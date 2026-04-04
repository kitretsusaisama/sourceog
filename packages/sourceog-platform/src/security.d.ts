import type { SourceOGResponse } from "@sourceog/runtime";
export interface SecurityPolicy {
    contentSecurityPolicy?: string;
    frameOptions?: "DENY" | "SAMEORIGIN";
    referrerPolicy?: string;
    xContentTypeOptions?: "nosniff";
    strictTransportSecurity?: string;
    permissionsPolicy?: string;
    crossOriginOpenerPolicy?: "same-origin" | "unsafe-none";
    extraHeaders?: Record<string, string>;
}
export interface ResolvedSecurityPolicy extends Required<Omit<SecurityPolicy, "extraHeaders">> {
    extraHeaders: Record<string, string>;
}
export declare function defineSecurityPolicy(policy: SecurityPolicy): SecurityPolicy;
export declare function normalizeSecurityPolicy(policy?: SecurityPolicy): ResolvedSecurityPolicy;
export declare function applySecurityPolicy(response: SourceOGResponse, policy?: SecurityPolicy): SourceOGResponse;
