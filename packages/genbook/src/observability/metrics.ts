import type { MetricsSnapshot } from "../types/adosf.js";

function keyFor(name: string, labels: Record<string, string>): string {
  const normalized = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return `${name}:${JSON.stringify(normalized)}`;
}

export class InMemoryMetricsRegistry {
  private readonly counters = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  private readonly gauges = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  private readonly histograms = new Map<string, { name: string; labels: Record<string, string>; count: number; sum: number }>();

  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = keyFor(name, labels);
    const current = this.counters.get(key) ?? { name, labels, value: 0 };
    current.value += value;
    this.counters.set(key, current);
  }

  setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    this.gauges.set(keyFor(name, labels), { name, labels, value });
  }

  observeHistogram(name: string, labels: Record<string, string> = {}, value: number): void {
    const key = keyFor(name, labels);
    const current = this.histograms.get(key) ?? { name, labels, count: 0, sum: 0 };
    current.count += 1;
    current.sum += value;
    this.histograms.set(key, current);
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: [...this.counters.values()],
      gauges: [...this.gauges.values()],
      histograms: [...this.histograms.values()],
    };
  }
}
