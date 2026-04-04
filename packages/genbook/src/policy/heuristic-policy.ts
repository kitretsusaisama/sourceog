import type {
  ControlPlaneRequestInput,
  ControlPlaneRouteInput,
  RenderDecision,
  RouteClass,
  TrafficSegment,
} from "../types/adosf.js";

function classifyRoute(route: ControlPlaneRouteInput): RouteClass {
  if (route.tags?.includes("critical")) return "latency-critical";
  if (route.tags?.includes("mutation-heavy")) return "mutation-heavy";
  if (route.tags?.includes("auth")) return "auth-sensitive";
  if (route.capabilities?.includes("edge-capable")) return "edge-friendly";
  if (route.capabilities?.includes("dynamic-only")) return "semi-static";
  return "static";
}

function classifyTrafficSegment(ctx: ControlPlaneRequestInput): TrafficSegment {
  if (ctx.degraded) return "degraded-mode";
  if (ctx.headers?.["user-agent"]?.toLowerCase().includes("bot")) return "bot";
  if (ctx.isAuthenticated) return "authenticated";
  return "anonymous";
}

export interface HeuristicPolicyContext {
  route: ControlPlaneRouteInput;
  request: ControlPlaneRequestInput;
}

export function createHeuristicDecision(input: HeuristicPolicyContext): RenderDecision {
  const routeClass = classifyRoute(input.route);
  const trafficSegment = classifyTrafficSegment(input.request);

  if (input.request.degraded) {
    return {
      strategy: "cache",
      cachePosture: "warm",
      runtimeTarget: "node",
      queuePriority: "high",
      hydrationPosture: "incremental-flight",
      invalidationMode: "graph",
      fallbackLadder: ["cache-serve", "shell-only", "typed-error"],
      observabilitySampleRate: 1,
      safetyProfile: "strict",
      ttlSeconds: 120,
      routeClass,
      trafficSegment,
      reason: "degraded-traffic-safety-envelope",
    };
  }

  if (input.request.isAuthenticated || routeClass === "auth-sensitive") {
    return {
      strategy: "stream",
      cachePosture: "cold",
      runtimeTarget: "node",
      queuePriority: "critical",
      hydrationPosture: "incremental-flight",
      invalidationMode: "graph",
      fallbackLadder: ["full-stream", "incremental-stream", "shell-only", "typed-error"],
      observabilitySampleRate: 1,
      safetyProfile: "resilience-biased",
      ttlSeconds: null,
      routeClass,
      trafficSegment,
      reason: "authenticated-or-sensitive-route",
    };
  }

  if (routeClass === "latency-critical") {
    return {
      strategy: "hybrid",
      cachePosture: "warm",
      runtimeTarget: input.request.runtimeTargetHint ?? "node",
      queuePriority: "critical",
      hydrationPosture: "incremental-flight",
      invalidationMode: "graph",
      fallbackLadder: ["full-stream", "hybrid-cache", "cache-serve", "shell-only"],
      observabilitySampleRate: 1,
      safetyProfile: "latency-biased",
      ttlSeconds: 30,
      routeClass,
      trafficSegment,
      reason: "critical-route-fast-path",
    };
  }

  if (routeClass === "edge-friendly" || trafficSegment === "bot") {
    return {
      strategy: "cache",
      cachePosture: "hot",
      runtimeTarget: "edge",
      queuePriority: "normal",
      hydrationPosture: "server-only",
      invalidationMode: "graph",
      fallbackLadder: ["cache-serve", "shell-only", "typed-error"],
      observabilitySampleRate: 0.5,
      safetyProfile: "balanced",
      ttlSeconds: 300,
      routeClass,
      trafficSegment,
      reason: "edge-cacheable-route",
    };
  }

  return {
    strategy: "hybrid",
    cachePosture: "warm",
    runtimeTarget: "node",
    queuePriority: "normal",
    hydrationPosture: "incremental-flight",
    invalidationMode: "graph",
    fallbackLadder: ["full-stream", "hybrid-cache", "cache-serve", "shell-only", "typed-error"],
    observabilitySampleRate: 0.25,
    safetyProfile: "balanced",
    ttlSeconds: 60,
    routeClass,
    trafficSegment,
    reason: "default-hybrid-policy",
  };
}
