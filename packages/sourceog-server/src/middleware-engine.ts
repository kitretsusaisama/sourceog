import { createLogger } from "@sourceog/runtime";

const logger = createLogger();

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type FrameworkErrorCode =
  | "CONFIG_INVALID"
  | "ENV_MISSING_REQUIRED"
  | "ROUTE_COLLISION"
  | "STATIC_ROUTE_USES_RUNTIME_API"
  | "EDGE_INCOMPATIBLE_API"
  | "ISR_LOCK_TIMEOUT"
  | "RENDER_HYDRATION_MISMATCH"
  | "BUNDLE_BUDGET_EXCEEDED"
  | "ADAPTER_CAPABILITY_MISSING"
  | "MIDDLEWARE_COMPILE_ERROR"
  | "VALIDATION_FAILED"
  | "AUTH_SESSION_INVALID"
  | "I18N_LOCALE_NOT_FOUND";

export type FrameworkLayer =
  | "config"
  | "discovery"
  | "manifest"
  | "runtime"
  | "compiler"
  | "renderer"
  | "platform"
  | "adapter"
  | "diagnostics";

export class FrameworkError extends Error {
  public readonly code: FrameworkErrorCode;
  public readonly layer: FrameworkLayer;
  public readonly routeKey?: string;
  public readonly context: Record<string, unknown>;
  public readonly recoverable: boolean;

  public constructor(
    code: FrameworkErrorCode,
    message: string,
    options: {
      layer?: FrameworkLayer;
      routeKey?: string;
      context?: Record<string, unknown>;
      recoverable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.layer = options.layer ?? "runtime";
    this.routeKey = options.routeKey;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
  }
}

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

export type MatcherPattern = string;

export interface SourceOGRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  geo?: { country?: string; city?: string };
  ip?: string;
  requestId: string;
  traceId: string;
}

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  maxAge?: number;
  path?: string;
  domain?: string;
};

export type NextFunction = () => void;

export interface MiddlewareResponse {
  rewrite(destination: string): void;
  redirect(destination: string, status?: 301 | 302 | 307 | 308): void;
  setHeader(name: string, value: string): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  next(): void;
}

export type MiddlewareHandler = (
  req: SourceOGRequest,
  res: MiddlewareResponse,
  next: NextFunction
) => Promise<void>;

export interface MiddlewareDefinition {
  id: string;
  scope: "global" | "scoped" | "route-local";
  matcher: MatcherPattern[];
  handler: MiddlewareHandler;
  edgeCompatible: boolean;
  priority: number;
}

// ---------------------------------------------------------------------------
// Compiled types
// ---------------------------------------------------------------------------

export interface CompiledMatcher {
  /** Returns true if pathname matches at least one pattern in the definition. */
  test(pathname: string): boolean;
  /** The original patterns this matcher was compiled from. */
  patterns: MatcherPattern[];
}

export interface CompiledMiddlewareEntry {
  id: string;
  scope: "global" | "scoped" | "route-local";
  matcher: CompiledMatcher;
  handler: MiddlewareHandler;
  edgeCompatible: boolean;
  priority: number;
}

export interface CompiledMiddlewareManifest {
  /** All entries sorted by priority descending. */
  entries: CompiledMiddlewareEntry[];
  /** Subset of entries where edgeCompatible === true. */
  edgeEntries: CompiledMiddlewareEntry[];
}

// ---------------------------------------------------------------------------
// MiddlewareResult
// ---------------------------------------------------------------------------

export interface MiddlewareResult {
  action: "next" | "redirect" | "rewrite";
  destination?: string;
  status?: number;
  headers: Record<string, string>;
  cookies: Array<{ name: string; value: string; options?: CookieOptions }>;
}

// ---------------------------------------------------------------------------
// Pattern compilation
// ---------------------------------------------------------------------------

/**
 * Strips CRLF characters from header/cookie values to prevent HTTP response splitting.
 * Requirements: 11.2, 11.3
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Convert a glob-style matcher pattern to a RegExp.
 *
 * Supported syntax:
 *   - Exact paths:        "/about"
 *   - Next.js bracket:    "/blog/[slug]"  → single segment
 *   - Next.js catch-all:  "/blog/[...slug]" or "/blog/[[...slug]]" → one or more segments
 *   - Express-style:      "/blog/:slug"   → single segment
 *   - Express catch-all:  "/blog/:path*"  → zero or more segments (with optional leading slash)
 *   - Express catch-all+: "/blog/:path+"  → one or more segments
 *   - Regex literal:      "/^\/api\/.*$/" (wrapped in forward slashes)
 */
function patternToRegex(pattern: string): RegExp {
  // Regex literal: /^\/api\/.*$/
  // Must start and end with "/" and contain at least one char in between
  // and not look like a normal path (i.e., the inner part must look like a regex)
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    const inner = pattern.slice(1, -1);
    // Only treat as regex literal if it contains regex metacharacters
    if (/[\\^$.|?*+()[\]{}]/.test(inner)) {
      return new RegExp(inner);
    }
  }

  // Process bracket syntax BEFORE escaping, since escaping would mangle brackets
  // Replace [[...slug]] → CATCHALL_PLACEHOLDER
  // Replace [...slug]   → CATCHALL_PLACEHOLDER
  // Replace [slug]      → SEGMENT_PLACEHOLDER
  let src = pattern
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "\x00CATCHALL\x00")  // [[...slug]]
    .replace(/\[\.\.\.([^\]]+)\]/g, "\x00CATCHALL\x00")       // [...slug]
    .replace(/\[([^\]]+)\]/g, "\x00SEGMENT\x00");              // [slug]

  // Escape regex special chars (except our placeholders which use \x00)
  src = src.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Restore placeholders
  src = src.replace(/\x00CATCHALL\x00/g, "(.+)");
  src = src.replace(/\x00SEGMENT\x00/g, "([^/]+)");

  // Express-style params: /:param* → optional catch-all including the preceding slash
  // e.g. /api/:path* → /api(?:/(.*))? which matches /api, /api/, /api/foo, /api/foo/bar
  src = src.replace(/\/:([ a-zA-Z_][a-zA-Z0-9_]*)\*/g, "(?:/(.*))?");
  // Handle :param* without leading slash
  src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\*/g, "(.*)");
  // Express-style params: :param+ → required catch-all (one or more path segments)
  src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\+/g, "(.+)");
  // Express-style params: :param → single segment
  src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "([^/]+)");

  return new RegExp(`^${src}$`);
}

/**
 * Compile an array of MatcherPattern strings into a CompiledMatcher.
 * Throws FrameworkError(code: "MIDDLEWARE_COMPILE_ERROR") for invalid patterns.
 */
export function compileMatcherPattern(patterns: MatcherPattern[]): CompiledMatcher {
  const regexes: RegExp[] = [];

  for (const pattern of patterns) {
    try {
      const re = patternToRegex(pattern);
      // Validate the regex by doing a test run
      re.test("/");
      regexes.push(re);
    } catch (err) {
      throw new FrameworkError(
        "MIDDLEWARE_COMPILE_ERROR",
        `Invalid middleware matcher pattern: "${pattern}"`,
        {
          layer: "platform",
          context: { pattern, cause: err instanceof Error ? err.message : String(err) },
          recoverable: false,
        }
      );
    }
  }

  return {
    patterns,
    test(pathname: string): boolean {
      return regexes.some((re) => re.test(pathname));
    },
  };
}

// ---------------------------------------------------------------------------
// MiddlewareEngine
// ---------------------------------------------------------------------------

export interface MiddlewareEngine {
  compile(definitions: MiddlewareDefinition[]): CompiledMiddlewareManifest;
  execute(req: SourceOGRequest, manifest: CompiledMiddlewareManifest): Promise<MiddlewareResult>;
}

export class MiddlewareEngineImpl implements MiddlewareEngine {
  /**
   * Compile middleware definitions into a manifest.
   * - Sorts by priority descending
   * - Compiles each matcher pattern
   * - Populates edgeEntries only for edgeCompatible entries
   * - Throws FrameworkError(code: "MIDDLEWARE_COMPILE_ERROR") for invalid patterns
   */
  public compile(definitions: MiddlewareDefinition[]): CompiledMiddlewareManifest {
    const sorted = [...definitions].sort((a, b) => b.priority - a.priority);

    const entries: CompiledMiddlewareEntry[] = [];
    const edgeEntries: CompiledMiddlewareEntry[] = [];

    for (const def of sorted) {
      if (!def.edgeCompatible) {
        logger.warn("Middleware not edge-compatible", { id: def.id });
      }

      const compiledMatcher = compileMatcherPattern(def.matcher);

      const entry: CompiledMiddlewareEntry = {
        id: def.id,
        scope: def.scope,
        matcher: compiledMatcher,
        handler: def.handler,
        edgeCompatible: def.edgeCompatible,
        priority: def.priority,
      };

      entries.push(entry);

      if (def.edgeCompatible) {
        edgeEntries.push(entry);
      }
    }

    return { entries, edgeEntries };
  }

  /**
   * Execute middleware chain for a request.
   * - Invokes handlers in manifest.entries order
   * - Stops on redirect or rewrite
   * - Continues on next()
   */
  public async execute(
    req: SourceOGRequest,
    manifest: CompiledMiddlewareManifest
  ): Promise<MiddlewareResult> {
    const accumulatedHeaders: Record<string, string> = {};
    const accumulatedCookies: Array<{ name: string; value: string; options?: CookieOptions }> = [];

    for (const entry of manifest.entries) {
      // Skip entries whose matcher doesn't match the request pathname
      if (!entry.matcher.test(req.url.pathname)) {
        continue;
      }

      // Use a mutable container so TypeScript doesn't narrow away closure mutations
      const state: { action: "next" | "redirect" | "rewrite"; destination?: string; redirectStatus: 301 | 302 | 307 | 308 } = {
        action: "next",
        destination: undefined,
        redirectStatus: 302,
      };
      let calledNext = false;

      const res: MiddlewareResponse = {
        rewrite(dest: string) {
          state.action = "rewrite";
          state.destination = dest;
        },
        redirect(dest: string, status: 301 | 302 | 307 | 308 = 302) {
          state.action = "redirect";
          state.destination = dest;
          state.redirectStatus = status;
        },
        setHeader(name: string, value: string) {
          accumulatedHeaders[name] = sanitizeHeaderValue(value);
        },
        setCookie(name: string, value: string, options?: CookieOptions) {
          accumulatedCookies.push({ name, value: sanitizeHeaderValue(value), options });
        },
        next() {
          calledNext = true;
        },
      };

      const nextFn: NextFunction = () => {
        calledNext = true;
      };

      await entry.handler(req, res, nextFn);

      if (state.action === "redirect") {
        return {
          action: "redirect",
          destination: state.destination,
          status: state.redirectStatus,
          headers: accumulatedHeaders,
          cookies: accumulatedCookies,
        };
      }

      if (state.action === "rewrite") {
        return {
          action: "rewrite",
          destination: state.destination,
          headers: accumulatedHeaders,
          cookies: accumulatedCookies,
        };
      }

      // If neither next() was called nor redirect/rewrite, stop the chain
      if (!calledNext) {
        break;
      }
    }

    return {
      action: "next",
      headers: accumulatedHeaders,
      cookies: accumulatedCookies,
    };
  }
}

/** Singleton factory */
export function createMiddlewareEngine(): MiddlewareEngine {
  return new MiddlewareEngineImpl();
}
