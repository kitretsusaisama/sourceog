// sourceog-renderer/src/transpiler/worker-bootstrap.ts
// Alibaba CTO 2027 Standard — Worker Module Loader & Inline Transform

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { 
  NoTranspilerError, 
  TransformStrategyError, 
  ModuleLoadError 
} from '@sourceog/genbook/errors';
import { isProduction } from '@sourceog/genbook';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type TransformFunction = (code: string, filename: string) => Promise<string>;

const TRANSFORM_TMP_DIR = path.join(tmpdir(), 'sourceog-worker-transform');

// Ensure temp directory exists (idempotent)
if (!existsSync(TRANSFORM_TMP_DIR)) {
  try {
    mkdirSync(TRANSFORM_TMP_DIR, { recursive: true });
  } catch (e) {
    // Critical failure: cannot prepare transform cache
    logger.error('Failed to create transform temp directory', e);
  }
}

// ---------------------------------------------------------------------------
// Transform Strategy Resolvers (Lazy Loaded)
// ---------------------------------------------------------------------------

let _esbuildTransform: TransformFunction | null = null;
let _sucraseTransform: TransformFunction | null = null;

/**
 * Attempts to load esbuild transform function.
 */
async function getEsbuildTransform(): Promise<TransformFunction | null> {
  if (_esbuildTransform) return _esbuildTransform;
  try {
    const esbuild = await import('esbuild');
    _esbuildTransform = async (code, filename) => {
      const result = await esbuild.transform(code, {
        loader: filename.endsWith('.tsx') ? 'tsx' : filename.endsWith('.jsx') ? 'jsx' : 'ts',
        jsx: 'automatic',
        jsxImportSource: 'react',
        target: 'es2022',
        format: 'esm',
      });
      return result.code;
    };
    return _esbuildTransform;
  } catch {
    return null;
  }
}

/**
 * Attempts to load sucrase transform function.
 */
async function getSucraseTransform(): Promise<TransformFunction | null> {
  if (_sucraseTransform) return _sucraseTransform;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;
    const sucrase = await dynamicImport("sucrase").catch(() => null) as
      | {
          transform(code: string, options: {
            transforms: string[];
            jsxRuntime: string;
            production: boolean;
            filePath: string;
          }): { code: string };
        }
      | null;
    if (!sucrase) {
      return null;
    }
    _sucraseTransform = async (code, filename) => {
      return sucrase.transform(code, {
        transforms: ['typescript', 'jsx'],
        jsxRuntime: 'automatic',
        production: isProduction,
        filePath: filename,
      }).code;
    };
    return _sucraseTransform;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API: loadModule
// ---------------------------------------------------------------------------

/**
 * Loads a module inside a worker, handling inline transpilation if necessary.
 * 
 * @param specifier - The file path or URL to import.
 * @param useInlineTransform - Whether to attempt transpilation for TS/TSX files.
 * @returns The module exports.
 */
export async function loadModule(
  specifier: string,
  useInlineTransform: boolean = false
): Promise<unknown> {
  let fsPath: string;
  
  try {
    fsPath = specifier.startsWith('file://') ? fileURLToPath(specifier) : specifier;
  } catch {
    // If it's not a file URL, it might be a bare specifier (e.g. 'react')
    // We let it pass through to native import.
    return import(specifier);
  }

  const ext = path.extname(fsPath);

  // 1. No transform needed for standard JS
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return import(specifier.startsWith('file://') ? specifier : pathToFileURL(fsPath).href);
  }

  // 2. Check if transform is needed/supported
  const needsTransform = ext === '.tsx' || ext === '.ts' || ext === '.jsx';
  
  if (!needsTransform) {
    // Try native import for unknown extensions
    return import(specifier.startsWith('file://') ? specifier : pathToFileURL(fsPath).href);
  }

  if (!useInlineTransform) {
    // If not using inline transform, rely on native Node flags (already set in execArgv)
    // But if we reach here and it's TSX, something is wrong or we should try native.
    return import(specifier.startsWith('file://') ? specifier : pathToFileURL(fsPath).href);
  }

  // 3. Perform Inline Transform
  return loadWithInlineTransform(fsPath, specifier);
}

// ---------------------------------------------------------------------------
// Internal Implementation
// ---------------------------------------------------------------------------

/**
 * Transforms source and loads from a temporary file to support relative imports.
 */
async function loadWithInlineTransform(fsPath: string, originalSpecifier: string): Promise<unknown> {
  let source: string;
  try {
    source = readFileSync(fsPath, 'utf8');
  } catch (e) {
    throw new ModuleLoadError(originalSpecifier, fsPath, e);
  }

  const sourceHash = createHash('sha256').update(source).digest('hex').slice(0, 8);
  
  // Create a temp file path preserving the filename structure for debug
  const tmpFile = path.join(
    TRANSFORM_TMP_DIR, 
    `${path.basename(fsPath).replace(/[^a-zA-Z0-9.]/g, '_')}-${sourceHash}.mjs`
  );

  // Check cache (file existence)
  if (existsSync(tmpFile)) {
    logger.debug(`Loading cached transform: ${tmpFile}`);
    return import(pathToFileURL(tmpFile).href);
  }

  // Determine transformer
  let transformFn = await getEsbuildTransform();
  if (!transformFn) {
    transformFn = await getSucraseTransform();
  }

  if (!transformFn) {
    throw new NoTranspilerError(
      path.extname(fsPath), 
      ['esbuild', 'sucrase']
    );
  }

  try {
    logger.debug(`Transforming ${fsPath} -> ${tmpFile}`);
    const transformedCode = await transformFn(source, fsPath);
    writeFileSync(tmpFile, transformedCode, 'utf8');
    return import(pathToFileURL(tmpFile).href);
  } catch (err) {
    // Wrap specific errors
    if (err instanceof NoTranspilerError) throw err;
    throw new TransformStrategyError('inline-transform', fsPath, err);
  }
}

// ---------------------------------------------------------------------------
// Utility: resolveImportSpecifier
// ---------------------------------------------------------------------------

/**
 * Resolves an import specifier relative to a parent path.
 */
export function resolveImportSpecifier(specifier: string, parentPath: string): string {
  if (!specifier || typeof specifier !== 'string') {
    throw new TypeError(`Invalid import specifier: ${specifier}`);
  }
  
  // Node built-ins or data URLs
  if (specifier.startsWith('node:') || specifier.startsWith('data:') || specifier.startsWith('file://')) {
    return specifier;
  }
  
  if (path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }

  // Relative specifier
  if (specifier.startsWith('.')) {
    const parentDir = path.dirname(parentPath);
    const resolved = path.resolve(parentDir, specifier);
    return pathToFileURL(resolved).href;
  }

  // Bare specifier - try to resolve via require
  try {
    const req = createRequire(parentPath);
    const resolved = req.resolve(specifier);
    return pathToFileURL(resolved).href;
  } catch {
    // Return as-is if cannot resolve (might be handled by loader)
    return specifier;
  }
}
