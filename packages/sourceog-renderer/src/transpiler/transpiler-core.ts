// sourceog-renderer/src/transpiler/transpiler-core.ts
// Alibaba CTO 2027 Standard — Unified Transpiler Abstraction Layer (UTAL)

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { 
  NoTranspilerError, 
  TransformStrategyError 
} from '@sourceog/genbook/errors';
import { 
  isBun, 
  isDeno, 
  isNode, 
  RUNTIME_MAJOR, 
  isProduction 
} from '@sourceog/genbook';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supported transpiler strategies ordered by preference.
 */
export type TranspilerStrategy = 
  | 'bun-native'
  | 'deno-native'
  | 'node-strip-types'
  | 'node-transform-types'
  | 'tsx'
  | 'esbuild'
  | 'sucrase'
  | 'none';

/**
 * Result of the transpiler detection process.
 */
export interface TranspilerDetectionResult {
  /** The selected strategy. */
  strategy: TranspilerStrategy;
  /** Arguments to pass to the Node.js Worker thread (e.g., --import tsx). */
  execArgv: string[];
  /** If true, the worker must perform manual transpilation inside the thread. */
  useInlineFallback: boolean;
}

/**
 * Signature for an inline transform function.
 */
type TransformFunction = (code: string, filename: string) => Promise<string>;

const INLINE_BUNDLE_DIR = path.join(process.cwd(), '.sourceog', 'inline-bundles');

if (!existsSync(INLINE_BUNDLE_DIR)) {
  mkdirSync(INLINE_BUNDLE_DIR, { recursive: true });
}

function findNearestTsconfig(startPath: string): string | undefined {
  let current = path.dirname(startPath);
  while (true) {
    for (const candidate of ['tsconfig.base.json', 'tsconfig.json']) {
      const resolved = path.join(current, candidate);
      if (existsSync(resolved)) {
        return resolved;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Transpiler Manager
// ---------------------------------------------------------------------------

/**
 * Manages transpiler detection and configuration.
 * Implements the Singleton pattern to ensure detection runs only once.
 */
class TranspilerManager {
  private detectionResult: TranspilerDetectionResult | null = null;
  private initPromise: Promise<void> | null = null;

  // Cached inline transformers (lazy loaded)
  private esbuildTransform: TransformFunction | null = null;
  private sucraseTransform: TransformFunction | null = null;

  /**
   * Initializes the manager and detects the optimal strategy.
   * Idempotent and thread-safe via promise gating.
   */
  public async initialize(): Promise<void> {
    if (this.detectionResult) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.detect().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  /**
   * Performs the detection logic.
   */
  private async detect(): Promise<void> {
    let strategy: TranspilerStrategy = 'none';
    let execArgv: string[] = [];
    let useInlineFallback = false;

    // 1. Bun / Deno Native (Highest Priority)
    if (isBun) {
      strategy = 'bun-native';
      this.detectionResult = { strategy, execArgv: [], useInlineFallback: false };
      return;
    }
    if (isDeno) {
      strategy = 'deno-native';
      this.detectionResult = { strategy, execArgv: [], useInlineFallback: false };
      return;
    }

    // 2. TSX Loader (Preferred External Loader)
    // SourceOG source files commonly use `.js` specifiers from TypeScript modules.
    // `tsx` resolves that development graph far more reliably than Node's native
    // type stripping, especially inside worker threads.
    const tsxLoader = await this.findTsxLoader();
    if (tsxLoader) {
      strategy = 'tsx';
      execArgv = ['--import', tsxLoader, '--conditions=react-server'];
      this.detectionResult = { strategy, execArgv, useInlineFallback: false };
      return;
    }

    if (isProduction) {
      throw new NoTranspilerError(
        '.tsx',
        ['precompiled SourceOG artifacts', 'tsx'],
      );
    }

    // 3. Fallback to Inline Transform (Esbuild/Sucrase)
    // This requires installing the dependencies manually.
    logger.warn(
      '[SOURCEOG] No native transpiler or tsx found. Falling back to inline transformation. ' +
      'Install "tsx" or "esbuild" for better performance.'
    );

    await this.setupInlineTransformers();

    if (isNode && RUNTIME_MAJOR >= 22) {
      if (this.esbuildTransform) {
        strategy = 'esbuild';
        useInlineFallback = true;
      } else if (this.sucraseTransform) {
        strategy = 'sucrase';
        useInlineFallback = true;
      } else {
        strategy = 'node-transform-types';
        execArgv = ['--experimental-transform-types', '--conditions=react-server'];
        this.detectionResult = { strategy, execArgv, useInlineFallback: false };
        return;
      }
    } else if (this.esbuildTransform) {
      strategy = 'esbuild';
      useInlineFallback = true;
    } else if (this.sucraseTransform) {
      strategy = 'sucrase';
      useInlineFallback = true;
    } else {
      throw new NoTranspilerError('.tsx', ['tsx', 'esbuild', 'sucrase', 'native']);
    }

    this.detectionResult = {
      strategy,
      execArgv: ['--conditions=react-server'],
      useInlineFallback,
    };
  }

  /**
   * Returns the worker exec configuration (execArgv + strategy).
   */
  public getWorkerExecArgv(): TranspilerDetectionResult {
    return this.detectionResult ?? { strategy: 'none', execArgv: [], useInlineFallback: false };
  }

  /**
   * Returns true if the worker needs to perform its own transpilation.
   */
  public useInlineTransform(): boolean {
    return this.detectionResult?.useInlineFallback ?? false;
  }
  
  /**
   * Returns the detected strategy name.
   */
  public getStrategyName(): TranspilerStrategy {
    return this.detectionResult?.strategy ?? 'none';
  }

  /**
   * Transforms source code inline (Main Thread Fallback).
   * Used only when no native/loader strategy is available.
   */
  public async transform(code: string, filename: string): Promise<string> {
    if (!this.esbuildTransform && !this.sucraseTransform) {
      await this.setupInlineTransformers();
    }

    if (this.esbuildTransform) {
      try {
        return await this.esbuildTransform(code, filename);
      } catch (err) {
        throw new TransformStrategyError('esbuild', filename, err);
      }
    }

    if (this.sucraseTransform) {
      try {
        return await this.sucraseTransform(code, filename);
      } catch (err) {
        throw new TransformStrategyError('sucrase', filename, err);
      }
    }

    throw new NoTranspilerError(path.extname(filename), ['esbuild', 'sucrase']);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempts to load esbuild and sucrase for inline transformation.
   */
  private async setupInlineTransformers(): Promise<void> {
    // Try Esbuild
    try {
      const esbuild = await loadEsbuildModule();
      this.esbuildTransform = async (code, filename) => {
        const result = await esbuild.transform(code, {
          loader: filename.endsWith('.tsx') ? 'tsx' : filename.endsWith('.jsx') ? 'jsx' : 'ts',
          jsx: 'automatic',
          jsxImportSource: 'react',
          target: 'es2022',
          format: 'esm',
        });
        return result.code;
      };
      return; // Prefer esbuild if available
    } catch { /* Fallthrough */ }

    // Try Sucrase
    try {
      // @ts-ignore - sucrase is an optional dependency
      const sucrase = await import('sucrase') as any;
      this.sucraseTransform = async (code, filename) => {
        return sucrase.transform(code, {
          transforms: ['typescript', 'jsx'],
          jsxRuntime: 'automatic',
          filePath: filename,
        }).code;
      };
    } catch { /* Fallthrough */ }
  }

  /**
   * Robustly locates the tsx/esm loader entry point.
   * Supports monorepos by checking parent directories.
   */
  private async findTsxLoader(): Promise<string | null> {
    // Strategy 1: import.meta.resolve (Node 20.6+)
    try {
      // @ts-ignore - import.meta.resolve is stage 3/4
      if (typeof import.meta.resolve === 'function') {
        // @ts-ignore
        const url = import.meta.resolve('tsx/esm');
        if (url) return url;
      }
    } catch {}

    // Strategy 2: Package.json exports lookup from CWD and Parent Directories
    // This handles monorepos where tsx is installed at the root.
    const searchPaths = [process.cwd()];
    let current = process.cwd();
    for (let i = 0; i < 5; i++) { // Walk up 5 levels
      const parent = path.dirname(current);
      if (parent === current) break;
      searchPaths.push(parent);
      current = parent;
    }

    for (const searchPath of searchPaths) {
      try {
        const req = createRequire(path.join(searchPath, 'dummy.js'));
        const pkgPath = req.resolve('tsx/package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        
        const esmExport = pkg.exports?.['./esm'];
        let rel: string | undefined;
        
        if (typeof esmExport === 'string') rel = esmExport;
        else if (typeof esmExport === 'object' && esmExport !== null) rel = esmExport.import ?? esmExport.default;

        if (rel) {
          const resolved = path.join(path.dirname(pkgPath), rel);
          if (existsSync(resolved)) return pathToFileURL(resolved).href;
        }
      } catch { /* Try next path */ }
    }

    return null;
  }
}

// Singleton Instance
export const transpilerManager = new TranspilerManager();

/**
 * Loads a module by URL, optionally applying inline transformation.
 * Used by the worker-side module loader (compat-module-loader.ts).
 */
export async function loadModule(url: string, useInlineTransform: boolean): Promise<unknown> {
  if (useInlineTransform) {
    const { fileURLToPath } = await import('node:url');
    const fsPath = url.startsWith('file:') ? fileURLToPath(url) : url;
    return bundleAndLoadModule(fsPath);
  }
  return import(url);
}

async function bundleAndLoadModule(fsPath: string): Promise<unknown> {
  const source = readFileSync(fsPath, 'utf8');
  const hash = createHash('sha256')
    .update(fsPath)
    .update(source)
    .digest('hex')
    .slice(0, 12);

  const tmpFile = path.join(
    INLINE_BUNDLE_DIR,
    `${path.basename(fsPath, path.extname(fsPath))}-${hash}.mjs`,
  );

  try {
    const esbuild = await loadEsbuildModule();
    const tsconfig = findNearestTsconfig(fsPath);
    const result = await esbuild.build({
      absWorkingDir: process.cwd(),
      bundle: true,
      conditions: ['react-server'],
      entryPoints: [fsPath],
      external: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/server',
        'react-server-dom-webpack',
        'react-server-dom-webpack/*',
      ],
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'react',
      logLevel: 'silent',
      platform: 'node',
      sourcemap: 'inline',
      target: 'es2022',
      ...(tsconfig ? { tsconfig } : {}),
      write: false,
    });

    const bundled = result.outputFiles?.[0]?.text;
    if (!bundled) {
      throw new Error(`No bundled output produced for ${fsPath}.`);
    }

    writeFileSync(tmpFile, bundled, 'utf8');
  } catch (error) {
    const transformed = await transpilerManager.transform(source, fsPath);
    writeFileSync(tmpFile, transformed, 'utf8');
    logger.warn('Fell back to single-file inline transform for module graph', {
      file: fsPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return import(pathToFileURL(tmpFile).href + `?t=${Date.now()}`);
}

async function loadEsbuildModule(): Promise<typeof import('esbuild')> {
  const normalizeEsbuildModule = (
    moduleValue: typeof import('esbuild') | { default?: typeof import('esbuild') },
  ): typeof import('esbuild') => {
    if (
      moduleValue
      && typeof moduleValue === 'object'
      && 'build' in moduleValue
      && typeof moduleValue.build === 'function'
    ) {
      return moduleValue as typeof import('esbuild');
    }

    const nested = (moduleValue as { default?: typeof import('esbuild') }).default;
    if (nested && typeof nested.build === 'function') {
      return nested;
    }

    throw new Error('Resolved esbuild module does not expose a usable build() API.');
  };

  try {
    return normalizeEsbuildModule(await import('esbuild'));
  } catch {
    const rootRequire = createRequire(path.join(process.cwd(), 'sourceog-inline-resolver.cjs'));
    return normalizeEsbuildModule(
      rootRequire('esbuild') as typeof import('esbuild') | { default?: typeof import('esbuild') },
    );
  }
}
