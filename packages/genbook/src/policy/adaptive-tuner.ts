import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DecisionTraceEntry,
  RouteMetrics,
  TunerSnapshotManifest,
  TuningHints,
} from "../types/adosf.js";

export interface AdaptiveTuner {
  observe(metrics: RouteMetrics): void;
  getHints(routeId: string): TuningHints | null;
  recordDecisionTrace(entry: DecisionTraceEntry): void;
  getDecisionTraces(): DecisionTraceEntry[];
  persistSnapshot(filePath: string): Promise<void>;
  loadSnapshot(filePath: string): Promise<void>;
  toManifest(): TunerSnapshotManifest;
}

export class RuleBasedAdaptiveTuner implements AdaptiveTuner {
  private readonly hints = new Map<string, TuningHints>();
  private readonly traces: DecisionTraceEntry[] = [];

  observe(metrics: RouteMetrics): void {
    const explanations: string[] = [];
    const next: TuningHints = { explainability: explanations };

    if (metrics.p95LatencyMs > 500) {
      next.cacheTTL = 300;
      next.preferStrategy = "cache";
      explanations.push("p95-latency-over-500ms");
    }
    if (metrics.cacheHitRate > 0.85 && metrics.p95LatencyMs < 150) {
      next.runtimeTarget = "edge";
      next.cacheTTL = Math.max(next.cacheTTL ?? 120, 600);
      explanations.push("high-cache-hit-low-latency");
    }
    if (metrics.errorRate > 0.03) {
      next.runtimeTarget = "node";
      next.degradeTo = "hybrid-cache";
      explanations.push("error-rate-spike");
    }
    if (metrics.queueDepth > 50) {
      next.queuePriority = "high";
      next.pinRoute = true;
      explanations.push("queue-depth-saturation");
    }

    this.hints.set(metrics.routeId, next);
  }

  getHints(routeId: string): TuningHints | null {
    return this.hints.get(routeId) ?? null;
  }

  recordDecisionTrace(entry: DecisionTraceEntry): void {
    this.traces.push(entry);
    if (this.traces.length > 200) {
      this.traces.shift();
    }
  }

  getDecisionTraces(): DecisionTraceEntry[] {
    return [...this.traces];
  }

  async persistSnapshot(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.toManifest(), null, 2), "utf8");
  }

  async loadSnapshot(filePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const manifest = JSON.parse(raw) as TunerSnapshotManifest;
      this.hints.clear();
      for (const [routeId, hint] of Object.entries(manifest.routeHints)) {
        this.hints.set(routeId, hint);
      }
      this.traces.splice(0, this.traces.length, ...(manifest.decisionTraces ?? []));
    } catch {
      // Ignore missing snapshots during cold start.
    }
  }

  toManifest(): TunerSnapshotManifest {
    return {
      version: "adosf-x/1",
      generatedAt: new Date().toISOString(),
      routeHints: Object.fromEntries(this.hints.entries()),
      decisionTraces: [...this.traces],
    };
  }
}
