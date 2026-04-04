import type { ConsistencyGraphManifest } from "../types/adosf.js";

export interface GraphStore {
  read(): Promise<ConsistencyGraphManifest | null>;
  write(manifest: ConsistencyGraphManifest): Promise<void>;
}

export class MemoryGraphStore implements GraphStore {
  private manifest: ConsistencyGraphManifest | null = null;

  async read(): Promise<ConsistencyGraphManifest | null> {
    return this.manifest;
  }

  async write(manifest: ConsistencyGraphManifest): Promise<void> {
    this.manifest = manifest;
  }
}
