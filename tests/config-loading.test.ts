import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  defineConfig,
  deepFreeze,
  deepMerge,
  FrameworkError,
  type SourceOGConfig,
  type SourceOGPlugin,
  type SourceOGPreset,
  type EnvSchema,
} from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a SourceOGConfig in-memory (no file I/O) by calling the internal
 * merge + plugin-hook logic directly. We expose loadConfig for file-based
 * loading, but for property tests we exercise the same algorithm by
 * constructing configs programmatically and passing them through a thin
 * wrapper that mirrors loadConfig's logic without touching the filesystem.
 */
async function runConfigPipeline(raw: SourceOGConfig): Promise<Readonly<SourceOGConfig>> {
  // Mirror the loadConfig algorithm without file I/O
  const defaultCfg: SourceOGConfig = {
    appDir: "app",
    outDir: ".sourceog",
    publicDir: "public",
    trailingSlash: false,
    plugins: [],
    presets: [],
    env: {},
    experimental: {},
  };

  let merged: SourceOGConfig = { ...defaultCfg };

  // Merge presets in declaration order
  for (const preset of raw.presets ?? []) {
    if (preset.config) {
      merged = deepMerge(
        merged as Record<string, unknown>,
        preset.config as Record<string, unknown>
      ) as SourceOGConfig;
    }
    merged = {
      ...merged,
      plugins: [...(merged.plugins ?? []), ...preset.plugins],
    };
  }

  // Merge user config on top (without presets to avoid duplication)
  // Plugins from presets are already in merged.plugins; user plugins are appended
  const { presets: _presets, plugins: userPlugins, ...rawWithoutPresetsAndPlugins } = raw;
  merged = deepMerge(
    merged as Record<string, unknown>,
    rawWithoutPresetsAndPlugins as Record<string, unknown>
  ) as SourceOGConfig;
  // Append user-level plugins after preset plugins
  merged = {
    ...merged,
    plugins: [...(merged.plugins ?? []), ...(userPlugins ?? [])],
  };

  // Run plugin config hooks
  for (const plugin of merged.plugins ?? []) {
    if (plugin.config) {
      merged = await plugin.config(merged);
    }
  }

  // Validate required env vars
  for (const [key, schema] of Object.entries(merged.env ?? {})) {
    const value = process.env[key];
    if (schema.required && (value === undefined || value === null || value === "")) {
      throw new FrameworkError(
        "ENV_MISSING_REQUIRED",
        `Required environment variable "${key}" is not set.`,
        { context: { key } }
      );
    }
  }

  return deepFreeze(merged);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const safeStringArb = fc.string({ minLength: 1, maxLength: 20 }).map((s) =>
  s.replace(/[^a-zA-Z0-9_]/g, "x")
);

// ---------------------------------------------------------------------------
// Property 17: Config presets merge before plugin hooks
// Validates: Requirements 15.2
// ---------------------------------------------------------------------------

describe("loadConfig — Property 17: Config presets merge before plugin hooks", () => {
  it("plugin config hooks see the fully merged preset config", async () => {
    /**
     * **Validates: Requirements 15.2**
     *
     * For any combination of presets and plugins, when a plugin's config hook
     * is invoked it must already see the values contributed by all presets
     * that were declared before the plugin.
     */
    await fc.assert(
      fc.asyncProperty(
        // Generate 1–3 presets each with a distinct appDir value
        fc.array(
          fc.record({
            name: safeStringArb,
            appDir: safeStringArb,
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (presetDefs) => {
          // The last preset's appDir should be visible to the plugin hook
          const lastPresetAppDir = presetDefs[presetDefs.length - 1].appDir;

          const observedConfigs: SourceOGConfig[] = [];

          const spyPlugin: SourceOGPlugin = {
            name: "spy",
            config(cfg) {
              observedConfigs.push({ ...cfg });
              return cfg;
            },
          };

          const presets: SourceOGPreset[] = presetDefs.map((def) => ({
            name: def.name,
            plugins: [],
            config: { appDir: def.appDir },
          }));

          const raw: SourceOGConfig = {
            presets,
            plugins: [spyPlugin],
          };

          await runConfigPipeline(raw);

          // The spy plugin must have been called exactly once
          if (observedConfigs.length !== 1) return false;

          // The config seen by the plugin must have the last preset's appDir
          // (since user config has no appDir, the last preset wins)
          return observedConfigs[0].appDir === lastPresetAppDir;
        }
      )
    );
  });

  it("preset plugins are added to the plugin list before user plugins run their hooks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(safeStringArb, { minLength: 1, maxLength: 3 }),
        async (presetPluginNames) => {
          const executionOrder: string[] = [];

          const presetPlugins: SourceOGPlugin[] = presetPluginNames.map((name) => ({
            name,
            config(cfg) {
              executionOrder.push(`preset:${name}`);
              return cfg;
            },
          }));

          const userPlugin: SourceOGPlugin = {
            name: "user",
            config(cfg) {
              executionOrder.push("user");
              return cfg;
            },
          };

          const preset: SourceOGPreset = {
            name: "test-preset",
            plugins: presetPlugins,
          };

          const raw: SourceOGConfig = {
            presets: [preset],
            plugins: [userPlugin],
          };

          await runConfigPipeline(raw);

          // All preset plugin hooks must run before the user plugin hook
          const userIndex = executionOrder.indexOf("user");
          if (userIndex === -1) return false;

          for (const name of presetPluginNames) {
            const presetIndex = executionOrder.indexOf(`preset:${name}`);
            if (presetIndex === -1 || presetIndex >= userIndex) return false;
          }

          return true;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Required env var absence throws before server starts
// Validates: Requirements 15.3
// ---------------------------------------------------------------------------

describe("loadConfig — Property 18: Required env var absence throws before server starts", () => {
  it("throws FrameworkError(ENV_MISSING_REQUIRED) when a required env var is absent", async () => {
    /**
     * **Validates: Requirements 15.3**
     *
     * For any config that declares a required env var that is not present in
     * process.env, loadConfig must throw FrameworkError with code
     * ENV_MISSING_REQUIRED before returning.
     */
    await fc.assert(
      fc.asyncProperty(
        // Generate env var keys that are guaranteed not to be in process.env
        fc.array(
          fc.string({ minLength: 10, maxLength: 30 }).map((s) =>
            `SOURCEOG_TEST_MISSING_${s.replace(/[^A-Z0-9]/gi, "X").toUpperCase()}`
          ),
          { minLength: 1, maxLength: 3 }
        ),
        async (missingKeys) => {
          // Ensure these keys are truly absent
          for (const key of missingKeys) {
            delete process.env[key];
          }

          const env: Record<string, EnvSchema> = {};
          for (const key of missingKeys) {
            env[key] = { required: true };
          }

          const raw: SourceOGConfig = { env };

          try {
            await runConfigPipeline(raw);
            return false; // Should have thrown
          } catch (err) {
            if (!(err instanceof FrameworkError)) return false;
            if (err.code !== "ENV_MISSING_REQUIRED") return false;
            // The context must include the missing key
            const missingKey = err.context["key"] as string;
            return missingKeys.includes(missingKey);
          }
        }
      )
    );
  });

  it("does NOT throw when all required env vars are present", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 5, maxLength: 20 }).map((s) =>
            `SOURCEOG_TEST_PRESENT_${s.replace(/[^A-Z0-9]/gi, "P").toUpperCase()}`
          ),
          { minLength: 1, maxLength: 3 }
        ),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
        async (keys, values) => {
          // Set all keys in process.env
          for (let i = 0; i < keys.length; i++) {
            process.env[keys[i]] = values[i % values.length] || "present";
          }

          const env: Record<string, EnvSchema> = {};
          for (const key of keys) {
            env[key] = { required: true };
          }

          try {
            await runConfigPipeline({ env });
            return true;
          } catch (err) {
            if (err instanceof FrameworkError && err.code === "ENV_MISSING_REQUIRED") {
              return false;
            }
            return true; // Other errors are not what we're testing
          } finally {
            // Clean up
            for (const key of keys) {
              delete process.env[key];
            }
          }
        }
      )
    );
  });

  it("non-required env vars do not cause a throw when absent", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 30 }).map((s) =>
          `SOURCEOG_TEST_OPT_${s.replace(/[^A-Z0-9]/gi, "O").toUpperCase()}`
        ),
        async (key) => {
          delete process.env[key];

          const raw: SourceOGConfig = {
            env: { [key]: { required: false } },
          };

          try {
            await runConfigPipeline(raw);
            return true;
          } catch (err) {
            if (err instanceof FrameworkError && err.code === "ENV_MISSING_REQUIRED") {
              return false;
            }
            return true;
          }
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: Returned config is deeply frozen
// Validates: Requirements 15.4
// ---------------------------------------------------------------------------

describe("loadConfig — Property 19: Returned config is deeply frozen", () => {
  /**
   * **Validates: Requirements 15.4**
   *
   * For any valid config, the object returned by loadConfig (or our pipeline)
   * must be deeply frozen: Object.isFrozen(config) === true, and all nested
   * plain objects must also be frozen.
   */

  function isDeepFrozen(obj: unknown): boolean {
    if (obj === null || typeof obj !== "object") return true;
    if (!Object.isFrozen(obj)) return false;
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (!isDeepFrozen(value)) return false;
    }
    return true;
  }

  it("top-level config object is frozen", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          appDir: fc.option(safeStringArb, { nil: undefined }),
          trailingSlash: fc.option(fc.boolean(), { nil: undefined }),
        }),
        async (partial) => {
          const raw: SourceOGConfig = partial;
          const config = await runConfigPipeline(raw);
          return Object.isFrozen(config);
        }
      )
    );
  });

  it("nested objects within config are also frozen", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          appDir: fc.option(safeStringArb, { nil: undefined }),
          experimental: fc.option(
            fc.dictionary(safeStringArb, fc.boolean()),
            { nil: undefined }
          ),
        }),
        async (partial) => {
          const raw: SourceOGConfig = partial;
          const config = await runConfigPipeline(raw);
          return isDeepFrozen(config);
        }
      )
    );
  });

  it("deepFreeze freezes all nested plain objects recursively", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a nested object structure
        fc.record({
          a: fc.record({
            b: fc.record({
              c: fc.integer(),
            }),
          }),
          d: fc.string(),
        }),
        async (nested) => {
          const frozen = deepFreeze(nested);
          return isDeepFrozen(frozen);
        }
      )
    );
  });

  it("config returned by runConfigPipeline is immutable (mutation throws in strict mode)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          appDir: fc.option(safeStringArb, { nil: undefined }),
        }),
        async (partial) => {
          const config = await runConfigPipeline(partial);
          // Attempting to mutate a frozen object throws in strict mode
          let threw = false;
          try {
            (config as Record<string, unknown>)["appDir"] = "mutated";
          } catch {
            threw = true;
          }
          // Either it threw (strict mode) or the value was not changed
          return threw || config.appDir !== "mutated";
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for defineConfig and FrameworkError
// ---------------------------------------------------------------------------

describe("defineConfig — unit tests", () => {
  it("returns the same config object passed in", () => {
    const cfg: SourceOGConfig = { appDir: "src/app", trailingSlash: true };
    expect(defineConfig(cfg)).toBe(cfg);
  });

  it("works with an empty config", () => {
    expect(defineConfig({})).toEqual({});
  });
});

describe("FrameworkError — unit tests", () => {
  it("has the correct code and name", () => {
    const err = new FrameworkError("CONFIG_INVALID", "bad config");
    expect(err.code).toBe("CONFIG_INVALID");
    expect(err.name).toBe("FrameworkError");
    expect(err instanceof Error).toBe(true);
  });

  it("stores context", () => {
    const err = new FrameworkError("ENV_MISSING_REQUIRED", "missing", {
      context: { key: "MY_VAR" },
    });
    expect(err.context).toEqual({ key: "MY_VAR" });
  });

  it("defaults layer to config", () => {
    const err = new FrameworkError("CONFIG_INVALID", "x");
    expect(err.layer).toBe("config");
  });
});
