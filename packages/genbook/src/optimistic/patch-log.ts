import type { PatchLogEntry } from "../types/adosf.js";

export class PatchLog {
  private readonly entries: PatchLogEntry[] = [];

  append(entry: PatchLogEntry): void {
    this.entries.push(entry);
  }

  mark(actionId: string, status: PatchLogEntry["status"]): void {
    const entry = this.entries.find((candidate) => candidate.actionId === actionId);
    if (entry) {
      entry.status = status;
    }
  }

  list(): PatchLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  pendingCount(): number {
    return this.entries.filter((entry) => entry.status === "pending").length;
  }
}
