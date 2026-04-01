/**
 * Unit tests for @sourceog/adapter-utils
 * Requirements: RF-14, Requirement 11 (Adapter Utilities Shared Package)
 */

import { describe, it, expect } from "vitest";
import {
  parseCookieHeader,
  serializeCookieHeader,
  createMutableHeaders,
  createMutableCookies,
  buildWebResponse,
  normalizeWebRequest,
  type MutableCookiesWithPending,
} from "../packages/adapter-utils/src/index";

// ---------------------------------------------------------------------------
// parseCookieHeader
// ---------------------------------------------------------------------------

describe("parseCookieHeader", () => {
  it("returns empty map for null/undefined/empty", () => {
    expect(parseCookieHeader(null).size).toBe(0);
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader("").size).toBe(0);
  });

  it("parses a single cookie", () => {
    const map = parseCookieHeader("session=abc123");
    expect(map.get("session")).toBe("abc123");
  });

  it("parses multiple cookies", () => {
    const map = parseCookieHeader("a=1; b=2; c=3");
    expect(map.get("a")).toBe("1");
    expect(map.get("b")).toBe("2");
    expect(map.get("c")).toBe("3");
  });

  it("decodes percent-encoded values", () => {
    const map = parseCookieHeader("token=hello%20world");
    expect(map.get("token")).toBe("hello world");
  });

  it("falls back to raw value when decoding fails", () => {
    const map = parseCookieHeader("bad=%GG");
    expect(map.get("bad")).toBe("%GG");
  });

  it("ignores parts without an equals sign", () => {
    const map = parseCookieHeader("novalue; key=val");
    expect(map.has("novalue")).toBe(false);
    expect(map.get("key")).toBe("val");
  });

  it("trims whitespace around name and value", () => {
    const map = parseCookieHeader("  name  =  value  ");
    expect(map.get("name")).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// serializeCookieHeader
// ---------------------------------------------------------------------------

describe("serializeCookieHeader", () => {
  it("serializes a basic name/value pair", () => {
    expect(serializeCookieHeader("session", "abc")).toBe("session=abc");
  });

  it("percent-encodes the value", () => {
    expect(serializeCookieHeader("msg", "hello world")).toBe("msg=hello%20world");
  });

  it("includes Path attribute", () => {
    expect(serializeCookieHeader("a", "b", { path: "/" })).toContain("; Path=/");
  });

  it("includes Domain attribute", () => {
    expect(serializeCookieHeader("a", "b", { domain: "example.com" })).toContain("; Domain=example.com");
  });

  it("includes Max-Age attribute", () => {
    expect(serializeCookieHeader("a", "b", { maxAge: 3600 })).toContain("; Max-Age=3600");
  });

  it("includes Expires attribute", () => {
    const expires = new Date("2030-01-01T00:00:00Z");
    expect(serializeCookieHeader("a", "b", { expires })).toContain("; Expires=");
  });

  it("includes HttpOnly flag", () => {
    expect(serializeCookieHeader("a", "b", { httpOnly: true })).toContain("; HttpOnly");
  });

  it("includes Secure flag", () => {
    expect(serializeCookieHeader("a", "b", { secure: true })).toContain("; Secure");
  });

  it("includes SameSite attribute", () => {
    expect(serializeCookieHeader("a", "b", { sameSite: "lax" })).toContain("; SameSite=lax");
  });

  it("round-trips: parse(serialize(name, value)) === value", () => {
    const name = "token";
    const value = "my secret value!";
    const serialized = serializeCookieHeader(name, value);
    const parsed = parseCookieHeader(serialized);
    expect(parsed.get(name)).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// createMutableHeaders
// ---------------------------------------------------------------------------

describe("createMutableHeaders", () => {
  it("creates empty headers when no source provided", () => {
    const h = createMutableHeaders();
    expect(h.get("x-test")).toBeNull();
  });

  it("accepts a Web API Headers object", () => {
    const source = new Headers({ "Content-Type": "application/json" });
    const h = createMutableHeaders(source);
    expect(h.get("content-type")).toBe("application/json");
  });

  it("accepts a Node.js-style record", () => {
    const h = createMutableHeaders({ "X-Custom": "value", "X-Multi": ["a", "b"] });
    expect(h.get("x-custom")).toBe("value");
    expect(h.get("x-multi")).toBe("a, b");
  });

  it("is case-insensitive for get/has/set/delete", () => {
    const h = createMutableHeaders({ "Content-Type": "text/html" });
    expect(h.get("CONTENT-TYPE")).toBe("text/html");
    expect(h.has("content-type")).toBe(true);
    h.set("CONTENT-TYPE", "application/json");
    expect(h.get("content-type")).toBe("application/json");
    h.delete("Content-Type");
    expect(h.has("content-type")).toBe(false);
  });

  it("append joins with comma", () => {
    const h = createMutableHeaders();
    h.set("accept", "text/html");
    h.append("accept", "application/json");
    expect(h.get("accept")).toBe("text/html, application/json");
  });

  it("forEach iterates all entries", () => {
    const h = createMutableHeaders({ a: "1", b: "2" });
    const entries: [string, string][] = [];
    h.forEach((v, k) => entries.push([k, v]));
    expect(entries).toHaveLength(2);
  });

  it("skips undefined values from Node.js record", () => {
    const h = createMutableHeaders({ present: "yes", missing: undefined });
    expect(h.has("present")).toBe(true);
    expect(h.has("missing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createMutableCookies
// ---------------------------------------------------------------------------

describe("createMutableCookies", () => {
  it("reads from initial map", () => {
    const c = createMutableCookies(new Map([["session", "abc"]]));
    expect(c.get("session")).toBe("abc");
    expect(c.has("session")).toBe(true);
  });

  it("getAll returns all entries", () => {
    const c = createMutableCookies(new Map([["a", "1"], ["b", "2"]]));
    const all = c.getAll();
    expect(all).toHaveLength(2);
  });

  it("set adds to store and pending list", () => {
    const c = createMutableCookies(new Map()) as MutableCookiesWithPending;
    c.set("token", "xyz", { httpOnly: true });
    expect(c.get("token")).toBe("xyz");
    expect(c._pending).toHaveLength(1);
    expect(c._pending[0].name).toBe("token");
    expect(c._pending[0].options?.httpOnly).toBe(true);
  });

  it("delete removes from store and adds deletion to pending", () => {
    const c = createMutableCookies(new Map([["session", "abc"]])) as MutableCookiesWithPending;
    c.delete("session");
    expect(c.has("session")).toBe(false);
    expect(c._pending[0].options?.maxAge).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildWebResponse
// ---------------------------------------------------------------------------

describe("buildWebResponse", () => {
  it("builds a response with null body", () => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const res = buildWebResponse({ status: 204, headers, cookies, body: null });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("builds a response with string body", async () => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const res = buildWebResponse({ status: 200, headers, cookies, body: "hello" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("copies headers into the response", async () => {
    const headers = createMutableHeaders();
    headers.set("x-custom", "test-value");
    const cookies = createMutableCookies(new Map());
    const res = buildWebResponse({ status: 200, headers, cookies, body: null });
    expect(res.headers.get("x-custom")).toBe("test-value");
  });

  it("flushes pending cookies as Set-Cookie headers", async () => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    cookies.set("session", "abc", { httpOnly: true, path: "/" });
    const res = buildWebResponse({ status: 200, headers, cookies, body: null });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("session=abc");
    expect(setCookie).toContain("HttpOnly");
  });

  it("builds a response with ReadableStream body", async () => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    });
    const res = buildWebResponse({ status: 200, headers, cookies, body: stream });
    expect(await res.text()).toBe("streamed");
  });
});

// ---------------------------------------------------------------------------
// normalizeWebRequest
// ---------------------------------------------------------------------------

describe("normalizeWebRequest", () => {
  it("normalizes a GET request", () => {
    const req = new Request("https://example.com/path?q=1");
    const normalized = normalizeWebRequest(req);
    expect(normalized.method).toBe("GET");
    expect(normalized.url.pathname).toBe("/path");
    expect(normalized.url.searchParams.get("q")).toBe("1");
    expect(normalized.body).toBeNull();
  });

  it("includes body for POST requests", () => {
    const req = new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
    });
    const normalized = normalizeWebRequest(req);
    expect(normalized.method).toBe("POST");
    expect(normalized.body).not.toBeNull();
  });

  it("parses cookies from Cookie header", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "session=abc; theme=dark" },
    });
    const normalized = normalizeWebRequest(req);
    expect(normalized.cookies.get("session")).toBe("abc");
    expect(normalized.cookies.get("theme")).toBe("dark");
  });

  it("extracts IP from x-forwarded-for", () => {
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    const normalized = normalizeWebRequest(req);
    expect(normalized.ip).toBe("1.2.3.4");
  });

  it("extracts IP from x-real-ip as fallback", () => {
    const req = new Request("https://example.com/", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    const normalized = normalizeWebRequest(req);
    expect(normalized.ip).toBe("9.9.9.9");
  });

  it("generates unique requestId and traceId", () => {
    const req1 = normalizeWebRequest(new Request("https://example.com/"));
    const req2 = normalizeWebRequest(new Request("https://example.com/"));
    expect(req1.requestId).not.toBe(req2.requestId);
    expect(req1.traceId).not.toBe(req2.traceId);
  });

  it("uppercases the method", () => {
    const req = new Request("https://example.com/", { method: "delete" });
    expect(normalizeWebRequest(req).method).toBe("DELETE");
  });

  it("has no body for HEAD requests", () => {
    const req = new Request("https://example.com/", { method: "HEAD" });
    expect(normalizeWebRequest(req).body).toBeNull();
  });
});
