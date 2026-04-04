import { ClientConsistencyGraph } from "./client-graph.js";

export interface FlightUpdateApplier {
  apply(stream: ReadableStream<Uint8Array> | string): Promise<void>;
}

export interface ClientRuntimeOptions {
  flightApplier: FlightUpdateApplier;
  refreshRoute?: (url?: string, replaceState?: boolean) => Promise<void>;
}

export class ClientRuntime {
  public readonly graph = new ClientConsistencyGraph();

  constructor(private readonly options: ClientRuntimeOptions) {}

  async hydrate(): Promise<void> {
    const snapshot = typeof window !== "undefined"
      ? window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__
      : undefined;
    const graphManifest = (snapshot as typeof snapshot & { consistencyGraphManifest?: Parameters<ClientConsistencyGraph["seedFromManifest"]>[0] })?.consistencyGraphManifest;
    if (graphManifest) {
      this.graph.seedFromManifest(graphManifest);
    }
  }

  async applyFlightUpdate(stream: ReadableStream<Uint8Array> | string): Promise<void> {
    await this.options.flightApplier.apply(stream);
  }

  async onInvalidation(nodeId: string): Promise<void> {
    const affected = this.graph.dependentsOf(nodeId);
    if (affected.length === 0) {
      return;
    }

    if (affected.some((id) => id.startsWith("route:"))) {
      await this.options.refreshRoute?.();
      return;
    }

    this.graph.emit(nodeId);
  }
}
