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
export declare function sanitizeForClient(payload: SessionPayload): ClientSession;
export declare function signSession(payload: SessionPayload, secret: string): string;
export declare function verifySession(token: string, secret: string): SessionPayload | null;
export type JWTPayload = Record<string, unknown>;
/**
 * Signs a payload as a HS256 JWT using the `jose` library.
 */
export declare function createJWT(payload: JWTPayload, secret: string): Promise<string>;
/**
 * Verifies a JWT signed with HS256.
 * Returns the payload on success, or `null` for invalid signature, expiry, or alg:none.
 */
export declare function verifyJWT(token: string, secret: string): Promise<JWTPayload | null>;
