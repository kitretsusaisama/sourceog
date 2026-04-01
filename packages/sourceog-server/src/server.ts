import { createReadStream, existsSync, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createDevDiagnostics, createDevManifest, planIncrementalInvalidation, resolveRouteClientAssetReferences, type ClientBuildArtifacts } from "@sourceog/compiler";
import { createDevRuntime, getClientRuntimeScript, type DevRuntime } from "@sourceog/dev";
import { applySecurityPolicy, AutomationEngine, composeMiddleware, detectLocale, resolveConfig, type ResolvedSourceOGConfig } from "@sourceog/platform";
import { createDocumentHtml, renderError, renderNotFound, renderRouteToCanonicalResult, renderRouteToFlightPayload, renderRouteToFlightStream, renderRouteToOfficialRscPayload, renderRouteToResponse, computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";
import { matchHandlerRoute, matchPageRoute, scanRoutes, type RouteManifest, type RouteMatch } from "@sourceog/router";
import {
  type ActionManifest,
  type CacheManifest,
  applyRuntimeCacheInvalidation,
  createLogger,
  createNodeRequest,
  FilesystemCacheStore,
  json,
  loadEnv,
  type PrerenderManifest,
  type PrerenderManifestEntry,
  resolveCacheInvalidation,
  runWithRequestContext,
  sendNodeResponse,
  setRevalidationHandler,
  mergeRevalidationTrackingSummary,
  withRevalidationTracking,
  SourceOGResponse,
  text
} from "@sourceog/runtime";

export interface SourceOGServerOptions {
  cwd: string;
  mode: "development" | "production";
  port?: number;
}

export interface SourceOGServerInstance {
  server: Server;
  config: ResolvedSourceOGConfig;
  manifest: RouteManifest;
  start(): Promise<void>;
  close(): Promise<void>;
}

export async function createSourceOGServer(options: SourceOGServerOptions): Promise<SourceOGServerInstance> {
  loadEnv(options.cwd, options.mode);

  let config = await resolveConfig(options.cwd);
  let manifest = await scanRoutes(config);
  const logger = createLogger();
  let automationEngine = new AutomationEngine(config.automations ?? []);
  let prerenderManifest = await loadPrerenderManifest(config.distRoot);
  let clientManifest = await loadClientManifest(config.distRoot);
  let actionManifest = await loadActionManifest(config.distRoot);
  let cacheManifest = await loadCacheManifest(config.distRoot);
  let dataCacheStore = createDataCacheStore(config.distRoot);
  const revalidatingPathnames = new Set<string>();
  let devRuntime: DevRuntime | undefined;

  setRevalidationHandler({
    async revalidatePath(pathname) {
      await invalidatePrerenderPath(config.distRoot, prerenderManifest, pathname);
      prerenderManifest = await loadPrerenderManifest(config.distRoot);
    },
    async revalidateTag(tag) {
      await invalidatePrerenderTag(config.distRoot, prerenderManifest, tag);
      prerenderManifest = await loadPrerenderManifest(config.distRoot);
    },
    async applyResolvedInvalidation(resolved) {
      prerenderManifest = await applyPrerenderInvalidation(config.distRoot, prerenderManifest, resolved, cacheManifest);
    }
  });

  const server = createServer(async (req, res) => {
    // RF-29: Assign unique x-request-id if not present in incoming request headers
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

    try {
      if (await serveInternalAsset(req, res, config, requestId)) {
        return;
      }

      const baseUrl = `http://${req.headers.host ?? `localhost:${options.port ?? 3000}`}`;
      const request = createNodeRequest(req, baseUrl);
      if (await handleServerActionRequest(req, res, request, actionManifest, cacheManifest, dataCacheStore, requestId)) {
        return;
      }
      if (await handleFlightRequest(req, res, request, manifest, config, clientManifest, prerenderManifest.buildId, cacheManifest, dataCacheStore, requestId)) {
        return;
      }
      const localeResult = resolveLocaleForRequest(request, config);
      const pageMatch = matchPageRoute(manifest, localeResult.pathname, {
        intercept: isInterceptRequest(request)
      });
      const handlerMatch = matchHandlerRoute(manifest, localeResult.pathname);
      const matched = handlerMatch ?? pageMatch;
      const context = {
        request,
        params: matched?.params ?? {},
        query: request.url.searchParams,
        locale: localeResult.locale,
        runtimeState: createRequestRuntimeState(prerenderManifest.buildId, dataCacheStore, cacheManifest)
      };

      await runWithRequestContext(context, async () => {
        for (const plugin of config.plugins ?? []) {
          await plugin.onRequest?.({ pathname: request.url.pathname, method: request.method });
        }

        if (handlerMatch) {
          const response = await runMiddleware(handlerMatch.route.middlewareFiles, context, async () =>
            handleRouteHandler(handlerMatch.route.file, req, context)
          );
          response.headers.set("x-request-id", requestId);
          await finalizeResponse(config, automationEngine, request.url.pathname, request.method, response, res);
          return;
        }

        if (pageMatch) {
          const prerenderedResponse = options.mode === "production"
            && pageMatch.renderContext === "canonical"
            ? await maybeServePrerenderedPage({
              config,
              pageMatch,
              context,
              logger,
              prerenderManifest,
              clientManifest,
              revalidatingPathnames,
              onManifestUpdated: async () => {
                prerenderManifest = await loadPrerenderManifest(config.distRoot);
                clientManifest = await loadClientManifest(config.distRoot);
              }
            })
            : null;

          if (prerenderedResponse) {
            prerenderedResponse.headers.set("x-request-id", requestId);
            await finalizeResponse(config, automationEngine, request.url.pathname, request.method, prerenderedResponse, res);
            return;
          }

          const response = await runMiddleware(pageMatch.route.middlewareFiles, context, async () =>
            renderRouteToResponse(pageMatch.route, context, {
              clientAssets: withDynamicFlightHref(
                resolveRouteClientAssetReferences(clientManifest, config.distRoot, pageMatch.route.id),
                request.url.pathname,
                pageMatch.renderContext === "intercepted"
              ) ?? undefined,
              routeIdentity: pageMatch,
              parallelRoutes: pageMatch.parallelRoutes
            })
          );
          response.headers.set("x-request-id", requestId);
          await finalizeResponse(config, automationEngine, request.url.pathname, request.method, response, res);
          return;
        }

        const notFoundFile = manifest.pages.find((route) => route.notFoundFile)?.notFoundFile;
        const response = await renderNotFound(notFoundFile, context);
        response.headers.set("x-request-id", requestId);
        await finalizeResponse(config, automationEngine, request.url.pathname, request.method, response, res);
      });
    } catch (error) {
      const request = createNodeRequest(req, `http://${req.headers.host ?? `localhost:${options.port ?? 3000}`}`);
      const response = await renderError(manifest.pages[0]?.errorFile, {
        request,
        params: {},
        query: request.url.searchParams
      }, error as Error);
      response.headers.set("x-request-id", requestId);
      applySecurityPolicy(response, config.security);
      await sendNodeResponse(res, response);
      logger.error("request_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  if (options.mode === "development") {
    devRuntime = createDevRuntime(server, config.appRoot, async (eventName, changedPath) => {
      config = await resolveConfig(options.cwd);
      manifest = await scanRoutes(config);
      automationEngine = new AutomationEngine(config.automations ?? []);
      prerenderManifest = await loadPrerenderManifest(config.distRoot);
      clientManifest = await loadClientManifest(config.distRoot);
      actionManifest = await loadActionManifest(config.distRoot);
      cacheManifest = await loadCacheManifest(config.distRoot);
      dataCacheStore = createDataCacheStore(config.distRoot);
      const diagnostics = createDevDiagnostics(manifest, changedPath);
      const invalidationPlan = planIncrementalInvalidation(manifest, [changedPath], eventName);
      const devManifest = createDevManifest(manifest, [changedPath]);
      await fs.mkdir(config.distRoot, { recursive: true });
      await fs.writeFile(
        path.join(config.distRoot, "dev-manifest.json"),
        JSON.stringify(devManifest, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(config.distRoot, "dev-diagnostics.json"),
        JSON.stringify({
          version: "2027.1",
          buildId: "dev",
          generatedAt: new Date().toISOString(),
          issues: diagnostics
        }, null, 2),
        "utf8"
      );

      return {
        fullReload: invalidationPlan.fullReload,
        affectedRouteIds: invalidationPlan.affectedRouteIds,
        affectedChunkIds: invalidationPlan.affectedChunkIds,
        routeCount: invalidationPlan.affectedRouteIds.length || devManifest.routes.length,
        diagnostics: {
          version: "2027.1",
          buildId: "dev",
          generatedAt: new Date().toISOString(),
          issues: diagnostics
        }
      };
    });
  }

  return {
    server,
    get config() {
      return config;
    },
    get manifest() {
      return manifest;
    },
    async start() {
      await new Promise<void>((resolve) => {
        server.listen(options.port ?? 3000, resolve);
      });
      logger.info("sourceog_server_started", {
        mode: options.mode,
        port: options.port ?? 3000
      });
    },
    async close() {
      await devRuntime?.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

function isInterceptRequest(request: ReturnType<typeof createNodeRequest>): boolean {
  const header = request.headers.get("x-sourceog-intercept");
  const query = request.url.searchParams.get("__sourceog_intercept");
  return header === "1" || header === "true" || query === "1" || query === "true";
}

function resolveLocaleForRequest(
  request: ReturnType<typeof createNodeRequest>,
  config: ResolvedSourceOGConfig
): { pathname: string; locale?: string } {
  if (!config.i18n) {
    return { pathname: request.url.pathname };
  }

  const locale = detectLocale(request, {
    locales: config.i18n.locales,
    defaultLocale: config.i18n.defaultLocale,
    localeDetection: config.i18n.localeDetection ? "header" : "none"
  });
  const segments = request.url.pathname.split("/").filter(Boolean);
  const pathname = segments[0] && config.i18n.locales.includes(segments[0])
    ? `/${segments.slice(1).join("/")}`.replace(/\/$/, "") || "/"
    : request.url.pathname;

  return {
    pathname,
    locale
  };
}

function createDynamicFlightHref(pathname: string, intercepted = false): string {
  const query = new URLSearchParams({ pathname });
  if (intercepted) {
    query.set("intercept", "1");
  }
  return `/__sourceog/flight?${query.toString()}`;
}

function wantsFlightStreamResponse(request: ReturnType<typeof createNodeRequest>): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/x-component");
}

function withDynamicFlightHref(
  clientAssets: ReturnType<typeof resolveRouteClientAssetReferences> | null,
  pathname: string,
  intercepted = false
): ReturnType<typeof resolveRouteClientAssetReferences> | null {
  if (!clientAssets) {
    return null;
  }

  return {
    ...clientAssets,
    clientReferenceManifestUrl: "/__sourceog/client-refs.json",
    flightHref: createDynamicFlightHref(pathname, intercepted)
  };
}

async function handleRouteHandler(
  file: string,
  req: IncomingMessage,
  context: HandlerContext
): Promise<SourceOGResponse> {
  const module = await import(pathToFileURL(file).href) as Record<string, (context: HandlerContext) => Promise<unknown> | unknown>;
  const method = (req.method ?? "GET").toUpperCase();
  const handler = module[method] ?? module.ALL;

  if (!handler) {
    return text(`Method ${method} not allowed`, { status: 405 });
  }

  const result = await handler(context);
  if (result instanceof SourceOGResponse) {
    return result;
  }

  if (result instanceof Response) {
    const response = new SourceOGResponse(await result.text(), {
      status: result.status,
      headers: result.headers
    });
    return response;
  }

  if (typeof result === "string") {
    return text(result);
  }

  return json(result ?? { ok: true });
}

async function handleServerActionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  request: ReturnType<typeof createNodeRequest>,
  actionManifest: ActionManifest,
  cacheManifest: CacheManifest,
  dataCacheStore: FilesystemCacheStore,
  requestId: string
): Promise<boolean> {
  if (!request.url.pathname.startsWith("/__sourceog/actions/")) {
    return false;
  }

  if (request.method !== "POST") {
    await sendNodeResponse(res, text("Method not allowed", { status: 405 }));
    return true;
  }

  // CSRF protection (RF-02): validate Origin header matches server origin
  const serverOrigin = request.url.origin;
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader !== serverOrigin) {
    await sendNodeResponse(res, text("Forbidden", { status: 403 }));
    return true;
  }

  // Content-Type validation (RF-06): must be application/json before parsing body
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    await sendNodeResponse(res, text("Unsupported Media Type", { status: 400 }));
    return true;
  }

  const actionId = decodeURIComponent(request.url.pathname.slice("/__sourceog/actions/".length));
  const actionEntry = actionManifest.entries.find((entry) => entry.actionId === actionId);
  if (!actionEntry) {
    await sendNodeResponse(res, text(`Unknown server action: ${actionId}`, { status: 404 }));
    return true;
  }

  try {
    const payload = await request.bodyJson<{ args?: unknown[] }>();
    const module = await import(pathToFileURL(actionEntry.filePath).href) as Record<string, (...args: unknown[]) => Promise<unknown> | unknown>;
    const action = module[actionEntry.exportName];
    if (typeof action !== "function") {
      throw new Error(`Export "${actionEntry.exportName}" is not callable.`);
    }

    const trackedResult = await withRevalidationTracking(() =>
      runWithRequestContext({
        request,
        params: {},
        query: request.url.searchParams,
        runtimeState: createRequestRuntimeState(actionManifest.buildId, dataCacheStore, cacheManifest)
      }, async () => action(...(payload.args ?? [])))
    );
    const { result } = trackedResult;
    let summary = trackedResult.summary;
    if (actionEntry.revalidationPolicy === "track-runtime-revalidation") {
      const linkedInvalidation = resolveCacheInvalidation({
        actionId,
        cacheManifest
      });
      const pendingInvalidation = {
        pathnames: linkedInvalidation.pathnames.filter((pathname) => !summary.paths.includes(pathname)),
        tags: linkedInvalidation.tags.filter((tag) => !summary.tags.includes(tag)),
        routeIds: linkedInvalidation.routeIds.filter((routeId) => !summary.routeIds.includes(routeId)),
        cacheKeys: linkedInvalidation.cacheKeys.filter((cacheKey) => !summary.cacheKeys.includes(cacheKey))
      };
      const needsInvalidation =
        pendingInvalidation.pathnames.length > 0
        || pendingInvalidation.tags.length > 0
        || pendingInvalidation.routeIds.length > 0
        || pendingInvalidation.cacheKeys.length > 0;

      if (needsInvalidation) {
        await applyRuntimeCacheInvalidation({
          ...pendingInvalidation,
          invalidated: true
        });
      }

      summary = mergeRevalidationTrackingSummary(summary, {
        paths: linkedInvalidation.pathnames,
        tags: linkedInvalidation.tags,
        routeIds: linkedInvalidation.routeIds,
        cacheKeys: linkedInvalidation.cacheKeys,
        invalidated: linkedInvalidation.invalidated
      });
    }

    const response = json({
      ok: true,
      result,
      revalidated: summary
    });
    response.headers.set("x-request-id", requestId);
    if (summary.invalidated && actionEntry.refreshPolicy === "refresh-current-route-on-revalidate") {
      response.headers.set("x-sourceog-action-refresh", "current-route");
    }
    if (summary.paths.length > 0) {
      response.headers.set("x-sourceog-revalidated-paths", JSON.stringify(summary.paths));
    }
    if (summary.tags.length > 0) {
      response.headers.set("x-sourceog-revalidated-tags", JSON.stringify(summary.tags));
    }
    if (summary.routeIds.length > 0) {
      response.headers.set("x-sourceog-revalidated-route-ids", JSON.stringify(summary.routeIds));
    }
    if (summary.cacheKeys.length > 0) {
      response.headers.set("x-sourceog-revalidated-cache-keys", JSON.stringify(summary.cacheKeys));
    }

    await sendNodeResponse(res, response);
    return true;
  } catch (error) {
    await sendNodeResponse(res, json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 }));
    return true;
  }
}

async function handleFlightRequest(
  req: IncomingMessage,
  res: ServerResponse,
  request: ReturnType<typeof createNodeRequest>,
  manifest: RouteManifest,
  config: ResolvedSourceOGConfig,
  clientManifest: ClientBuildArtifacts,
  buildId: string,
  cacheManifest: CacheManifest,
  dataCacheStore: FilesystemCacheStore,
  requestId: string
): Promise<boolean> {
  // New canonical Flight endpoint: GET /_sourceog/flight/:routeId (Req 3.1–3.6, INV-003)
  const newFlightMatch = request.url.pathname.match(/^\/_sourceog\/flight\/(.+)$/);
  if (newFlightMatch) {
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
      await sendNodeResponse(res, text("Method not allowed", { status: 405 }));
      return true;
    }

    const routeId = decodeURIComponent(newFlightMatch[1]!);
    const requestedPathname = request.url.searchParams.get("pathname") ?? `/${routeId}`;
    const syntheticRequest = {
      ...request,
      url: new URL(requestedPathname, request.url.origin)
    };
    const localeResult = resolveLocaleForRequest(syntheticRequest, config);
    const pageMatch = matchPageRoute(manifest, localeResult.pathname, {
      intercept: request.url.searchParams.get("intercept") === "1" || request.url.searchParams.get("intercept") === "true"
    });

    if (!pageMatch) {
      await sendNodeResponse(res, text(`Unknown route: ${routeId}`, { status: 404 }));
      return true;
    }

    const context = {
      request: syntheticRequest,
      params: pageMatch.params,
      query: syntheticRequest.url.searchParams,
      locale: localeResult.locale,
      runtimeState: createRequestRuntimeState(buildId, dataCacheStore, cacheManifest)
    };

    const canonicalRouteId = computeCanonicalRouteId(
      pageMatch.route.pathname,
      Object.fromEntries(
        Object.entries(pageMatch.params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v])
      )
    );
    const slotId = request.url.searchParams.get("slotId") ?? "";
    const intercepted = pageMatch.renderContext === "intercepted";
    const renderContextKey = computeRenderContextKey(canonicalRouteId, slotId, intercepted);

    // Set headers before any body (Req 3.1, 3.3, 3.4, INV-003)
    res.setHeader("Content-Type", "text/x-component");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Render-Context-Key", renderContextKey);
    res.setHeader("X-Canonical-Route-Id", canonicalRouteId);
    res.setHeader("x-request-id", requestId);

    try {
      const flightStream = await runWithRequestContext(context, async () =>
        renderRouteToFlightStream(pageMatch.route, context, {
          parallelRoutes: pageMatch.parallelRoutes
        })
      );

      // Pipe ReadableStream directly to HTTP response without buffering (Req 3.2)
      const reader = flightStream.getReader();
      res.on("close", () => reader.cancel().catch(() => {}));

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            const canContinue = res.write(value);
            if (!canContinue) {
              await new Promise<void>((resolve) => res.once("drain", resolve));
            }
          }
        } catch (streamError) {
          // Req 3.6: on stream error after headers sent, destroy response and log [SOURCEOG-FALLBACK]
          console.error("[SOURCEOG-FALLBACK] Flight stream error after headers sent:", {
            severity: "ERROR",
            type: "[SOURCEOG-FALLBACK]",
            requestId,
            route: routeId,
            message: streamError instanceof Error ? streamError.message : String(streamError),
            stack: streamError instanceof Error ? streamError.stack : undefined,
            timestamp: new Date().toISOString()
          });
          res.destroy(streamError instanceof Error ? streamError : new Error(String(streamError)));
        }
      };

      void pump();
    } catch (error) {
      // Error before headers body — destroy and log
      console.error("[SOURCEOG-FALLBACK] Flight render error:", {
        severity: "ERROR",
        type: "[SOURCEOG-FALLBACK]",
        requestId,
        route: routeId,
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }

    return true;
  }

  // Legacy Flight endpoint: GET /__sourceog/flight?pathname=...
  if (request.url.pathname !== "/__sourceog/flight") {
    return false;
  }

  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    await sendNodeResponse(res, text("Method not allowed", { status: 405 }));
    return true;
  }

  const requestedPathname = request.url.searchParams.get("pathname");
  if (!requestedPathname || !requestedPathname.startsWith("/")) {
    await sendNodeResponse(res, text("Missing pathname query parameter", { status: 400 }));
    return true;
  }

  const syntheticRequest = {
    ...request,
    url: new URL(requestedPathname, request.url.origin)
  };
  const localeResult = resolveLocaleForRequest(syntheticRequest, config);
  const pageMatch = matchPageRoute(manifest, localeResult.pathname, {
    intercept: request.url.searchParams.get("intercept") === "1" || request.url.searchParams.get("intercept") === "true"
  });

  if (!pageMatch) {
    await sendNodeResponse(res, text(`Unknown route: ${requestedPathname}`, { status: 404 }));
    return true;
  }

  const context = {
    request: syntheticRequest,
    params: pageMatch.params,
    query: syntheticRequest.url.searchParams,
    locale: localeResult.locale,
    runtimeState: createRequestRuntimeState(buildId, dataCacheStore, cacheManifest)
  };

  if (wantsFlightStreamResponse(request)) {
    const renderContext = pageMatch.renderContext ?? "canonical";
    const canonicalRouteId = computeCanonicalRouteId(
      pageMatch.route.pathname,
      Object.fromEntries(
        Object.entries(pageMatch.params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v])
      )
    );
    const renderContextKey = computeRenderContextKey(canonicalRouteId, "", renderContext === "intercepted");
    const flightPayload = await runWithRequestContext(context, async () =>
      renderRouteToOfficialRscPayload(pageMatch.route, context, {
        parallelRoutes: pageMatch.parallelRoutes
      })
    );
    const response = new SourceOGResponse(Readable.from(flightPayload.chunks), {
      headers: {
        "content-type": "text/x-component",
        "cache-control": "no-store",
        "x-sourceog-route-id": pageMatch.route.id,
        "x-sourceog-canonical-route-id": canonicalRouteId,
        "x-sourceog-resolved-route-id": pageMatch.route.id,
        "x-sourceog-render-context-key": renderContextKey,
        "x-sourceog-render-context": renderContext,
        "x-sourceog-rsc-payload-format": flightPayload.format,
        "x-request-id": requestId
      }
    });
    await sendNodeResponse(res, response);
    return true;
  }

  const payload = await runWithRequestContext(context, async () =>
    renderRouteToFlightPayload(pageMatch.route, context, {
      pathname: requestedPathname,
      clientAssets: withDynamicFlightHref(
        resolveRouteClientAssetReferences(clientManifest, config.distRoot, pageMatch.route.id),
        requestedPathname,
        pageMatch.renderContext === "intercepted"
      ) ?? undefined,
      routeIdentity: pageMatch,
      parallelRoutes: pageMatch.parallelRoutes
    })
  );
  const flightResponse = json(payload);
  flightResponse.headers.set("x-request-id", requestId);
  await sendNodeResponse(res, flightResponse);
  return true;
}

interface HandlerContext {
  request: ReturnType<typeof createNodeRequest>;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  locale?: string;
}

async function runMiddleware(
  middlewareFiles: string[],
  context: Parameters<Parameters<typeof composeMiddleware>[0][number]>[0],
  finalHandler: () => Promise<SourceOGResponse>
): Promise<SourceOGResponse> {
  const middleware = await Promise.all(middlewareFiles.map(async (file) => {
    const loaded = await import(pathToFileURL(file).href) as { default?: Parameters<typeof composeMiddleware>[0][number] };
    return loaded.default;
  }));

  return composeMiddleware(
    middleware.filter((value): value is NonNullable<typeof value> => Boolean(value)),
    context,
    finalHandler
  );
}

async function serveInternalAsset(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedSourceOGConfig,
  requestId: string
): Promise<boolean> {
  if (!req.url?.startsWith("/__sourceog/")) {
    return false;
  }

  // Set x-request-id before writing any response body
  res.setHeader("x-request-id", requestId);

  const safeRoot = path.resolve(config.distRoot, "static");
  const assetPath = path.resolve(config.distRoot, "static", req.url.replace(/^\//, "").replaceAll("/", path.sep));

  // Path traversal protection: ensure resolved path stays within distRoot/static
  if (!(assetPath.startsWith(safeRoot + path.sep) || assetPath === safeRoot)) {
    res.statusCode = 404;
    res.end();
    return true;
  }

  if (existsSync(assetPath)) {
    if (assetPath.endsWith(".js")) {
      res.setHeader("content-type", "application/javascript; charset=utf-8");
    } else if (assetPath.endsWith(".json")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }

    createReadStream(assetPath).pipe(res);
    return true;
  }

  if (req.url === "/__sourceog/client.js") {
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    res.end(getClientRuntimeScript());
    return true;
  }

  if (req.url === "/__sourceog/client-refs.json") {
    const manifestPath = path.join(config.distRoot, "public", "_sourceog", "client-refs.json");
    if (!existsSync(manifestPath)) {
      return false;
    }

    res.setHeader("content-type", "application/json; charset=utf-8");
    createReadStream(manifestPath).pipe(res);
    return true;
  }

  return false;
}

async function emitResponseHooks(config: ResolvedSourceOGConfig, pathname: string, status: number): Promise<void> {
  for (const plugin of config.plugins ?? []) {
    await plugin.onResponse?.({ pathname, status });
  }
}

async function finalizeResponse(
  config: ResolvedSourceOGConfig,
  automationEngine: AutomationEngine,
  pathname: string,
  method: string,
  response: SourceOGResponse,
  res: ServerResponse
): Promise<void> {
  applySecurityPolicy(response, config.security);
  await sendNodeResponse(res, response);
  await emitResponseHooks(config, pathname, response.status);
  await automationEngine.dispatch({
    name: "request.complete",
    payload: {
      pathname,
      method,
      status: response.status
    },
    timestamp: new Date().toISOString()
  });
}

async function maybeServePrerenderedPage(input: {
  config: ResolvedSourceOGConfig;
  pageMatch: RouteMatch;
  context: HandlerContext;
  logger: ReturnType<typeof createLogger>;
  prerenderManifest: PrerenderManifest;
  clientManifest: ClientBuildArtifacts;
  revalidatingPathnames: Set<string>;
  onManifestUpdated: () => Promise<void>;
}): Promise<SourceOGResponse | null> {
  const pathname = input.context.request.url.pathname;
  const entry = input.prerenderManifest.prerendered.find((record) => record.pathname === pathname);
  if (!entry || !existsSync(entry.filePath)) {
    return null;
  }

  if (!isPrerenderEntryStale(entry)) {
    return createStaticFileResponse(entry.filePath, "HIT");
  }

  if (!input.revalidatingPathnames.has(pathname)) {
    input.revalidatingPathnames.add(pathname);
    void regeneratePrerenderEntry({
      config: input.config,
      routeMatch: input.pageMatch,
      pathname,
      entry,
      clientManifest: input.clientManifest,
      logger: input.logger
    }).finally(async () => {
      input.revalidatingPathnames.delete(pathname);
      await input.onManifestUpdated();
    });
  }

  return createStaticFileResponse(entry.filePath, "STALE");
}

function isPrerenderEntryStale(entry: PrerenderManifestEntry): boolean {
  if (entry.invalidated) {
    return true;
  }

  if (!entry.revalidate) {
    return false;
  }

  const generatedAt = new Date(entry.generatedAt).getTime();
  return Date.now() - generatedAt >= entry.revalidate * 1_000;
}

function createStaticFileResponse(filePath: string, cacheState: "HIT" | "STALE"): SourceOGResponse {
  const response = new SourceOGResponse(createReadStream(filePath), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-sourceog-cache": cacheState
    }
  });
  return response;
}

async function regeneratePrerenderEntry(input: {
  config: ResolvedSourceOGConfig;
  routeMatch: RouteMatch;
  pathname: string;
  entry: PrerenderManifestEntry;
  clientManifest: ClientBuildArtifacts;
  logger: ReturnType<typeof createLogger>;
}): Promise<void> {
  const dataCacheStore = createDataCacheStore(input.config.distRoot);
  const context = {
    request: {
      url: new URL(`http://sourceog.local${input.pathname}`),
      method: "GET",
      headers: new Headers(),
      cookies: new Map<string, string>(),
      requestId: "revalidate",
      runtime: "node" as const,
      async bodyText() {
        return "";
      },
      async bodyJson<T>() {
        return {} as T;
      }
    },
    params: input.routeMatch.params,
    query: new URLSearchParams(),
    locale: undefined as string | undefined,
    runtimeState: createRequestRuntimeState(
      input.clientManifest.buildId ?? "runtime",
      dataCacheStore,
      await loadCacheManifest(input.config.distRoot)
    )
  };

  const staticFlightHref = input.entry.flightFilePath
    ? `/${path.relative(path.join(input.config.distRoot, "static"), input.entry.flightFilePath).replaceAll("\\", "/")}`
    : undefined;
  const clientAssets = resolveRouteClientAssetReferences(input.clientManifest, input.config.distRoot, input.routeMatch.route.id);
  const clientAssetsWithFlight = clientAssets
    ? {
      ...clientAssets,
      flightHref: staticFlightHref
    }
    : undefined;
  const rendered = await renderRouteToCanonicalResult(input.routeMatch.route, context, {
    pathname: input.pathname,
    clientAssets: clientAssetsWithFlight,
    routeIdentity: input.routeMatch,
    parallelRoutes: input.routeMatch.parallelRoutes
  });
  const html = createDocumentHtml(rendered, context.locale, {
    routeId: input.routeMatch.route.id,
    clientAssets: clientAssetsWithFlight
  });
  if (input.entry.flightFilePath) {
    const flightPayload = await renderRouteToFlightPayload(input.routeMatch.route, context, {
      pathname: input.pathname,
      clientAssets: clientAssetsWithFlight,
      routeIdentity: input.routeMatch,
      parallelRoutes: input.routeMatch.parallelRoutes
    });
    const tempFlightPath = `${input.entry.flightFilePath}.tmp`;
    await fs.writeFile(tempFlightPath, JSON.stringify(flightPayload, null, 2), "utf8");
    await fs.rename(tempFlightPath, input.entry.flightFilePath);
  }
  const tempPath = `${input.entry.filePath}.tmp`;
  await fs.writeFile(tempPath, html, "utf8");
  await fs.rename(tempPath, input.entry.filePath);
  await updatePrerenderEntry(input.config.distRoot, {
    ...input.entry,
    invalidated: false,
    generatedAt: new Date().toISOString(),
    hash: createHash("sha256").update(html).digest("hex")
  });
  input.logger.info("sourceog_isr_regenerated", {
    pathname: input.pathname
  });
}

async function loadClientManifest(distRoot: string): Promise<ClientBuildArtifacts> {
  const manifestPath = path.join(distRoot, "client-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      version: "2027.1",
      generatedAt: new Date().toISOString(),
      runtimeAsset: path.join(distRoot, "static", "__sourceog", "client.js"),
      routeEntries: [],
      sharedChunks: []
    };
  }

  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as ClientBuildArtifacts;
}

async function loadActionManifest(distRoot: string): Promise<ActionManifest> {
  const manifestPath = path.join(distRoot, "action-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      version: "2027.1",
      buildId: "dev",
      generatedAt: new Date().toISOString(),
      entries: []
    };
  }

  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as ActionManifest;
}

async function loadCacheManifest(distRoot: string): Promise<CacheManifest> {
  const manifestPath = path.join(distRoot, "cache-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      version: "2027.1",
      buildId: "dev",
      generatedAt: new Date().toISOString(),
      entries: [],
      invalidationLinks: []
    };
  }

  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as CacheManifest;
}

async function loadPrerenderManifest(distRoot: string): Promise<PrerenderManifest> {
  const manifestPath = path.join(distRoot, "prerender-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      version: "2027.1",
      buildId: "dev",
      generatedAt: new Date().toISOString(),
      prerendered: []
    };
  }

  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as PrerenderManifest;
}

async function updatePrerenderEntry(distRoot: string, entry: PrerenderManifestEntry): Promise<void> {
  const manifest = await loadPrerenderManifest(distRoot);
  const nextEntries = manifest.prerendered.map((record) => (record.pathname === entry.pathname ? entry : record));
  await fs.writeFile(
    path.join(distRoot, "prerender-manifest.json"),
    JSON.stringify({
      ...manifest,
      generatedAt: new Date().toISOString(),
      prerendered: nextEntries
    }, null, 2),
    "utf8"
  );
}

async function applyPrerenderInvalidation(
  distRoot: string,
  manifest: PrerenderManifest,
  resolved: {
    cacheKeys: string[];
    routeIds: string[];
    pathnames: string[];
    tags: string[];
  },
  cacheManifest: CacheManifest
): Promise<PrerenderManifest> {
  const targetPathnames = new Set(resolved.pathnames);
  const targetRouteIds = new Set(resolved.routeIds);
  const targetTags = new Set(resolved.tags);
  const targetCacheKeys = new Set(resolved.cacheKeys);

  for (const entry of cacheManifest.entries) {
    if (entry.kind !== "route") {
      continue;
    }

    const matches =
      targetCacheKeys.has(entry.cacheKey)
      || (entry.routeId ? targetRouteIds.has(entry.routeId) : false)
      || (entry.pathname ? targetPathnames.has(entry.pathname) : false)
      || entry.linkedRouteIds.some((routeKey) => targetRouteIds.has(routeKey) || targetPathnames.has(routeKey))
      || entry.linkedTagIds.some((tag) => targetTags.has(tag));

    if (!matches) {
      continue;
    }

    if (entry.routeId) {
      targetRouteIds.add(entry.routeId);
    }
    if (entry.pathname) {
      targetPathnames.add(entry.pathname);
    }
    for (const tag of entry.linkedTagIds) {
      targetTags.add(tag);
    }
  }

  const nextEntries = manifest.prerendered.map((entry) => (
    targetPathnames.has(entry.pathname) || entry.tags.some((tag) => targetTags.has(tag))
      ? { ...entry, invalidated: true }
      : entry
  ));

  const changed = nextEntries.some((entry, index) => entry.invalidated !== manifest.prerendered[index]?.invalidated);
  if (!changed) {
    return manifest;
  }

  const nextManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    prerendered: nextEntries
  };
  await fs.writeFile(
    path.join(distRoot, "prerender-manifest.json"),
    JSON.stringify(nextManifest, null, 2),
    "utf8"
  );
  return nextManifest;
}

async function invalidatePrerenderPath(distRoot: string, manifest: PrerenderManifest, pathname: string): Promise<void> {
  const nextEntries = manifest.prerendered.map((entry) => (
    entry.pathname === pathname
      ? { ...entry, generatedAt: new Date(0).toISOString(), invalidated: true }
      : entry
  ));
  await fs.writeFile(
    path.join(distRoot, "prerender-manifest.json"),
    JSON.stringify({ ...manifest, generatedAt: new Date().toISOString(), prerendered: nextEntries }, null, 2),
    "utf8"
  );
}

async function invalidatePrerenderTag(distRoot: string, manifest: PrerenderManifest, tag: string): Promise<void> {
  const nextEntries = manifest.prerendered.map((entry) => (
    entry.tags.includes(tag)
      ? { ...entry, generatedAt: new Date(0).toISOString(), invalidated: true }
      : entry
  ));
  await fs.writeFile(
    path.join(distRoot, "prerender-manifest.json"),
    JSON.stringify({ ...manifest, generatedAt: new Date().toISOString(), prerendered: nextEntries }, null, 2),
    "utf8"
  );
}

function createDataCacheStore(distRoot: string): FilesystemCacheStore {
  return new FilesystemCacheStore(path.join(distRoot, "cache", "data"));
}

/**
 * Build the bootstrap <script> tag injecting window.__SOURCEOG_CLIENT_CONTEXT__
 * with CanonicalRenderContext and clientReferenceManifestUrl preload (Req 3.8).
 */
export function buildBootstrapScript(context: {
  renderMode: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  parallelRouteMap: Record<string, string>;
  intercepted: boolean;
  interceptedFrom?: string;
  interceptedUrl?: string;
  clientReferenceManifestUrl: string;
  buildId: string;
  deployId: string;
}): string {
  const safeJson = JSON.stringify(context).replace(/<\/script>/gi, "<\\/script>");
  // Req 4.8, 12.7: install hydrationMode deprecation proxy via Object.defineProperty
  const deprecationProxy = `Object.defineProperty(window.__SOURCEOG_CLIENT_CONTEXT__,"hydrationMode",{configurable:true,enumerable:false,get:function(){console.warn("hydrationMode is deprecated. Use renderMode instead.");return window.__SOURCEOG_CLIENT_CONTEXT__.renderMode==="client-root"?"full-route":"mixed-route";}});`;
  return `<script>window.__SOURCEOG_CLIENT_CONTEXT__=${safeJson};${deprecationProxy}</script>`;
}

function createRequestRuntimeState(
  buildId: string,
  dataCacheStore: FilesystemCacheStore,
  cacheManifest: CacheManifest
) {
  return {
    buildId,
    dataCacheStore,
    cacheManifest
  };
}
