import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload {
  sub: string;
  roles?: string[];
  expiresAt: number;
}

/**
 * The subset of session data safe to expose to the browser.
 * Intentionally distinct from `SessionPayload` to prevent accidental leakage
 * of signing-related fields (`expiresAt`, `iat`, `exp`) at compile time.
 */
export interface ClientSession {
  readonly sub: string;
  readonly roles?: readonly string[];
}

/**
 * Strips signing-related fields from a `SessionPayload` before passing it to
 * Client Islands or RSC serialization. Only `sub` and `roles` are forwarded.
 */
export function sanitizeForClient(payload: SessionPayload): ClientSession {
  return {
    sub: payload.sub,
    ...(payload.roles !== undefined && { roles: payload.roles }),
  };
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = createHmac("sha256", secret).update(body).digest();
  const provided = Buffer.from(signature, "base64url");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) {
    return null;
  }

  return payload;
}

// ---------------------------------------------------------------------------
// JWT helpers (jose-based, edge-runtime compatible)
// ---------------------------------------------------------------------------

export type JWTPayload = Record<string, unknown>;

/**
 * Signs a payload as a HS256 JWT using the `jose` library.
 */
export async function createJWT(payload: JWTPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
}

/**
 * Verifies a JWT signed with HS256.
 * Returns the payload on success, or `null` for invalid signature, expiry, or alg:none.
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  // Explicitly reject alg:none before touching jose
  try {
    const [headerB64] = token.split(".");
    if (!headerB64) return null;
    const headerJson = Buffer.from(headerB64, "base64url").toString("utf8");
    const header = JSON.parse(headerJson) as Record<string, unknown>;
    if (header.alg === "none") return null;
  } catch {
    return null;
  }

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    // Strip jose-internal registered claims from the returned payload
    const { iss, sub, aud, exp, nbf, iat, jti, ...rest } = payload;
    void iss; void sub; void aud; void exp; void nbf; void iat; void jti;
    return rest as JWTPayload;
  } catch {
    return null;
  }
}
