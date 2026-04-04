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
export type FrameworkErrorCode = "CONFIG_INVALID" | "ENV_MISSING_REQUIRED" | "ROUTE_COLLISION" | "STATIC_ROUTE_USES_RUNTIME_API" | "EDGE_INCOMPATIBLE_API" | "ISR_LOCK_TIMEOUT" | "RENDER_HYDRATION_MISMATCH" | "BUNDLE_BUDGET_EXCEEDED" | "ADAPTER_CAPABILITY_MISSING" | "MIDDLEWARE_COMPILE_ERROR" | "VALIDATION_FAILED" | "AUTH_SESSION_INVALID" | "I18N_LOCALE_NOT_FOUND";
export type FrameworkLayer = "config" | "router" | "renderer" | "compiler" | "server" | "platform" | "adapter" | "cli";
export declare class FrameworkError extends Error {
    readonly code: FrameworkErrorCode;
    readonly layer: FrameworkLayer;
    readonly routeKey?: string;
    readonly context: Record<string, unknown>;
    readonly recoverable: boolean;
    constructor(code: FrameworkErrorCode, message: string, options?: {
        layer?: FrameworkLayer;
        routeKey?: string;
        context?: Record<string, unknown>;
        recoverable?: boolean;
    });
}
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
export declare function defineConfig(config: SourceOGConfig): SourceOGConfig;
export declare function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T;
export declare function deepFreeze<T>(obj: T): T;
export declare function loadConfig(cwd: string): Promise<Readonly<SourceOGConfig>>;
