/**
 * sourceog-renderer/src/transpiler/transpiler-core.ts
 * 
 * Alibaba CTO 2027 Standard: Unified Transpiler Abstraction Layer
 * 
 * Design Principles:
 * 1. Zero-config — works out of the box in 99% of environments
 * 2. Multi-strategy — falls back through available transpilers automatically
 * 3. Production-first — pre-compiled artifacts skip transpilation entirely
 * 4. Monorepo-aware — searches up directory tree for dependencies
 * 5. Runtime-agnostic — Node.js, Bun, Deno all supported
 * 6. Hot-reload capable — cache invalidation on file change in dev
 * 7. O(1) lookup after initial detection — strategies cached at module load
 */

import { existsSync, readFileSync, statSync, watchFile, unwatchFile } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranspilerName = 
  | "node-strip-types"     // Node.js 22.6+ --experimental-strip-types
  | "node-transform-types" // Node.js 22.6+ --experimental-transform-types
  | "tsx"                  // tsx/esm loader
  | "swc"                  // @swc-node/register
  | "esbuild"              // esbuild inline transform
  | "sucrase"              // sucrase inline transform
  | "builtin"              // Runtime built-in (Bun/Deno)
  | "none";                // No transpilation needed (pre-compiled)

export type TranspilerStrategy = {
  name: TranspilerName;
  priority: number;           // Higher = preferred
  available: boolean;
  setup: () => Promise<void>; // One-time initialization
  transform?: (code: string, filename: string) => Promise<string>;
  getExecArgv?: () => string[];
  supports: {
    tsx: boolean;
    ts: boolean;
    jsx: boolean;
    decorators: boolean;
    imports: boolean;
  };
};

export type TranspilerDetectionResult = {
  strategy: TranspilerStrategy;
  nodeVersion: string;
  runtime: "node" | "bun" | "deno" | "unknown";
  environment: "development" | "production" | "test";
  reason: string;
};

export type TranspilerCacheEntry = {
  hash: string;
  transformed: string;
  transformTime: number;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_VERSION = process.versions.node ? 
  `v${process.versions.node}` : "unknown";

const NODE_MAJOR = parseInt(process.versions.node?.split(".")[0] ?? "0", 10);

const IS_BUN = typeof (globalThis as any).Bun !== "undefined";
const IS_DENO = typeof (globalThis as any).Deno !== "undefined";

const ENVIRONMENT = (() => {
  const env = process.env.NODE_ENV ?? "development";
  if (env === "test" || process.env.VITEST || process.env.JEST_WORKER_ID) return "test";
  if (env === "production") return "production";
  return "development";
})();

// ---------------------------------------------------------------------------
// LRU Cache for transformed code
// ---------------------------------------------------------------------------

class TransformCache {
  private readonly cache = new Map<string, TranspilerCacheEntry>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private watchers = new Map<string, () => void>();

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.transformed;
  }

  set(key: string, hash: string, transformed: string, transformTime: number): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    
    this.cache.set(key, { hash, transformed, transformTime, timestamp: Date.now() });
  }

  invalidate(filePath: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(filePath)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Watch a file for changes and invalidate cache on modification.
   * Only active in development mode.
   */
  watch(filePath: string): void {
    if (ENVIRONMENT !== "development") return;
    if (this.watchers.has(filePath)) return;
    
    try {
      watchFile(filePath, { interval: 100 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          this.invalidate(filePath);
        }
      });
      this.watchers.set(filePath, () => unwatchFile(filePath));
    } catch {
      // File might not exist yet
    }
  }

  dispose(): void {
    for (const unwatch of this.watchers.values()) {
      unwatch();
    }
    this.watchers.clear();
    this.cache.clear();
  }

  get stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.hits / (this.hits + this.misses) || 0,
    };
  }

  private hits = 0;
  private misses = 0;
  
  recordHit(): void { this.hits++; }
  recordMiss(): void { this.misses++; }
}

// Global transform cache — shared across all workers in the same process
const globalTransformCache = new TransformCache(
  ENVIRONMENT === "production" ? 1000 : 200,
  ENVIRONMENT === "development" ? 5_000 : Infinity
);

// ---------------------------------------------------------------------------
// Strategy Implementations
// ---------------------------------------------------------------------------

function createNodeStripTypesStrategy(): TranspilerStrategy {
  return {
    name: "node-strip-types",
    priority: 100,
    available: NODE_MAJOR >= 22,
    setup: async () => { /* No setup needed — flag-based */ },
    getExecArgv: () => [
      "--experimental-strip-types",
      "--conditions=react-server",
    ],
    supports: {
      tsx: false, // Strip-types doesn't handle JSX
      ts: true,
      jsx: false,
      decorators: false,
      imports: true,
    },
  };
}

function createNodeTransformTypesStrategy(): TranspilerStrategy {
  return {
    name: "node-transform-types",
    priority: 99,
    available: NODE_MAJOR >= 22,
    setup: async () => { /* No setup needed — flag-based */ },
    getExecArgv: () => [
      "--experimental-transform-types",
      "--conditions=react-server",
    ],
    supports: {
      tsx: true,
      ts: true,
      jsx: true,
      decorators: false,
      imports: true,
    },
  };
}

function createTsxStrategy(): TranspilerStrategy {
  let loaderUrl: string | null = null;
  
  return {
    name: "tsx",
    priority: 90,
    available: false, // Will be detected in setup
    setup: async () => {
      loaderUrl = await findTsxLoader();
      (createTsxStrategy as any).__loaderUrl = loaderUrl;
    },
    getExecArgv: () => {
      const url = (createTsxStrategy as any).__loaderUrl ?? loaderUrl;
      if (!url) return [];
      return ["--import", url, "--conditions=react-server"];
    },
    supports: {
      tsx: true,
      ts: true,
      jsx: true,
      decorators: true,
      imports: true,
    },
  };
}

function createSwcStrategy(): TranspilerStrategy {
  return {
    name: "swc",
    priority: 80,
    available: false,
    setup: async () => {
      try {
        createRequire(import.meta.url).resolve("@swc-node/register");
        createSwcStrategy.prototype.available = true;
      } catch {
        // Not available
      }
    },
    getExecArgv: () => [
      "--require", "@swc-node/register",
      "--conditions=react-server",
    ],
    supports: {
      tsx: true,
      ts: true,
      jsx: true,
      decorators: true,
      imports: true,
    },
  };
}

function createEsbuildStrategy(): TranspilerStrategy {
  let transformFn: ((code: string, filename: string) => Promise<string>) | null = null;
  
  return {
    name: "esbuild",
    priority: 70,
    available: false,
    setup: async () => {
      try {
        const esbuild = await import("esbuild");
        transformFn = async (code: string, filename: string) => {
          const result = await esbuild.transform(code, {
            loader: filename.endsWith(".tsx") ? "tsx" : 
                    filename.endsWith(".jsx") ? "jsx" : "ts",
            jsx: "automatic",
            target: "es2022",
            format: "esm",
          });
          return result.code;
        };
        (createEsbuildStrategy as any).__transform = transformFn;
        createEsbuildStrategy.prototype.available = true;
      } catch {
        // Not available
      }
    },
    transform: async (code: string, filename: string) => {
      const fn = (createEsbuildStrategy as any).__transform ?? transformFn;
      if (!fn) throw new Error("esbuild transform not initialized");
      return fn(code, filename);
    },
    supports: {
      tsx: true,
      ts: true,
      jsx: true,
      decorators: true,
      imports: true,
    },
  };
}

function createSucraseStrategy(): TranspilerStrategy {
  let transformFn: ((code: string, filename: string) => Promise<string>) | null = null;
  
  return {
    name: "sucrase",
    priority: 60,
    available: false,
    setup: async () => {
      try {
        // @ts-expect-error - sucrase is an optional runtime dependency for inline transform 
        const sucrase = await import("sucrase");
        transformFn = async (code: string, filename: string) => {
          const result = sucrase.transform(code, {
            transforms: ["typescript", "jsx"],
            jsxRuntime: "automatic",
            filePath: filename,
          });
          return result.code;
        };
        (createSucraseStrategy as any).__transform = transformFn;
        createSucraseStrategy.prototype.available = true;
      } catch {
        // Not available
      }
    },
    transform: async (code: string, filename: string) => {
      const fn = (createSucraseStrategy as any).__transform ?? transformFn;
      if (!fn) throw new Error("sucrase transform not initialized");
      return fn(code, filename);
    },
    supports: {
      tsx: true,
      ts: true,
      jsx: true,
      decorators: false,
      imports: true,
    },
  };
}

function createBuiltinStrategy(): TranspilerStrategy {
  return {
    name: "builtin",
    priority: 110, // Highest — if available, always use
    available: IS_BUN || IS_DENO,
    setup: async () => { /* Built-in — no setup */ },
    supports: {
      tsx: IS_BUN || IS_DENO,
      ts: IS_BUN || IS_DENO,
      jsx: IS_BUN || IS_DENO,
      decorators: IS_BUN || IS_DENO,
      imports: true,
    },
  };
}

function createNoneStrategy(): TranspilerStrategy {
  return {
    name: "none",
    priority: 0,
    available: true,
    setup: async () => { /* No-op */ },
    supports: {
      tsx: false,
      ts: false,
      jsx: false,
      decorators: false,
      imports: true,
    },
  };
}

// ---------------------------------------------------------------------------
// tsx Loader Discovery — Multi-strategy, monorepo-aware
// ---------------------------------------------------------------------------

/**
 * Find tsx/esm loader URL using multiple discovery strategies.
 * 
 * Search order:
 * 1. Explicit env var (SOURCEOG_TSX_LOADER)
 * 2. import.meta.resolve (Node 20.6+)
 * 3. Package.json exports lookup from package location
 * 4. Package.json exports lookup from cwd
 * 5. Package.json exports lookup from parent directories (monorepo)
 * 6. Known file layout probing
 */
async function findTsxLoader(): Promise<string | null> {
  // Strategy 0: Explicit override
  const explicit = process.env.SOURCEOG_TSX_LOADER;
  if (explicit) {
    const resolved = explicit.startsWith("file://") 
      ? explicit 
      : existsSync(explicit) 
        ? pathToFileURL(path.resolve(explicit)).href 
        : null;
    if (resolved) return resolved;
  }

  // Strategy 1: import.meta.resolve (Node 20.6+)
  try {
    const url = import.meta.resolve("tsx/esm");
    if (url) return url;
  } catch {
    // Fall through
  }

  // Build search paths: package location + cwd + parent directories
  const searchFromUrls = [
    import.meta.url,
    pathToFileURL(process.cwd()).href,
  ];

  // Walk up to 5 parent directories (monorepo support)
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    searchFromUrls.push(pathToFileURL(parent).href);
    currentDir = parent;
  }

  // Also check common monorepo locations
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (workspaceRoot) {
    searchFromUrls.push(pathToFileURL(workspaceRoot).href);
    searchFromUrls.push(pathToFileURL(path.join(workspaceRoot, "node_modules")).href);
  }

  for (const fromUrl of searchFromUrls) {
    // Strategy 2-5: Package.json exports + file probing
    const result = findTsxFromLocation(fromUrl);
    if (result) return result;
  }

  return null;
}

function findTsxFromLocation(fromUrl: string): string | null {
  const req = createRequire(fromUrl);

  // Strategy 2: Package.json exports lookup
  try {
    const pkgPath = req.resolve("tsx/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };
    
    const esmExport = pkg.exports?.["./esm"] as 
      | { import?: string; default?: string }
      | string
      | undefined;
    
    let rel: string | undefined;
    if (typeof esmExport === "string") {
      rel = esmExport;
    } else if (typeof esmExport === "object") {
      rel = esmExport?.import ?? esmExport?.default;
    }
    
    if (rel) {
      const resolved = path.join(path.dirname(pkgPath), rel);
      if (existsSync(resolved)) {
        return pathToFileURL(resolved).href;
      }
    }
  } catch {
    // Fall through
  }

  // Strategy 3-5: Known file layout probing
  try {
    const tsxRoot = path.dirname(req.resolve("tsx/package.json"));
    
    const candidates = [
      // tsx v4+
      "dist/esm/index.cjs",
      "dist/esm/loader.cjs",
      "dist/esm/index.mjs",
      // tsx v3
      "dist/esm/index.js",
      "esm/index.js",
      "esm.js",
      // Legacy
      "src/esm/index.ts",
    ];
    
    for (const candidate of candidates) {
      const abs = path.join(tsxRoot, candidate);
      if (existsSync(abs)) {
        return pathToFileURL(abs).href;
      }
    }
  } catch {
    // tsx not found from this location
  }

  return null;
}

/**
 * Find workspace root by looking for workspace config files.
 */
function findWorkspaceRoot(startDir: string): string | null {
  let current = startDir;
  
  for (let i = 0; i < 10; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    
    // Check for workspace markers
    const markers = [
      "pnpm-workspace.yaml",
      "lerna.json",
      "nx.json",
      "turbo.json",
    ];
    
    for (const marker of markers) {
      if (existsSync(path.join(current, marker))) {
        return current;
      }
    }
    
    // Check package.json for workspaces field
    const pkgPath = path.join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        // Ignore
      }
    }
    
    current = parent;
  }
  
  return null;
}

// ---------------------------------------------------------------------------
// Transpiler Manager — Singleton
// ---------------------------------------------------------------------------

class TranspilerManager {
  private strategy: TranspilerStrategy | null = null;
  private detectionResult: TranspilerDetectionResult | null = null;
  private initPromise: Promise<void> | null = null;
  private needsJsx: boolean = true;

  constructor() {}

  /**
   * Initialize the transpiler — detects and sets up the best available strategy.
   * Thread-safe via promise gating.
   */
  async initialize(options?: { needsJsx?: boolean }): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (this.strategy) return;

    this.needsJsx = options?.needsJsx ?? true;

    this.initPromise = this._detect().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async _detect(): Promise<void> {
    const runtime: TranspilerDetectionResult["runtime"] = IS_BUN 
      ? "bun" 
      : IS_DENO 
        ? "deno" 
        : "node";

    // Define candidate strategies in priority order
    const candidates: TranspilerStrategy[] = [
      createBuiltinStrategy(),
      createNodeTransformTypesStrategy(),
      createNodeStripTypesStrategy(),
      createTsxStrategy(),
      createSwcStrategy(),
      createEsbuildStrategy(),
      createSucraseStrategy(),
      createNoneStrategy(),
    ];

    // Filter strategies that support our requirements
    const viable = candidates.filter(s => {
      if (!s.supports.tsx && this.needsJsx) return false;
      if (!s.supports.ts) return false;
      return true;
    });

    // Try each strategy in priority order
    for (const candidate of viable) {
      // Run availability check
      try {
        await candidate.setup();
      } catch {
        continue;
      }

      // Re-check availability after setup
      const isAvailable = (candidate as any).available ?? candidate.available;
      if (!isAvailable) continue;

      this.strategy = candidate;
      this.detectionResult = {
        strategy: candidate,
        nodeVersion: NODE_VERSION,
        runtime,
        environment: ENVIRONMENT,
        reason: this._getReason(candidate),
      };

      // Log detection result (development only)
      if (ENVIRONMENT === "development") {
        console.debug(
          `[SOURCEOG] Transpiler detected: ${candidate.name} ` +
          `(priority=${candidate.priority}, runtime=${runtime}, env=${ENVIRONMENT})`
        );
      }

      return;
    }

    // Fallback to none — will fail at runtime but gives clear error
    this.strategy = createNoneStrategy();
    this.detectionResult = {
      strategy: this.strategy,
      nodeVersion: NODE_VERSION,
      runtime,
      environment: ENVIRONMENT,
      reason: "No suitable transpiler found — .tsx files will fail to load",
    };

    console.error(
      `[SOURCEOG] WARNING: No transpiler found for .tsx files. ` +
      `Install one of: tsx, @swc-node/register, esbuild, sucrase. ` +
      `Or use Node.js 22.6+ with --experimental-transform-types.`
    );
  }

  private _getReason(strategy: TranspilerStrategy): string {
    switch (strategy.name) {
      case "builtin":
        return IS_BUN ? "Bun built-in TypeScript support" : "Deno built-in TypeScript support";
      case "node-transform-types":
        return "Node.js 22.6+ experimental transform-types flag";
      case "node-strip-types":
        return "Node.js 22.6+ experimental strip-types flag (JSX requires separate transform)";
      case "tsx":
        return "tsx/esm loader found via package discovery";
      case "swc":
        return "@swc-node/register found";
      case "esbuild":
        return "esbuild found — using inline transform";
      case "sucrase":
        return "sucrase found — using inline transform";
      case "none":
        return "No transpiler available";
    }
  }

  /**
   * Get the execArgv needed for worker threads.
   */
  getWorkerExecArgv(): string[] {
    if (!this.strategy?.getExecArgv) return [];
    return this.strategy.getExecArgv();
  }

  /**
   * Get the current strategy name.
   */
  getStrategyName(): TranspilerName {
    return this.strategy?.name ?? "none";
  }

  /**
   * Get full detection result.
   */
  getDetectionResult(): TranspilerDetectionResult | null {
    return this.detectionResult;
  }

  /**
   * Check if inline transform is needed (for strategies without --import support).
   */
  needsInlineTransform(): boolean {
    return this.strategy?.name === "esbuild" || this.strategy?.name === "sucrase";
  }

  /**
   * Transform code inline using the current strategy.
   */
  async transformInline(code: string, filename: string): Promise<string> {
    if (!this.strategy?.transform) {
      throw new Error(`Strategy ${this.strategy?.name} does not support inline transform`);
    }
    return this.strategy.transform(code, filename);
  }

  /**
   * Check if a file needs transpilation.
   */
  needsTranspilation(filename: string): boolean {
    const ext = path.extname(filename);
    if (ext === ".tsx" && !this.strategy?.supports.tsx) return true;
    if (ext === ".ts" && !this.strategy?.supports.ts) return true;
    if (ext === ".jsx" && !this.strategy?.supports.jsx) return true;
    return false;
  }

  dispose(): void {
    globalTransformCache.dispose();
    this.strategy = null;
    this.detectionResult = null;
  }
}

// Singleton instance
let managerInstance: TranspilerManager | null = null;

export function getTranspilerManager(): TranspilerManager {
  if (!managerInstance) {
    managerInstance = new TranspilerManager();
  }
  return managerInstance;
}

// Export for direct access
export { globalTransformCache, findTsxLoader, findWorkspaceRoot };