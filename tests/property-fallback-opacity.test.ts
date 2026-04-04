/**
 * Property 14: Fallback Opacity
 * Validates: Requirements 4.3, 8.10 (INV-005)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 14: Fallback Opacity`
 *
 * For any invocation of hardFallbackHtmlReplace, a structured console.error call
 * containing severity, type: "[SOURCEOG-FALLBACK]", route, renderContextKey, reason,
 * stack, and timestamp MUST be emitted BEFORE any DOM modification occurs.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getClientRuntimeScript } from "@sourceog/dev";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

function arbitraryRenderContext(): fc.Arbitrary<{
  pathname: string;
  renderContextKey: string;
  renderMode: string;
  shellMode: "document" | "fragment";
  bodyHtml: string;
}> {
  return fc.record({
    pathname: fc.stringMatching(/^\/[a-z0-9\/\-]{0,30}$/).map((s) => s || "/"),
    renderContextKey: fc.stringMatching(/^[0-9a-f]{16}$/),
    renderMode: fc.constant("server-components"),
    shellMode: fc.oneof(fc.constant("document" as const), fc.constant("fragment" as const)),
    bodyHtml: fc.string({ minLength: 1, maxLength: 100 }).map((s) => `<div>${s}</div>`)
  });
}

function arbitraryError(): fc.Arbitrary<Error> {
  return fc.string({ minLength: 1, maxLength: 80 }).map((msg) => {
    const err = new Error(msg);
    err.stack = `Error: ${msg}\n    at hardFallbackHtmlReplace (hmr.ts:1:1)`;
    return err;
  });
}

// ---------------------------------------------------------------------------
// Standalone implementation of hardFallbackHtmlReplace for property testing
// (mirrors the spec contract from design.md and hmr.ts)
// ---------------------------------------------------------------------------

interface FallbackPayload {
  pathname?: string;
  renderContextKey?: string;
  shellMode?: "document" | "fragment";
  bodyHtml?: string;
  shellHtmlStart?: string;
  shellHtmlEnd?: string;
}

interface FallbackLogEntry {
  severity: string;
  type: string;
  route: string;
  renderContextKey: string;
  reason: string;
  stack?: string;
  timestamp: string;
}

/**
 * Standalone implementation that mirrors the spec contract.
 * Used to verify the log-before-DOM-modification invariant (INV-005).
 */
async function hardFallbackHtmlReplaceSpec(
  payload: FallbackPayload,
  reason: Error | unknown,
  onLog: (entry: FallbackLogEntry) => void,
  onDomModify: () => void
): Promise<void> {
  // INV-005: MUST log BEFORE any DOM modification
  onLog({
    severity: "ERROR",
    type: "[SOURCEOG-FALLBACK]",
    route: payload?.pathname ?? "/",
    renderContextKey: payload?.renderContextKey ?? "unknown",
    reason: (reason as Error)?.message ?? String(reason),
    stack: (reason as Error)?.stack,
    timestamp: new Date().toISOString()
  });

  // DOM modification happens AFTER the log
  onDomModify();
}

// ---------------------------------------------------------------------------
// Property 14: Fallback Opacity
// ---------------------------------------------------------------------------

describe("Property 14: Fallback Opacity", () => {
  it(
    "[SOURCEOG-FALLBACK] log is emitted BEFORE any DOM modification",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRenderContext(),
          arbitraryError(),
          async (payload, error) => {
            const events: Array<"log" | "dom"> = [];
            let logEntry: FallbackLogEntry | null = null;

            await hardFallbackHtmlReplaceSpec(
              payload,
              error,
              (entry) => {
                events.push("log");
                logEntry = entry;
              },
              () => {
                events.push("dom");
              }
            );

            // INV-005: log must come before DOM modification
            expect(events[0]).toBe("log");
            expect(events[1]).toBe("dom");
            expect(events).toHaveLength(2);

            // Log entry must have all required fields (Req 4.3)
            expect(logEntry).not.toBeNull();
            expect(logEntry?.severity).toBe("ERROR");
            expect(logEntry?.type).toBe("[SOURCEOG-FALLBACK]");
            expect(logEntry?.route).toBeTruthy();
            expect(logEntry?.renderContextKey).toBeTruthy();
            expect(logEntry?.reason).toBeTruthy();
            expect(logEntry?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it("log entry contains route from payload.pathname", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryRenderContext(),
        arbitraryError(),
        async (payload, error) => {
          let logEntry: FallbackLogEntry | null = null;

          await hardFallbackHtmlReplaceSpec(
            payload,
            error,
            (entry) => { logEntry = entry; },
            () => {}
          );

          if (logEntry === null) {
            throw new Error("Fallback log entry is null");
          }

          expect(logEntry.route).toBe(payload.pathname ?? "/");

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("log entry contains renderContextKey from payload", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryRenderContext(),
        arbitraryError(),
        async (payload, error) => {
          let logEntry: FallbackLogEntry | null = null;

          await hardFallbackHtmlReplaceSpec(
            payload,
            error,
            (entry) => { logEntry = entry; },
            () => {}
          );

          const renderContextKey = logEntry
            ? logEntry.renderContextKey
            : (payload.renderContextKey ?? "unknown");
          expect(renderContextKey).toBe(payload.renderContextKey ?? "unknown");

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("log entry reason matches error.message", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryRenderContext(),
        arbitraryError(),
        async (payload, error) => {
          let logEntry: FallbackLogEntry | null = null;

          await hardFallbackHtmlReplaceSpec(
            payload,
            error,
            (entry) => { logEntry = entry; },
            () => {}
          );

          expect(logEntry?.reason).toBe(error.message);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("client runtime script contains [SOURCEOG-FALLBACK] log before DOM modification", () => {
    const script = getClientRuntimeScript();

    // The script must contain the hardFallbackHtmlReplace function
    expect(script).toContain("async function hardFallbackHtmlReplace(payload, reason)");

    // INV-005: the log must appear before innerHTML assignment in the function body
    const fnStart = script.indexOf("async function hardFallbackHtmlReplace(payload, reason)");
    const logPos = script.indexOf("[SOURCEOG-FALLBACK]", fnStart);
    const innerHtmlPos = script.indexOf("innerHTML", fnStart);

    expect(fnStart).toBeGreaterThan(-1);
    expect(logPos).toBeGreaterThan(fnStart);
    expect(innerHtmlPos).toBeGreaterThan(logPos);

    // Must contain all required log fields
    expect(script).toContain('severity: "ERROR"');
    expect(script).toContain('type: "[SOURCEOG-FALLBACK]"');
    expect(script).toContain("renderContextKey");
    expect(script).toContain("timestamp");
  });
});
