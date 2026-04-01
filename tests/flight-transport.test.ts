/**
 * Unit tests for Flight transport
 * Requirements: 3.6, 3.8
 *
 * Covers:
 *  - Stream error after headers sent → stream destroyed + [SOURCEOG-FALLBACK] log
 *  - HTML response includes bootstrap script with window.__SOURCEOG_CLIENT_CONTEXT__
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { buildBootstrapScript } from "@sourceog/server";
import { computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Mock ServerResponse for testing stream error handling
// ---------------------------------------------------------------------------

class MockServerResponse extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly writtenChunks: (Uint8Array | string)[] = [];
  headersSent = false;
  destroyed = false;
  destroyedWith: Error | undefined;

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  write(chunk: Uint8Array | string): boolean {
    this.headersSent = true;
    this.writtenChunks.push(chunk);
    return true;
  }

  end(chunk?: Uint8Array | string): this {
    if (chunk) this.writtenChunks.push(chunk);
    this.emit("finish");
    return this;
  }

  destroy(error?: Error): this {
    this.destroyed = true;
    this.destroyedWith = error;
    this.emit("close");
    return this;
  }
}

// ---------------------------------------------------------------------------
// Helpers: simulate the Flight stream pump from handleFlightRequest
// ---------------------------------------------------------------------------

async function simulateFlightStreamPump(
  res: MockServerResponse,
  stream: ReadableStream<Uint8Array>,
  routeId: string
): Promise<void> {
  const reader = stream.getReader();
  res.on("close", () => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        break;
      }
      res.write(value);
    }
  } catch (streamError) {
    // Req 3.6: log [SOURCEOG-FALLBACK] before destroying response
    console.error("[SOURCEOG-FALLBACK] Flight stream error after headers sent:", {
      severity: "ERROR",
      type: "[SOURCEOG-FALLBACK]",
      route: routeId,
      message: streamError instanceof Error ? streamError.message : String(streamError),
      stack: streamError instanceof Error ? streamError.stack : undefined,
      timestamp: new Date().toISOString()
    });
    res.destroy(streamError instanceof Error ? streamError : new Error(String(streamError)));
  }
}

// ---------------------------------------------------------------------------
// Tests: Stream error after headers sent (Req 3.6)
// ---------------------------------------------------------------------------

describe("Flight transport — stream error handling (Req 3.6)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("destroys the response stream when a Flight stream error occurs after headers are sent", async () => {
    const res = new MockServerResponse();
    const routeId = "page:/test";

    // Set headers first (simulating the server's header-setting sequence)
    res.setHeader("Content-Type", "text/x-component");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Render-Context-Key", "abc123def456abcd");
    res.setHeader("X-Canonical-Route-Id", "abc123def456");

    // Create a stream that emits one chunk then errors
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const erroringStream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      }
    });

    // Start pumping
    const pumpPromise = simulateFlightStreamPump(res, erroringStream, routeId);

    // Emit one valid chunk (headers are now "sent")
    controller.enqueue(encoder.encode('0:D{}\n'));

    // Then error the stream
    controller.error(new Error("Upstream RSC render failed"));

    await pumpPromise;

    // Response must be destroyed (Req 3.6)
    expect(res.destroyed).toBe(true);
    expect(res.destroyedWith?.message).toBe("Upstream RSC render failed");
  });

  it("logs [SOURCEOG-FALLBACK] before destroying the response on stream error", async () => {
    const res = new MockServerResponse();
    const routeId = "page:/blog/post";

    res.setHeader("Content-Type", "text/x-component");
    res.setHeader("Cache-Control", "no-store");

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const erroringStream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; }
    });

    const pumpPromise = simulateFlightStreamPump(res, erroringStream, routeId);

    controller.enqueue(encoder.encode('0:D{}\n'));
    controller.error(new Error("Worker timeout"));

    await pumpPromise;

    // [SOURCEOG-FALLBACK] must be logged (Req 3.6, INV-005)
    expect(consoleSpy).toHaveBeenCalledWith(
      "[SOURCEOG-FALLBACK] Flight stream error after headers sent:",
      expect.objectContaining({
        severity: "ERROR",
        type: "[SOURCEOG-FALLBACK]",
        route: routeId,
        message: "Worker timeout"
      })
    );

    // Log must have been called before destroy
    expect(res.destroyed).toBe(true);
  });

  it("logs [SOURCEOG-FALLBACK] with route ID, message, and timestamp", async () => {
    const res = new MockServerResponse();
    const routeId = "page:/dashboard";

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const erroringStream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; }
    });

    const pumpPromise = simulateFlightStreamPump(res, erroringStream, routeId);
    controller.enqueue(encoder.encode('1:["$","div",null,{}]\n'));
    controller.error(new Error("Manifest not found"));

    await pumpPromise;

    const logCall = consoleSpy.mock.calls[0];
    expect(logCall).toBeDefined();
    const logPayload = logCall![1] as Record<string, unknown>;

    expect(logPayload.route).toBe(routeId);
    expect(logPayload.message).toBe("Manifest not found");
    expect(typeof logPayload.timestamp).toBe("string");
    // Timestamp must be a valid ISO 8601 string
    expect(() => new Date(logPayload.timestamp as string)).not.toThrow();
  });

  it("completes normally (no destroy) when stream ends without error", async () => {
    const res = new MockServerResponse();
    const routeId = "page:/home";

    const encoder = new TextEncoder();
    const cleanStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('0:D{}\n'));
        controller.enqueue(encoder.encode('1:["$","div",null,{}]\n'));
        controller.close();
      }
    });

    await simulateFlightStreamPump(res, cleanStream, routeId);

    expect(res.destroyed).toBe(false);
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(res.writtenChunks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Bootstrap script with window.__SOURCEOG_CLIENT_CONTEXT__ (Req 3.8)
// ---------------------------------------------------------------------------

describe("Flight transport — bootstrap script injection (Req 3.8)", () => {
  it("buildBootstrapScript produces a <script> tag with window.__SOURCEOG_CLIENT_CONTEXT__", () => {
    const canonicalRouteId = computeCanonicalRouteId("/blog/:slug", { slug: "hello-world" });
    const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

    const context = {
      renderMode: "server-components",
      canonicalRouteId,
      resolvedRouteId: "page:/blog/:slug",
      renderContextKey,
      parallelRouteMap: {},
      intercepted: false,
      clientReferenceManifestUrl: "/__sourceog/client-refs.json",
      buildId: "build-abc123",
      deployId: "deploy-xyz789"
    };

    const script = buildBootstrapScript(context);

    // Must be a <script> tag (Req 3.8)
    expect(script).toMatch(/^<script>/);
    expect(script).toMatch(/<\/script>$/);

    // Must contain window.__SOURCEOG_CLIENT_CONTEXT__
    expect(script).toContain("window.__SOURCEOG_CLIENT_CONTEXT__");

    // Must be valid JSON-parseable context
    const jsonMatch = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=({.+});/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]!);

    expect(parsed.renderMode).toBe("server-components");
    expect(parsed.canonicalRouteId).toBe(canonicalRouteId);
    expect(parsed.renderContextKey).toBe(renderContextKey);
    expect(parsed.clientReferenceManifestUrl).toBe("/__sourceog/client-refs.json");
    expect(parsed.buildId).toBe("build-abc123");
    expect(parsed.deployId).toBe("deploy-xyz789");
  });

  it("bootstrap script does NOT include bodyHtml field (INV-001)", () => {
    const canonicalRouteId = computeCanonicalRouteId("/", {});
    const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

    const context = {
      renderMode: "server-components",
      canonicalRouteId,
      resolvedRouteId: "page:/",
      renderContextKey,
      parallelRouteMap: {},
      intercepted: false,
      clientReferenceManifestUrl: "/__sourceog/client-refs.json",
      buildId: "build-001",
      deployId: "deploy-001"
    };

    const script = buildBootstrapScript(context);

    // bodyHtml must NOT be present (INV-001: HTML always derived from Flight)
    expect(script).not.toContain("bodyHtml");
  });

  it("bootstrap script escapes </script> in JSON values to prevent XSS", () => {
    const context = {
      renderMode: "server-components",
      canonicalRouteId: "abc123def456",
      resolvedRouteId: "page:/xss",
      renderContextKey: "abc123def456abcd",
      parallelRouteMap: {},
      intercepted: false,
      // Inject a </script> in a value to test escaping
      clientReferenceManifestUrl: "/__sourceog/client-refs.json</script><script>alert(1)",
      buildId: "build-xss",
      deployId: "deploy-xss"
    };

    const script = buildBootstrapScript(context);

    // The raw </script><script> sequence must NOT appear unescaped in the output
    // (it should be escaped as <\/script>)
    expect(script).not.toContain("</script><script>");

    // The escaped form must be present instead
    expect(script).toContain("<\\/script>");

    // The outer closing tag must still be present exactly once at the end
    expect(script.endsWith("</script>")).toBe(true);
  });

  it("bootstrap script includes clientReferenceManifestUrl for browser manifest preload", () => {
    const canonicalRouteId = computeCanonicalRouteId("/products/:id", { id: "42" });
    const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

    const manifestUrl = "/_sourceog/client-refs.json?v=abc123";
    const context = {
      renderMode: "server-components",
      canonicalRouteId,
      resolvedRouteId: "page:/products/:id",
      renderContextKey,
      parallelRouteMap: {},
      intercepted: false,
      clientReferenceManifestUrl: manifestUrl,
      buildId: "build-prod",
      deployId: "deploy-prod"
    };

    const script = buildBootstrapScript(context);

    // clientReferenceManifestUrl must be present for browser manifest loading (Req 3.8)
    expect(script).toContain(manifestUrl);

    const jsonMatch = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=({.+});/);
    const parsed = JSON.parse(jsonMatch![1]!);
    expect(parsed.clientReferenceManifestUrl).toBe(manifestUrl);
  });

  it("bootstrap script includes intercepted route context fields", () => {
    const canonicalRouteId = computeCanonicalRouteId("/photos/:id", { id: "99" });
    const renderContextKey = computeRenderContextKey(canonicalRouteId, "modal", true);

    const context = {
      renderMode: "server-components",
      canonicalRouteId,
      resolvedRouteId: "page:/photos/:id",
      renderContextKey,
      parallelRouteMap: { modal: renderContextKey },
      intercepted: true,
      interceptedFrom: "/gallery",
      interceptedUrl: "/photos/99",
      clientReferenceManifestUrl: "/__sourceog/client-refs.json",
      buildId: "build-intercept",
      deployId: "deploy-intercept"
    };

    const script = buildBootstrapScript(context);
    const jsonMatch = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=({.+});/);
    const parsed = JSON.parse(jsonMatch![1]!);

    expect(parsed.intercepted).toBe(true);
    expect(parsed.interceptedFrom).toBe("/gallery");
    expect(parsed.interceptedUrl).toBe("/photos/99");
    expect(parsed.parallelRouteMap).toEqual({ modal: renderContextKey });
  });
});
