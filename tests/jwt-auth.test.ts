import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createJWT, verifyJWT } from "@sourceog/platform";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a JWT payload: a record of string keys to JSON-safe scalar values.
 * Avoids registered JWT claim names so they don't collide with jose internals.
 */
const registeredClaims = new Set(["iss", "sub", "aud", "exp", "nbf", "iat", "jti"]);

const jwtPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc
  .dictionary(
    fc.string({ minLength: 1, maxLength: 16 }).filter((k) => !registeredClaims.has(k)),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { minKeys: 1, maxKeys: 8 }
  );

/**
 * Generates secrets of at least 32 bytes (required for HS256).
 */
const secretArb: fc.Arbitrary<string> = fc.string({ minLength: 32, maxLength: 64 });

// ---------------------------------------------------------------------------
// Property 24: JWT round trip
// Validates: Requirements 9.1, 9.2
// ---------------------------------------------------------------------------

describe("JWT — Property 24: JWT round trip", () => {
  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * For any payload and secret, verifyJWT(createJWT(payload, secret), secret)
   * must return an object equal to the original payload.
   */
  it("verifyJWT(createJWT(payload, secret), secret) equals original payload", async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArb, secretArb, async (payload, secret) => {
        const token = await createJWT(payload, secret);
        const result = await verifyJWT(token, secret);
        if (result === null) return false;
        // Every key in the original payload must be present and equal
        for (const [k, v] of Object.entries(payload)) {
          if (result[k] !== v) return false;
        }
        return true;
      })
    );
  });

  it("returns null when verified with a different secret", async () => {
    await fc.assert(
      fc.asyncProperty(
        jwtPayloadArb,
        secretArb,
        secretArb,
        async (payload, secret, otherSecret) => {
          fc.pre(secret !== otherSecret);
          const token = await createJWT(payload, secret);
          const result = await verifyJWT(token, otherSecret);
          return result === null;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: JWT rejects alg:none tokens
// Validates: Requirements 9.5
// ---------------------------------------------------------------------------

describe("JWT — Property 25: JWT rejects alg:none tokens", () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * Tokens constructed with alg:"none" must always be rejected (return null).
   */
  it("returns null for tokens with alg:none header", async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArb, secretArb, async (payload, secret) => {
        // Craft a token with alg:"none" manually
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
        // alg:none tokens have an empty signature segment
        const algNoneToken = `${header}.${body}.`;

        const result = await verifyJWT(algNoneToken, secret);
        return result === null;
      })
    );
  });

  it("returns null for alg:none tokens regardless of payload content", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ userId: "admin", role: "superuser" })).toString("base64url");
    const token = `${header}.${body}.`;

    const result = await verifyJWT(token, "a-secret-that-is-at-least-32-bytes-long");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("JWT — unit tests", () => {
  const secret = "super-secret-key-that-is-at-least-32-bytes";

  it("createJWT returns a three-segment JWT string", async () => {
    const token = await createJWT({ userId: "123" }, secret);
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyJWT returns payload for a valid token", async () => {
    const token = await createJWT({ userId: "abc", role: "admin" }, secret);
    const result = await verifyJWT(token, secret);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("abc");
    expect(result!.role).toBe("admin");
  });

  it("verifyJWT returns null for a tampered token", async () => {
    const token = await createJWT({ userId: "abc" }, secret);
    const tampered = token.slice(0, -4) + "XXXX";
    expect(await verifyJWT(tampered, secret)).toBeNull();
  });

  it("verifyJWT returns null for a wrong secret", async () => {
    const token = await createJWT({ userId: "abc" }, secret);
    expect(await verifyJWT(token, "wrong-secret-that-is-at-least-32-bytes-long")).toBeNull();
  });

  it("verifyJWT returns null for a malformed token", async () => {
    expect(await verifyJWT("not.a.jwt", secret)).toBeNull();
    expect(await verifyJWT("", secret)).toBeNull();
  });
});
