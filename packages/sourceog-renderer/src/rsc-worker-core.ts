/**
 * sourceog-renderer/src/rsc-worker-core.ts  — Alibaba CTO 2027 Standard
 *
 * The isolated rendering engine. Does NOT touch worker_threads.
 * 
 * Fixes vs original:
 *  1. react + react-server-dom-webpack imported ONCE at module load.
 *  2. UTAL: Zero-Config inline transform fallback for .tsx route modules.
 *  3. stream.abort() is called on PassThrough error AND on timeout.
 *  4. TextDecoder is reused, not recreated per chunk.
 *  5. Timeout clears BOTH the settled guard and the stream — no ghost timers.
 *  6. onError path calls done() before reject() — prevents double-settle.
 */

import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs"; 
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import {
  toError,
  toSearchParamsObject,
  type ClientManifestEntry,
} from "./rsc-worker-utils.js";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto"; 

export type { ClientManifestEntry, ClientManifestRecord } from "./rsc-worker-utils.js";
export {
  loadManifestFromPath,
  normalizeClientManifest,
  toError,
  toSearchParamsObject,
} from "./rsc-worker-utils.js";

type QueryEntry = [string, string];

const TRANSFORM_TEMP_DIR = mkdtempSync(path.join(tmpdir(), "sourceog-worker-transform-"));

export type WorkerRenderRequest = {
  route: {
    id: string;
    file: string;
    pathname?: string;
  };
  context: {
    params?: Record<string, string>;
    query?: QueryEntry[];
    renderContextKey: string;
    renderContext?: string;
  };
  collectChunks?: boolean;
  debug?: boolean;
  timeoutMs?: number;
};

export type WorkerRenderResponse = {
  format: "react-flight-text";
  chunks: string[];
  usedClientRefs: string[];
};

// ---------------------------------------------------------------------------
// Module-level require — created once, not per-request
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

const {
  renderToPipeableStream,
}: {
  renderToPipeableStream: (
    model: unknown,
    webpackMap: unknown,
    options?: { onError?: (error: unknown) => void }
  ) => {
    pipe: (destination: NodeJS.WritableStream) => NodeJS.WritableStream;
    abort?: (reason?: unknown) => void;
  };
} = require("react-server-dom-webpack/server.node");

let _React: typeof import("react") | null = null;

async function getReact(): Promise<typeof import("react")> {
  if (_React) return _React;
  _React = await import("react");
  return _React;
}

// ---------------------------------------------------------------------------
// UTAL: Zero-Config Inline Transform Fallback (Core Layer)
// ---------------------------------------------------------------------------

let _esbuildTransform: ((code: string, filepath: string) => Promise<string>) | null = null;
let _sucraseTransform: ((code: string, filepath: string) => Promise<string>) | null = null;

async function ensureInlineTransformers() {
  if (_esbuildTransform || _sucraseTransform) return;

  try {
    const esbuild = await import("esbuild");
    _esbuildTransform = (code, filepath) =>
      esbuild.transform(code, {
        loader: filepath.endsWith(".tsx") ? "tsx" : filepath.endsWith(".jsx") ? "jsx" : "ts",
        jsx: "automatic",
        jsxImportSource: "react",
        target: "es2022",
        format: "esm",
      }).then(r => r.code);
    return;
  } catch { /* esbuild not available */ }

  try {
    // @ts-expect-error - sucrase is an optional runtime dependency for inline transform
    const sucrase = await import("sucrase");
    _sucraseTransform = (code, filepath) =>
      sucrase.transform(code, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: process.env.NODE_ENV === "production",
        filePath: filepath,
      }).code;
    return;
  } catch { /* sucrase not available */ }
}

// ---------------------------------------------------------------------------
// Route module loader (UTAL Protected)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route module loader (UTAL Protected)
// ---------------------------------------------------------------------------

export async function loadRouteModule(
  file: string
): Promise<{ default?: unknown; Page?: unknown; [key: string]: unknown }> {
  const fileUrl = file.startsWith("file://") ? file : pathToFileURL(path.resolve(file)).href;

  try {
    return await import(fileUrl) as { default?: unknown; Page?: unknown; [key: string]: unknown };
  } catch (error) {
    if (String(error).includes("Unknown file extension")) {
      const fsPath = file.startsWith("file://") ? fileURLToPath(file) : path.resolve(file);
      const ext = path.extname(fsPath);

      if (ext === ".tsx" || ext === ".ts" || ext === ".jsx") {
        await ensureInlineTransformers();
        const transformFn = _esbuildTransform ?? _sucraseTransform;

        if (!transformFn) {
          throw new Error(
            `[SOURCEOG] Cannot load "${fsPath}". Unknown file extension and no inline transpiler (esbuild/sucrase) available.`
          );
        }

        const source = readFileSync(fsPath, "utf8");
        const code = await transformFn(source, fsPath);
        
        // FIX: data:text/javascript URLs CANNOT resolve relative imports (e.g. import './Client').
        // We must write the transformed code to a temporary .mjs file in the OS temp directory.
        const hash = createHash("sha256").update(fsPath).digest("hex").slice(0, 8);
        const tmpFile = path.join(TRANSFORM_TEMP_DIR, `${path.basename(fsPath, ext)}-${hash}.mjs`);
        
        // Cache the transpiled file so we only transform once per route per worker
        if (!existsSync(tmpFile)) {
          writeFileSync(tmpFile, code, "utf8");
        }
        
        return import(pathToFileURL(tmpFile).href) as Promise<{ default?: unknown; Page?: unknown; [key: string]: unknown }>;
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Core render function
// ---------------------------------------------------------------------------

export async function renderFlightStream(
  requestId: string,
  payload: WorkerRenderRequest,
  manifestForRender: Record<string, unknown>,
  onChunk?: (chunk: string) => void
): Promise<WorkerRenderResponse> {
  const { route, context } = payload;
  const collectChunks = payload.collectChunks === true;
  const timeoutMs = Number.isFinite(payload.timeoutMs)
    ? Number(payload.timeoutMs)
    : 30_000;

  const routeModule = await loadRouteModule(route.file);
  const React = await getReact();

  const PageComponent = (routeModule.default ?? routeModule.Page) as
    | React.ComponentType<Record<string, unknown>>
    | undefined;

  if (typeof PageComponent !== "function") {
    throw new Error(
      `Route module does not export a renderable component: ${route.file}`
    );
  }

  const element = React.createElement(PageComponent, {
    params: context.params ?? {},
    searchParams: toSearchParamsObject(context.query),
  });

  const chunks: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const usedClientRefs = collectUsedClientRefs(manifestForRender);

  await new Promise<void>((resolve, reject) => {
    const passThrough = new PassThrough();
    let settled = false;
    let flightStream: ReturnType<typeof renderToPipeableStream> | undefined;

    const done = (cb: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cb();
    };

    const abort = (reason: unknown): void => {
      if (typeof flightStream?.abort === "function") {
        try { flightStream.abort(reason); } catch { /* ignore */ }
      }
      passThrough.destroy(toError(reason));
    };

    const timeout = setTimeout(() => {
      const err = new Error(`RSC render timed out after ${timeoutMs}ms`);
      abort(err);
      done(() => reject(err));
    }, timeoutMs);

    passThrough.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (!text) return;
      if (collectChunks) chunks.push(text);
      onChunk?.(text);
    });

    passThrough.on("end", () => {
      const tail = decoder.decode();
      if (tail) {
        if (collectChunks) chunks.push(tail);
        onChunk?.(tail);
      }
      done(resolve);
    });

    passThrough.on("error", (error) => {
      abort(error);
      done(() => reject(toError(error)));
    });

    flightStream = renderToPipeableStream(element, manifestForRender, {
      onError(error) {
        done(() => reject(toError(error)));
        abort(error);
      },
    });

    flightStream.pipe(passThrough);
  });

  return {
    format: "react-flight-text",
    chunks,
    usedClientRefs,
  };
}

// ---------------------------------------------------------------------------
// Client ref collection
// ---------------------------------------------------------------------------

function collectUsedClientRefs(
  manifestForRender: Record<string, unknown>
): string[] {
  return Object.keys(manifestForRender).filter((k) => k.includes("#"));
}