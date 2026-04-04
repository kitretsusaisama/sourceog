import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "@sourceog/platform";
import { mergeMetadata, renderMetadataToHead } from "@sourceog/platform";
import type { RouteDefinition } from "@sourceog/router";
import type {
  CanonicalRenderResult,
  ClientBoundaryDescriptor,
  ClientReferenceManifest,
  ClientReferenceRef,
  ClientRouteSnapshot,
  FlightManifestRefs,
  FlightRenderSegment,
  FlightRenderTreeNode,
  RouteRenderIdentity,
  RouteRenderMode,
  SourceOGRequestContext,
  SourceOGResponse,
} from "@sourceog/runtime";
import { SourceOGError, SOURCEOG_ERROR_CODES, html } from "@sourceog/runtime";
import { renderRouteToOfficialRscPayload } from "./rsc.js";
import { loadModule } from "./transpiler/transpiler-core.js";

export interface DocumentClientAssets {
  runtimeHref: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  sharedChunkHrefs?: string[];
  preloadHrefs?: string[];
  renderMode?: RouteRenderMode;
  hydrationMode?: "none" | "full-route" | "mixed-route";
  boundaryRefs?: ClientBoundaryDescriptor[];
  clientReferenceRefs?: ClientReferenceRef[];
  actionEntries?: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

export interface RouteRenderIdentityInput extends RouteRenderIdentity {}

export interface FlightHtmlRenderResult {
  bodyHtml: string;
  shellMode: "document" | "fragment";
}

export interface RenderRouteResult extends CanonicalRenderResult {
  htmlShell: string;
  renderTimeMs: number;
}

interface RouteModuleLike {
  default?: React.ComponentType<unknown>;
  metadata?: Metadata;
  generateMetadata?: (context: SourceOGRequestContext) => Promise<Metadata> | Metadata;
}

/**
 * Dynamically imports a module from the specified file path, applying inline transforms for TS, TSX, and JSX files if needed.
 * @param filePath The file path of the module to import.
 * @returns A Promise resolving to the imported module of type T.
 */
function importModule<T>(filePath: string): Promise<T> {
  const useInlineTransform = filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  return loadModule(pathToFileURL(filePath).href, useInlineTransform) as Promise<T>;
}

/**
 * Loads the modules for a given route including page, layout, and template modules and merges their metadata.
 * @param route The route definition to load modules for.
 * @param context The request context for generating metadata.
 * @returns An object containing the loaded pageModule, layoutModules, optional templateModule, and merged metadata.
 */
async function loadRouteModules(
  route: RouteDefinition,
  context: SourceOGRequestContext,
): Promise<{
  pageModule: RouteModuleLike;
  layoutModules: RouteModuleLike[];
  templateModule?: RouteModuleLike;
  metadata: Metadata;
}> {
  const pageModule = await importModule<RouteModuleLike>(route.file);
  const layoutModules = await Promise.all(route.layouts.map((layout) => importModule<RouteModuleLike>(layout)));
  const templateModule = route.templateFile
    ? await importModule<RouteModuleLike>(route.templateFile)
    : undefined;

  const metadataParts: Array<Metadata | undefined> = [];
  for (const mod of [...layoutModules, templateModule, pageModule]) {
    if (!mod) {
      continue;
    }
    if (typeof mod.generateMetadata === "function") {
      metadataParts.push(await mod.generateMetadata(context));
    } else {
      metadataParts.push(mod.metadata);
    }
  }

  return {
    pageModule,
    layoutModules,
    templateModule,
    metadata: mergeMetadata(...metadataParts),
  };
}

/**
 * Builds the render tree and collects render segments for a given route.
 * @param route The route definition to build the render tree for.
 * @returns An object containing the renderedSegments array and the server-side render tree root node.
 */
function buildRenderTree(route: RouteDefinition): {
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
} {
  const renderedSegments: FlightRenderSegment[] = [];
  const root: FlightRenderTreeNode = {
    id: `render-tree:${route.id}`,
    kind: "root",
    routeId: route.id,
    pathname: route.pathname,
    segmentKey: "root",
    boundaryIds: [],
    children: [],
  };

  let cursor = root;
  route.layouts.forEach((layoutFile, index) => {
    renderedSegments.push({
      kind: "layout",
      routeId: route.id,
      filePath: layoutFile,
      pathname: route.pathname,
      segmentKey: `layout:${index}`,
    });
    const layoutNode: FlightRenderTreeNode = {
      id: `layout:${route.id}:${index}`,
      kind: "layout",
      routeId: route.id,
      pathname: route.pathname,
      filePath: layoutFile,
      segmentKey: `layout:${index}`,
      boundaryIds: [],
      children: [],
    };
    cursor.children.push(layoutNode);
    cursor = layoutNode;
  });

  if (route.templateFile) {
    renderedSegments.push({
      kind: "template",
      routeId: route.id,
      filePath: route.templateFile,
      pathname: route.pathname,
      segmentKey: "template",
    });
    const templateNode: FlightRenderTreeNode = {
      id: `template:${route.id}`,
      kind: "template",
      routeId: route.id,
      pathname: route.pathname,
      filePath: route.templateFile,
      segmentKey: "template",
      boundaryIds: [],
      children: [],
    };
    cursor.children.push(templateNode);
    cursor = templateNode;
  }

  renderedSegments.push({
    kind: "page",
    routeId: route.id,
    filePath: route.file,
    pathname: route.pathname,
    segmentKey: "page",
  });
  cursor.children.push({
    id: `page:${route.id}`,
    kind: "page",
    routeId: route.id,
    pathname: route.pathname,
    filePath: route.file,
    segmentKey: "page",
    boundaryIds: [],
    children: [],
  });

  return { renderedSegments, serverTree: root };
}

/**
 * Recursively attaches boundary IDs to each node of a flight render tree.
 *
 * @param tree - The current FlightRenderTreeNode to process.
 * @param boundaryRefs - Array of ClientBoundaryDescriptor providing boundary IDs.
 * @returns Updated FlightRenderTreeNode with boundaryIds assigned.
 */
function attachBoundaryIds(
  tree: FlightRenderTreeNode,
  boundaryRefs: ClientBoundaryDescriptor[],
): FlightRenderTreeNode {
  const nextChildren = tree.children.map((child) => attachBoundaryIds(child, boundaryRefs));
  const nextBoundaryIds =
    tree.kind === "page" || tree.kind === "parallel-page"
      ? boundaryRefs.filter((boundary) => boundary.routeId === tree.routeId).map((boundary) => boundary.boundaryId)
      : tree.boundaryIds;
  return {
    ...tree,
    boundaryIds: nextBoundaryIds,
    children: nextChildren,
  };
}

/**
 * Builds a React element tree by applying the page component, optional template component,
 * and a series of layout components in reverse order.
 *
 * @param route - The route definition for which the element tree is built.
 * @param modules - An object containing the page module, an array of layout modules,
 *   and an optional template module.
 * @param context - The request context providing params and query data.
 * @param parallelSlotElements - Optional mapping of parallel slot names to React elements
 *   to be included in layout components.
 * @returns The constructed React.ReactElement representing the assembled component tree.
 */
function buildElementTree(
  route: RouteDefinition,
  modules: {
    pageModule: RouteModuleLike;
    layoutModules: RouteModuleLike[];
    templateModule?: RouteModuleLike;
  },
  context: SourceOGRequestContext,
  parallelSlotElements?: Record<string, React.ReactElement>,
): React.ReactElement {
  const Page = modules.pageModule.default ?? (() => React.createElement("div", null, `Route ${route.id}`));
  let element = React.createElement(Page, {
    params: context.params,
    query: context.query,
  });

  if (modules.templateModule?.default) {
    const Template = modules.templateModule.default;
    element = React.createElement(Template, {
      children: element,
      params: context.params,
      query: context.query,
    });
  }

  for (const layout of [...modules.layoutModules].reverse()) {
    if (!layout.default) {
      continue;
    }
    const Layout = layout.default;
    element = React.createElement(Layout, {
      children: element,
      params: context.params,
      query: context.query,
      ...parallelSlotElements,
    });
  }

  return element;
}

/**
 * Resolves the appropriate render mode for a route based on client assets settings.
 *
 * @param clientAssets - Optional document client assets containing renderMode and hydrationMode.
 * @returns The determined route render mode, either from clientAssets.renderMode or derived from hydrationMode.
 */
function resolveRenderMode(clientAssets?: DocumentClientAssets): RouteRenderMode {
  return clientAssets?.renderMode
    ?? (clientAssets?.hydrationMode === "full-route" ? "client-root" : "server-components");
}

/**
 * Computes a canonical route ID based on the route pattern and parameters.
 *
 * @param routePattern - The route pattern string.
 * @param params - A record of parameter names to their values.
 * @returns The first 12 characters of the SHA-256 hash of the route pattern and sorted parameters.
 */
export function computeCanonicalRouteId(
  routePattern: string,
  params: Record<string, string>,
): string {
  const stableParams = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((accumulator, key) => {
      accumulator[key] = params[key] ?? '';
      return accumulator;
    }, {});
  return createHash("sha256")
    .update(routePattern + JSON.stringify(stableParams))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Computes a unique render context key for a given route, slot, and interception status.
 *
 * @param canonicalRouteId - The canonical identifier for the route.
 * @param slotId - The identifier for the slot.
 * @param intercepted - A boolean indicating if the route is intercepted.
 * @returns A 16-character hexadecimal string representing the render context key.
 */
export function computeRenderContextKey(
  canonicalRouteId: string,
  slotId: string,
  intercepted: boolean,
): string {
  return createHash("sha256")
    .update(canonicalRouteId + slotId + String(intercepted))
    .digest("hex")
    .slice(0, 16);
}

/code/438951ed-cb87-42ed-836d-bdeb3a3ed217/new_code/packages/sourceog-renderer/src/render.ts

/**
 * Creates flight manifest references based on the provided client assets.
 *
 * @param clientAssets - Optional document client assets containing various hrefs and entries.
 * @returns FlightManifestRefs object containing runtime, route, metadata, entry, shared chunk, boundary asset hrefs, and action IDs.
 */
function createFlightManifestRefs(clientAssets?: DocumentClientAssets): FlightManifestRefs {
  return {
    runtimeHref: clientAssets?.runtimeHref,
    routeAssetHref: clientAssets?.routeAssetHref,
    metadataHref: clientAssets?.metadataHref,
    entryAssetHref: clientAssets?.entryAssetHref,
    sharedChunkHrefs: clientAssets?.sharedChunkHrefs ?? [],
    boundaryAssetHrefs: (clientAssets?.boundaryRefs ?? [])
      .map((boundaryRef) => boundaryRef.assetHref)
      .filter((value): value is string => Boolean(value)),
    actionIds: (clientAssets?.actionEntries ?? []).map((entry) => entry.actionId),
  };
}

/**
 * Escapes special characters in a string for safe use in HTML attributes.
 *
 * @param value The string to escape.
 * @returns The escaped string with HTML entities for &, \", and >.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll(">", "&gt;");
}

/**
 * Escapes special sequences in script content to prevent closing tags or comment injections.
 *
 * @param value - The script content string to escape.
 * @returns The escaped script content string.
 */
export function escapeScriptContent(value: string): string {
  return value
    .replaceAll("</", "<\\/")
    .replaceAll("<!--", "<\\!--")
    .replaceAll("-->", "--\\>");
}

/**
 * Creates a snapshot of the client route based on the rendered result and optional client assets.
 *
 * @param rendered - The rendered result containing route and render details.
 * @param clientAssets - Optional client-specific assets like hrefs and hydration mode.
 * @returns The client route snapshot including HTML, assets, metadata, and render context.
 */
function createClientRouteSnapshot(
  rendered: CanonicalRenderResult,
  clientAssets?: DocumentClientAssets,
): ClientRouteSnapshot {
  return {
    version: "2027.1",
    routeId: rendered.routeId,
    pathname: rendered.pathname,
    canonicalRouteId: rendered.canonicalRouteId,
    resolvedRouteId: rendered.resolvedRouteId,
    renderContextKey: rendered.renderContextKey,
    renderContext: rendered.renderContext,
    intercepted: rendered.intercepted,
    parallelRouteMap: rendered.parallelRouteMap,
    headHtml: rendered.headHtml,
    bodyHtml: rendered.bodyHtml,
    shellHtmlStart: rendered.shellHtmlStart,
    shellHtmlEnd: rendered.shellHtmlEnd,
    shellMode: rendered.shellMode,
    rscPayloadFormat: rendered.rscPayloadFormat,
    rscPayloadChunks: rendered.rscPayloadChunks,
    renderedSegments: rendered.renderedSegments,
    serverTree: rendered.serverTree,
    renderMode: rendered.renderMode,
    hydrationMode: clientAssets?.hydrationMode ?? (rendered.renderMode === "client-root" ? "full-route" : "mixed-route"),
    runtimeHref: clientAssets?.runtimeHref,
    routeAssetHref: clientAssets?.routeAssetHref,
    metadataHref: clientAssets?.metadataHref,
    entryAssetHref: clientAssets?.entryAssetHref,
    clientReferenceManifestUrl: clientAssets?.clientReferenceManifestUrl ?? "/__sourceog/client-refs.json",
    flightHref: clientAssets?.flightHref,
    flightManifestRefs: rendered.flightManifestRefs,
    boundaryRefs: rendered.boundaryRefs,
    clientReferenceRefs: rendered.clientReferenceRefs,
    sharedChunkHrefs: clientAssets?.sharedChunkHrefs ?? [],
    preloadHrefs: clientAssets?.preloadHrefs ?? [],
    actionEntries: rendered.actionEntries,
  };
}

/**
 * Renders HTML link tags for preloading client assets.
 *
 * @param clientAssets - The client assets to render links for.
 * @returns A string containing HTML link tags for modulepreload and fetch preloads.
 */
function renderClientAssetHead(clientAssets?: DocumentClientAssets): string {
  if (!clientAssets) {
    return "";
  }

  const modulePreloads = new Set<string>([clientAssets.runtimeHref]);
  const fetchPreloads = new Set<string>();

  if (clientAssets.routeAssetHref) {
    modulePreloads.add(clientAssets.routeAssetHref);
  }
  if (clientAssets.entryAssetHref) {
    modulePreloads.add(clientAssets.entryAssetHref);
  }
  for (const href of clientAssets.sharedChunkHrefs ?? []) {
    modulePreloads.add(href);
  }
  for (const boundaryRef of clientAssets.boundaryRefs ?? []) {
    if (boundaryRef.assetHref) {
      modulePreloads.add(boundaryRef.assetHref);
    }
  }
  for (const href of clientAssets.preloadHrefs ?? []) {
    if (href.endsWith(".json") || href.includes("/flight")) {
      fetchPreloads.add(href);
    } else {
      modulePreloads.add(href);
    }
  }
  if (clientAssets.metadataHref) {
    fetchPreloads.add(clientAssets.metadataHref);
  }
  if (clientAssets.flightHref) {
    fetchPreloads.add(clientAssets.flightHref);
  }
  if (clientAssets.clientReferenceManifestUrl) {
    fetchPreloads.add(clientAssets.clientReferenceManifestUrl);
  }

  return [
    ...[...modulePreloads].map((href) => `<link rel="modulepreload" href="${escapeHtmlAttr(href)}" />`),
    ...[...fetchPreloads].map((href) => `<link rel="preload" as="fetch" href="${escapeHtmlAttr(href)}" crossorigin="anonymous" />`),
  ].join("");
}

/**
 * Renders a script tag to initialize the client context for hydration.
 *
 * @param rendered - The canonical render result containing route and render information.
 * @param clientAssets - Optional document client assets used to create the client context; if not provided, the function returns an empty string.
 * @returns A string containing a script tag that sets window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__, window.__SOURCEOG_LAST_RENDER_SNAPSHOT__, and window.__SOURCEOG_CLIENT_CONTEXT__; or an empty string if clientAssets is not provided.
 */
function renderClientContextScript(rendered: CanonicalRenderResult, clientAssets?: DocumentClientAssets): string {
  if (!clientAssets) {
    return "";
  }

  const snapshot = createClientRouteSnapshot(rendered, clientAssets);
  const clientContext = {
    routeId: snapshot.routeId,
    pathname: snapshot.pathname,
    canonicalRouteId: snapshot.canonicalRouteId,
    resolvedRouteId: snapshot.resolvedRouteId,
    renderContextKey: snapshot.renderContextKey,
    renderContext: snapshot.renderContext,
    intercepted: snapshot.intercepted,
    parallelRouteMap: snapshot.parallelRouteMap,
    hydrationMode: snapshot.hydrationMode,
    renderMode: snapshot.renderMode,
    shellMode: snapshot.shellMode,
    rscPayloadFormat: snapshot.rscPayloadFormat,
    rscPayloadChunks: snapshot.rscPayloadChunks,
    runtimeHref: snapshot.runtimeHref,
    routeAssetHref: snapshot.routeAssetHref,
    metadataHref: snapshot.metadataHref,
    entryAssetHref: snapshot.entryAssetHref,
    clientReferenceManifestUrl: snapshot.clientReferenceManifestUrl,
    flightHref: snapshot.flightHref,
    boundaryRefs: snapshot.boundaryRefs,
    clientReferenceRefs: snapshot.clientReferenceRefs,
    renderedSegments: snapshot.renderedSegments,
    serverTree: snapshot.serverTree,
    flightManifestRefs: snapshot.flightManifestRefs,
    sharedChunkHrefs: snapshot.sharedChunkHrefs,
    preloadHrefs: snapshot.preloadHrefs,
    actionEntries: snapshot.actionEntries,
  };

  return `<script>window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__=${escapeScriptContent(JSON.stringify(snapshot))};window.__SOURCEOG_LAST_RENDER_SNAPSHOT__=window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__;window.__SOURCEOG_CLIENT_CONTEXT__=${escapeScriptContent(JSON.stringify(clientContext))};${rendered.routeId ? `document.documentElement.dataset.sourceogRoute=${JSON.stringify(rendered.routeId)};` : ""}</script>`;
}

export /**
 * Creates the full HTML document string for SSR output.
 *
 * @param {CanonicalRenderResult} rendered - The result of server-side rendering containing HTML parts and payloads.
 * @param {string} [locale] - Optional locale for setting the lang attribute in the HTML tag.
 * @param {Object} [options] - Optional settings including client assets.
 * @param {DocumentClientAssets} [options.clientAssets] - Client assets for including scripts and styles.
 * @returns {string} The complete HTML string of the document.
 */ function createDocumentHtml(
  rendered: CanonicalRenderResult,
  locale?: string,
  options?: {
    clientAssets?: DocumentClientAssets;
  },
): string {
  const headMarkup = `${rendered.headHtml}${renderClientAssetHead(options?.clientAssets)}`;
  const bodyScripts = [
    ...rendered.rscPayloadChunks.map((chunk) => `<script type="text/x-component">${escapeScriptContent(chunk)}</script>`),
    '<script>window.__SOURCEOG_RSC_READY__=true;</script>',
    renderClientContextScript(rendered, options?.clientAssets),
    options?.clientAssets
      ? `<script type="module" src="${escapeHtmlAttr(options.clientAssets.runtimeHref)}"></script>`
      : '<script type="module" src="/__sourceog/client.js"></script>',
  ].join("");

  if (rendered.shellMode === "document") {
    let body = rendered.bodyHtml;
    if (body.includes("<head>")) {
      body = body.replace("<head>", `<head>${headMarkup}`);
    } else if (body.includes("<body")) {
      body = body.replace(/<body([^>]*)>/, `<head>${headMarkup}</head><body$1>`);
    } else {
      body = `<html><head>${headMarkup}</head><body>${body}</body></html>`;
    }

    if (body.includes("<body")) {
      body = body.replace(/<body([^>]*)>/, '<body$1><div id="sourceog-root">');
    }

    if (body.includes("</body>")) {
      body = body.replace("</body>", `</div>${bodyScripts}</body>`);
    } else {
      body = `${body}</div>${bodyScripts}`;
    }

    return body.startsWith("<!DOCTYPE html>") ? body : `<!DOCTYPE html>${body}`;
  }

  return `<!DOCTYPE html><html lang="${escapeHtmlAttr(locale ?? "en")}"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${headMarkup}</head><body><div id="sourceog-root">${rendered.bodyHtml}</div>${bodyScripts}</body></html>`;
}

export /**
 * Renders the specified route to a canonical render result.
 *
 * @param {RouteDefinition} route - The definition of the route to render.
 * @param {SourceOGRequestContext} context - The request context containing params and query.
 * @param {RenderRouteOptions & { pathname?: string; clientAssets?: DocumentClientAssets; clientReferenceManifest?: ClientReferenceManifest; clientReferenceDistRoot?: string; routeIdentity?: RouteRenderIdentityInput; }} [options] - Options for rendering including client assets and route identity.
 * @param {string} [options.pathname] - Optional pathname to use during rendering.
 * @param {DocumentClientAssets} [options.clientAssets] - Optional client assets for including in rendering.
 * @param {ClientReferenceManifest} [options.clientReferenceManifest] - Optional manifest for client references.
 * @param {string} [options.clientReferenceDistRoot] - Optional root path for client reference distribution.
 * @param {RouteRenderIdentityInput} [options.routeIdentity] - Optional identity input for route rendering.
 * @returns {Promise<RenderRouteResult>} A promise that resolves to the render result.
 */ async function renderRouteToCanonicalResult(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions & {
    pathname?: string;
    clientAssets?: DocumentClientAssets;
    clientReferenceManifest?: ClientReferenceManifest;
    clientReferenceDistRoot?: string;
    routeIdentity?: RouteRenderIdentityInput;
  } = {},
): Promise<RenderRouteResult> {
  const renderStartedAt = Date.now();
  const modules = await loadRouteModules(route, context);

  // Render parallel slot pages and collect their elements as named props
  const parallelSlotElements: Record<string, React.ReactElement> = {};
  const parallelRoutes = (options as RenderRouteOptions).parallelRoutes ?? {};
  for (const [slotName, slotRoute] of Object.entries(parallelRoutes)) {
    const slotModules = await loadRouteModules(slotRoute, context);
    const SlotPage = slotModules.pageModule.default;
    if (SlotPage) {
      parallelSlotElements[slotName] = React.createElement(SlotPage, {
        params: context.params,
        query: context.query,
      });
    }
  }
  const element = buildElementTree(route, modules, context, parallelSlotElements);
  const bodyHtml = renderToStaticMarkup(element);
  const { renderedSegments, serverTree } = buildRenderTree(route);
  const rscPayload = await renderRouteToOfficialRscPayload(route, context, options);

  const resolvedRouteId = options.routeIdentity?.resolvedRouteId ?? route.id;
  const canonicalRouteId = options.routeIdentity?.canonicalRouteId
    ?? computeCanonicalRouteId(route.pathname, Object.fromEntries(Object.entries(context.params).map(([key, value]) => [key, Array.isArray(value) ? value.join("/") : value])));
  const intercepted = options.routeIdentity?.intercepted ?? false;
  const renderContext = options.routeIdentity?.renderContext ?? (intercepted ? "intercepted" : "canonical");
  const renderContextKey = options.routeIdentity?.renderContextKey ?? computeRenderContextKey(canonicalRouteId, route.slotName ?? "", intercepted);
  const boundaryRefs = options.clientAssets?.boundaryRefs ?? [];

  const result: CanonicalRenderResult = {
    routeId: route.id,
    pathname: options.pathname ?? route.pathname,
    canonicalRouteId,
    resolvedRouteId,
    renderContextKey,
    renderContext,
    intercepted,
    parallelRouteMap: options.routeIdentity?.parallelRouteMap ?? {},
    renderMode: resolveRenderMode(options.clientAssets),
    headHtml: renderMetadataToHead(modules.metadata),
    shellHtmlStart: bodyHtml.startsWith("<html") ? "<html><body>" : '<div id="sourceog-root">',
    shellHtmlEnd: bodyHtml.startsWith("<html") ? "</body></html>" : '</div>',
    shellMode: bodyHtml.startsWith("<html") ? "document" : "fragment",
    bodyHtml,
    rscPayloadFormat: rscPayload.format,
    rscPayloadChunks: [...rscPayload.chunks],
    renderedSegments,
    serverTree: attachBoundaryIds(serverTree, boundaryRefs),
    boundaryRefs,
    clientReferenceRefs: options.clientAssets?.clientReferenceRefs ?? [],
    flightManifestRefs: createFlightManifestRefs(options.clientAssets),
    actionEntries: options.clientAssets?.actionEntries ?? [],
  };

  return {
    ...result,
    htmlShell: createDocumentHtml(result, context.locale, { clientAssets: options.clientAssets }),
    renderTimeMs: Date.now() - renderStartedAt,
  };
}

/**
 * Renders a route to a Flight payload.
 *
 * @param route - The route definition to render.
 * @param context - The request context for rendering.
 * @param options - Optional rendering options.
 * @returns A promise that resolves to a client route snapshot.
 */
export async function renderRouteToFlightPayload(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<ClientRouteSnapshot> {
  const normalizedOptions = options as Parameters<typeof renderRouteToCanonicalResult>[2];
  const rendered = await renderRouteToCanonicalResult(route, context, normalizedOptions);
  return createClientRouteSnapshot(rendered, normalizedOptions?.clientAssets);
}

/**
 * Creates two identical ReadableStream duplicates from an existing stream.
 *
 * @param stream The ReadableStream<Uint8Array> to duplicate.
 * @returns An array containing two ReadableStream<Uint8Array> instances that read the same data.
 */
export function teeReadableStream(
  stream: ReadableStream<Uint8Array>,
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  return stream.tee();
}

/**
 * Renders the given route as a flight stream.
 *
 * @param route The route definition to render.
 * @param context The source request context for rendering.
 * @param options Rendering options to customize the flight stream.
 * @returns A ReadableStream that emits Uint8Array chunks of the rendered route.
 */
export async function renderRouteToFlightStream(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const payload = await renderRouteToOfficialRscPayload(route, context, options);
  const encoder = new TextEncoder();
  const chunks = [...payload.chunks];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk.endsWith("\n") ? chunk : `${chunk}\n`));
      }
      controller.close();
    },
  });
}

/**
 * Renders a route to a HTTP response by generating the canonical result and wrapping it in an HTML response.
 *
 * @param route The definition of the route to render.
 * @param context The Source OG request context used during rendering.
 * @param options Additional rendering options, including pathname, client assets, and route identity.
 * @returns A promise that resolves to a Source OG formatted HTTP response.
 */
export async function renderRouteToResponse(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions & {
    pathname?: string;
    clientAssets?: DocumentClientAssets;
    routeIdentity?: RouteRenderIdentityInput;
  } = {},
): Promise<SourceOGResponse> {
  const rendered = await renderRouteToCanonicalResult(route, context, options as Parameters<typeof renderRouteToCanonicalResult>[2]);
  return html(rendered.htmlShell, {
    status: 200,
    headers: {
      "x-sourceog-render-mode": "flight-derived",
      "x-sourceog-render-runtime": rendered.renderMode,
      "x-sourceog-rsc-payload-format": rendered.rscPayloadFormat,
    },
  });
}

/**
 * Renders an error page for SourceOG requests.
 *
 * @param _errorFile - The path to an optional error file (unused).
 * @param context - The OG request context containing request details.
 * @param error - The Error object containing the error message.
 * @returns A SourceOGResponse containing the HTML for the error page with status code 500.
 */
export async function renderError(
  _errorFile: string | undefined,
  context: SourceOGRequestContext,
  error: Error,
): Promise<SourceOGResponse> {
  return html(
    `<!DOCTYPE html><html><head><title>SourceOG Error</title></head><body><h1>Render Error</h1><pre>${escapeHtmlAttr(error.message)}</pre><p>${escapeHtmlAttr(context.request.url.pathname)}</p></body></html>`,
    { status: 500 },
  );
}
/**
 * Generates a 404 Not Found response with an HTML page displaying the requested path.
 *
 * @param _notFoundFile - Optional path to a custom Not Found file (currently unused).
 * @param context - The source OG request context.
 * @returns A Promise resolving to a SourceOGResponse containing the HTML content and 404 status.
 */
export async function renderNotFound(
  _notFoundFile: string | undefined,
  context: SourceOGRequestContext,
): Promise<SourceOGResponse> {
  return html(
    `<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>Not Found</h1><p>${escapeHtmlAttr(context.request.url.pathname)}</p></body></html>`,
    { status: 404 },
  );
}

/**
 * Streams a server components response for testing.
 * @param rendered The canonical render result to convert to HTML.
 * @param clientAssets Optional document client assets for rendering.
 * @returns A PassThrough stream containing the rendered HTML document.
 */
export async function streamServerComponentsResponseForTest(
  rendered: CanonicalRenderResult,
  clientAssets?: DocumentClientAssets,
): Promise<PassThrough> {
  const stream = new PassThrough();
  stream.write(createDocumentHtml(rendered, "en", { clientAssets }));
  stream.end();
  return stream;
}

export const renderRoute = renderRouteToResponse;

/**
 * Converts a web ReadableStream of Uint8Array into a Node.js Readable stream.
 *
 * @param stream - The web ReadableStream of Uint8Array data.
 * @returns A Node.js Readable stream representing the provided web stream.
 */
export function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream);
}

/**
 * Creates a SourceOGError representing a render failure.
 * @param message The error message describing the failure.
 * @param details Optional additional context or details about the error.
 * @returns A SourceOGError with the RENDER_FAILED error code.
 */
export function createRenderFailure(message: string, details?: Record<string, unknown>): SourceOGError {
  return new SourceOGError(SOURCEOG_ERROR_CODES.RENDER_FAILED, message, details);
}
