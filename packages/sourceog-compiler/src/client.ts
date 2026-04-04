import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { build as bundleClientEntry } from "esbuild";
import type { ResolvedSourceOGConfig } from "@sourceog/platform";
import type { RouteManifest } from "@sourceog/router";
import {
  SOURCEOG_MANIFEST_VERSION,
  type ActionManifest,
  type ActionManifestEntry,
  type ClientBoundaryDescriptor,
  type ClientReferenceManifest,
  type ClientReferenceRef,
  type RouteRenderMode
} from "@sourceog/runtime";
import { getClientRuntimeScript } from "@sourceog/dev";
import { createSourceOGWorkspaceResolverPlugin } from "./workspace-resolver.js";

export interface ClientSharedChunkEntry {
  chunkId: string;
  importFiles: string[];
  routeIds: string[];
  outputAsset: string;
}

export interface ClientRouteEntry {
  routeId: string;
  pathname: string;
  sourceFile: string;
  generatedEntryFile?: string;
  outputAsset: string;
  metadataAsset: string;
  browserEntryAsset?: string;
  imports: string[];
  routeChunkIds: string[];
  sharedChunkIds: string[];
  preloadAssets: string[];
  ownershipHash: string;
  chunkName: string;
  hydrationMode: "none" | "full-route" | "mixed-route";
  renderMode: RouteRenderMode;
  hasClientBoundaries: boolean;
  clientBoundaryFiles: string[];
  clientBoundaryModuleIds: string[];
  clientReferenceRefs: ClientReferenceRef[];
  boundaryRefs: ClientBoundaryDescriptor[];
  actionIds: string[];
  actionEntries: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

export interface ClientBuildArtifacts {
  version: string;
  buildId?: string;
  generatedAt: string;
  runtimeAsset: string;
  routeEntries: ClientRouteEntry[];
  sharedChunks: ClientSharedChunkEntry[];
}

export interface RouteClientAssetReferences {
  runtimeHref: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  sharedChunkHrefs: string[];
  preloadHrefs: string[];
  hydrationMode: ClientRouteEntry["hydrationMode"];
  renderMode: ClientRouteEntry["renderMode"];
  clientReferenceRefs?: ClientReferenceRef[];
  clientBoundaryModuleIds?: string[];
  boundaryRefs?: ClientBoundaryDescriptor[];
  actionEntries?: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

export async function writeClientArtifacts(
  config: ResolvedSourceOGConfig,
  manifest: RouteManifest,
  options?: {
    clientReferenceManifest?: ClientReferenceManifest;
    actionManifest?: ActionManifest;
  }
): Promise<ClientBuildArtifacts> {
  const runtimeDir = path.join(config.distRoot, "static", "__sourceog");
  const generatedDir = path.join(config.distRoot, "generated", "client");
  const boundaryGeneratedDir = path.join(generatedDir, "boundaries");
  const runtimeGeneratedFile = path.join(generatedDir, "sourceog-runtime.ts");
  const routeAssetDir = path.join(runtimeDir, "routes");
  const metadataDir = path.join(runtimeDir, "metadata");
  const entryAssetDir = path.join(runtimeDir, "entries");
  const boundaryAssetDir = path.join(runtimeDir, "boundaries");
  const sharedChunkDir = path.join(runtimeDir, "chunks");
  const routeEntries: ClientRouteEntry[] = [];
  const clientReferencesByRoute = createClientReferencesByRoute(options?.clientReferenceManifest);
  const actionEntriesByRoute = createActionEntriesByRoute(options?.actionManifest);

  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(boundaryGeneratedDir, { recursive: true });
  await fs.mkdir(routeAssetDir, { recursive: true });
  await fs.mkdir(metadataDir, { recursive: true });
  await fs.mkdir(entryAssetDir, { recursive: true });
  await fs.mkdir(boundaryAssetDir, { recursive: true });
  await fs.mkdir(sharedChunkDir, { recursive: true });

  const runtimeAssetPath = path.join(runtimeDir, "client.js");
  await fs.writeFile(runtimeGeneratedFile, getClientRuntimeScript(), "utf8");
  await bundleClientEntry({
    entryPoints: [runtimeGeneratedFile],
    outfile: runtimeAssetPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: "inline",
    target: ["es2020"],
    jsx: "automatic",
    plugins: [createSourceOGWorkspaceResolverPlugin()],
    logLevel: "silent"
  });

  for (const route of manifest.pages) {
    const chunkName = sanitizeChunkName(route.id);
    const generatedEntryFile = path.join(generatedDir, `${chunkName}.tsx`);
    const outputAsset = path.join(routeAssetDir, `${chunkName}.js`);
    const metadataAsset = path.join(metadataDir, `${chunkName}.json`);
    const browserEntryAsset = path.join(entryAssetDir, `${chunkName}.js`);
    const imports = collectRouteImports(route);
    const clientReferenceRefs = clientReferencesByRoute.get(route.id) ?? [];
    const clientBoundaryFiles = clientReferenceRefs
      .map((entry) => entry.filePath)
      .filter((value): value is string => Boolean(value));
    const clientBoundaryModuleIds = createClientBoundaryModuleIds(route.file, clientBoundaryFiles);
    const actionEntries = actionEntriesByRoute.get(route.id) ?? [];
    const actionIds = actionEntries.map((entry) => entry.actionId);
    const hydrationMode = resolveHydrationMode(route.file, clientBoundaryFiles, actionEntries.length);
    const renderMode = hydrationMode === "full-route" ? "client-root" : "server-components";
    let boundaryRefs = createClientBoundaryDescriptors(route.id, route.pathname, route.file, hydrationMode, clientBoundaryFiles);

    if (hydrationMode === "full-route") {
      await fs.writeFile(
        generatedEntryFile,
        createClientEntrySource({
          routeId: route.id,
          routePathname: route.pathname,
          pageFile: route.file,
          generatedEntryFile,
          hydrationMode,
          clientBoundaryFiles
        }),
        "utf8"
      );

      await bundleClientEntry({
        entryPoints: [generatedEntryFile],
        outfile: browserEntryAsset,
        bundle: true,
        format: "esm",
        platform: "browser",
        sourcemap: "inline",
        target: ["es2020"],
        jsx: "automatic",
        plugins: [createSourceOGWorkspaceResolverPlugin()],
        logLevel: "silent"
      });
    }

    if (hydrationMode === "mixed-route") {
      boundaryRefs = await writeClientBoundaryBrowserAssets({
        distRoot: config.distRoot,
        routeId: route.id,
        chunkName,
        sourceFile: route.file,
        boundaryRefs,
        generatedDir: boundaryGeneratedDir,
        outputDir: boundaryAssetDir
      });
    }

    routeEntries.push({
      routeId: route.id,
      pathname: route.pathname,
      sourceFile: route.file,
      generatedEntryFile: hydrationMode === "full-route" ? generatedEntryFile : undefined,
      outputAsset,
      metadataAsset,
      browserEntryAsset: hydrationMode === "full-route" ? browserEntryAsset : undefined,
      imports,
      routeChunkIds: [`route:${chunkName}`],
      sharedChunkIds: [],
      preloadAssets: [],
      ownershipHash: "",
      chunkName,
      hydrationMode,
      renderMode,
      hasClientBoundaries: clientBoundaryFiles.length > 0,
      clientBoundaryFiles,
      clientBoundaryModuleIds,
      clientReferenceRefs,
      boundaryRefs,
      actionIds,
      actionEntries
    });
  }

  const sharedChunks = await writeSharedChunkArtifacts(routeEntries, sharedChunkDir);

  for (const routeEntry of routeEntries) {
    routeEntry.sharedChunkIds = sharedChunks
      .filter((chunk) => chunk.routeIds.includes(routeEntry.routeId))
      .map((chunk) => chunk.chunkId);
    routeEntry.preloadAssets = [
      runtimeAssetPath,
      routeEntry.outputAsset,
      routeEntry.metadataAsset,
      ...(routeEntry.browserEntryAsset ? [routeEntry.browserEntryAsset] : []),
      ...routeEntry.boundaryRefs
        .map((boundaryRef) => boundaryRef.assetFilePath)
        .filter((value): value is string => Boolean(value)),
      ...sharedChunks
        .filter((chunk) => routeEntry.sharedChunkIds.includes(chunk.chunkId))
        .map((chunk) => chunk.outputAsset)
    ];
    routeEntry.ownershipHash = createOwnershipHash(routeEntry);

    await fs.writeFile(
      routeEntry.outputAsset,
      createRouteChunkSource(routeEntry),
      "utf8"
    );
    await fs.writeFile(
      routeEntry.metadataAsset,
      JSON.stringify(
        {
          version: SOURCEOG_MANIFEST_VERSION,
          routeId: routeEntry.routeId,
          pathname: routeEntry.pathname,
          chunkName: routeEntry.chunkName,
          hydrationMode: routeEntry.hydrationMode,
          renderMode: routeEntry.renderMode,
          browserEntryAsset: routeEntry.browserEntryAsset,
          hasClientBoundaries: routeEntry.hasClientBoundaries,
          clientBoundaryFiles: routeEntry.clientBoundaryFiles,
          clientBoundaryModuleIds: routeEntry.clientBoundaryModuleIds,
          clientReferenceRefs: routeEntry.clientReferenceRefs,
          boundaryRefs: routeEntry.boundaryRefs,
          actionIds: routeEntry.actionIds,
          actionEntries: routeEntry.actionEntries,
          routeChunkIds: routeEntry.routeChunkIds,
          sharedChunkIds: routeEntry.sharedChunkIds,
          preloadAssets: routeEntry.preloadAssets,
          ownershipHash: routeEntry.ownershipHash,
          imports: routeEntry.imports
        },
        null,
        2
      ),
      "utf8"
    );
  }

  const artifacts: ClientBuildArtifacts = {
    version: SOURCEOG_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    runtimeAsset: runtimeAssetPath,
    routeEntries,
    sharedChunks
  };

  await fs.writeFile(
    path.join(config.distRoot, "client-manifest.json"),
    JSON.stringify(artifacts, null, 2),
    "utf8"
  );

  return artifacts;
}

export function resolveRouteClientAssetReferences(
  artifacts: ClientBuildArtifacts,
  distRoot: string,
  routeId: string
): RouteClientAssetReferences | null {
  const routeEntry = artifacts.routeEntries.find((entry) => entry.routeId === routeId);
  if (!routeEntry) {
    return null;
  }

  const sharedChunkHrefs = artifacts.sharedChunks
    .filter((chunk) => routeEntry.sharedChunkIds.includes(chunk.chunkId))
    .map((chunk) => toPublicAssetHref(distRoot, chunk.outputAsset));

  return {
    runtimeHref: toPublicAssetHref(distRoot, artifacts.runtimeAsset),
    routeAssetHref: toPublicAssetHref(distRoot, routeEntry.outputAsset),
    metadataHref: toPublicAssetHref(distRoot, routeEntry.metadataAsset),
    entryAssetHref: routeEntry.browserEntryAsset
      ? toPublicAssetHref(distRoot, routeEntry.browserEntryAsset)
      : undefined,
    sharedChunkHrefs,
    preloadHrefs: routeEntry.preloadAssets.map((filePath) => toPublicAssetHref(distRoot, filePath)),
    hydrationMode: routeEntry.hydrationMode,
    renderMode: routeEntry.renderMode,
    clientReferenceRefs: routeEntry.clientReferenceRefs,
    clientBoundaryModuleIds: routeEntry.clientBoundaryModuleIds,
    boundaryRefs: routeEntry.boundaryRefs,
    actionEntries: routeEntry.actionEntries
  };
}

export async function writeServerClientReferenceModules(input: {
  distRoot: string;
  manifest: ClientReferenceManifest;
}): Promise<Record<string, string>> {
  const generatedDir = path.join(input.distRoot, "generated", "server-client-references");
  const outputDir = path.join(input.distRoot, "server-client-references");
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const modulesById = new Map<string, { filePath: string; exports: string[] }>();
  for (const entry of input.manifest.entries) {
    const existing = modulesById.get(entry.moduleId);
    if (existing) {
      existing.exports = [...new Set([...existing.exports, ...entry.exports])].sort();
      continue;
    }

    modulesById.set(entry.moduleId, {
      filePath: entry.filePath,
      exports: [...new Set(entry.exports)].sort()
    });
  }

  const outputByModuleId: Record<string, string> = {};
  for (const [moduleId, moduleEntry] of modulesById.entries()) {
    const generatedEntryFile = path.join(generatedDir, `${moduleId}.tsx`);
    const outputAsset = path.join(outputDir, `${moduleId}.js`);
    const importPath = toImportSpecifier(generatedEntryFile, moduleEntry.filePath);

    const exportLines = [
      `import * as ClientModule from "${importPath}";`,
      "",
      ...moduleEntry.exports.map((exportName) =>
        exportName === "default"
          ? `export default ClientModule.default;`
          : `export const ${exportName} = ClientModule.${exportName};`
      )
    ];

    await fs.writeFile(generatedEntryFile, exportLines.join("\n"), "utf8");
    await bundleClientEntry({
      entryPoints: [generatedEntryFile],
      outfile: outputAsset,
      bundle: true,
      format: "esm",
      platform: "node",
      external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
      sourcemap: "inline",
      target: ["node18"],
      jsx: "automatic",
      plugins: [createSourceOGWorkspaceResolverPlugin()],
      logLevel: "silent"
    });

    outputByModuleId[moduleId] = outputAsset;
  }

  return outputByModuleId;
}

function createClientEntrySource(input: {
  routeId: string;
  routePathname: string;
  pageFile: string;
  generatedEntryFile: string;
  hydrationMode?: ClientRouteEntry["hydrationMode"];
  clientBoundaryFiles?: string[];
}): string {
  const pageImportPath = toImportSpecifier(input.generatedEntryFile, input.pageFile);
  const importsRouteComponent = (input.hydrationMode ?? "none") === "full-route";
  const islandImports = (input.clientBoundaryFiles ?? []).map((filePath, index) => ({
    identifier: `boundaryModule${index}`,
    importPath: toImportSpecifier(input.generatedEntryFile, filePath),
    aliases: createClientBoundaryAliases(input.pageFile, filePath)
  }));

  return [
    `import React from "react";`,
    `import { hydrateRoot } from "react-dom/client";`,
    importsRouteComponent ? `import RouteComponent from "${pageImportPath}";` : "",
    ...islandImports.map((entry) => `import * as ${entry.identifier} from "${entry.importPath}";`),
    "",
    `const routeId = ${JSON.stringify(input.routeId)};`,
    `const routePathname = ${JSON.stringify(input.routePathname)};`,
    `const hydrationMode = ${JSON.stringify(input.hydrationMode ?? "none")};`,
    `const getBoundaryRefs = () => window.__SOURCEOG_CLIENT_CONTEXT__?.boundaryRefs ?? [];`,
    islandImports.length === 0
      ? `const islandRegistry = {};`
      : [
        `const islandRegistry = Object.assign({},`,
        ...islandImports.map((entry) =>
          `  ${JSON.stringify(entry.aliases)}.reduce((registry, alias) => { registry[alias] = ${entry.identifier}; return registry; }, {}),`
        ),
        `);`
      ].join("\n"),
    "",
    `function getHydrationPayload() {`,
    `  const root = document.getElementById("sourceog-root");`,
    `  if (!root) {`,
    `    throw new Error(\`[SourceOG] Missing hydration root for \${routePathname}.\`);`,
    `  }`,
    `  return root;`,
    `}`,
    "",
    `function parseIslandProps(value) {`,
    `  if (!value) {`,
    `    return {};`,
    `  }`,
    `  try {`,
    `    return JSON.parse(decodeURIComponent(value));`,
    `  } catch (error) {`,
    `    console.error("[SourceOG] Failed to parse client island props.", error);`,
    `    return {};`,
    `  }`,
    `}`,
    "",
    `function hydrateClientBoundaries(boundaryRefs) {`,
    `  let hydratedCount = 0;`,
    `  for (const boundaryRef of boundaryRefs) {`,
    `    if (boundaryRef.bootstrapStrategy !== "hydrate-island") {`,
    `      continue;`,
    `    }`,
    `    const islands = [...document.querySelectorAll(boundaryRef.selector)];`,
    `    if (islands.length === 0) {`,
    `      continue;`,
    `    }`,
    `    const moduleRef = islandRegistry[boundaryRef.moduleId];`,
    `    if (!moduleRef) {`,
    `      console.error("[SourceOG] Unable to resolve client boundary module.", { boundaryRef, known: Object.keys(islandRegistry) });`,
    `      continue;`,
    `    }`,
    `    for (const island of islands) {`,
    `      const exportName = island.getAttribute("data-sourceog-client-export") ?? boundaryRef.exportName ?? "default";`,
    `      const Component = moduleRef?.[exportName];`,
    `      if (!Component) {`,
    `        console.error("[SourceOG] Unable to resolve client island export.", { boundaryRef, exportName, knownExports: Object.keys(moduleRef) });`,
    `        continue;`,
    `      }`,
    `      hydrateRoot(island, React.createElement(Component, parseIslandProps(island.getAttribute("data-sourceog-client-props"))));`,
    `      hydratedCount += 1;`,
    `    }`,
    `  }`,
    `  return hydratedCount;`,
    `}`,
    "",
    importsRouteComponent
      ? [
        `function hydrateRouteRoot() {`,
        `  const root = getHydrationPayload();`,
        `  hydrateRoot(root, React.createElement(RouteComponent, {`,
        `    params: window.__SOURCEOG_ROUTE_PARAMS__ ?? {},`,
        `    query: new URLSearchParams(window.location.search),`,
        `    __routeId: routeId`,
        `  }));`,
        `}`
      ].join("\n")
      : [
        `function hydrateRouteRoot() {`,
        `  console.warn("[SourceOG] Route-root hydration is unavailable for this boundary-only route.", { routeId, routePathname });`,
        `}`
      ].join("\n"),
    "",
    `function bootstrap() {`,
    `  const boundaryRefs = getBoundaryRefs();`,
    `  if (hydrationMode === "mixed-route") {`,
    `    if (boundaryRefs.length === 0) {`,
    `      console.warn("[SourceOG] Mixed route has no declared client boundaries.", { routeId, routePathname });`,
    `      return;`,
    `    }`,
    `    hydrateClientBoundaries(boundaryRefs);`,
    `    return;`,
    `  }`,
    `  hydrateRouteRoot();`,
    `}`,
    "",
    `export async function sourceogBootstrapRoute() {`,
    `  bootstrap();`,
    `}`,
    "",
    `export default sourceogBootstrapRoute;`
  ].filter(Boolean).join("\n");
}

async function writeClientBoundaryBrowserAssets(input: {
  distRoot: string;
  routeId: string;
  chunkName: string;
  sourceFile: string;
  boundaryRefs: ClientBoundaryDescriptor[];
  generatedDir: string;
  outputDir: string;
}): Promise<ClientBoundaryDescriptor[]> {
  const resolvedRefs: ClientBoundaryDescriptor[] = [];

  for (const [index, boundaryRef] of input.boundaryRefs.entries()) {
    if (boundaryRef.bootstrapStrategy !== "hydrate-island") {
      resolvedRefs.push(boundaryRef);
      continue;
    }

    const boundaryChunkName = `${input.chunkName}__boundary_${index}_${sanitizeBoundaryName(boundaryRef.boundaryId)}`;
    const generatedEntryFile = path.join(input.generatedDir, `${boundaryChunkName}.tsx`);
    const outputAsset = path.join(input.outputDir, `${boundaryChunkName}.js`);

    await fs.writeFile(
      generatedEntryFile,
      createClientBoundaryEntrySource({
        generatedEntryFile,
        sourceFile: input.sourceFile,
        boundaryRef
      }),
      "utf8"
    );

    await bundleClientEntry({
      entryPoints: [generatedEntryFile],
      outfile: outputAsset,
      bundle: true,
      format: "esm",
      platform: "browser",
      sourcemap: "inline",
      target: ["es2020"],
      jsx: "automatic",
      plugins: [createSourceOGWorkspaceResolverPlugin()],
      logLevel: "silent"
    });

    resolvedRefs.push({
      ...boundaryRef,
      assetFilePath: outputAsset,
      assetHref: toPublicAssetHref(input.distRoot, outputAsset)
    });
  }

  return resolvedRefs;
}

function createClientBoundaryEntrySource(input: {
  generatedEntryFile: string;
  sourceFile: string;
  boundaryRef: ClientBoundaryDescriptor;
}): string {
  const boundaryImportPath = toImportSpecifier(
    input.generatedEntryFile,
    input.boundaryRef.filePath ?? input.sourceFile,
  );

  return [
    `import React from "react";`,
    `import { hydrateRoot } from "react-dom/client";`,
    `import * as BoundaryModule from "${boundaryImportPath}";`,
    "",
    `function parseIslandProps(value) {`,
    `  if (!value) {`,
    `    return {};`,
    `  }`,
    `  try {`,
    `    return JSON.parse(decodeURIComponent(value));`,
    `  } catch (error) {`,
    `    console.error("[SourceOG] Failed to parse client island props.", error);`,
    `    return {};`,
    `  }`,
    `}`,
    "",
    `export async function sourceogBootstrapBoundary(boundaryRef) {`,
    `  const islands = [...document.querySelectorAll(boundaryRef.selector)];`,
    `  if (islands.length === 0) {`,
    `    return;`,
    `  }`,
    `  for (const island of islands) {`,
    `    const exportName = island.getAttribute("data-sourceog-client-export") ?? boundaryRef.exportName ?? ${JSON.stringify(input.boundaryRef.exportName)};`,
    `    const Component = BoundaryModule?.[exportName];`,
    `    if (!Component) {`,
    `      console.error("[SourceOG] Unable to resolve client island export.", { boundaryRef, exportName, knownExports: Object.keys(BoundaryModule) });`,
    `      continue;`,
    `    }`,
    `    hydrateRoot(island, React.createElement(Component, parseIslandProps(island.getAttribute("data-sourceog-client-props"))));`,
    `  }`,
    `}`,
    "",
    `export default sourceogBootstrapBoundary;`
  ].join("\n");
}

function collectRouteImports(route: RouteManifest["pages"][number]): string[] {
  return [
    route.file,
    ...route.layouts,
    ...route.middlewareFiles,
    route.templateFile,
    route.errorFile,
    route.loadingFile,
    route.notFoundFile
  ].filter((value): value is string => Boolean(value));
}

async function writeSharedChunkArtifacts(
  routeEntries: ClientRouteEntry[],
  sharedChunkDir: string
): Promise<ClientSharedChunkEntry[]> {
  const routeIdsByImport = new Map<string, Set<string>>();

  for (const routeEntry of routeEntries) {
    for (const importFile of routeEntry.imports.filter((file) => normalizePath(file) !== normalizePath(routeEntry.sourceFile))) {
      const normalized = normalizePath(importFile);
      const routeIds = routeIdsByImport.get(normalized) ?? new Set<string>();
      routeIds.add(routeEntry.routeId);
      routeIdsByImport.set(normalized, routeIds);
    }
  }

  const sharedChunks: ClientSharedChunkEntry[] = [];

  for (const [normalizedImport, routeIds] of routeIdsByImport.entries()) {
    if (routeIds.size < 2) {
      continue;
    }

    const chunkId = createSharedChunkId(normalizedImport);
    const outputAsset = path.join(sharedChunkDir, `${chunkId}.js`);
    const importFiles = routeEntries
      .flatMap((routeEntry) => routeEntry.imports)
      .filter((file, index, files) => normalizePath(file) === normalizedImport && files.findIndex((candidate) => normalizePath(candidate) === normalizePath(file)) === index);
    const sharedChunk: ClientSharedChunkEntry = {
      chunkId,
      importFiles,
      routeIds: [...routeIds].sort(),
      outputAsset
    };

    await fs.writeFile(outputAsset, createSharedChunkSource(sharedChunk), "utf8");
    sharedChunks.push(sharedChunk);
  }

  return sharedChunks.sort((left, right) => left.chunkId.localeCompare(right.chunkId));
}

function createRouteChunkSource(routeEntry: ClientRouteEntry): string {
  return [
    `export const routeId = ${JSON.stringify(routeEntry.routeId)};`,
    `export const pathname = ${JSON.stringify(routeEntry.pathname)};`,
    `export const chunkName = ${JSON.stringify(routeEntry.chunkName)};`,
    `export const hydrationMode = ${JSON.stringify(routeEntry.hydrationMode)};`,
    `export const renderMode = ${JSON.stringify(routeEntry.renderMode)};`,
    `export const hasClientBoundaries = ${JSON.stringify(routeEntry.hasClientBoundaries)};`,
    `export const clientBoundaryFiles = ${JSON.stringify(routeEntry.clientBoundaryFiles)};`,
    `export const clientBoundaryModuleIds = ${JSON.stringify(routeEntry.clientBoundaryModuleIds)};`,
    `export const clientReferenceRefs = ${JSON.stringify(routeEntry.clientReferenceRefs)};`,
    `export const boundaryRefs = ${JSON.stringify(routeEntry.boundaryRefs)};`,
    `export const actionIds = ${JSON.stringify(routeEntry.actionIds)};`,
    `export const actionEntries = ${JSON.stringify(routeEntry.actionEntries)};`,
    `export const routeChunkIds = ${JSON.stringify(routeEntry.routeChunkIds)};`,
    `export const sharedChunkIds = ${JSON.stringify(routeEntry.sharedChunkIds)};`,
    `export const preloadAssets = ${JSON.stringify(routeEntry.preloadAssets)};`,
    `export const ownershipHash = ${JSON.stringify(routeEntry.ownershipHash)};`,
    `export const entry = ${JSON.stringify(routeEntry.generatedEntryFile ?? null)};`,
    `export const browserEntryAsset = ${JSON.stringify(routeEntry.browserEntryAsset ?? null)};`,
    `export default { routeId, pathname, chunkName, hydrationMode, renderMode, hasClientBoundaries, clientBoundaryFiles, clientBoundaryModuleIds, clientReferenceRefs, boundaryRefs, actionIds, actionEntries, routeChunkIds, sharedChunkIds, preloadAssets, ownershipHash, entry, browserEntryAsset };`
  ].join("\n");
}

function createSharedChunkSource(sharedChunk: ClientSharedChunkEntry): string {
  return [
    `export const chunkId = ${JSON.stringify(sharedChunk.chunkId)};`,
    `export const routeIds = ${JSON.stringify(sharedChunk.routeIds)};`,
    `export const importFiles = ${JSON.stringify(sharedChunk.importFiles)};`,
    `export default { chunkId, routeIds, importFiles };`
  ].join("\n");
}

function createOwnershipHash(routeEntry: ClientRouteEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        routeId: routeEntry.routeId,
        pathname: routeEntry.pathname,
        chunkName: routeEntry.chunkName,
        hydrationMode: routeEntry.hydrationMode,
        renderMode: routeEntry.renderMode,
        clientBoundaryFiles: routeEntry.clientBoundaryFiles.map((file) => normalizePath(file)),
        clientBoundaryModuleIds: routeEntry.clientBoundaryModuleIds,
        clientReferenceRefs: routeEntry.clientReferenceRefs,
        boundaryRefs: routeEntry.boundaryRefs,
        actionIds: routeEntry.actionIds,
        actionEntries: routeEntry.actionEntries,
        imports: routeEntry.imports.map((file) => normalizePath(file)),
        routeChunkIds: routeEntry.routeChunkIds,
        sharedChunkIds: routeEntry.sharedChunkIds
      })
    )
    .digest("hex")
    .slice(0, 16);
}

function createSharedChunkId(importFile: string): string {
  const hash = createHash("sha256").update(importFile).digest("hex").slice(0, 8);
  return `shared_${path.basename(importFile, path.extname(importFile)).replace(/[^a-zA-Z0-9_]/g, "_")}_${hash}`;
}

function toPublicAssetHref(distRoot: string, filePath: string): string {
  const normalized = path.relative(path.join(distRoot, "static"), filePath).replaceAll("\\", "/");
  return `/${normalized}`;
}

function sanitizeChunkName(routeId: string): string {
  return routeId
    .replaceAll(":", "_")
    .replaceAll("/", "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replaceAll(".", "_");
}

function toImportSpecifier(fromFile: string, toFile: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replaceAll("\\", "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

function createClientReferencesByRoute(
  manifest: ClientReferenceManifest | undefined
): Map<string, ClientReferenceRef[]> {
  const referencesByRoute = new Map<string, ClientReferenceRef[]>();

  for (const entry of manifest?.entries ?? []) {
    for (const routeId of entry.routeIds) {
      const refs = referencesByRoute.get(routeId) ?? [];
      refs.push({
        referenceId: entry.referenceId,
        moduleId: entry.moduleId,
        filePath: entry.filePath,
        routeIds: entry.routeIds,
        runtimeTargets: entry.runtimeTargets,
        manifestKey: entry.manifestKey,
        exportName: entry.exportName,
        chunks: entry.chunks
      });
      referencesByRoute.set(routeId, refs);
    }
  }

  return new Map(
    [...referencesByRoute.entries()].map(([routeId, refs]) => [
      routeId,
      refs
        .sort((left, right) => (left.manifestKey ?? left.moduleId).localeCompare(right.manifestKey ?? right.moduleId))
    ])
  );
}

function createActionEntriesByRoute(
  manifest: ActionManifest | undefined
): Map<string, ActionManifestEntry[]> {
  const actionEntriesByRoute = new Map<string, ActionManifestEntry[]>();

  for (const entry of manifest?.entries ?? []) {
    for (const routeId of entry.routeIds) {
      const actionEntries = actionEntriesByRoute.get(routeId) ?? [];
      actionEntries.push(entry);
      actionEntriesByRoute.set(routeId, actionEntries);
    }
  }

  return new Map(
    [...actionEntriesByRoute.entries()].map(([routeId, actionEntries]) => [
      routeId,
      [...actionEntries].sort((left, right) => left.exportName.localeCompare(right.exportName))
    ])
  );
}

function createClientBoundaryModuleIds(sourceFile: string, clientBoundaryFiles: string[]): string[] {
  return [...new Set(
    clientBoundaryFiles.flatMap((filePath) => createClientBoundaryAliases(sourceFile, filePath))
  )].sort();
}

function createClientBoundaryDescriptors(
  routeId: string,
  pathname: string,
  sourceFile: string,
  hydrationMode: ClientRouteEntry["hydrationMode"],
  clientBoundaryFiles: string[]
): ClientBoundaryDescriptor[] {
  if (hydrationMode === "none") {
    return [];
  }

  if (hydrationMode === "full-route") {
    return [{
      boundaryId: "route-root",
      routeId,
      moduleId: pathname,
      exportName: "default",
      filePath: sourceFile,
      selector: "#sourceog-root",
      propsEncoding: "uri-json",
      bootstrapStrategy: "hydrate-root"
    }];
  }

  const descriptors = new Map<string, ClientBoundaryDescriptor>();
  for (const filePath of clientBoundaryFiles) {
    const canonicalModuleId = toRelativeModuleId(sourceFile, filePath).replace(/\.[^.]+$/, "");
    if (descriptors.has(canonicalModuleId)) {
      continue;
    }

    descriptors.set(canonicalModuleId, {
      boundaryId: canonicalModuleId,
      routeId,
      moduleId: canonicalModuleId,
      exportName: "default",
      filePath,
      selector: `[data-sourceog-client-boundary=${JSON.stringify(canonicalModuleId)}]`,
      propsEncoding: "uri-json",
      bootstrapStrategy: "hydrate-island"
    });
  }

  return [...descriptors.values()].sort((left, right) => (left.moduleId ?? "").localeCompare(right.moduleId ?? ""));
}

function sanitizeBoundaryName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "boundary";
}

function createClientBoundaryAliases(sourceFile: string, clientBoundaryFile: string): string[] {
  const normalizedFile = normalizePath(clientBoundaryFile);
  const extensionless = normalizedFile.replace(/\.[^.]+$/, "");
  const relative = toRelativeModuleId(sourceFile, clientBoundaryFile);
  const aliases = new Set<string>([
    normalizedFile,
    extensionless,
    path.basename(clientBoundaryFile),
    path.basename(clientBoundaryFile, path.extname(clientBoundaryFile))
  ]);

  if (relative) {
    aliases.add(relative);
    aliases.add(relative.replace(/\.[^.]+$/, ""));
  }

  return [...aliases].sort();
}

function toRelativeModuleId(sourceFile: string, targetFile: string): string {
  const relative = path.relative(path.dirname(sourceFile), targetFile).replaceAll("\\", "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function resolveHydrationMode(
  sourceFile: string,
  clientBoundaryFiles: string[],
  actionEntryCount = 0
): ClientRouteEntry["hydrationMode"] {
  if (clientBoundaryFiles.length === 0) {
    return "none";
  }

  if (clientBoundaryFiles.some((filePath) => normalizePath(filePath) === normalizePath(sourceFile))) {
    return "full-route";
  }

  // Routes that only rely on client interactivity and do not couple that
  // interactivity to server actions can hydrate from the route root. This
  // keeps the mixed-route path for action-linked islands like /about while
  // preserving full-route hydration for playground-style verification routes.
  if (actionEntryCount === 0) {
    return "full-route";
  }

  return "mixed-route";
}

// ---------------------------------------------------------------------------
// Phase 1 — discoverClientBoundaries() BFS walk (Req 1.6, Property 4)
// ---------------------------------------------------------------------------

import type { AnalyzedModuleBoundary } from "./boundary.js";

/**
 * Minimal info captured for each "use client" boundary discovered during BFS.
 */
export interface ClientBoundaryInfo {
  /** Absolute path to the "use client" file. */
  filePath: string;
  /** All exports declared in the "use client" file. */
  exports: string[];
}

/**
 * Result returned by `discoverClientBoundaries()`.
 */
export interface ClientBoundaryDiscoveryResult {
  /**
   * Every file reachable from the entry points without crossing a
   * "use client" boundary (i.e. pure server-side modules).
   */
  serverModules: Set<string>;
  /**
   * Every "use client" file encountered during the BFS walk, keyed by its
   * absolute path.  The BFS does NOT recurse into their imports (Req 1.6).
   */
  clientBoundaries: Map<string, ClientBoundaryInfo>;
}

/**
 * BFS walk starting from `entryFiles`.
 *
 * Rules (Req 1.6, Property 4):
 * - If a file has `directive: "use-client"` it is added to `clientBoundaries`
 *   and the BFS does NOT recurse into its imports.
 * - Otherwise the file is added to `serverModules` and the BFS recurses into
 *   its `resolvedLocalImports`.
 *
 * The function accepts a pre-built map of `AnalyzedModuleBoundary` objects
 * (produced by `analyzeModuleBoundaries()`) so it can look up directive and
 * import information without re-parsing files.
 */
export async function discoverClientBoundaries(
  entryFiles: string[],
  analyzedModules: AnalyzedModuleBoundary[]
): Promise<ClientBoundaryDiscoveryResult> {
  const serverModules = new Set<string>();
  const clientBoundaries = new Map<string, ClientBoundaryInfo>();

  // Build a fast lookup map: normalised path → AnalyzedModuleBoundary.
  const moduleByPath = new Map<string, AnalyzedModuleBoundary>();
  for (const mod of analyzedModules) {
    moduleByPath.set(normalizePath(mod.filePath), mod);
  }

  const visited = new Set<string>();
  const queue: string[] = [...entryFiles];

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    const key = normalizePath(filePath);

    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const mod = moduleByPath.get(key);

    if (mod?.directive === "use-client") {
      // This is a client boundary — record it and stop traversal (Req 1.6).
      clientBoundaries.set(filePath, {
        filePath,
        exports: mod.clientExports
      });
    } else {
      // Server module — record it and recurse into its local imports.
      serverModules.add(filePath);

      const imports = mod?.resolvedLocalImports ?? [];
      for (const imported of imports) {
        if (!visited.has(normalizePath(imported))) {
          queue.push(imported);
        }
      }
    }
  }

  return { serverModules, clientBoundaries };
}
