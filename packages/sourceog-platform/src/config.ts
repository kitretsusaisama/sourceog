import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SourceOGError, SOURCEOG_ERROR_CODES, type DeploymentManifest } from "@sourceog/runtime";
import type { SecurityPolicy } from "./security.js";
import type { SourceOGAutomation } from "./automation.js";

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

export interface SourceOGAdapter {
  name: string;
  deploy?(manifest: DeploymentManifest, artifacts: AdapterBuildArtifacts, config: SourceOGConfig): Promise<void>;
  createRequestHandler?(manifest: DeploymentManifest): unknown;
  checkCapabilities?(features: AdapterFeatureSet): CapabilityReport;
}

export const sourceOGConfigSchema = z.object({
  appDir: z.string().default("app"),
  srcDir: z.string().default("."),
  distDir: z.string().default(".sourceog"),
  basePath: z.string().default(""),
  experimental: z.record(z.string(), z.boolean()).default({}),
  budgets: z.record(z.string(), z.number()).optional(),
  i18n: z.object({
    locales: z.array(z.string()).default(["en"]),
    defaultLocale: z.string().default("en"),
    localeDetection: z.boolean().default(true)
  }).optional(),
  images: z.object({
    domains: z.array(z.string()).default([]),
    formats: z.array(z.enum(["webp", "avif", "jpeg", "png"])).default(["webp", "avif"])
  }).optional(),
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

export async function resolveConfig(cwd: string): Promise<ResolvedSourceOGConfig> {
  const candidates = [
    "sourceog.config.ts",
    "sourceog.config.js",
    "sourceog.config.mjs",
    "sourceog.config.cjs"
  ].map((fileName) => path.join(cwd, fileName));

  const configFile = candidates.find((candidate) => existsSync(candidate));
  const loadedConfig = configFile
    ? (await import(pathToFileURL(configFile).href)).default
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