import { AdosfError } from "./error.js";
import { EXCEPTION_POLICY_MAP } from "./exception-policy.js";

export interface ErrorBoundaryResult<T> {
  ok: boolean;
  value?: T;
  error?: AdosfError;
  fallback?: string;
}

export async function executeWithErrorBoundary<T>(operation: () => Promise<T> | T): Promise<ErrorBoundaryResult<T>> {
  try {
    return {
      ok: true,
      value: await operation(),
    };
  } catch (error) {
    const normalized = error instanceof AdosfError
      ? error
      : new AdosfError({
        code: "ADOSF_POLICY_DECISION_FAILURE",
        message: error instanceof Error ? error.message : String(error),
        category: "core",
        severity: "high",
        recoverability: "degradable",
        userImpact: "partial",
        metadata: {
          faultDomain: "error-boundary",
          retryable: false,
          fallbackClass: "cache-serve",
        },
        cause: error,
      });

    return {
      ok: false,
      error: normalized,
      fallback: EXCEPTION_POLICY_MAP[normalized.code]?.fallback ?? "typed-error",
    };
  }
}
