export interface RetryPolicy {
  max: number;
  backoffMs: number;
  strategy: "none" | "linear" | "exponential";
}

export interface CircuitBreakerPolicy {
  threshold: number;
  windowMs: number;
  halfOpenAfterMs: number;
}

export interface ResiliencePolicy {
  fallback: string;
  retry: RetryPolicy | false;
  circuitBreaker: CircuitBreakerPolicy | false;
  quarantine: boolean;
  alertSeverity: "info" | "warn" | "page";
  metricsLabel: string;
}

export const EXCEPTION_POLICY_MAP: Record<string, ResiliencePolicy> = {
  ADOSF_GRAPH_INCONSISTENCY: {
    fallback: "quarantine-route",
    retry: false,
    circuitBreaker: false,
    quarantine: true,
    alertSeverity: "warn",
    metricsLabel: "graph_inconsistency",
  },
  ADOSF_OPTIMISTIC_CONFLICT: {
    fallback: "rollback-patch",
    retry: false,
    circuitBreaker: false,
    quarantine: false,
    alertSeverity: "info",
    metricsLabel: "optimistic_conflict",
  },
  ADOSF_POLICY_DECISION_FAILURE: {
    fallback: "cache-serve",
    retry: { max: 1, backoffMs: 10, strategy: "linear" },
    circuitBreaker: { threshold: 5, windowMs: 10000, halfOpenAfterMs: 30000 },
    quarantine: false,
    alertSeverity: "page",
    metricsLabel: "policy_decision_failure",
  },
};
