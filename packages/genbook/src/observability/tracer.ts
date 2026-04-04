export interface TraceSpan {
  name: string;
  startedAt: number;
  endedAt?: number;
  attributes: Record<string, string | number | boolean>;
}

export class InMemoryTracer {
  private readonly spans: TraceSpan[] = [];

  startSpan(name: string, attributes: Record<string, string | number | boolean> = {}): TraceSpan {
    const span: TraceSpan = {
      name,
      startedAt: Date.now(),
      attributes,
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span: TraceSpan): void {
    span.endedAt = Date.now();
  }

  getSpans(): TraceSpan[] {
    return this.spans.map((span) => ({ ...span, attributes: { ...span.attributes } }));
  }
}
