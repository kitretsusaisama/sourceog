import { createReadStream, existsSync, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { createDevDiagnostics, createDevManifest, planIncrementalInvalidation, resolveRouteClientAssetReferences, type ClientBuildArtifacts } from "@sourceog/compiler";
import { createDevRuntime, getClientRuntimeScript, type DevRuntime } from "@sourceog/dev";
import { createDebugPayload, HeuristicControlPlane, RuleBasedAdaptiveTuner } from "@sourceog/genbook";
import { loadRuntimeModule } from "@sourceog/platform/module-loader";
import { applySecurityPolicy, AutomationEngine, composeMiddleware, detectLocale, resolveConfig, type ResolvedSourceOGConfig } from "@sourceog/platform";
import { renderError, renderNotFound, renderRouteToCanonicalResult, renderRouteToFlightPayload, renderRouteToFlightStream, renderRouteToOfficialRscPayload, renderRouteToResponse, computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";
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
export interface SourceOGServerOptions {
  cwd: string;
  mode: "development" | "production";
  port?: number;
  portFallback?: boolean;
}

export interface SourceOGServerInstance {
  server: Server;
  config: ResolvedSourceOGConfig;
  manifest: RouteManifest;
  resolvedPort: number | null;
  start(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Creates and configures a SourceOG server instance.
 *
 * @param options - Configuration options for the server, including the current working directory, mode, and optional port settings.
 * @returns A promise that resolves to a SourceOGServerInstance containing the server, resolved configuration, route manifest, resolved port, and control methods.
 */
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
  const adosfTuner = new RuleBasedAdaptiveTuner();
  await adosfTuner.loadSnapshot(path.join(config.distRoot, "tuner-snapshot.json"));
  const adosfControlPlane = new HeuristicControlPlane(adosfTuner);
  const revalidatingPathnames = new Set<string>();
  let devRuntime: DevRuntime | undefined;
  let resolvedPort: number | null = null;

  setRevalidationHandler({
    async revalidatePath(pathname) {
      await invalidatePrerenderPath(config.distRoot, prerenderManifest, pathname);
      prerenderManifest = await loadPrerenderManifest(config.distRoot);
    },
    async revalidateTag(tag) {
      await invalidatePrerenderTag(config.distRoot, prerenderManifest, tag);
      prerenderManifest = await loadPrerenderManifest(config.distRoot);
    },
    async invalidateResource(resourceId) {
      if (resourceId.startsWith("route:")) {
        await invalidatePrerenderPath(config.distRoot, prerenderManifest, resourceId.slice("route:".length) || "/");
        prerenderManifest = await loadPrerenderManifest(config.distRoot);
      } else if (resourceId.startsWith("tag:")) {
        await invalidatePrerenderTag(config.distRoot, prerenderManifest, resourceId.slice("tag:".length));
        prerenderManifest = await loadPrerenderManifest(config.distRoot);
      }
    },
    async applyResolvedInvalidation(resolved) {
      prerenderManifest = await applyPrerenderInvalidation(config.distRoot, prerenderManifest, resolved, cacheManifest);
    }
  });

  const server = createServer(async (req, res) => {
    // RF-29: Assign unique x-request-id if not present in incoming request headers
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

    try {
      if (await handleAdosfDebugRequest(req, res, config, requestId)) {
        return;
      }

      if (await serveInternalAsset(req, res, config, requestId)) {
        return;
      }

      const baseUrl = `http://${req.headers.host ?? `localhost:${resolvedPort ?? resolvePreferredPort(config, options)}`}`;
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
      const rootMiddlewareFiles = getRootMiddlewareFiles(config);
      const appliedRootMiddleware = new Set(rootMiddlewareFiles);
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

        /**
         * Resolves the response for the current request by running middleware or route handler.
         * @returns {Promise<SourceOGResponse>} The response object generated by middleware or route handler.
         */
        const resolveResponse = async (): Promise<SourceOGResponse> => {
          if (handlerMatch) {
            return runMiddleware(
              filterMiddlewareFiles(handlerMatch.route.middlewareFiles, appliedRootMiddleware),
              context,
              async () => handleRouteHandler(handlerMatch.route.file, req, context)
            );
          }

          if (pageMatch) {
            const pageRenderStartedAt = Date.now();
            const pageDecision = await adosfControlPlane.decide(
              {
                id: pageMatch.route.id,
                pathname: pageMatch.route.pathname,
                kind: pageMatch.route.kind,
                capabilities: pageMatch.route.capabilities
              },
              {
                pathname: request.url.pathname,
                isAuthenticated: Boolean(request.cookies.get("session")),
                headers: Object.fromEntries(request.headers.entries())
              }
            );
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
              prerenderedResponse.headers.set("x-sourceog-control-strategy", pageDecision.strategy);
              prerenderedResponse.headers.set("x-sourceog-control-runtime", pageDecision.runtimeTarget);
              prerenderedResponse.headers.set("x-sourceog-control-fallback", pageDecision.fallbackLadder.join(","));
              adosfControlPlane.reportOutcome(pageMatch.route.id, {
                routeId: pageMatch.route.id,
                durationMs: Date.now() - pageRenderStartedAt,
                cacheHit: true
              });
              return prerenderedResponse;
            }

            const response = await runMiddleware(
              filterMiddlewareFiles(pageMatch.route.middlewareFiles, appliedRootMiddleware),
              context,
              async () =>
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
            response.headers.set("x-sourceog-control-strategy", pageDecision.strategy);
            response.headers.set("x-sourceog-control-runtime", pageDecision.runtimeTarget);
            response.headers.set("x-sourceog-control-fallback", pageDecision.fallbackLadder.join(","));
            adosfControlPlane.reportOutcome(pageMatch.route.id, {
              routeId: pageMatch.route.id,
              durationMs: Date.now() - pageRenderStartedAt,
              cacheHit: false
            });
            return response;
          }

          const notFoundFile = manifest.pages.find((route) => route.notFoundFile)?.notFoundFile;
          return renderNotFound(notFoundFile, context);
        };

        const response = rootMiddlewareFiles.length > 0
          ? await runMiddleware(rootMiddlewareFiles, context, resolveResponse)
          : await resolveResponse();
        response.headers.set("x-request-id", requestId);
        await finalizeResponse(config, automationEngine, request.url.pathname, request.method, response, res);
      });
    } catch (error) {
      const request = createNodeRequest(req, `http://${req.headers.host ?? `localhost:${resolvedPort ?? resolvePreferredPort(config, options)}`}`);
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
    get resolvedPort() {
      return resolvedPort;
    },
    async start() {
      const listenResult = await listenWithPortFallback(server, resolvePreferredPort(config, options), {
        fallbackEnabled: options.portFallback ?? true
      });
      resolvedPort = listenResult.port;
      logger.info("sourceog_server_started", {
        mode: options.mode,
        requestedPort: listenResult.requestedPort,
        port: listenResult.port,
        fallbackApplied: listenResult.fallbackApplied
      });
      return listenResult.port;
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

/**
 * Parses an unknown value and returns a valid port number candidate.
 *
 * @param value - The value to interpret as a port number.
 * @returns The port number if the value is a non-negative integer or a string representation thereof; otherwise undefined.
 */
function readPortCandidate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Determines the port number to use based on the configuration and server mode.
 *
 * @param config - The resolved source configuration, including app and runtime properties.
 * @param mode - The server mode ('development' or other) to select appropriate port candidates.
 * @returns The resolved port number if available; otherwise, undefined.
 */
function resolveConfiguredPort(
  config: ResolvedSourceOGConfig,
  mode: SourceOGServerOptions["mode"]
): number | undefined {
  const appConfig = (config.app ?? {}) as Record<string, unknown>;
  const runtimeConfig = (config.runtime ?? {}) as Record<string, unknown>;
  const candidates = mode === "development"
    ? [appConfig.devPort, appConfig.port, runtimeConfig.port]
    : [appConfig.startPort, appConfig.port, runtimeConfig.port];

  for (const candidate of candidates) {
    const port = readPortCandidate(candidate);
    if (port !== undefined) {
      return port;
    }
  }

  return undefined;
}

/**
 * Resolves the preferred port for the server.
 *
 * @param config - The resolved source OG configuration.
 * @param options - The server options containing mode and optional port override.
 * @returns The first available port from options.port, environment PORT, configured port, or default 3000.
 */
function resolvePreferredPort(config: ResolvedSourceOGConfig, options: SourceOGServerOptions): number {
  return options.port
    ?? readPortCandidate(process.env.PORT)
    ?? resolveConfiguredPort(config, options.mode)
    ?? 3000;
}

/**
 * Listens once on the specified server and port, then resolves with the listening port number.
 * @param server - The server instance to listen on.
 * @param port - The port number to listen on.
 * @returns A promise that resolves to the actual port number the server is listening on.
 */
async function listenOnce(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    /**
     * Rejects the promise when an error occurs before listening.
     * @param error - The error encountered.
     */
    const onError = (error) => {
      reject(error);
    };

    /**
     * Handles the server listening event by removing the error listener and resolving the promise.
     */
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    /**
     * Handles the server error event after listening starts by removing the listening listener and rejecting the promise.
     * @param error - The error encountered.
     */
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port);
  });

  const address = server.address();
  return address && typeof address === "object" ? address.port : port;
}

/**
 * Checks if a given port on the local machine is available by attempting to listen on it.
 * @param port - The port number to check availability for.
 * @returns A Promise that resolves to true if the port is available, or false if it's in use.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", () => {
      resolve(false);
    });
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}

/**
 * Listens on a preferred port with optional fallback to subsequent ports.
 * Attempts up to 25 times, incrementing the port if fallback is enabled and the port is unavailable.
 *
 * @param server - The server instance to listen on.
 * @param preferredPort - The initial port to attempt.
 * @param options - Configuration options for fallback behavior.
 * @param options.fallbackEnabled - Whether to enable port fallback when the preferred port is in use.
 * @returns A promise that resolves to an object containing:
 *   - port: The port number that was successfully listened on.
 *   - requestedPort: The original preferred port requested.
 *   - fallbackApplied: Whether the actual port differs from the preferred port.
 */
async function listenWithPortFallback(
  server: Server,
  preferredPort: number,
  options: { fallbackEnabled: boolean }
): Promise<{ port: number; requestedPort: number; fallbackApplied: boolean }> {
  let nextPort = preferredPort;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (nextPort !== 0) {
      const available = await isPortAvailable(nextPort);
      if (!available) {
        if (options.fallbackEnabled) {
          nextPort += 1;
          continue;
        }

        const conflict = new Error(
          `Port ${preferredPort} is already in use. Pass --port <port> or allow dynamic port fallback.`,
        ) as Error & { code?: string };
        conflict.code = "EADDRINUSE";
        throw conflict;
      }
    }

    const port = await listenOnce(server, nextPort);
    return {
      port,
      requestedPort: preferredPort,
      fallbackApplied: port !== preferredPort
    };
  }

  throw new Error(`Could not find an available port after probing from ${preferredPort}.`);
}

/**
 * Determines whether a request should be intercepted based on a specific header or query parameter.
 *
 * @param request - The request object created by createNodeRequest, containing headers and URL search parameters.
 * @returns A boolean indicating if interception is enabled (true) or not (false).
 */
function isInterceptRequest(request: ReturnType<typeof createNodeRequest>): boolean {
  const header = request.headers.get("x-sourceog-intercept");
  const query = request.url.searchParams.get("__sourceog_intercept");
  return header === "1" || header === "true" || query === "1" || query === "true";
}

/**
 * Resolves the locale and pathname for a given request based on the provided i18n configuration.
 *
 * @param request - The incoming request object created by createNodeRequest.
 * @param config - The resolved source OG configuration containing optional i18n settings.
 * @returns An object with the resolved pathname and optional locale.
 */
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

/**
 * Creates a dynamic href URL for flight requests.
 *
 * @param {string} pathname - The pathname to include in the flight URL.
 * @param {boolean} [intercepted=false] - Whether to add the intercepted flag to the query.
 * @returns {string} The constructed flight URL.
 */
function createDynamicFlightHref(pathname: string, intercepted = false): string {
  const query = new URLSearchParams({ pathname });
  if (intercepted) {
    query.set("intercept", "1");
  }
  return `/__sourceog/flight?${query.toString()}`;
}

/**
 * Determines whether the incoming request expects a Flight stream response by inspecting the Accept header.
 * @param request - The Node request object created by createNodeRequest.
 * @returns True if the Accept header includes "text/x-component", indicating a Flight stream response; otherwise false.
 */
/**
 * Determines if the flight stream response should be used based on the Accept header.
 *
 * @param request - The node request created by createNodeRequest.
 * @returns True if the Accept header includes "text/x-component", otherwise false.
 */
function wantsFlightStreamResponse(request: ReturnType<typeof createNodeRequest>): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/x-component");
}

/**
 * Enhances client asset references with a dynamic flight href based on pathname and interception state.
 *
 * @param clientAssets - The client asset references to augment.
 * @param pathname - The URL pathname for flight requests.
 * @param intercepted - Whether the pathname has been intercepted.
 * @returns The augmented client asset references with a dynamic flight href, or null if no assets.
 */
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

/**
 * Handles routing of incoming requests by loading the appropriate handler module.
 *
 * @param file - The file path to the handler module.
 * @param req - The incoming HTTP request message.
 * @param context - The handler context containing environment info.
 * @returns A Promise that resolves to a SourceOGResponse representing the response.
 */
async function handleRouteHandler(
  file: string,
  req: IncomingMessage,
  context: HandlerContext
): Promise<SourceOGResponse> {
  const module = await loadRuntimeModule<Record<string, (context: HandlerContext) => Promise<unknown> | unknown>>(file, {
    namespace: "handlers",
  });
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

/**
 * Processes server action requests for SourceOG actions.
 *
 * @param req - The Node.js incoming HTTP request.
 * @param res - The Node.js server response object.
 * @param request - The created Node request with parsed URL and headers.
 * @param actionManifest - The manifest containing action definitions.
 * @param cacheManifest - The manifest for caching configuration.
 * @param dataCacheStore - The filesystem cache store instance.
 * @param requestId - The unique identifier for the request.
 * @returns A Promise that resolves to a boolean indicating if the request was handled.
 */
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
  if (originHeader && originHeader !== serverOrigin) {
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
    const module = await loadRuntimeModule<Record<string, (...args: unknown[]) => Promise<unknown> | unknown>>(actionEntry.filePath, {
      namespace: "actions",
    });
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

    const routeId = decodeURIComponent(newFlightMatch[1] ?? '');
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

      /**
       * Pipes data from the flight stream reader to the HTTP response in chunks,
       * handling backpressure by waiting for 'drain' events when necessary.
       * Ends the response when the stream is done and handles errors by logging
       * and destroying the response.
       * @returns {Promise<void>} A promise that resolves when streaming completes.
       */
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
    const canonicalRouteId = pageMatch.canonicalRouteId;
    const resolvedRouteId = pageMatch.resolvedRouteId;
    const renderContextKey = pageMatch.renderContextKey;
    const flightPayload = await runWithRequestContext(context, async () =>
      renderRouteToOfficialRscPayload(pageMatch.route, context, {
        routeIdentity: pageMatch,
        parallelRoutes: pageMatch.parallelRoutes
      })
    );
    const response = new SourceOGResponse(Readable.from(flightPayload.chunks), {
      headers: {
        "content-type": "text/x-component",
        "cache-control": "no-store",
        "x-sourceog-route-id": pageMatch.route.id,
        "x-sourceog-canonical-route-id": canonicalRouteId,
        "x-sourceog-resolved-route-id": resolvedRouteId,
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

/**
 * Executes an array of middleware modules in sequence.
 * @param {string[]} middlewareFiles - Array of file paths to middleware modules.
 * @param {Parameters<Parameters<typeof composeMiddleware>[0][number]>[0]} context - Context object passed to each middleware.
 * @param {() => Promise<SourceOGResponse>} finalHandler - Final handler function to invoke after middleware completes.
 * @returns {Promise<SourceOGResponse>} The response object produced by the middleware chain.
 */
async function runMiddleware(
  middlewareFiles: string[],
  context: Parameters<Parameters<typeof composeMiddleware>[0][number]>[0],
  finalHandler: () => Promise<SourceOGResponse>
): Promise<SourceOGResponse> {
  const middleware = await Promise.all(middlewareFiles.map(async (file) => {
    const loaded = await loadRuntimeModule<{ default?: Parameters<typeof composeMiddleware>[0][number] }>(file, {
      namespace: "middleware",
    });
    return loaded.default;
  }));

  return composeMiddleware(
    middleware.filter((value): value is NonNullable<typeof value> => Boolean(value)),
    context,
    finalHandler
  );
}

/**
 * Retrieves available middleware files from the application root directory.
 * @param {ResolvedSourceOGConfig} config - The resolved configuration for the SourceOG server.
 * @returns {string[]} List of existing middleware file paths.
 */
function getRootMiddlewareFiles(config: ResolvedSourceOGConfig): string[] {
  const candidates = ["middleware.ts", "middleware.tsx", "middleware.js", "middleware.mjs", "middleware.cjs"];
  return candidates
    .map((candidate) => path.join(config.appRoot, candidate))
    .filter((candidate) => existsSync(candidate));
}

/**
 * Filters out middleware files that have already been applied.
 * @param {string[]} middlewareFiles - Array of middleware file paths to filter.
 * @param {Set<string>} alreadyApplied - Set of file paths that have been executed.
 * @returns {string[]} Array of file paths that have not yet been applied.
 */
function filterMiddlewareFiles(middlewareFiles: string[], alreadyApplied: Set<string>): string[] {
  return middlewareFiles.filter((file) => !alreadyApplied.has(file));
}

/**
 * Serves internal static assets if the request URL matches the internal path.
 * @param {IncomingMessage} req - Incoming HTTP request object.
 * @param {ServerResponse} res - HTTP response object used to send back the asset.
 /**
  * Filters middleware files based on the resolved server configuration and request identifier.
  *
  * @param {ResolvedSourceOGConfig} config - The resolved server configuration.
  * @param {string} requestId - Unique identifier for the request, set in the response header.
  * @returns {Promise<boolean>} True if an internal asset was served, otherwise false.
  */
 */
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

/**
 * Handles incoming ADOSF debug requests by serving debug artifacts.
 *
 * @param req - The incoming HTTP request.
 * @param res - The HTTP server response to send data to the client.
 * @param config - The resolved source OG configuration including distribution root paths.
 * @param requestId - The unique identifier for the request, included in response headers.
 * @returns Promise<boolean> - True if the request was a debug request and was handled; otherwise, false.
 */
async function handleAdosfDebugRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedSourceOGConfig,
  requestId: string
): Promise<boolean> {
  if (!req.url?.startsWith("/_adosf/debug/")) {
    return false;
  }

  const key = req.url.slice("/_adosf/debug/".length).split("?")[0] ?? "";
  const manifestPathByKey: Record<string, string> = {
    policy: path.join(config.distRoot, "control-plane-manifest.json"),
    graph: path.join(config.distRoot, "consistency-graph.json"),
    tuner: path.join(config.distRoot, "tuner-snapshot.json")
  };

  const targetPath = manifestPathByKey[key];
  if (!targetPath || !existsSync(targetPath)) {
    const response = json({ error: "ADOSF debug artifact not found", key }, { status: 404 });
    response.headers.set("x-request-id", requestId);
    await sendNodeResponse(res, response);
    return true;
  }

  const raw = await fs.readFile(targetPath, "utf8");
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const response = json(createDebugPayload({
    controlPlane: key === "policy" ? (payload as unknown) : undefined,
    consistencyGraph: key === "graph" ? (payload as unknown) : undefined,
    tuner: key === "tuner" ? (payload as unknown) : undefined
  }));
  response.headers.set("x-request-id", requestId);
  await sendNodeResponse(res, response);
  return true;
}

/**
 * Emits response hooks for each plugin in the provided configuration.
 * Calls each plugin's onResponse hook with the request pathname and status code.
 *
 * @param {ResolvedSourceOGConfig} config - The resolved configuration object containing plugins.
 * @param {string} pathname - The request pathname that triggered the response hooks.
 * @param {number} status - The HTTP status code of the response.
 * @returns {Promise<void>} A promise that resolves once all response hooks have been processed.
 */
async function emitResponseHooks(config: ResolvedSourceOGConfig, pathname: string, status: number): Promise<void> {
  for (const plugin of config.plugins ?? []) {
    await plugin.onResponse?.({ pathname, status });
  }
}

/**
 * Finalizes the HTTP response by applying the security policy, sending the response,
 * emitting response hooks, and dispatching a completion event to the automation engine.
 *
 * @param config - The resolved source OG configuration containing settings and security policies.
 * @param automationEngine - The automation engine used to dispatch lifecycle events.
 * @param pathname - The request pathname being handled.
 * @param method - The HTTP method of the request.
 * @param response - The SourceOG response object containing status and headers.
 * @param res - The server response object used to send data back to the client.
 * @returns A promise that resolves once the response finalization is complete.
 */
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

/**
 * Attempts to serve a prerendered page if available and valid. Checks for an existing prerendered entry,
 * verifies its freshness, and returns a static file response. If the entry is stale and not already
 * being revalidated, triggers regeneration and marks the pathname as revalidating.
 *
 * @param input.config - the resolved source OG configuration.
 * @param input.pageMatch - the route match information for the requested page.
 * @param input.context - the request handler context, including the incoming request.
 * @param input.logger - a logger instance for logging events during serving and regeneration.
 * @param input.prerenderManifest - the manifest containing prerendered page records.
 * @param input.clientManifest - the client build artifacts manifest for regeneration.
 * @param input.revalidatingPathnames - a set tracking pathnames currently being revalidated.
 * @param input.onManifestUpdated - callback invoked after the prerender manifest has been updated.
 * @returns a Promise that resolves to a SourceOGResponse for the static file or null if no prerendered page is served.
 */
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

/**
 * Determines if a prerendered entry is stale.
 *
 * @param {PrerenderManifestEntry} entry - The manifest entry to check for staleness.
 * @returns {boolean} True if the entry is stale and needs regeneration, false otherwise.
 */
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

/**
 * Creates a static file response with caching headers.
 *
 * @param {string} filePath - The path to the static file.
 * @param {"HIT"|"STALE"} cacheState - The cache state to include in the response headers.
 * @returns {SourceOGResponse} The response object for the static file.
 */
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

/**
 * Regenerates a prerendered entry based on the provided input.
 *
 * @param {Object} input - The input parameters for regeneration.
 * @param {ResolvedSourceOGConfig} input.config - The resolved configuration object.
 * @param {RouteMatch} input.routeMatch - The route match details.
 * @param {string} input.pathname - The pathname for the request.
 * @param {PrerenderManifestEntry} input.entry - The prerender manifest entry to regenerate.
 * @param {ClientBuildArtifacts} input.clientManifest - The client build artifacts.
 * @param {ReturnType<typeof createLogger>} input.logger - The logger instance.
 * @returns {Promise<void>} A promise that resolves when regeneration is complete.
 */
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
  const html = rendered.htmlShell ?? "";
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

/**
 * Loads the client manifest from the specified distribution root.
 *
 * @param distRoot - The root directory where the client manifest is located.
 * @returns A Promise that resolves to the ClientBuildArtifacts object.
 */
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

/**
 * Loads the action manifest from the given distribution root path.
 * @param distRoot - The path to the distribution root directory.
 * @returns A promise that resolves to the ActionManifest. If the manifest file is not found, returns a default manifest.
 */
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

/**
 * Loads the cache manifest from the given distribution root directory.
 * @param distRoot The root directory where the cache-manifest.json file is located.
 * @returns A Promise that resolves to the CacheManifest object loaded from the manifest file.
 *          If the file does not exist, returns a default CacheManifest object.
 */
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

/**
 * Loads the prerender manifest from the specified distribution root directory.
 * @param distRoot - The root directory of the distribution where the manifest is located.
 * @returns A Promise that resolves to the PrerenderManifest object.
 */
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

/**
 * Applies invalidation to prerendered entries based on resolved cache keys, route IDs, pathnames, and tags.
 * @param distRoot - The root directory of the distribution.
 * @param manifest - The current prerender manifest.
 * @param resolved - The resolved invalidation criteria including cacheKeys, routeIds, pathnames, and tags.
 * @param cacheManifest - The cache manifest containing entries to check for invalidation.
 * @returns A Promise that resolves to the updated PrerenderManifest.
 */
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

/**
 * Invalidates a specific prerendered path in the manifest.
 *
 * @param distRoot - The root directory where the prerender manifest is located.
 * @param manifest - The prerender manifest object containing prerendered entries.
 * @param pathname - The path to invalidate within the prerendered entries.
 * @returns A promise that resolves when the manifest file is updated.
 */
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

/**
 * Invalidates entries in the prerender manifest by tag and writes the updated manifest to disk.
 *
 * @param distRoot - The root directory where the distribution files are located.
 * @param manifest - The prerender manifest object containing entries to update.
 * @param tag - The tag used to select which prerender entries to invalidate.
 * @returns A Promise that resolves when the manifest has been written to disk.
 */
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

/**
 * Creates a FilesystemCacheStore for data caching in the specified distribution root directory.
 *
 * @param distRoot - The root directory where the cache folder will be created.
 * @returns A FilesystemCacheStore instance pointing to the data cache directory.
 */
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
  const deprecationProxy = 'Object.defineProperty(window.__SOURCEOG_CLIENT_CONTEXT__,"hydrationMode",{configurable:true,enumerable:false,get:function(){console.warn("hydrationMode is deprecated. Use renderMode instead.");return window.__SOURCEOG_CLIENT_CONTEXT__.renderMode==="client-root"?"full-route":"mixed-route";}});';
  return `<script>window.__SOURCEOG_CLIENT_CONTEXT__=${safeJson};${deprecationProxy}</script>`;
}

/**
 * Creates the runtime state for a request, bundling build ID, data cache store, and cache manifest.
 * @param buildId The identifier for the current build.
 * @param dataCacheStore The filesystem cache store used for data caching.
 * @param cacheManifest The cache manifest describing the caching configuration.
 * @returns An object containing buildId, dataCacheStore, and cacheManifest.
 */
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
