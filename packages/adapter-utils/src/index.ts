/**
 * @sourceog/adapter-utils — Shared utilities for all SourceOG deployment adapters.
 *
 * Provides cookie parsing/serialization, mutable header/cookie wrappers,
 * Web Response building, and Web Request normalization.
 * All functions use only Web APIs — no Node.js built-ins — so they work
 * in edge runtimes (Cloudflare Workers, Vercel Edge) as well as Node.js.
 *
 * Requirements: RF-14, Requirement 11 (Adapter Utilities Shared Package)
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ReadonlyHeaders {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(callback: (value: string, name: string) => void): void;
}

export interface ReadonlyCookies {
  get(name: string): string | undefined;
  has(name: string): boolean;
  getAll(): Array<{ name: string; value: string }>;
}

export interface MutableHeaders extends ReadonlyHeaders {
  set(name: string, value: string): void;
  delete(name: string): void;
  append(name: string, value: string): void;
}

export interface MutableCookies extends ReadonlyCookies {
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
}

export interface GeoData {
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

export interface AdapterSourceOGRequest {
  method: string;
  url: URL;
  headers: ReadonlyHeaders;
  cookies: ReadonlyCookies;
  body: ReadableStream<Uint8Array> | null;
  geo?: GeoData;
  ip?: string;
  requestId: string;
  traceId: string;
}

export interface AdapterSourceOGResponse {
  status: number;
  headers: MutableHeaders;
  cookies: MutableCookies;
  body: ReadableStream<Uint8Array> | string | null;
}

/** Internal type for cookies with pending Set-Cookie mutations. */
export interface MutableCookiesWithPending extends MutableCookies {
  _pending: Array<{ name: string; value: string; options?: CookieOptions }>;
}

// ---------------------------------------------------------------------------
// parseCookieHeader
// ---------------------------------------------------------------------------

/**
 * Parse a `Cookie` header string into a Map of name → decoded value.
 * Accepts `string | null | undefined` to cover both Web API (null) and
 * Node.js (undefined) header shapes.
 *
 * Round-trip property: parseCookieHeader(serializeCookieHeader(n, v)) produces
 * a map where map.get(n) === v (Requirement 11.4).
 */
export function parseCookieHeader(
  cookieHeader: string | null | undefined
): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (name) {
      try {
        cookies.set(name, decodeURIComponent(value));
      } catch {
        cookies.set(name, value);
      }
    }
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// serializeCookieHeader
// ---------------------------------------------------------------------------

/**
 * Serialize a cookie name/value pair with optional attributes into a
 * `Set-Cookie` header string.
 */
export function serializeCookieHeader(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  return cookie;
}

// ---------------------------------------------------------------------------
// createMutableHeaders
// ---------------------------------------------------------------------------

/**
 * Create a MutableHeaders wrapper backed by a case-insensitive Map.
 *
 * Accepts an optional source which may be:
 * - A Web API `Headers` object (iterable via forEach)
 * - A plain `Record<string, string | string[] | undefined>` (Node.js IncomingMessage.headers)
 */
export function createMutableHeaders(
  source?: Headers | Record<string, string | string[] | undefined>
): MutableHeaders {
  const map = new Map<string, string>();

  if (source) {
    if (typeof (source as Headers).forEach === "function") {
      // Web API Headers
      (source as Headers).forEach((value: string, name: string) => {
        map.set(name.toLowerCase(), value);
      });
    } else {
      // Node.js-style record
      for (const [key, value] of Object.entries(
        source as Record<string, string | string[] | undefined>
      )) {
        if (value === undefined) continue;
        map.set(
          key.toLowerCase(),
          Array.isArray(value) ? value.join(", ") : value
        );
      }
    }
  }

  return {
    get(name: string) {
      return map.get(name.toLowerCase()) ?? null;
    },
    has(name: string) {
      return map.has(name.toLowerCase());
    },
    forEach(callback: (value: string, name: string) => void) {
      map.forEach((value, name) => callback(value, name));
    },
    set(name: string, value: string) {
      map.set(name.toLowerCase(), value);
    },
    delete(name: string) {
      map.delete(name.toLowerCase());
    },
    append(name: string, value: string) {
      const existing = map.get(name.toLowerCase());
      map.set(
        name.toLowerCase(),
        existing ? `${existing}, ${value}` : value
      );
    },
  };
}

// ---------------------------------------------------------------------------
// createMutableCookies
// ---------------------------------------------------------------------------

/**
 * Create a MutableCookies wrapper with a `_pending` list that accumulates
 * Set-Cookie mutations for later serialization into response headers.
 */
export function createMutableCookies(
  initial: Map<string, string>
): MutableCookiesWithPending {
  const store = new Map(initial);
  const pending: Array<{ name: string; value: string; options?: CookieOptions }> = [];

  return {
    _pending: pending,
    get(name: string) {
      return store.get(name);
    },
    has(name: string) {
      return store.has(name);
    },
    getAll() {
      return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
    },
    set(name: string, value: string, options?: CookieOptions) {
      store.set(name, value);
      pending.push({ name, value, options });
    },
    delete(name: string) {
      store.delete(name);
      pending.push({ name, value: "", options: { maxAge: 0 } });
    },
  };
}

// ---------------------------------------------------------------------------
// buildWebResponse
// ---------------------------------------------------------------------------

/**
 * Convert an AdapterSourceOGResponse into a Web API `Response`.
 * Flushes pending cookie mutations as `Set-Cookie` headers.
 */
export function buildWebResponse(sourceogRes: AdapterSourceOGResponse): Response {
  const responseHeaders = new Headers();

  sourceogRes.headers.forEach((value, name) => {
    responseHeaders.set(name, value);
  });

  const cookiesWithPending = sourceogRes.cookies as MutableCookiesWithPending;
  if (cookiesWithPending._pending?.length) {
    for (const { name, value, options } of cookiesWithPending._pending) {
      responseHeaders.append(
        "set-cookie",
        serializeCookieHeader(name, value, options)
      );
    }
  }

  const { body, status } = sourceogRes;

  if (body === null) {
    return new Response(null, { status, headers: responseHeaders });
  }
  if (typeof body === "string") {
    return new Response(body, { status, headers: responseHeaders });
  }
  return new Response(body as ReadableStream, { status, headers: responseHeaders });
}

// ---------------------------------------------------------------------------
// normalizeWebRequest
// ---------------------------------------------------------------------------

/**
 * Normalize a Web API `Request` into an `AdapterSourceOGRequest`.
 * Uses only Web APIs — safe for edge runtimes.
 *
 * IP is extracted from `x-forwarded-for` or `x-real-ip` headers.
 * requestId and traceId are generated via `crypto.randomUUID()`.
 */
export function normalizeWebRequest(req: Request): AdapterSourceOGRequest {
  const url = new URL(req.url);
  const headers = createMutableHeaders(req.headers);
  const cookieMap = parseCookieHeader(req.headers.get("cookie"));
  const cookies = createMutableCookies(cookieMap);

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  const body = hasBody ? (req.body as ReadableStream<Uint8Array> | null) : null;

  return {
    method,
    url,
    headers,
    cookies,
    body,
    ip,
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  };
}
