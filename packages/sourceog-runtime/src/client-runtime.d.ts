import { ClientConsistencyGraph } from "./client-graph.js";
export interface FlightUpdateApplier {
    apply(stream: ReadableStream<Uint8Array> | string): Promise<void>;
}
export interface ClientRuntimeOptions {
    flightApplier: FlightUpdateApplier;
    refreshRoute?: (url?: string, replaceState?: boolean) => Promise<void>;
}
export declare class ClientRuntime {
    private readonly options;
    readonly graph: ClientConsistencyGraph;
    constructor(options: ClientRuntimeOptions);
    hydrate(): Promise<void>;
    applyFlightUpdate(stream: ReadableStream<Uint8Array> | string): Promise<void>;
    onInvalidation(nodeId: string): Promise<void>;
}
