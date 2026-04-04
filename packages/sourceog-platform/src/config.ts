import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { SourceOGError, SOURCEOG_ERROR_CODES, type DeploymentManifest } from "@sourceog/runtime";
import type { SecurityPolicy } from "./security.js";
import type { SourceOGAutomation } from "./automation.js";
import { loadRuntimeModule } from "./module-loader.js";

export interface AdapterFeatureSet {
  features: string[];
}

export interface CapabilityReport {
  supported: string[];
  unsupported: string[];
  warnings: string[];
}

export interface AdapterBuildArtifacts {
  buildId: string;
  distRoot?: string;
  manifestPaths?: Record<string, string>;
  [key: string]: unknown;
}

export type SourceOGSection = Record<string, unknown>;
export type SourceOGProfile = Record<string, unknown>;
export type SourceOGCompatMode = Record<string, unknown>;
export type SourceOGRoutePolicy = Record<string, unknown>;
export type SourceOGActionPolicy = Record<string, unknown>;
export type SourceOGBudgetProfile = Record<string, unknown>;
export type SourceOGCanaryProfile = Record<string, unknown>;
export type SourceOGObservabilityProfile = Record<string, unknown>;
export type SourceOGDoctorProfile = Record<string, unknown>;
export type SourceOGRuntimeProfile = Record<string, unknown>;
export type SourceOGWorkerProfile = Record<string, unknown>;
export type SourceOGGraphProfile = Record<string, unknown>;
export type SourceOGAssetPolicy = Record<string, unknown>;
export type SourceOGServingPolicy = Record<string, unknown>;
export type SourceOGCacheProfile = Record<string, unknown>;
export type SourceOGRenderProfile = Record<string, unknown>;
export type SourceOGDeploymentProfile = Record<string, unknown>;
export type SourceOGBenchmarkProfile = Record<string, unknown>;
export type SourceOGTestProfile = Record<string, unknown>;
export type SourceOGStarter = Record<string, unknown>;

export interface SourceOGAdapter {
  name: string;
  deploy?(manifest: DeploymentManifest, artifacts: AdapterBuildArtifacts, config: SourceOGConfig): Promise<void>;
  createRequestHandler?(manifest: DeploymentManifest): unknown;
  checkCapabilities?(features: AdapterFeatureSet): CapabilityReport;
}

const sectionSchema = z.record(z.string(), z.unknown());

export const sourceOGConfigSchema = z.object({
  appDir: z.string().default("app"),
  srcDir: z.string().default("."),
  distDir: z.string().default(".sourceog"),
  basePath: z.string().default(""),
  app: sectionSchema.optional(),
  routing: sectionSchema.optional(),
  rendering: sectionSchema.optional(),
  runtime: sectionSchema.optional(),
  runtimePolicy: sectionSchema.optional(),
  artifactPolicy: sectionSchema.optional(),
  workers: sectionSchema.optional(),
  workerPolicy: sectionSchema.optional(),
  streaming: sectionSchema.optional(),
  streamPolicy: sectionSchema.optional(),
  experimental: z.record(z.string(), z.boolean()).default({}),
  budgets: z.record(z.string(), z.number()).optional(),
  budgetsByRoute: sectionSchema.optional(),
  cache: sectionSchema.optional(),
  cachePolicy: sectionSchema.optional(),
  invalidations: sectionSchema.optional(),
  graph: sectionSchema.optional(),
  graphPolicy: sectionSchema.optional(),
  assets: sectionSchema.optional(),
  i18n: z.object({
    locales: z.array(z.string()).default(["en"]),
    defaultLocale: z.string().default("en"),
    localeDetection: z.boolean().default(true)
  }).optional(),
  images: z.object({
    domains: z.array(z.string()).default([]),
    formats: z.array(z.enum(["webp", "avif", "jpeg", "png"])).default(["webp", "avif"])
  }).optional(),
  scripts: sectionSchema.optional(),
  fonts: sectionSchema.optional(),
  styling: sectionSchema.optional(),
  forms: sectionSchema.optional(),
  env: z.object({
    required: z.array(z.string()).default([])
  }).optional(),
  security: z.object({
    contentSecurityPolicy: z.string().optional(),
    frameOptions: z.enum(["DENY", "SAMEORIGIN"]).optional(),
    referrerPolicy: z.string().optional(),
    xContentTypeOptions: z.literal("nosniff").optional(),
    strictTransportSecurity: z.string().optional(),
    permissionsPolicy: z.string().optional(),
    crossOriginOpenerPolicy: z.enum(["same-origin", "unsafe-none"]).optional(),
    extraHeaders: z.record(z.string(), z.string()).optional()
  }).optional(),
  auth: sectionSchema.optional(),
  automation: sectionSchema.optional(),
  observability: sectionSchema.optional(),
  doctor: sectionSchema.optional(),
  doctorPolicy: sectionSchema.optional(),
  diagnostics: sectionSchema.optional(),
  deployment: sectionSchema.optional(),
  profiles: sectionSchema.optional(),
  regions: sectionSchema.optional(),
  canary: sectionSchema.optional(),
  compat: sectionSchema.optional(),
  testing: sectionSchema.optional(),
  replayPolicy: sectionSchema.optional(),
  governance: sectionSchema.optional(),
  release: sectionSchema.optional(),
  cost: sectionSchema.optional(),
  slo: sectionSchema.optional(),
  scaffolds: sectionSchema.optional(),
  benchmarks: sectionSchema.optional(),
  manifestVersion: z.string().default("2027.1"),
  stability: z.enum(["stable", "experimental", "internal"]).default("stable")
});

export type SourceOGResolvedConfigShape = z.infer<typeof sourceOGConfigSchema>;

export type SourceOGConfig = Partial<SourceOGResolvedConfigShape> & {
  plugins?: SourceOGPlugin[];
  automations?: SourceOGAutomation[];
  security?: SecurityPolicy;
  adapter?: SourceOGAdapter;
};

export interface SourceOGPlugin {
  name: string;
  onConfigResolved?(config: ResolvedSourceOGConfig): Promise<void> | void;
  onBuildStart?(config: ResolvedSourceOGConfig): Promise<void> | void;
  onBuildEnd?(config: ResolvedSourceOGConfig): Promise<void> | void;
  onRequest?(input: { pathname: string; method: string }): Promise<void> | void;
  onResponse?(input: { pathname: string; status: number }): Promise<void> | void;
}

export interface RouteMatcher {
  pattern: string;
}

export interface ResolvedSourceOGConfig extends SourceOGConfig {
  appDir: string;
  srcDir: string;
  distDir: string;
  basePath: string;
  experimental: Record<string, boolean>;
  manifestVersion: string;
  stability: "stable" | "experimental" | "internal";
  cwd: string;
  appRoot: string;
  distRoot: string;
}

export function defineConfig(config: SourceOGConfig): SourceOGConfig {
  return config;
}

export function defineAdapter(adapter: SourceOGAdapter): SourceOGAdapter {
  return adapter;
}

export function defineCompatMode<T extends SourceOGCompatMode>(mode: T): T {
  return mode;
}

export function defineRoutePolicy<T extends SourceOGRoutePolicy>(policy: T): T {
  return policy;
}

export function defineActionPolicy<T extends SourceOGActionPolicy>(policy: T): T {
  return policy;
}

export function defineBudgetProfile<T extends SourceOGBudgetProfile>(profile: T): T {
  return profile;
}

export function defineCanaryProfile<T extends SourceOGCanaryProfile>(profile: T): T {
  return profile;
}

export function defineObservabilityProfile<T extends SourceOGObservabilityProfile>(profile: T): T {
  return profile;
}

export function defineDoctorProfile<T extends SourceOGDoctorProfile>(profile: T): T {
  return profile;
}

export function defineRuntimeProfile<T extends SourceOGRuntimeProfile>(profile: T): T {
  return profile;
}

export function defineWorkerProfile<T extends SourceOGWorkerProfile>(profile: T): T {
  return profile;
}

export function defineGraphProfile<T extends SourceOGGraphProfile>(profile: T): T {
  return profile;
}

export function defineAssetPolicy<T extends SourceOGAssetPolicy>(policy: T): T {
  return policy;
}

export function defineServingPolicy<T extends SourceOGServingPolicy>(policy: T): T {
  return policy;
}

export function defineCacheProfile<T extends SourceOGCacheProfile>(profile: T): T {
  return profile;
}

export function defineRenderProfile<T extends SourceOGRenderProfile>(profile: T): T {
  return profile;
}

export function defineDeploymentProfile<T extends SourceOGDeploymentProfile>(profile: T): T {
  return profile;
}

export function definePlugin<T extends SourceOGPlugin>(plugin: T): T {
  return plugin;
}

export function defineStarter<T extends SourceOGStarter>(starter: T): T {
  return starter;
}

export function defineBenchmarkProfile<T extends SourceOGBenchmarkProfile>(profile: T): T {
  return profile;
}

export function defineTestProfile<T extends SourceOGTestProfile>(profile: T): T {
  return profile;
}

/**
 * Loads a config file, transpiling TypeScript files via esbuild if needed.
 */
async function loadConfigFile(configFile: string): Promise<Record<string, unknown>> {
  try {
    const mod = await loadRuntimeModule<Record<string, unknown> & { default?: Record<string, unknown> }>(configFile, {
      cacheRoot: path.join(path.dirname(configFile), ".sourceog", "runtime-cache", "config"),
      projectRoot: path.dirname(configFile),
      namespace: "config",
    });
    return mod.default ?? {};
  } catch {
    // Fall back to empty config if transpilation fails
    return {};
  }
}

export async function resolveConfig(cwd: string): Promise<ResolvedSourceOGConfig> {
  const candidates = [
    "sourceog.config.ts",
    "sourceog.config.js",
    "sourceog.config.mjs",
    "sourceog.config.cjs"
  ].map((fileName) => path.join(cwd, fileName));

  const configFile = candidates.find((candidate) => existsSync(candidate));
  const loadedConfig = configFile
    ? await loadConfigFile(configFile)
    : {};

  const parsed = sourceOGConfigSchema.safeParse(loadedConfig ?? {});
  if (!parsed.success) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.CONFIG_INVALID,
      "Invalid SourceOG configuration.",
      { issues: parsed.error.flatten() }
    );
  }

  const {
    srcDir: rawSrcDir,
    distDir: rawDistDir,
    appDir: rawAppDir,
    basePath: rawBasePath,
    env,
    ...rest
  } = parsed.data;

  const srcDir = rawSrcDir ?? "src";
  const distDir = rawDistDir ?? "dist";
  const appDir = rawAppDir ?? "app";
  const basePath = rawBasePath ?? "/";

  const resolved = {
    ...rest,
    env,
    srcDir,
    distDir,
    appDir,
    basePath,
    plugins: Array.isArray(loadedConfig?.plugins) ? loadedConfig.plugins as SourceOGPlugin[] : [],
    automations: Array.isArray(loadedConfig?.automations)
      ? loadedConfig.automations as SourceOGAutomation[]
      : [],
    security: loadedConfig?.security as SecurityPolicy | undefined,
    adapter: loadedConfig?.adapter as SourceOGAdapter | undefined,
    cwd,
    appRoot: path.join(cwd, srcDir, appDir),
    distRoot: path.join(cwd, distDir)
  } satisfies ResolvedSourceOGConfig;

  for (const key of resolved.env?.required ?? []) {
    if (!process.env[key]) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.CONFIG_INVALID,
        `Missing required environment variable "${key}".`
      );
    }
  }

  for (const plugin of resolved.plugins) {
    await plugin.onConfigResolved?.(resolved);
  }

  return resolved;
}
