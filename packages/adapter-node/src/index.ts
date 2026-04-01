/**
 * adapter-node — SourceOG Adapter for Node.js HTTP
 * Requirements: 6.1, 6.5, 6.6, 6.7
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { DeploymentManifest } from "@sourceog/runtime";
import type {
  AdapterBuildArtifacts as BuildArtifacts,
  AdapterFeatureSet as RuntimeCapabilities,
  CapabilityReport,
  SourceOGAdapter,
  SourceOGConfig
} from "@sourceog/platform/config";
import {
  parseCookieHeader,
  serializeCookieHeader,
  createMutableHeaders,
  createMutableCookies,
  type MutableCookiesWithPending,
  type AdapterSourceOGRequest,
  type AdapterSourceOGResponse,
  type CookieOptions,
} from "@sourceog/adapter-utils";

export type {
  ReadonlyHeaders,
  ReadonlyCookies,
  MutableHeaders,
  MutableCookies,
  CookieOptions,
  GeoData,
  AdapterSourceOGRequest,
  AdapterSourceOGResponse,
} from "@sourceog/adapter-utils";

export type NodeRequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const NODE_SUPPORTED_FEATURES = new Set([
  "streaming", "cookies", "headers", "filesystem", "crypto", "isr",
  "middleware", "edge-runtime", "server-actions", "image-optimization",
  "i18n", "rate-limiting", "jwt", "validation",
]);

function resolveDeployRoot(config: SourceOGConfig, adapterName: string): string {
  const c = config as SourceOGConfig & { distRoot?: string; distDir?: string; cwd?: string };
  const base = c.distRoot ?? path.resolve(c.cwd ?? process.cwd(), c.distDir ?? ".sourceog");
  return path.join(base, "deploy", adapterName);
}

async function copyDeploymentManifests(
  manifestPaths: Record<string, string> | undefined,
  deployRoot: string
): Promise<void> {
  if (!manifestPaths) return;
  const manifestsRoot = path.join(deployRoot, "manifests");
  await fs.mkdir(manifestsRoot, { recursive: true });
  for (const [name, filePath] of Object.entries(manifestPaths)) {
    await fs.copyFile(filePath, path.join(manifestsRoot, `${name}.json`));
  }
}

function nodeIncomingMessageToReadableStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      req.on("end", () => controller.close());
      req.on("error", (err) => controller.error(err));
    },
    cancel() { req.destroy(); },
  });
}

function normalizeIncomingMessage(req: IncomingMessage, baseUrl: string): AdapterSourceOGRequest {
  const url = new URL(req.url ?? "/", baseUrl);
  const headers = createMutableHeaders(req.headers as Record<string, string | string[] | undefined>);
  const cookieHeader = req.headers["cookie"];
  const cookieMap = parseCookieHeader(Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader);
  const cookies = createMutableCookies(cookieMap);
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim())
    ?? req.socket?.remoteAddress ?? undefined;
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  return {
    method, url, headers, cookies, ip,
    body: hasBody ? nodeIncomingMessageToReadableStream(req) : null,
    requestId: randomUUID(),
    traceId: randomUUID(),
  };
}

async function writeSourceOGResponse(sourceogRes: AdapterSourceOGResponse, res: ServerResponse): Promise<void> {
  res.statusCode = sourceogRes.status;
  if (typeof sourceogRes.body === "string" && !sourceogRes.headers.has("content-type")) {
    sourceogRes.headers.set("content-type", "text/plain;charset=UTF-8");
  }
  sourceogRes.headers.forEach((value: string, name: string) => res.setHeader(name, value));
  const cookiesWithPending = sourceogRes.cookies as MutableCookiesWithPending;
  if (cookiesWithPending._pending?.length) {
    res.setHeader(
      "set-cookie",
      cookiesWithPending._pending.map(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) =>
        serializeCookieHeader(name, value, options as CookieOptions)
      )
    );
  }
  const { body } = sourceogRes;
  if (body === null) { res.end(); return; }
  if (typeof body === "string") { res.end(body); return; }
  const nodeReadable = Readable.fromWeb(body as import("stream/web").ReadableStream);
  await new Promise<void>((resolve, reject) => {
    nodeReadable.pipe(res);
    nodeReadable.on("end", resolve);
    nodeReadable.on("error", reject);
  });
}

function createDefaultHandler(manifest: DeploymentManifest): (req: AdapterSourceOGRequest) => Promise<AdapterSourceOGResponse> {
  return async (req) => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const matchedRoute = manifest.routes.find((r: { pathname: string }) => {
      try {
        return new RegExp("^" + r.pathname.replace(/\[([^\]]+)\]/g, "[^/]+") + "$").test(req.url.pathname);
      } catch { return r.pathname === req.url.pathname; }
    });
    if (!matchedRoute) return { status: 404, headers, cookies, body: "Not Found" };
    return { status: 200, headers, cookies, body: null };
  };
}

class NodeAdapter implements SourceOGAdapter {
  public readonly name = "node";

  checkCapabilities(features: RuntimeCapabilities): CapabilityReport {
    const supported: string[] = [], unsupported: string[] = [], warnings: string[] = [];
    for (const feature of features.features) {
      (NODE_SUPPORTED_FEATURES.has(feature) ? supported : unsupported).push(feature);
    }
    return { supported, unsupported, warnings };
  }

  async deploy(manifest: DeploymentManifest, artifacts: BuildArtifacts, config: SourceOGConfig): Promise<void> {
    const deployRoot = resolveDeployRoot(config, this.name);
    await fs.mkdir(deployRoot, { recursive: true });
    await copyDeploymentManifests(artifacts.manifestPaths, deployRoot);
    await fs.writeFile(path.join(deployRoot, "deployment-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await fs.writeFile(
      path.join(deployRoot, "package.json"),
      JSON.stringify({ name: "sourceog-node-deployment", private: true, type: "module", buildId: artifacts.buildId, main: "./server.mjs" }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(deployRoot, "server.mjs"),
      ["export const buildId = " + JSON.stringify(artifacts.buildId) + ";", "export const deploymentManifestPath = \"./deployment-manifest.json\";", "export const manifestsDir = \"./manifests\";"].join("\n"),
      "utf8"
    );
  }

  createRequestHandler(manifest: DeploymentManifest): NodeRequestHandler {
    const defaultHandler = createDefaultHandler(manifest);
    return (req: IncomingMessage, res: ServerResponse): void => {
      const sourceogReq = normalizeIncomingMessage(req, "http://" + (req.headers.host ?? "localhost"));
      void defaultHandler(sourceogReq)
        .then((sourceogRes) => writeSourceOGResponse(sourceogRes, res))
        .catch((err: unknown) => {
          if (!res.headersSent) { res.statusCode = 500; res.end("Internal Server Error"); }
          console.error("[adapter-node] Unhandled error:", err);
        });
    };
  }
}

export const nodeAdapter: SourceOGAdapter = new NodeAdapter();
export function createNodeAdapter(): SourceOGAdapter { return new NodeAdapter(); }
export default nodeAdapter;