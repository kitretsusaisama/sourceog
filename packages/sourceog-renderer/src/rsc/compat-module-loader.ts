// sourceog-renderer/src/rsc/compat-module-loader.ts
// Alibaba CTO 2027 Standard — RSC Module Loader (Worker Context)
//
// This module runs inside the RSC worker thread. It provides a thin abstraction
// over the Unified Transpiler Abstraction Layer (UTAL) to load route modules
// (pages, layouts, templates) in a portable, cross-runtime way.

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { ModuleLoadError, TranspileError } from '@sourceog/genbook';
import { loadModule } from '../transpiler/transpiler-core.js';import { logger } from '../core/logger.js';

/**
 * Indicates whether this worker should attempt inline transformation for
 * TypeScript / TSX / JSX sources. This is configured at worker bootstrap
 * based on the detected transpiler strategy.
 */
let USE_INLINE_TRANSFORM = false;

/**
 * Configuration payload for the module loader.
 */
export interface ModuleLoaderOptions {
  /**
   * If true, enables inline transformation via UTAL for TS/TSX/JSX files.
   */
  useInlineTransform: boolean;
}

/**
 * Configures the module loader for the current worker context.
 * Must be called once during worker initialization.
 *
 * @param options - Module loader configuration.
 */
export function configureModuleLoader(options: ModuleLoaderOptions): void {
  USE_INLINE_TRANSFORM = options.useInlineTransform;
}

/**
 * Normalizes a file system path or URL-like specifier into an ESM import URL.
 *
 * Supported inputs:
 * - file URL: returned as-is.
 * - absolute path: converted to file URL.
 * - relative path: resolved against process.cwd() and converted to file URL.
 */
function normalizeSpecifierToUrl(specifier: string): string {
  if (specifier.startsWith('file:')) {
    return specifier;
  }

  if (path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }

  const absolutePath = path.resolve(process.cwd(), specifier);
  return pathToFileURL(absolutePath).href;
}

/**
 * Loads an arbitrary module inside the worker, handling inline transpilation
 * via the UTAL layer when necessary.
 *
 * This is the fundamental primitive used by higher-level helpers
 * (route loaders, component resolvers, etc.) to obtain module exports.
 *
 * @param specifier - File path or file URL for the module to load.
 * @returns The loaded module's exports object.
 * @throws ModuleLoadError | TranspileError
 */
export async function loadRouteModule(
  specifier: string,
): Promise<Record<string, unknown>> {
  let url: string;

  try {
    url = normalizeSpecifierToUrl(specifier);
  } catch (error) {
    throw new ModuleLoadError(
      `Failed to normalize module specifier: ${specifier}`,
      specifier,
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  const fsPath =
    url.startsWith('file:') ? fileURLToPath(url) : specifier;

  const runtimeGlobals = globalThis as typeof globalThis & {
    __SOURCEOG_RSC_PARENT_MODULE_FILE__?: string;
  };
  const previousParentModuleFile = runtimeGlobals.__SOURCEOG_RSC_PARENT_MODULE_FILE__;

  try {
    runtimeGlobals.__SOURCEOG_RSC_PARENT_MODULE_FILE__ = fsPath;
    const mod = await loadModule(url, USE_INLINE_TRANSFORM);
    return mod as Record<string, unknown>;
  } catch (error) {
    // Preserve explicit transpile errors; wrap others in ModuleLoadError.
    if (error instanceof TranspileError) {
      logger.error('Transpile error while loading route module', {
        file: fsPath,
        code: error.code,
        message: error.message,
      });
      throw error;
    }

    logger.error('Failed to load route module', {
      file: fsPath,
      message: (error as Error)?.message,
    });

    throw new ModuleLoadError(
      `Failed to load route module: ${fsPath}`,
      fsPath,
      error instanceof Error ? error : new Error(String(error)),
    );
  } finally {
    runtimeGlobals.__SOURCEOG_RSC_PARENT_MODULE_FILE__ = previousParentModuleFile;
  }
}
