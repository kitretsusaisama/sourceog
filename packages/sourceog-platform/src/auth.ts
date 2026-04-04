import { createHmac, timingSafeEqual } from "node:crypto";

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
// JWT helpers (native HS256 implementation)
// ---------------------------------------------------------------------------

export type JWTPayload = Record<string, unknown>;

function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeBase64UrlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signJwtSegments(headerB64: string, payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
}

/**
 * Signs a payload as a compact HS256 JWT.
 */
export async function createJWT(payload: JWTPayload, secret: string): Promise<string> {
  const headerB64 = encodeBase64UrlJson({ alg: "HS256", typ: "JWT" });
  const payloadB64 = encodeBase64UrlJson(payload);
  const signatureB64 = signJwtSegments(headerB64, payloadB64, secret);
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verifies a compact JWT signed with HS256.
 * Returns the payload on success, or `null` for invalid signature, expiry, or alg:none.
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = segments;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return null;
  }

  try {
    const header = decodeBase64UrlJson(headerB64) as Record<string, unknown>;
    if (header.alg === "none") return null;
    if (header.alg !== "HS256") return null;
  } catch {
    return null;
  }

  try {
    const expectedSignature = Buffer.from(signJwtSegments(headerB64, payloadB64, secret), "base64url");
    const providedSignature = Buffer.from(signatureB64, "base64url");
    if (
      expectedSignature.length !== providedSignature.length ||
      !timingSafeEqual(expectedSignature, providedSignature)
    ) {
      return null;
    }

    const payload = decodeBase64UrlJson(payloadB64) as Record<string, unknown>;
    const exp = payload.exp;
    if (typeof exp === "number" && Number.isFinite(exp) && exp * 1000 <= Date.now()) {
      return null;
    }

    const { iss, sub, aud, nbf, iat, jti, exp: _exp, ...rest } = payload;
    void iss;
    void sub;
    void aud;
    void nbf;
    void iat;
    void jti;
    void _exp;
    return rest as JWTPayload;
  } catch {
    return null;
  }
}
