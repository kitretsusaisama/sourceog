import type { CacheEntry, CachePolicy } from "./cache.js";
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
export declare class ISRCoordinator {
    private readonly locks;
    private readonly outputDir;
    private readonly lockTimeoutMs;
    constructor(options?: ISRCoordinatorOptions);
    acquireLock(routeKey: string): Promise<Lock | null>;
    releaseLock(lock: Lock): Promise<void>;
    atomicSwap(routeKey: string, newContent: Buffer): Promise<void>;
    isStale(_routeKey: string, entry: Pick<ISRCacheEntry, "expiresAt">): Promise<boolean>;
    getLockMap(): ReadonlyMap<string, Lock>;
    private resolveOutputPath;
}
