import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CacheEntry, CachePolicy, CacheStore } from "./cache.js";
import type { DataCacheBackend, DataCacheEntry } from "./data-cache.js";

interface SerializedEntry {
  kind: "route" | "data";
  scope: "request" | "shared" | "route";
  routeKey: string;
  tags: string[];
  linkedRouteIds: string[];
  linkedTagIds: string[];
  body: string;
  headers: Record<string, string>;
  status: number;
  createdAt: number;
  expiresAt: number;
  etag: string;
  buildId: string;
}

function serialize(entry: CacheEntry): SerializedEntry {
  return { ...entry, body: entry.body.toString("base64") };
}

function deserialize(raw: SerializedEntry): CacheEntry {
  return { ...raw, body: Buffer.from(raw.body, "base64") };
}

/** Shape of the tags.json Tag_Index file: tag → array of safe cache-entry filenames (without .json). */
type TagIndex = Record<string, string[]>;

export class FilesystemCacheStore implements CacheStore {
  private readonly cacheDir: string;
  private readonly tagIndexPath: string;

  public constructor(cacheDir = ".sourceog/cache") {
    this.cacheDir = cacheDir;
    this.tagIndexPath = path.join(cacheDir, "tags.json");
  }

  public async get(key: string): Promise<CacheEntry | null> {
    const filePath = this.entryPath(key);
    let raw: SerializedEntry;
    try {
      const text = await fs.readFile(filePath, "utf8");
      raw = JSON.parse(text) as SerializedEntry;
    } catch {
      return null;
    }

    if (Date.now() > raw.expiresAt) {
      return null;
    }

    return deserialize(raw);
  }

  public async set(key: string, entry: CacheEntry, _policy: CachePolicy): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const safe = this.safeKey(key);
    const filePath = path.join(this.cacheDir, `${safe}.json`);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(serialize(entry)), "utf8");
    await fs.rename(tmpPath, filePath);

    if (entry.tags.length > 0) {
      await this.updateTagIndex((index) => {
        for (const tag of entry.tags) {
          const existing = Array.isArray(index[tag]) ? index[tag] : [];
          if (!existing.includes(safe)) {
            existing.push(safe);
          }
          index[tag] = existing;
        }
      });
    }
  }

  public async purge(tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }

    const index = await this.getTagIndex();
    const keysToDelete = new Set<string>();
    for (const tag of tags) {
      for (const safe of index[tag] ?? []) {
        keysToDelete.add(safe);
      }
    }

    if (keysToDelete.size === 0) {
      return;
    }

    await Promise.all(
      [...keysToDelete].map(async (safe) => {
        try {
          await fs.unlink(path.join(this.cacheDir, `${safe}.json`));
        } catch {
          // Already gone — no-op.
        }
      })
    );

    // Remove purged keys from the index.
    await this.updateTagIndex((index) => {
      for (const tag of Object.keys(index)) {
        index[tag] = index[tag].filter((k) => !keysToDelete.has(k));
        if (index[tag].length === 0) {
          delete index[tag];
        }
      }
    });
  }

  public async revalidate(routeKey: string): Promise<void> {
    const safe = this.safeKey(routeKey);
    try {
      await fs.unlink(path.join(this.cacheDir, `${safe}.json`));
    } catch {
      // Missing entries are already effectively revalidated.
    }
    await this.removeKeyFromTagIndex(safe);
  }

  public async purgeKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    const safeKeys = keys.map((k) => this.safeKey(k));
    await Promise.all(
      safeKeys.map(async (safe) => {
        try {
          await fs.unlink(path.join(this.cacheDir, `${safe}.json`));
        } catch {
          // Missing entries are already effectively purged.
        }
      })
    );

    const safeSet = new Set(safeKeys);
    await this.updateTagIndex((index) => {
      for (const tag of Object.keys(index)) {
        index[tag] = index[tag].filter((k) => !safeSet.has(k));
        if (index[tag].length === 0) {
          delete index[tag];
        }
      }
    });
  }

  public async purgeLinkedRoutes(routeKeys: string[]): Promise<void> {
    if (routeKeys.length === 0) {
      return;
    }

    const lookup = new Set(routeKeys);
    let files: string[];
    try {
      files = await fs.readdir(this.cacheDir);
    } catch {
      return;
    }

    const deletedSafeKeys: string[] = [];
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json") && file !== "tags.json")
        .map(async (file) => {
          const filePath = path.join(this.cacheDir, file);
          try {
            const text = await fs.readFile(filePath, "utf8");
            const raw = JSON.parse(text) as SerializedEntry;
            if (raw.linkedRouteIds.some((routeKey) => lookup.has(routeKey))) {
              await fs.unlink(filePath);
              deletedSafeKeys.push(file.slice(0, -5)); // strip .json
            }
          } catch {
            // Ignore unreadable or concurrently removed files.
          }
        })
    );

    if (deletedSafeKeys.length > 0) {
      const deletedSet = new Set(deletedSafeKeys);
      await this.updateTagIndex((index) => {
        for (const tag of Object.keys(index)) {
          index[tag] = index[tag].filter((k) => !deletedSet.has(k));
          if (index[tag].length === 0) {
            delete index[tag];
          }
        }
      });
    }
  }

  // ── Tag_Index helpers ──────────────────────────────────────────────────────

  /** Read tags.json; rebuild from cache entries if missing or corrupt. */
  private async getTagIndex(): Promise<TagIndex> {
    try {
      const text = await fs.readFile(this.tagIndexPath, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Copy into a null-prototype object to avoid prototype key collisions.
        return Object.assign(Object.create(null) as TagIndex, parsed as TagIndex);
      }
      return Object.create(null) as TagIndex;
    } catch {
      return this.rebuildTagIndex();
    }
  }

  /** Rebuild tags.json by scanning all existing cache entry files. */
  private async rebuildTagIndex(): Promise<TagIndex> {
    const index: TagIndex = Object.create(null) as TagIndex;
    let files: string[];
    try {
      files = await fs.readdir(this.cacheDir);
    } catch {
      return index;
    }

    await Promise.all(
      files
        .filter((f) => f.endsWith(".json") && f !== "tags.json")
        .map(async (file) => {
          const safe = file.slice(0, -5);
          try {
            const text = await fs.readFile(path.join(this.cacheDir, file), "utf8");
            const raw = JSON.parse(text) as SerializedEntry;
            for (const tag of raw.tags ?? []) {
              const existing = Array.isArray(index[tag]) ? index[tag] : [];
              if (!existing.includes(safe)) existing.push(safe);
              index[tag] = existing;
            }
          } catch {
            // Skip unreadable entries.
          }
        })
    );

    try {
      const tmpPath = `${this.tagIndexPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(index), "utf8");
      await fs.rename(tmpPath, this.tagIndexPath);
    } catch {
      // Best-effort write; non-fatal.
    }

    return index;
  }

  /** Atomically read-modify-write tags.json. Deletes the file when the index becomes empty. */
  private async updateTagIndex(mutate: (index: TagIndex) => void): Promise<void> {
    const index = await this.getTagIndex();
    mutate(index);
    if (Object.keys(index).length === 0) {
      try {
        await fs.unlink(this.tagIndexPath);
      } catch {
        // Already gone — no-op.
      }
      return;
    }
    const tmpPath = `${this.tagIndexPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(index), "utf8");
    await fs.rename(tmpPath, this.tagIndexPath);
  }

  /** Remove a single safe key from all tag arrays in the index. */
  private async removeKeyFromTagIndex(safe: string): Promise<void> {
    await this.updateTagIndex((index) => {
      for (const tag of Object.keys(index)) {
        const before = index[tag];
        const after = before.filter((k) => k !== safe);
        if (after.length !== before.length) {
          index[tag] = after;
          if (after.length === 0) delete index[tag];
        }
      }
    });
  }

  private safeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_\-.]/g, "_");
  }

  private entryPath(key: string): string {
    return path.join(this.cacheDir, `${this.safeKey(key)}.json`);
  }
}

export class DataFilesystemCacheStore implements DataCacheBackend {
  private readonly cacheDir: string;
  private readonly tagsFile: string;

  constructor(cacheDir = ".sourceog/data-cache") {
    this.cacheDir = cacheDir;
    this.tagsFile = path.join(cacheDir, "tags.json");
  }

  async get(key: string): Promise<DataCacheEntry | null> {
    const filePath = path.join(this.cacheDir, `${this.safeKey(key)}.json`);
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text) as DataCacheEntry;
    } catch {
      return null;
    }
  }

  async set(key: string, entry: DataCacheEntry): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const safe = this.safeKey(key);
    const filePath = path.join(this.cacheDir, `${safe}.json`);
    const tmpPath = `${filePath}.tmp`;

    await fs.writeFile(tmpPath, JSON.stringify(entry), "utf8");
    await fs.rename(tmpPath, filePath);

    // Update tags.json
    let tags: Record<string, string[]> = {};
    try {
      const text = await fs.readFile(this.tagsFile, "utf8");
      tags = JSON.parse(text) as Record<string, string[]>;
    } catch {
      // Start fresh if missing or unreadable
    }

    for (const tag of entry.tags) {
      const existing = tags[tag] ?? [];
      if (!existing.includes(safe)) {
        existing.push(safe);
      }
      tags[tag] = existing;
    }

    const tagsTmp = `${this.tagsFile}.tmp`;
    await fs.writeFile(tagsTmp, JSON.stringify(tags), "utf8");
    await fs.rename(tagsTmp, this.tagsFile);
  }

  async delete(key: string): Promise<void> {
    const safe = this.safeKey(key);
    const filePath = path.join(this.cacheDir, `${safe}.json`);

    try {
      await fs.unlink(filePath);
    } catch {
      // Already gone — no-op
    }

    // Remove safe key from all tag arrays in tags.json
    let tags: Record<string, string[]> = {};
    try {
      const text = await fs.readFile(this.tagsFile, "utf8");
      tags = JSON.parse(text) as Record<string, string[]>;
    } catch {
      return;
    }

    let changed = false;
    for (const tag of Object.keys(tags)) {
      const before = tags[tag];
      const after = before.filter((k) => k !== safe);
      if (after.length !== before.length) {
        tags[tag] = after;
        changed = true;
      }
    }

    if (changed) {
      const tagsTmp = `${this.tagsFile}.tmp`;
      await fs.writeFile(tagsTmp, JSON.stringify(tags), "utf8");
      await fs.rename(tagsTmp, this.tagsFile);
    }
  }

  async deleteByTag(tag: string): Promise<void> {
    let tags: Record<string, string[]> = {};
    try {
      const text = await fs.readFile(this.tagsFile, "utf8");
      tags = JSON.parse(text) as Record<string, string[]>;
    } catch {
      return;
    }

    const safeKeys = tags[tag] ?? [];

    // Delete each entry file
    await Promise.all(
      safeKeys.map(async (safe) => {
        try {
          await fs.unlink(path.join(this.cacheDir, `${safe}.json`));
        } catch {
          // Already gone — no-op
        }
      })
    );

    // Remove the tag from tags.json
    delete tags[tag];
    const tagsTmp = `${this.tagsFile}.tmp`;
    await fs.writeFile(tagsTmp, JSON.stringify(tags), "utf8");
    await fs.rename(tagsTmp, this.tagsFile);
  }

  private safeKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}
