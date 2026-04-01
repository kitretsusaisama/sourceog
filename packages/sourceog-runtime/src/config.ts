/**
 * Config Layer — sourceog-runtime
 *
 * Implements loadConfig following the design algorithm:
 *   1. Import sourceog.config.ts (or use defaults)
 *   2. Validate shape → throw FrameworkError(CONFIG_INVALID) on failure
 *   3. Merge presets in declaration order (config + plugins)
 *   4. Run plugin config hooks in order
 *   5. Validate required env vars → throw FrameworkError(ENV_MISSING_REQUIRED)
 *   6. Return deepFreeze(merged)
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// FrameworkError
// ---------------------------------------------------------------------------

export type FrameworkErrorCode =
  | "CONFIG_INVALID"
  | "ENV_MISSING_REQUIRED"
  | "ROUTE_COLLISION"
  | "STATIC_ROUTE_USES_RUNTIME_API"
  | "EDGE_INCOMPATIBLE_API"
  | "ISR_LOCK_TIMEOUT"
  | "RENDER_HYDRATION_MISMATCH"
  | "BUNDLE_BUDGET_EXCEEDED"
  | "ADAPTER_CAPABILITY_MISSING"
  | "MIDDLEWARE_COMPILE_ERROR"
  | "VALIDATION_FAILED"
  | "AUTH_SESSION_INVALID"
  | "I18N_LOCALE_NOT_FOUND";

export type FrameworkLayer =
  | "config"
  | "router"
  | "renderer"
  | "compiler"
  | "server"
  | "platform"
  | "adapter"
  | "cli";

export class FrameworkError extends Error {
  public readonly code: FrameworkErrorCode;
  public readonly layer: FrameworkLayer;
  public readonly routeKey?: string;
  public readonly context: Record<string, unknown>;
  public readonly recoverable: boolean;

  constructor(
    code: FrameworkErrorCode,
    message: string,
    options: {
      layer?: FrameworkLayer;
      routeKey?: string;
      context?: Record<string, unknown>;
      recoverable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.layer = options.layer ?? "config";
    this.routeKey = options.routeKey;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
  }
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface EnvSchema {
  required?: boolean;
  default?: string;
  description?: string;
}

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  localeDetection?: "header" | "cookie" | "path" | boolean;
  messages?: Record<string, () => Promise<Record<string, string>>>;
}

export interface ImageConfig {
  domains?: string[];
  formats?: Array<"webp" | "avif" | "jpeg" | "png">;
  deviceSizes?: number[];
  imageSizes?: number[];
}

export interface ExperimentalConfig {
  [key: string]: boolean | undefined;
}

export interface SourceOGAdapter {
  name: string;
  deploy?(artifacts: unknown): Promise<void>;
  createRequestHandler?(config: SourceOGConfig): unknown;
  checkCapabilities?(): Record<string, boolean>;
}

export interface SourceOGPlugin {
  name: string;
  config?(config: SourceOGConfig): SourceOGConfig | Promise<SourceOGConfig>;
  build?(ctx: unknown): void | Promise<void>;
  request?(ctx: unknown): void | Promise<void>;
  response?(ctx: unknown): void | Promise<void>;
  render?(ctx: unknown): void | Promise<void>;
  error?(ctx: unknown): void | Promise<void>;
}

export interface SourceOGPreset {
  name: string;
  plugins: SourceOGPlugin[];
  config?: Partial<SourceOGConfig>;
}

export interface SourceOGConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string;
  baseUrl?: string;
  trailingSlash?: boolean;
  i18n?: I18nConfig;
  images?: ImageConfig;
  env?: Record<string, EnvSchema>;
  plugins?: SourceOGPlugin[];
  presets?: SourceOGPreset[];
  adapter?: SourceOGAdapter;
  experimental?: ExperimentalConfig;
  budgets?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// defineConfig — identity helper for type inference
// ---------------------------------------------------------------------------

export function defineConfig(config: SourceOGConfig): SourceOGConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Deep merge helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseVal = result[key];
    if (isPlainObject(baseVal) && isPlainObject(value)) {
      result[key] = deepMerge(baseVal, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Shape validation (minimal — checks it's a plain object)
// ---------------------------------------------------------------------------

function validateConfigShape(raw: unknown): SourceOGConfig {
  if (!isPlainObject(raw)) {
    throw new FrameworkError("CONFIG_INVALID", "Configuration must be a plain object.", {
      context: { received: typeof raw },
    });
  }
  // Validate known fields have correct types when present
  const cfg = raw as Record<string, unknown>;
  const stringFields = ["appDir", "outDir", "publicDir", "baseUrl"] as const;
  for (const field of stringFields) {
    if (field in cfg && typeof cfg[field] !== "string") {
      throw new FrameworkError("CONFIG_INVALID", `Config field "${field}" must be a string.`, {
        context: { field, received: typeof cfg[field] },
      });
    }
  }
  if ("trailingSlash" in cfg && typeof cfg.trailingSlash !== "boolean") {
    throw new FrameworkError("CONFIG_INVALID", 'Config field "trailingSlash" must be a boolean.', {
      context: { received: typeof cfg.trailingSlash },
    });
  }
  if ("plugins" in cfg && !Array.isArray(cfg.plugins)) {
    throw new FrameworkError("CONFIG_INVALID", 'Config field "plugins" must be an array.', {
      context: { received: typeof cfg.plugins },
    });
  }
  if ("presets" in cfg && !Array.isArray(cfg.presets)) {
    throw new FrameworkError("CONFIG_INVALID", 'Config field "presets" must be an array.', {
      context: { received: typeof cfg.presets },
    });
  }
  return cfg as SourceOGConfig;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

function defaultConfig(): SourceOGConfig {
  return {
    appDir: "app",
    outDir: ".sourceog",
    publicDir: "public",
    trailingSlash: false,
    plugins: [],
    presets: [],
    env: {},
    experimental: {},
  };
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

export async function loadConfig(cwd: string): Promise<Readonly<SourceOGConfig>> {
  // 1. Import config file or use empty object
  const candidates = [
    "sourceog.config.ts",
    "sourceog.config.js",
    "sourceog.config.mjs",
    "sourceog.config.cjs",
  ].map((fileName) => path.join(cwd, fileName));

  const configFile = candidates.find((candidate) => existsSync(candidate));
  let raw: unknown = {};
  if (configFile) {
    const mod = await import(pathToFileURL(configFile).href);
    raw = mod.default ?? mod;
  }

  // 2. Validate shape
  const validated = validateConfigShape(raw);

  // 3. Merge presets in declaration order, then merge validated config on top
  let merged: SourceOGConfig = defaultConfig();

  for (const preset of validated.presets ?? []) {
    if (preset.config) {
      merged = deepMerge(merged as Record<string, unknown>, preset.config as Record<string, unknown>) as SourceOGConfig;
    }
    merged = {
      ...merged,
      plugins: [...(merged.plugins ?? []), ...preset.plugins],
    };
  }

  // Merge the user config on top (excluding presets to avoid duplication)
  // Plugins from presets are already in merged.plugins; user plugins are appended after
  const { presets: _presets, plugins: userPlugins, ...validatedWithoutPresetsAndPlugins } = validated;
  merged = deepMerge(merged as Record<string, unknown>, validatedWithoutPresetsAndPlugins as Record<string, unknown>) as SourceOGConfig;
  // Append user-level plugins after preset plugins
  merged = {
    ...merged,
    plugins: [...(merged.plugins ?? []), ...(userPlugins ?? [])],
  };

  // 4. Run plugin config hooks
  for (const plugin of merged.plugins ?? []) {
    if (plugin.config) {
      merged = await plugin.config(merged);
    }
  }

  // 5. Validate required env vars
  for (const [key, schema] of Object.entries(merged.env ?? {})) {
    const value = process.env[key];
    if (schema.required && (value === undefined || value === null || value === "")) {
      throw new FrameworkError("ENV_MISSING_REQUIRED", `Required environment variable "${key}" is not set.`, {
        layer: "config",
        context: { key },
        recoverable: false,
      });
    }
  }

  // 6. Return deeply frozen config
  return deepFreeze(merged);
}
