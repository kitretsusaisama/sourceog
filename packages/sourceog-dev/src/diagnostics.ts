import type { DiagnosticsEnvelope, DiagnosticIssue } from "@sourceog/runtime";

export interface DevClientSyncPayload {
  type: "sync";
  changedFile: string;
  changedAt: string;
  fullReload: boolean;
  affectedRouteIds: string[];
  affectedChunkIds: string[];
  diagnostics: DiagnosticsEnvelope;
  routeCount: number;
}

export interface DevClientDiagnosticsPayload {
  type: "diagnostics";
  diagnostics: DiagnosticsEnvelope;
}

export type DevClientMessage = DevClientSyncPayload | DevClientDiagnosticsPayload;

type Listener = (message: DevClientMessage) => void;

export class DevDiagnosticsBus {
  private readonly listeners = new Set<Listener>();

  private diagnostics: DiagnosticsEnvelope = {
    version: "2027.1",
    buildId: "dev",
    generatedAt: new Date().toISOString(),
    issues: []
  };

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setIssues(issues: DiagnosticIssue[]): DiagnosticsEnvelope {
    this.diagnostics = {
      version: "2027.1",
      buildId: "dev",
      generatedAt: new Date().toISOString(),
      issues
    };
    this.emit({
      type: "diagnostics",
      diagnostics: this.diagnostics
    });
    return this.diagnostics;
  }

  public emitSync(input: Omit<DevClientSyncPayload, "type" | "diagnostics">): void {
    this.emit({
      type: "sync",
      diagnostics: this.diagnostics,
      ...input
    });
  }

  public getEnvelope(): DiagnosticsEnvelope {
    return this.diagnostics;
  }

  private emit(message: DevClientMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}
