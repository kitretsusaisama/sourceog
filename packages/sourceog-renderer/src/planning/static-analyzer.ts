// sourceog-renderer/src/planning/static-analyzer.ts
// Alibaba CTO 2027 Standard — Route Static Analysis

import type { StaticAnalysisResult } from './planner-types.js';
import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../core/logger.js';

/**
 * Analyzes route modules to determine static eligibility and dynamic behaviors.
 *
 * This implementation uses lightweight heuristics:
 * - export inspection
 * - simple source scanning (string-based)
 *
 * For production build-time analysis, this should be replaced with a full
 * AST-based analyzer integrated into the bundler.
 */
export class StaticAnalyzer {
  /**
   * Analyzes a route module to determine its rendering characteristics.
   *
   * @param moduleExports - The imported module object to inspect.
   * @param filePath - The file path used for source scanning if needed.
   */
  public analyze(
    moduleExports: Record<string, unknown>,
    filePath?: string,
  ): StaticAnalysisResult {
    const result: StaticAnalysisResult = {
      isPure: true, // Assume pure until proven dynamic
      hasActions: false,
      clientBoundaries: [],
    };

    // 1. Check for dynamic function exports / config hints
    // e.g. export const dynamic = 'force-dynamic'
    const dynamicValue = moduleExports['dynamic'];
    if (typeof dynamicValue === 'string') {
      result.isPure = false;
    }

    // 2. Inspect exported functions for server actions and client boundaries
    for (const key of Object.keys(moduleExports)) {
      const exportValue = moduleExports[key];

      if (typeof exportValue === 'function') {
        // Heuristic: functions starting with "action" are likely server actions
        if (key.startsWith('action')) {
          result.hasActions = true;
        }
      }

      // Heuristic for client boundaries:
      // If an export has a special marker like `__client_boundary__`,
      // we treat it as a client boundary.
      if (
        typeof exportValue === 'object' &&
        exportValue !== null &&
        '__client_boundary__' in (exportValue as Record<string, unknown>) &&
        (exportValue as Record<string, unknown>)['__client_boundary__'] === true
      ) {
        result.clientBoundaries.push(key);
      }
    }

    // 3. Source Code Scanning Heuristic
    if (filePath && existsSync(filePath)) {
      try {
        const source = readFileSync(filePath, 'utf-8');

        // Detection patterns for dynamic rendering triggers
        const dynamicPatterns = [
          /cookies\(/,
          /headers\(/,
          /searchParams/,
          /Math\.random\(/,
          /Date\.now\(/,
        ];

        for (const pattern of dynamicPatterns) {
          if (pattern.test(source)) {
            result.isPure = false;
            logger.debug(
              `Static analysis detected dynamic pattern in ${filePath}: ${pattern}`,
            );
            break;
          }
        }
      } catch {
        // Ignore read errors; rely solely on export-based analysis
      }
    }

    return result;
  }
}

/**
 * Singleton instance for convenience.
 */
export const staticAnalyzer = new StaticAnalyzer();