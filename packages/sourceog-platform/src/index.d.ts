import type { SourceOGAdapter } from "./config.js";
export interface SourceOGConfig {
    /** Absolute path to the app directory. Defaults to {cwd}/app */
    appRoot: string;
    /** Relative path to the app directory from cwd. Defaults to "app" */
    appDir: string;
    /** Working directory — root of the project */
    cwd: string;
    /** Output directory. Defaults to {cwd}/.sourceog */
    outputDir: string;
    /** Alias for outputDir — used by server.ts internals */
    distRoot: string;
    /** Static assets directory. Defaults to {cwd}/public */
    publicDir: string;
    /** Environment: "development" | "production" | "test" */
    mode: "development" | "production" | "test";
    /** Port for the dev server */
    port: number;
    /** Hostname for the dev server */
    hostname: string;
    /** File extensions to scan for routes */
    extensions: string[];
    /** Directories to ignore during route scanning */
    ignore: string[];
    /** Whether to enable RSC worker pool */
    rscWorkers: boolean;
    /** Number of RSC workers (0 = auto) */
    rscWorkerCount: number;
    /** Custom env variables exposed to client bundles */
    publicEnv: Record<string, string>;
    /** Raw config object from axiom.config.ts / sourceog.config.ts */
    raw: Record<string, unknown>;
    /** Adapter configuration for deployment target */
    adapter?: SourceOGAdapter;
    /** Experimental feature flags */
    experimental: Record<string, boolean>;
    /** Plugins to run during build */
    plugins?: Array<{
        name: string;
        onBuildStart?: (config: SourceOGConfig) => Promise<void> | void;
        onBuildEnd?: (config: SourceOGConfig) => Promise<void> | void;
        [key: string]: unknown;
    }>;
    /** Automation definitions */
    automations?: unknown[];
    /** Stability level */
    stability?: string;
    /** Manifest version */
    manifestVersion?: string;
    /** i18n configuration */
    i18n?: {
        locales: string[];
        defaultLocale: string;
        localeDetection?: boolean;
    };
    /** Bundle size budgets */
    budgets?: Record<string, number>;
}
/**
 * Resolve the full SourceOG platform config for a given project root.
 * Returns the internal SourceOGConfig shape used by the platform layer.
 * For the full ResolvedSourceOGConfig (with srcDir, distDir, basePath), use resolveConfig from @sourceog/platform/config.
 *
 * @param cwd - Absolute path to the project root. Defaults to process.cwd().
 */
export declare function resolvePlatformConfig(cwd?: string): Promise<SourceOGConfig>;
/**
 * Cast SourceOGConfig to a router-compatible config shape for use with @sourceog/router.
 */
export declare function toRouterConfig(config: SourceOGConfig): {
    appRoot: string;
    cwd: string;
    extensions: string[];
    ignore: string[];
};
export interface OpenGraphImage {
    url: string;
    width?: number;
    height?: number;
    alt?: string;
    type?: string;
}
export interface OpenGraphMetadata {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    images?: OpenGraphImage[];
    locale?: string;
    type?: "website" | "article" | "profile" | "book";
    [key: string]: unknown;
}
export interface TwitterMetadata {
    card?: "summary" | "summary_large_image" | "app" | "player";
    site?: string;
    creator?: string;
    title?: string;
    description?: string;
    images?: string[];
    [key: string]: unknown;
}
export interface ViewportMetadata {
    width?: string | number;
    initialScale?: number;
    maximumScale?: number;
    userScalable?: boolean;
    themeColor?: string;
}
export interface RobotsMetadata {
    index?: boolean;
    follow?: boolean;
    noarchive?: boolean;
    nosnippet?: boolean;
    noimageindex?: boolean;
}
export interface Metadata {
    title?: string;
    titleTemplate?: string;
    description?: string;
    keywords?: string | string[];
    authors?: Array<{
        name: string;
        url?: string;
    }>;
    creator?: string;
    publisher?: string;
    canonical?: string;
    canonicalUrl?: string;
    alternates?: Record<string, string>;
    openGraph?: OpenGraphMetadata;
    twitter?: TwitterMetadata;
    viewport?: ViewportMetadata;
    robots?: RobotsMetadata | string;
    icons?: {
        icon?: string | Array<{
            url: string;
            sizes?: string;
            type?: string;
        }>;
        apple?: string | Array<{
            url: string;
            sizes?: string;
        }>;
        shortcut?: string;
    };
    manifest?: string;
    themeColor?: string;
    colorScheme?: "light" | "dark" | "light dark" | "dark light";
    /** Arbitrary additional meta tags */
    other?: Record<string, string>;
}
/**
 * Deep-merge metadata objects left-to-right.
 * Later values override earlier ones. Arrays are replaced (not concatenated).
 * Undefined values in later objects do NOT override defined earlier values.
 */
export declare function mergeMetadata(...parts: Array<Metadata | undefined | null>): Metadata;
/**
 * Convert a Metadata object to an HTML string of <meta>, <title>, and <link> tags
 * suitable for injection into <head>.
 */
export declare function renderMetadataToHead(metadata: Metadata): string;
export { defineConfig, defineAdapter, defineCompatMode, defineRoutePolicy, defineActionPolicy, defineBudgetProfile, defineCanaryProfile, defineObservabilityProfile, defineDoctorProfile, defineRuntimeProfile, defineWorkerProfile, defineGraphProfile, defineAssetPolicy, defineServingPolicy, defineCacheProfile, defineRenderProfile, defineDeploymentProfile, definePlugin, defineStarter, defineBenchmarkProfile, defineTestProfile, resolveConfig, } from "./config.js";
export type { AdapterFeatureSet, CapabilityReport, AdapterBuildArtifacts, SourceOGSection, SourceOGProfile, SourceOGCompatMode, SourceOGRoutePolicy, SourceOGActionPolicy, SourceOGBudgetProfile, SourceOGCanaryProfile, SourceOGObservabilityProfile, SourceOGDoctorProfile, SourceOGRuntimeProfile, SourceOGWorkerProfile, SourceOGGraphProfile, SourceOGAssetPolicy, SourceOGServingPolicy, SourceOGCacheProfile, SourceOGRenderProfile, SourceOGDeploymentProfile, SourceOGBenchmarkProfile, SourceOGTestProfile, SourceOGStarter, SourceOGAdapter, SourceOGConfig as PlatformSourceOGConfig, ResolvedSourceOGConfig, SourceOGPlugin, } from "./config.js";
export { Image } from "./image.js";
export type { ImageProps } from "./image.js";
export { createJWT, verifyJWT, signSession, verifySession, sanitizeForClient } from "./auth.js";
export type { JWTPayload, SessionPayload, ClientSession } from "./auth.js";
export { defineMiddleware, composeMiddleware } from "./middleware.js";
export type { SourceOGMiddleware, NextMiddleware } from "./middleware.js";
export { RateLimiter, rateLimit } from "./rate-limiter.js";
export type { RateLimitRule, RateLimitResult, RateLimitMiddleware } from "./rate-limiter.js";
export { detectLocale, localizePathname, loadMessages } from "./i18n.js";
export type { I18nConfig, Messages } from "./i18n.js";
export { parseBody, parseQuery, parseHeaders } from "./validation.js";
export type { ReadonlyHeaders } from "./validation.js";
export { defineSecurityPolicy, normalizeSecurityPolicy, applySecurityPolicy } from "./security.js";
export type { SecurityPolicy, ResolvedSecurityPolicy } from "./security.js";
export { defineSchedule, defineAutomation, defineWorkflow, createAutomationManifest, AutomationEngine, type AutomationSchedule, type AutomationContext, type AutomationResult, type SourceOGAutomation, type AutomationManifest, type AutomationManifestEntry, type AutomationEventName, type AutomationEvent, } from "./automation.js";
