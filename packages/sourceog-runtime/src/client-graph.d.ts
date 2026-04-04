import type { ConsistencyGraphManifest } from "@sourceog/genbook/types";
type InvalidationListener = (nodeId: string) => void;
export declare class ClientConsistencyGraph {
    private readonly dependents;
    private readonly listeners;
    seedFromManifest(manifest: ConsistencyGraphManifest): void;
    dependentsOf(nodeId: string): string[];
    subscribe(nodeId: string, listener: InvalidationListener): () => void;
    emit(nodeId: string): void;
}
export {};
