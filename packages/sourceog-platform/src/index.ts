// =============================================================================
// @sourceog/platform
// Configuration resolution, metadata types, and HTML head rendering.
// Referenced by: render.tsx, rsc-worker-pool.test.ts
// =============================================================================

import path from "node:path";
import { existsSync } from "node:fs";
import type { SourceOGAdapter } from "./config.js";

// ---------------------------------------------------------------------------
// SourceOG Platform Config
// ---------------------------------------------------------------------------

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
  plugins?: Array<{ name: string; onBuildStart?: (config: SourceOGConfig) => Promise<void> | void; onBuildEnd?: (config: SourceOGConfig) => Promise<void> | void; [key: string]: unknown }>;
  /** Automation definitions */
  automations?: unknown[];
  /** Stability level */
  stability?: string;
  /** Manifest version */
  manifestVersion?: string;
  /** i18n configuration */
  i18n?: { locales: string[]; defaultLocale: string; localeDetection?: boolean };
  /** Bundle size budgets */
  budgets?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Config file discovery and loading
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = [
  "sourceog.config.ts",
  "sourceog.config.js",
  "sourceog.config.mjs",
  "axiom.config.ts",
  "axiom.config.js",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
];

async function loadRawConfig(cwd: string): Promise<Record<string, unknown>> {
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) continue;

    try {
      // Dynamic import handles .js/.mjs; tsx handles .ts
      const mod = await import(filePath) as { default?: Record<string, unknown> };
      return mod.default ?? {};
    } catch {
      // File exists but failed to load — treat as empty config
      return {};
    }
  }

  return {};
}

function resolveEnvMode(): SourceOGConfig["mode"] {
  const env = process.env.NODE_ENV;
  if (env === "production") return "production";
  if (env === "test") return "test";
  return "development";
}

/**
 * Resolve the full SourceOG platform config for a given project root.
 * Returns the internal SourceOGConfig shape used by the platform layer.
 * For the full ResolvedSourceOGConfig (with srcDir, distDir, basePath), use resolveConfig from @sourceog/platform/config.
 *
 * @param cwd - Absolute path to the project root. Defaults to process.cwd().
 */
export async function resolvePlatformConfig(cwd: string = process.cwd()): Promise<SourceOGConfig> {
  const raw = await loadRawConfig(cwd);

  const appRoot = typeof raw.appRoot === "string"
    ? path.resolve(cwd, raw.appRoot)
    : path.join(cwd, "app");

  const outputDir = typeof raw.outputDir === "string"
    ? path.resolve(cwd, raw.outputDir)
    : path.join(cwd, ".sourceog");

  const publicDir = typeof raw.publicDir === "string"
    ? path.resolve(cwd, raw.publicDir)
    : path.join(cwd, "public");

  const port =
    typeof raw.port === "number"
      ? raw.port
      : parseInt(process.env.PORT ?? "3000", 10) || 3000;

  const rscWorkerCount =
    typeof raw.rscWorkerCount === "number"
      ? raw.rscWorkerCount
      : parseInt(process.env.SOURCEOG_RSC_WORKERS ?? "0", 10) || 0;

  return {
    appRoot,
    appDir: typeof raw.appDir === 'string' ? raw.appDir : 'app',
    cwd,
    outputDir,
    distRoot: outputDir,
    publicDir,
    mode: resolveEnvMode(),
    port,
    hostname: typeof raw.hostname === "string" ? raw.hostname : "0.0.0.0",
    extensions: Array.isArray(raw.extensions)
      ? (raw.extensions as string[])
      : ["tsx", "ts", "jsx", "js"],
    ignore: Array.isArray(raw.ignore)
      ? (raw.ignore as string[])
      : [],
    rscWorkers: raw.rscWorkers !== false,
    rscWorkerCount,
    publicEnv:
      typeof raw.publicEnv === "object" && raw.publicEnv !== null
        ? (raw.publicEnv as Record<string, string>)
        : {},
    raw,
    adapter: raw.adapter as SourceOGAdapter | undefined,
    experimental: typeof raw.experimental === "object" && raw.experimental !== null
      ? (raw.experimental as Record<string, boolean>)
      : {},
    i18n: typeof raw.i18n === "object" && raw.i18n !== null
      ? (raw.i18n as { locales: string[]; defaultLocale: string; localeDetection?: boolean })
      : undefined,
    plugins: Array.isArray(raw.plugins) ? (raw.plugins as SourceOGConfig["plugins"]) : undefined,
    automations: Array.isArray(raw.automations) ? raw.automations : undefined,
    stability: typeof raw.stability === "string" ? raw.stability : undefined,
    manifestVersion: typeof raw.manifestVersion === "string" ? raw.manifestVersion : undefined,
    budgets: typeof raw.budgets === "object" && raw.budgets !== null
      ? (raw.budgets as Record<string, number>)
      : undefined,
  };
}

/**
 * Cast SourceOGConfig to a router-compatible config shape for use with @sourceog/router.
 */
export function toRouterConfig(config: SourceOGConfig): { appRoot: string; cwd: string; extensions: string[]; ignore: string[] } {
  return {
    appRoot: config.appRoot,
    cwd: config.cwd,
    extensions: config.extensions,
    ignore: config.ignore,
  };
}

// ---------------------------------------------------------------------------
// Metadata types
// ---------------------------------------------------------------------------

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
  authors?: Array<{ name: string; url?: string }>;
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
    icon?: string | Array<{ url: string; sizes?: string; type?: string }>;
    apple?: string | Array<{ url: string; sizes?: string }>;
    shortcut?: string;
  };
  manifest?: string;
  themeColor?: string;
  colorScheme?: "light" | "dark" | "light dark" | "dark light";
  /** Arbitrary additional meta tags */
  other?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// mergeMetadata
// ---------------------------------------------------------------------------

/**
 * Deep-merge metadata objects left-to-right.
 * Later values override earlier ones. Arrays are replaced (not concatenated).
 * Undefined values in later objects do NOT override defined earlier values.
 */
export function mergeMetadata(...parts: Array<Metadata | undefined | null>): Metadata {
  const result: Metadata = {};

  for (const part of parts) {
    if (!part) continue;

    // Scalar fields
    if (part.title !== undefined) result.title = part.title;
    if (part.titleTemplate !== undefined) result.titleTemplate = part.titleTemplate;
    if (part.description !== undefined) result.description = part.description;
    if (part.keywords !== undefined) result.keywords = part.keywords;
    if (part.authors !== undefined) result.authors = part.authors;
    if (part.creator !== undefined) result.creator = part.creator;
    if (part.publisher !== undefined) result.publisher = part.publisher;
    if (part.canonical !== undefined) result.canonical = part.canonical;
    if (part.canonicalUrl !== undefined) result.canonicalUrl = part.canonicalUrl;
    if (part.manifest !== undefined) result.manifest = part.manifest;
    if (part.themeColor !== undefined) result.themeColor = part.themeColor;
    if (part.colorScheme !== undefined) result.colorScheme = part.colorScheme;
    if (part.robots !== undefined) result.robots = part.robots;

    // Object fields — shallow merge
    if (part.openGraph !== undefined) {
      result.openGraph = { ...result.openGraph, ...part.openGraph };
    }
    if (part.twitter !== undefined) {
      result.twitter = { ...result.twitter, ...part.twitter };
    }
    if (part.viewport !== undefined) {
      result.viewport = { ...result.viewport, ...part.viewport };
    }
    if (part.icons !== undefined) {
      result.icons = { ...result.icons, ...part.icons };
    }
    if (part.alternates !== undefined) {
      result.alternates = { ...result.alternates, ...part.alternates };
    }
    if (part.other !== undefined) {
      result.other = { ...result.other, ...part.other };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// renderMetadataToHead
// ---------------------------------------------------------------------------

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll(">", "&gt;");
}

function meta(name: string, content: string): string {
  return `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}" />`;
}

function ogMeta(property: string, content: string): string {
  return `<meta property="${escapeAttr(property)}" content="${escapeAttr(content)}" />`;
}

function link(rel: string, href: string, extras?: string): string {
  return `<link rel="${escapeAttr(rel)}" href="${escapeAttr(href)}"${extras ? ` ${extras}` : ""} />`;
}

/**
 * Convert a Metadata object to an HTML string of <meta>, <title>, and <link> tags
 * suitable for injection into <head>.
 */
export function renderMetadataToHead(metadata: Metadata): string {
  if (!metadata) return "";

  const parts: string[] = [];

  // Title
  if (metadata.title) {
    const rendered =
      metadata.titleTemplate
        ? metadata.titleTemplate.replace("%s", metadata.title)
        : metadata.title;
    parts.push(`<title>${rendered.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>`);
  }

  // Basic meta
  if (metadata.description) {
    parts.push(meta("description", metadata.description));
  }

  if (metadata.keywords) {
    const kw = Array.isArray(metadata.keywords)
      ? metadata.keywords.join(", ")
      : metadata.keywords;
    parts.push(meta("keywords", kw));
  }

  if (metadata.creator) parts.push(meta("author", metadata.creator));
  if (metadata.publisher) parts.push(meta("publisher", metadata.publisher));

  // Robots
  if (metadata.robots) {
    if (typeof metadata.robots === "string") {
      parts.push(meta("robots", metadata.robots));
    } else {
      const directives: string[] = [];
      if (metadata.robots.index === false) directives.push("noindex");
      else directives.push("index");
      if (metadata.robots.follow === false) directives.push("nofollow");
      else directives.push("follow");
      if (metadata.robots.noarchive) directives.push("noarchive");
      if (metadata.robots.nosnippet) directives.push("nosnippet");
      if (metadata.robots.noimageindex) directives.push("noimageindex");
      if (directives.length > 0) parts.push(meta("robots", directives.join(", ")));
    }
  }

  // Canonical
  if (metadata.canonical) {
    parts.push(link("canonical", metadata.canonical));
  }

  // Alternates
  if (metadata.alternates) {
    for (const [hreflang, href] of Object.entries(metadata.alternates)) {
      parts.push(link("alternate", href, `hreflang="${escapeAttr(hreflang)}"`));
    }
  }

  // OpenGraph
  if (metadata.openGraph) {
    const og = metadata.openGraph;
    if (og.title) parts.push(ogMeta("og:title", og.title));
    if (og.description) parts.push(ogMeta("og:description", og.description));
    if (og.url) parts.push(ogMeta("og:url", og.url));
    if (og.siteName) parts.push(ogMeta("og:site_name", og.siteName));
    if (og.type) parts.push(ogMeta("og:type", og.type));
    if (og.locale) parts.push(ogMeta("og:locale", og.locale));
    for (const image of og.images ?? []) {
      parts.push(ogMeta("og:image", image.url));
      if (image.width) parts.push(ogMeta("og:image:width", String(image.width)));
      if (image.height) parts.push(ogMeta("og:image:height", String(image.height)));
      if (image.alt) parts.push(ogMeta("og:image:alt", image.alt));
      if (image.type) parts.push(ogMeta("og:image:type", image.type));
    }
  }

  // Twitter
  if (metadata.twitter) {
    const tw = metadata.twitter;
    if (tw.card) parts.push(meta("twitter:card", tw.card));
    if (tw.site) parts.push(meta("twitter:site", tw.site));
    if (tw.creator) parts.push(meta("twitter:creator", tw.creator));
    if (tw.title) parts.push(meta("twitter:title", tw.title));
    if (tw.description) parts.push(meta("twitter:description", tw.description));
    for (const image of tw.images ?? []) {
      parts.push(meta("twitter:image", image));
    }
  }

  // Viewport
  if (metadata.viewport) {
    const vp = metadata.viewport;
    const content: string[] = [];
    if (vp.width !== undefined) content.push(`width=${vp.width}`);
    if (vp.initialScale !== undefined) content.push(`initial-scale=${vp.initialScale}`);
    if (vp.maximumScale !== undefined) content.push(`maximum-scale=${vp.maximumScale}`);
    if (vp.userScalable !== undefined) {
      content.push(`user-scalable=${vp.userScalable ? "yes" : "no"}`);
    }
    if (content.length > 0) parts.push(meta("viewport", content.join(", ")));

    if (vp.themeColor) {
      parts.push(meta("theme-color", vp.themeColor));
    }
  } else {
    // Default viewport
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  }

  // Theme color (top-level)
  if (metadata.themeColor && !metadata.viewport?.themeColor) {
    parts.push(meta("theme-color", metadata.themeColor));
  }

  // Color scheme
  if (metadata.colorScheme) {
    parts.push(meta("color-scheme", metadata.colorScheme));
  }

  // Icons
  if (metadata.icons) {
    const icons = metadata.icons;
    if (typeof icons.shortcut === "string") {
      parts.push(link("shortcut icon", icons.shortcut));
    }
    if (icons.icon) {
      if (typeof icons.icon === "string") {
        parts.push(link("icon", icons.icon));
      } else {
        for (const ico of icons.icon) {
          const extras = [
            ico.sizes ? `sizes="${escapeAttr(ico.sizes)}"` : "",
            ico.type ? `type="${escapeAttr(ico.type)}"` : "",
          ]
            .filter(Boolean)
            .join(" ");
          parts.push(link("icon", ico.url, extras || undefined));
        }
      }
    }
    if (icons.apple) {
      if (typeof icons.apple === "string") {
        parts.push(link("apple-touch-icon", icons.apple));
      } else {
        for (const ico of icons.apple) {
          parts.push(
            link("apple-touch-icon", ico.url, ico.sizes ? `sizes="${escapeAttr(ico.sizes)}"` : undefined)
          );
        }
      }
    }
  }

  // Web manifest
  if (metadata.manifest) {
    parts.push(link("manifest", metadata.manifest));
  }

  // Arbitrary other tags
  if (metadata.other) {
    for (const [name, content] of Object.entries(metadata.other)) {
      parts.push(meta(name, content));
    }
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Adapter types and config helpers (from config.ts)
// ---------------------------------------------------------------------------
export {
  defineConfig,
  defineAdapter,
  defineCompatMode,
  defineRoutePolicy,
  defineActionPolicy,
  defineBudgetProfile,
  defineCanaryProfile,
  defineObservabilityProfile,
  defineDoctorProfile,
  defineRuntimeProfile,
  defineWorkerProfile,
  defineGraphProfile,
  defineAssetPolicy,
  defineServingPolicy,
  defineCacheProfile,
  defineRenderProfile,
  defineDeploymentProfile,
  definePlugin,
  defineStarter,
  defineBenchmarkProfile,
  defineTestProfile,
  resolveConfig,
} from "./config.js";
export type {
  AdapterFeatureSet,
  CapabilityReport,
  AdapterBuildArtifacts,
  SourceOGSection,
  SourceOGProfile,
  SourceOGCompatMode,
  SourceOGRoutePolicy,
  SourceOGActionPolicy,
  SourceOGBudgetProfile,
  SourceOGCanaryProfile,
  SourceOGObservabilityProfile,
  SourceOGDoctorProfile,
  SourceOGRuntimeProfile,
  SourceOGWorkerProfile,
  SourceOGGraphProfile,
  SourceOGAssetPolicy,
  SourceOGServingPolicy,
  SourceOGCacheProfile,
  SourceOGRenderProfile,
  SourceOGDeploymentProfile,
  SourceOGBenchmarkProfile,
  SourceOGTestProfile,
  SourceOGStarter,
  SourceOGAdapter,
  SourceOGConfig as PlatformSourceOGConfig,
  ResolvedSourceOGConfig,
  SourceOGPlugin,
} from "./config.js";

// ---------------------------------------------------------------------------
// Image component (from image.tsx)
// ---------------------------------------------------------------------------
export { Image } from "./image.js";
export type { ImageProps } from "./image.js";

// ---------------------------------------------------------------------------
// Auth — JWT helpers
// ---------------------------------------------------------------------------
export { createJWT, verifyJWT, signSession, verifySession, sanitizeForClient } from "./auth.js";
export type { JWTPayload, SessionPayload, ClientSession } from "./auth.js";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export { defineMiddleware, composeMiddleware } from "./middleware.js";
export type { SourceOGMiddleware, NextMiddleware } from "./middleware.js";

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------
export { RateLimiter, rateLimit } from "./rate-limiter.js";
export type { RateLimitRule, RateLimitResult, RateLimitMiddleware } from "./rate-limiter.js";

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
export { detectLocale, localizePathname, loadMessages } from "./i18n.js";
export type { I18nConfig, Messages } from "./i18n.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
export { parseBody, parseQuery, parseHeaders } from "./validation.js";
export type { ReadonlyHeaders } from "./validation.js";

// ---------------------------------------------------------------------------
// Security policy
// ---------------------------------------------------------------------------
export { defineSecurityPolicy, normalizeSecurityPolicy, applySecurityPolicy } from "./security.js";
export type { SecurityPolicy, ResolvedSecurityPolicy } from "./security.js";

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------
export {
  defineSchedule,
  defineAutomation,
  defineWorkflow,
  createAutomationManifest,
  AutomationEngine,
  type AutomationSchedule,
  type AutomationContext,
  type AutomationResult,
  type SourceOGAutomation,
  type AutomationManifest,
  type AutomationManifestEntry,
  type AutomationEventName,
  type AutomationEvent,
} from "./automation.js";
