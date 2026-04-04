import type { DecisionTrace, ExecutionPlan } from "./contracts.js";
import { getRequestContext } from "./context.js";
import { getArtifactMode } from "./artifacts.js";

export type { DecisionTrace, ExecutionPlan } from "./contracts.js";

function inferCapabilities(): string[] {
  const context = getRequestContext();
  const capabilities = new Set<string>(["node", "streaming", "actions"]);
  if (context?.request.runtime === "edge") {
    capabilities.add("edge");
  }
  if (context?.runtimeState?.cacheManifest) {
    capabilities.add("cache");
  }
  return [...capabilities].sort();
}

export function getExecutionPlan(): ExecutionPlan {
  const context = getRequestContext();
  const routeId = context?.runtimeState?.executionPlan?.routeId;
  const reasons = [
    `artifact-mode:${getArtifactMode()}`,
    `runtime:${context?.request.runtime ?? "node"}`,
  ];

  return {
    buildId: context?.runtimeState?.buildId,
    routeId,
    pathname: context?.request.url.pathname,
    requestId: context?.request.requestId,
    runtime: context?.runtimeState?.executionPlan?.runtime ?? (context?.request.runtime === "edge" ? "edge" : "node"),
    artifactMode: getArtifactMode(),
    decisionWindow: Math.floor(Date.now() / 60_000),
    capabilities: inferCapabilities(),
    reasons,
  };
}

export function inspectDecision(): DecisionTrace {
  const plan = getExecutionPlan();
  return {
    generatedAt: new Date().toISOString(),
    plan,
    reducerPhases: [
      "compatibility-constraints",
      "static-route-policy",
      "runtime-capability-constraints",
      "safety-envelope",
    ],
    overrides: [],
    confidence: 1,
  };
}
