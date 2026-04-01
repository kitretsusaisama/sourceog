import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "./logger.js";
import type { CacheEntry, CachePolicy } from "./cache.js";

const logger = createLogger();

export interface Lock {
  routeKey: string;
  acquiredAt: number;
}

export type ISRCachePolicy = CachePolicy;
export type ISRCacheEntry = CacheEntry;

export interface ISRCoordinatorOptions {
  outputDir?: string;
  lockTimeoutMs?: number;
}

export class ISRCoordinator {
  private readonly locks = new Map<string, Lock>();
  private readonly outputDir: string;
  private readonly lockTimeoutMs: number;

  public constructor(options: ISRCoordinatorOptions = {}) {
    this.outputDir = options.outputDir ?? ".sourceog/isr";
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  }

  public async acquireLock(routeKey: string): Promise<Lock | null> {
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      if (Date.now() > deadline) {
        logger.warn("ISR lock acquisition timed out", { routeKey, timeoutMs: this.lockTimeoutMs });
        return null;
      }

      if (!this.locks.has(routeKey)) {
        const lock: Lock = { routeKey, acquiredAt: Date.now() };
        this.locks.set(routeKey, lock);
        return lock;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  public async releaseLock(lock: Lock): Promise<void> {
    this.locks.delete(lock.routeKey);
  }

  public async atomicSwap(routeKey: string, newContent: Buffer): Promise<void> {
    const finalPath = this.resolveOutputPath(routeKey);
    const tmpPath = `${finalPath}.tmp`;
    const prevPath = `${finalPath}.prev`;

    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(tmpPath, newContent);

    try {
      await fs.rm(prevPath, { force: true });
      await fs.rename(finalPath, prevPath);
    } catch (error) {
      const details = error as NodeJS.ErrnoException;
      if (details.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.rename(tmpPath, finalPath);
  }

  public async isStale(_routeKey: string, entry: Pick<ISRCacheEntry, "expiresAt">): Promise<boolean> {
    return Date.now() > entry.expiresAt;
  }

  public getLockMap(): ReadonlyMap<string, Lock> {
    return this.locks;
  }

  private resolveOutputPath(routeKey: string): string {
    const safeName = routeKey.replace(/[^a-zA-Z0-9_\-./]/g, "_");
    return path.join(this.outputDir, `${safeName}.html`);
  }
}
