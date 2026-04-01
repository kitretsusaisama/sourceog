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

export function defineSecurityPolicy(policy: SecurityPolicy): SecurityPolicy {
  return policy;
}

export function normalizeSecurityPolicy(policy?: SecurityPolicy): ResolvedSecurityPolicy {
  return {
    contentSecurityPolicy: policy?.contentSecurityPolicy ?? "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
    frameOptions: policy?.frameOptions ?? "SAMEORIGIN",
    referrerPolicy: policy?.referrerPolicy ?? "strict-origin-when-cross-origin",
    xContentTypeOptions: policy?.xContentTypeOptions ?? "nosniff",
    strictTransportSecurity: policy?.strictTransportSecurity ?? "max-age=31536000; includeSubDomains",
    permissionsPolicy: policy?.permissionsPolicy ?? "camera=(), geolocation=(), microphone=()",
    crossOriginOpenerPolicy: policy?.crossOriginOpenerPolicy ?? "same-origin",
    extraHeaders: policy?.extraHeaders ?? {}
  };
}

export function applySecurityPolicy(response: SourceOGResponse, policy?: SecurityPolicy): SourceOGResponse {
  const resolved = normalizeSecurityPolicy(policy);
  response.headers.set("content-security-policy", resolved.contentSecurityPolicy);
  response.headers.set("x-frame-options", resolved.frameOptions);
  response.headers.set("referrer-policy", resolved.referrerPolicy);
  response.headers.set("x-content-type-options", resolved.xContentTypeOptions);
  response.headers.set("strict-transport-security", resolved.strictTransportSecurity);
  response.headers.set("permissions-policy", resolved.permissionsPolicy);
  response.headers.set("cross-origin-opener-policy", resolved.crossOriginOpenerPolicy);

  for (const [key, value] of Object.entries(resolved.extraHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}
