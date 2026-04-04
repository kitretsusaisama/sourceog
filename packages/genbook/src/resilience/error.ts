import { SourceOGBaseError, type ErrorCategory, type ErrorSeverity } from "../errors/base.js";

export type Recoverability = "recoverable" | "degradable" | "fatal";

export type UserImpact = "none" | "partial" | "full";

export interface AdosfErrorMetadata {
  faultDomain: string;
  retryable: boolean;
  fallbackClass: string;
  correlationId?: string;
  decisionSnapshot?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export class AdosfError extends SourceOGBaseError {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly recoverability: Recoverability;
  public readonly userImpact: UserImpact;
  public readonly retryable: boolean;
  public readonly fallbackClass: string;
  public readonly correlationId?: string;
  public readonly decisionSnapshot?: Record<string, unknown>;

  constructor(input: {
    code: string;
    message: string;
    category: ErrorCategory;
    severity: ErrorSeverity;
    recoverability: Recoverability;
    userImpact: UserImpact;
    metadata: AdosfErrorMetadata;
    cause?: unknown;
  }) {
    super(input.message, {
      cause: input.cause,
      metadata: {
        faultDomain: input.metadata.faultDomain,
        details: input.metadata.details ?? {},
      },
    });
    this.code = input.code;
    this.category = input.category;
    this.severity = input.severity;
    this.recoverability = input.recoverability;
    this.userImpact = input.userImpact;
    this.retryable = input.metadata.retryable;
    this.fallbackClass = input.metadata.fallbackClass;
    this.correlationId = input.metadata.correlationId;
    this.decisionSnapshot = input.metadata.decisionSnapshot;
  }
}

export class GraphInconsistencyError extends AdosfError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "ADOSF_GRAPH_INCONSISTENCY",
      message,
      category: "core",
      severity: "high",
      recoverability: "degradable",
      userImpact: "partial",
      metadata: {
        faultDomain: "graph",
        retryable: false,
        fallbackClass: "quarantine-route",
        details,
      },
    });
  }
}

export class OptimisticConflictError extends AdosfError {
  constructor(resourceId: string, details?: Record<string, unknown>) {
    super({
      code: "ADOSF_OPTIMISTIC_CONFLICT",
      message: `Optimistic action conflict detected for "${resourceId}".`,
      category: "render",
      severity: "medium",
      recoverability: "recoverable",
      userImpact: "partial",
      metadata: {
        faultDomain: "optimistic",
        retryable: false,
        fallbackClass: "rollback-patch",
        details: { resourceId, ...details },
      },
    });
  }
}
