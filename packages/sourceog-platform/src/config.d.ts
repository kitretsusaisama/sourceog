import { z } from "zod";
import { type DeploymentManifest } from "@sourceog/runtime";
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

export interface SourceOGResolvedConfigShape {
  appDir: string;
  srcDir: string;
  distDir: string;
  basePath: string;
  app?: SourceOGSection;
  routing?: SourceOGSection;
  rendering?: SourceOGSection;
  runtime?: SourceOGSection;
  runtimePolicy?: SourceOGSection;
  artifactPolicy?: SourceOGSection;
  workers?: SourceOGSection;
  workerPolicy?: SourceOGSection;
  streaming?: SourceOGSection;
  streamPolicy?: SourceOGSection;
  experimental: Record<string, boolean>;
  budgets?: Record<string, number>;
  budgetsByRoute?: SourceOGSection;
  cache?: SourceOGSection;
  cachePolicy?: SourceOGSection;
  invalidations?: SourceOGSection;
  graph?: SourceOGSection;
  graphPolicy?: SourceOGSection;
  assets?: SourceOGSection;
  i18n?: {
    locales: string[];
    defaultLocale: string;
    localeDetection: boolean;
  };
  images?: {
    domains: string[];
    formats: Array<"webp" | "avif" | "jpeg" | "png">;
  };
  scripts?: SourceOGSection;
  fonts?: SourceOGSection;
  styling?: SourceOGSection;
  forms?: SourceOGSection;
  env?: {
    required: string[];
  };
  security?: SecurityPolicy;
  auth?: SourceOGSection;
  automation?: SourceOGSection;
  observability?: SourceOGSection;
  doctor?: SourceOGSection;
  doctorPolicy?: SourceOGSection;
  diagnostics?: SourceOGSection;
  deployment?: SourceOGSection;
  profiles?: SourceOGSection;
  regions?: SourceOGSection;
  canary?: SourceOGSection;
  compat?: SourceOGSection;
  testing?: SourceOGSection;
  replayPolicy?: SourceOGSection;
  governance?: SourceOGSection;
  release?: SourceOGSection;
  cost?: SourceOGSection;
  slo?: SourceOGSection;
  scaffolds?: SourceOGSection;
  benchmarks?: SourceOGSection;
  manifestVersion: string;
  stability: "stable" | "experimental" | "internal";
}

export declare const sourceOGConfigSchema: z.ZodType<SourceOGResolvedConfigShape>;

export type SourceOGConfig = Partial<SourceOGResolvedConfigShape> & {
  plugins?: SourceOGPlugin[];
  automations?: SourceOGAutomation[];
  security?: SecurityPolicy;
  adapter?: SourceOGAdapter;
};

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

export declare function defineConfig(config: SourceOGConfig): SourceOGConfig;
export declare function defineAdapter(adapter: SourceOGAdapter): SourceOGAdapter;
export declare function defineCompatMode<T extends SourceOGCompatMode>(mode: T): T;
export declare function defineRoutePolicy<T extends SourceOGRoutePolicy>(policy: T): T;
export declare function defineActionPolicy<T extends SourceOGActionPolicy>(policy: T): T;
export declare function defineBudgetProfile<T extends SourceOGBudgetProfile>(profile: T): T;
export declare function defineCanaryProfile<T extends SourceOGCanaryProfile>(profile: T): T;
export declare function defineObservabilityProfile<T extends SourceOGObservabilityProfile>(profile: T): T;
export declare function defineDoctorProfile<T extends SourceOGDoctorProfile>(profile: T): T;
export declare function defineRuntimeProfile<T extends SourceOGRuntimeProfile>(profile: T): T;
export declare function defineWorkerProfile<T extends SourceOGWorkerProfile>(profile: T): T;
export declare function defineGraphProfile<T extends SourceOGGraphProfile>(profile: T): T;
export declare function defineAssetPolicy<T extends SourceOGAssetPolicy>(policy: T): T;
export declare function defineServingPolicy<T extends SourceOGServingPolicy>(policy: T): T;
export declare function defineCacheProfile<T extends SourceOGCacheProfile>(profile: T): T;
export declare function defineRenderProfile<T extends SourceOGRenderProfile>(profile: T): T;
export declare function defineDeploymentProfile<T extends SourceOGDeploymentProfile>(profile: T): T;
export declare function definePlugin<T extends SourceOGPlugin>(plugin: T): T;
export declare function defineStarter<T extends SourceOGStarter>(starter: T): T;
export declare function defineBenchmarkProfile<T extends SourceOGBenchmarkProfile>(profile: T): T;
export declare function defineTestProfile<T extends SourceOGTestProfile>(profile: T): T;
export declare function resolveConfig(cwd: string): Promise<ResolvedSourceOGConfig>;
