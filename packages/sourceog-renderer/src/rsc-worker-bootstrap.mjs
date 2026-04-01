/**
 * sourceog-renderer/src/rsc-worker-bootstrap.mjs  — Alibaba CTO 2027 Standard
 *
 * Self-healing worker bootstrap with embedded inline transpilation fallback.
 * 
 * Fixes:
 *  1. React + react-server-dom-webpack imported ONCE at top level.
 *  2. routeModuleErrorCache has TTL in dev mode.
 *  3. SIGTERM handler drains in-flight render.
 *  4. INLINE TRANSFORM FALLBACK: Uses temp files instead of data: URLs.
 */

import { workerData, parentPort } from "node:worker_threads";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

if (!parentPort) {
  process.stderr.write(
    "[rsc-worker] parentPort is null — must run as worker_threads Worker\n"
  );
  process.exitCode = 1;
  process.exit();
}

globalThis.__SOURCEOG_RSC_WORKER__ = true;

const require = createRequire(import.meta.url);
const USE_INLINE_TRANSFORM = workerData?.useInlineTransform === true;

// ---------------------------------------------------------------------------
// Module-level imports — paid once per worker lifetime
// ---------------------------------------------------------------------------

// React is pre-compiled JS in node_modules, so it always imports directly
const React = await import("react");
const { renderToPipeableStream } = await import(
  "react-server-dom-webpack/server.node"
);

// ---------------------------------------------------------------------------
// Inline Transpiler Fallback (Zero-Config Magic)
// ---------------------------------------------------------------------------

let esbuildTransform = null;
let sucraseTransform = null;
let transformInitialized = false;

const TRANSFORM_TMP_DIR = path.join(process.cwd(), ".sourceog", "transform-cache");
if (!existsSync(TRANSFORM_TMP_DIR)) {
  try { mkdirSync(TRANSFORM_TMP_DIR, { recursive: true }); } catch {}
}

async function ensureTransformers() {
  if (transformInitialized) return;
  transformInitialized = true;

  try {
    const esbuild = await import("esbuild");
    esbuildTransform = (code, filename) => {
      return esbuild.transform(code, {
        loader: filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".jsx") ? "jsx" : "ts",
        jsx: "automatic",
        jsxImportSource: "react",
        target: "es2022",
        format: "esm",
      }).then(r => r.code);
    };
    return;
  } catch {}

  // Priority 2: sucrase (lightweight, no native bindings)
  try {
    const sucrase = await import("sucrase");
    sucraseTransform = (code, filename) => {
      const result = sucrase.transform(code, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: process.env.NODE_ENV === "production",
        filePath: filename,
      });
      return result.code;
    };
    return;
  } catch {}

  if (USE_INLINE_TRANSFORM) {
    process.stderr.write(
      "[SOURCEOG] WARNING: Inline transform enabled, but neither esbuild nor sucrase found. " +
      ".tsx routes will fail to load.\n"
    );
  }
}

/**
 * Unified module loader. If USE_INLINE_TRANSFORM is true, it reads the file,
 * compiles it to a temp file, and imports that.
 */

async function loadRouteModule(specifier) {
  // If we were explicitly told to use inline transform (due to missing tsx), do it.
  if (USE_INLINE_TRANSFORM) {
    return loadWithInlineTransform(specifier);
  }
  try {
    return import(specifier.startsWith("file://") ? specifier : pathToFileURL(specifier).href);
  } catch (error) {
    // If native import fails specifically because of TSX extension or syntax, 
    // AND we have inline capabilities, fallback gracefully.
    const ext = path.extname(specifier);
    const isTsx = ext === ".tsx" || ext === ".jsx";
    
    // If it's a TSX/JSX file, Node native flags (strip-types) fail. Fallback to inline.
    if (isTsx && (String(error).includes("Unknown file extension") || String(error).includes("Unexpected token"))) {
      // Ensure transformers are ready
      await ensureTransformers();
      if (esbuildTransform || sucraseTransform) {
        return loadWithInlineTransform(specifier);
      }
    }
    throw error;
  }
}

async function loadWithInlineTransform(specifier) {
  const fsPath = specifier.startsWith("file://") ? fileURLToPath(specifier) : specifier;
  const ext = path.extname(fsPath);

  // No transform needed for standard JS
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return import(specifier.startsWith("file://") ? specifier : pathToFileURL(fsPath).href);
  }

  // Need transform for TS/TSX/JSX
  if (ext !== ".tsx" && ext !== ".ts" && ext !== ".jsx") {
    return import(specifier.startsWith("file://") ? specifier : pathToFileURL(fsPath).href);
  }

  await ensureTransformers();

  if (!esbuildTransform && !sucraseTransform) {
    throw new Error(
      `[SOURCEOG] Cannot load "${fsPath}". Unknown file extension and no inline transpiler (esbuild/sucrase) available.`
    );
  }

  const source = readFileSync(fsPath, "utf8");
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  const tmpFile = path.join(TRANSFORM_TMP_DIR, `${path.basename(fsPath)}-${hash}.mjs`);

  // Cache the transpiled file so we only transform once per source change
  if (!existsSync(tmpFile)) {
    const transformFn = esbuildTransform || sucraseTransform;
    let code;
    try {
      code = await transformFn(source, fsPath);
    } catch (err) {
      throw new Error(`[SOURCEOG] Inline transform failed for "${fsPath}": ${err.message}`);
    }
    writeFileSync(tmpFile, code, "utf8");
  }

  return import(pathToFileURL(tmpFile).href);
}


// ---------------------------------------------------------------------------
// Cross-platform path helpers
// ---------------------------------------------------------------------------

function isFileUrl(value) {
  return typeof value === "string" && value.startsWith("file://");
}

function toFileUrl(value) {
  if (!value || typeof value !== "string") {
    throw new TypeError(`Expected non-empty path string, received: ${value}`);
  }
  return isFileUrl(value) ? value : pathToFileURL(path.resolve(value)).href;
}

function toFsPath(value) {
  if (!value || typeof value !== "string") {
    throw new TypeError(`Expected non-empty path string, received: ${value}`);
  }
  return isFileUrl(value) ? fileURLToPath(value) : path.resolve(value);
}

// ---------------------------------------------------------------------------
// Manifest loading — once at startup
// ---------------------------------------------------------------------------

function loadManifestFromPath(manifestPath) {
  if (!manifestPath) return {};

  const fsPath = toFsPath(manifestPath);
  if (!existsSync(fsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(fsPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};

    const registry = parsed.registry ?? parsed;
    if (registry && typeof registry === "object") {
      for (const entry of Object.values(registry)) {
        if (!entry || typeof entry !== "object") continue;
        if (entry.filepath && path.isAbsolute(entry.filepath)) {
          entry.filepath = toFileUrl(entry.filepath);
        }
        if (entry.id && path.isAbsolute(entry.id)) {
          entry.id = toFileUrl(entry.id);
        }
        if (Array.isArray(entry.chunks)) {
          entry.chunks = entry.chunks.map((c) =>
            typeof c === "string" && path.isAbsolute(c) ? toFileUrl(c) : c
          );
        }
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

const manifest = loadManifestFromPath(workerData?.manifestPath ?? "");

if (manifest && typeof manifest === "object") {
  const registry = manifest.registry ?? manifest;
  const converted = {};
  for (const [key, value] of Object.entries(registry)) {
    const nk =
      typeof key === "string" && path.isAbsolute(key) ? toFileUrl(key) : key;
    converted[nk] = value;
  }
  globalThis.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = converted;
}

function buildClientManifest(manifestValue) {
  const registry = manifestValue?.registry ?? manifestValue ?? {};
  const clientManifest = {};

  for (const entry of Object.values(registry)) {
    if (!entry?.id || !entry?.name) continue;

    const entryData = {
      id: entry.id,
      chunks: Array.isArray(entry.chunks) ? entry.chunks : [],
      name: entry.name,
      async: entry.async ?? false,
    };

    clientManifest[`${entry.id}#${entry.name}`] = entryData;
    if (!(entry.id in clientManifest)) {
      clientManifest[entry.id] = entryData;
    }
  }

  return clientManifest;
}

const clientManifestForRender = buildClientManifest(manifest);

// ---------------------------------------------------------------------------
// Route module cache — LRU (50 slots) + TTL-based error cache
// ---------------------------------------------------------------------------

const ROUTE_MODULE_CACHE_MAX = 50;
const ERROR_CACHE_TTL_MS =
  process.env.NODE_ENV === "development" ? 5_000 : Infinity;

const routeModuleCache = new Map();
const routeModuleErrorCache = new Map();

function touchLRU(cacheKey, mod) {
  routeModuleCache.delete(cacheKey);
  routeModuleCache.set(cacheKey, mod);
  if (routeModuleCache.size > ROUTE_MODULE_CACHE_MAX) {
    routeModuleCache.delete(routeModuleCache.keys().next().value);
  }
}

function resolveImportSpecifier(spec) {
  if (!spec || typeof spec !== "string") {
    throw new TypeError(`Invalid import specifier: ${spec}`);
  }
  if (
    spec.startsWith("node:") ||
    spec.startsWith("data:") ||
    spec.startsWith("file://")
  ) {
    return spec;
  }
  if (path.isAbsolute(spec)) {
    return pathToFileURL(spec).href;
  }

  try {
    const resolved = require.resolve(spec);
    return pathToFileURL(resolved).href;
  } catch {
    return spec; // Let the inline loader handle it if it's a bare spec
  }
}

async function cachedLoadRouteModule(file) {
  const cacheKey = resolveImportSpecifier(file);

  const cached = routeModuleErrorCache.get(cacheKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) throw cached.error;
    routeModuleErrorCache.delete(cacheKey);
  }

  if (routeModuleCache.has(cacheKey)) {
    const mod = routeModuleCache.get(cacheKey);
    touchLRU(cacheKey, mod);
    return mod;
  }

  try {
    const mod = await loadRouteModule(cacheKey);
    touchLRU(cacheKey, mod);
    return mod;
  } catch (err) {
    routeModuleErrorCache.set(cacheKey, {
      error: err,
      expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Worker message helpers
// ---------------------------------------------------------------------------

function post(type, requestId, routeId, pathname, renderContextKey, extra) {
  if (parentPort) {
    parentPort.postMessage({
      type,
      requestId,
      route: routeId,
      pathname,
      renderContextKey,
      ...extra,
    });
  }
}

// ---------------------------------------------------------------------------
// Render handler — serialised mutex
// ---------------------------------------------------------------------------

let renderMutex = Promise.resolve();

function handleRender(requestId, payload) {
  const task = renderMutex.then(() => _handleRender(requestId, payload));
  renderMutex = task.catch(() => undefined);
  return task;
}

async function _handleRender(requestId, payload) {
  const { route, context, collectChunks = false } = payload ?? {};
  const pathname = route?.pathname ?? "";
  const renderContextKey = context?.renderContextKey ?? "";
  const bufferedChunks = [];

  try {
    if (!route?.file) throw new Error("Route payload is missing route.file");

    const routeModule = await cachedLoadRouteModule(route.file);
    const PageComponent = routeModule.default ?? routeModule.Page;

    if (typeof PageComponent !== "function") {
      throw new Error(
        `Route module does not export a default component: ${route.file}`
      );
    }

    globalThis.__SOURCEOG_RSC_PARENT_MODULE_FILE__ = route.file;

    const element = React.createElement(PageComponent, {
      params: context?.params ?? {},
      searchParams: Object.fromEntries(context?.query ?? []),
    });

    const decoder = new TextDecoder("utf-8", { fatal: false });

    await new Promise((resolve, reject) => {
      const passThrough = new PassThrough();
      let flightStream;

      passThrough.on("data", (chunk) => {
        const str =
          typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        if (!str) return;

        if (collectChunks) bufferedChunks.push(str);

        post("render_chunk", requestId, route.id, pathname, renderContextKey, {
          chunk: str,
        });
      });

      passThrough.on("end", () => {
        const tail = decoder.decode();
        if (tail) {
          if (collectChunks) bufferedChunks.push(tail);
          post("render_chunk", requestId, route.id, pathname, renderContextKey, {
            chunk: tail,
          });
        }
        resolve(undefined);
      });

      passThrough.on("error", (err) => {
        if (typeof flightStream?.abort === "function") {
          try { flightStream.abort(err); } catch {}
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      flightStream = renderToPipeableStream(element, clientManifestForRender, {
        onError(error) {
          const err = error instanceof Error ? error : new Error(String(error));
          passThrough.destroy(err);
          reject(err);
        },
      });

      flightStream.pipe(passThrough);
    });

    post("render_result", requestId, route.id, pathname, renderContextKey, {
      result: {
        format: "react-flight-text",
        chunks: collectChunks ? bufferedChunks : [],
        usedClientRefs: [],
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    post("render_error", requestId, route?.id ?? "", pathname, renderContextKey, {
      error: err.message,
      stack: err.stack ?? "",
    });
  }
}

// ---------------------------------------------------------------------------
// Message loop
// ---------------------------------------------------------------------------

function messageHandler(message) {
  if (message?.type === "render") {
    void handleRender(message.requestId, message.payload);
  }
}

parentPort.on("message", messageHandler);

// Graceful SIGTERM
process.on("SIGTERM", () => {
  parentPort.off("message", messageHandler);
  renderMutex.finally(() => process.exit(0));
});