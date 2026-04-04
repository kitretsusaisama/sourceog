import type { ClientReferenceManifestEntry } from "@sourceog/runtime";

interface ClientReferenceManifestRegistryEntry {
  id: string;
  chunks: string[];
  name: string;
  async: boolean;
  filepath: string;
  exports: string[];
}

interface ClientReferenceManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: ClientReferenceManifestEntry[];
  registry: Record<string, ClientReferenceManifestRegistryEntry>;
}

type ModuleDirective = "none" | "use-client" | "use-server";

interface RouteOwnership {
  routeIds: Set<string>;
  pathnames: Set<string>;
}

interface ParsedModuleSource {
  filePath: string;
  directive: ModuleDirective;
  conflictingDirectives: boolean;
  importSpecifiers: string[];
  resolvedLocalImports: string[];
  nodeBuiltinImports: string[];
  actionExports: string[];
  clientExports: string[];
}

export interface AnalyzedModuleBoundary {
  filePath: string;
  directive: ModuleDirective;
  importSpecifiers: string[];
  resolvedLocalImports: string[];
  nodeBuiltinImports: string[];
  actionExports: string[];
  clientExports: string[];
  routeIds: string[];
  pathnames: string[];
}

export interface BoundaryAnalysisResult {
  modules: AnalyzedModuleBoundary[];
  clientReferenceManifest: ClientReferenceManifest;
  serverReferenceManifest: ServerReferenceManifest;
  actionManifest: ActionManifest;
  diagnostics: DiagnosticIssue[];
}

export async function analyzeModuleBoundaries(manifest: RouteManifest): Promise<BoundaryAnalysisResult> {
  const ownership = new Map<string, RouteOwnership>();
  const parsedModules = new Map<string, ParsedModuleSource>();
  const diagnostics: DiagnosticIssue[] = [];
  const queue: string[] = [];

  for (const route of [...manifest.pages, ...(manifest.handlers ?? [])]) {
    for (const filePath of collectOwnedFiles(route)) {
      if (mergeOwnership(ownership, filePath, route.id, route.pathname)) {
        queue.push(filePath);
      }
    }
  }

  while (queue.length > 0) {
    const nextFile = queue.shift();
    if (!nextFile) {
      continue;
    }

    const parsed = parsedModules.get(nextFile) ?? await parseModuleSource(nextFile);
    if (!parsedModules.has(nextFile)) {
      parsedModules.set(nextFile, parsed);
      if (parsed.conflictingDirectives) {
        diagnostics.push({
          level: "error",
          code: "SOURCEOG_CONFLICTING_MODULE_DIRECTIVES",
          message: `Module "${path.basename(nextFile)}" declares both "use client" and "use server".`,
          file: nextFile,
          recoveryHint: "Keep exactly one top-level module directive per file."
        });
      }
    }

    const currentOwnership = ownership.get(normalizePath(nextFile));
    if (!currentOwnership) {
      continue;
    }

    if (parsed.directive === "use-client") {
      continue;
    }

    for (const importedFile of parsed.resolvedLocalImports) {
      let changed = false;
      for (const routeId of currentOwnership.routeIds) {
        changed = mergeOwnership(ownership, importedFile, routeId, undefined) || changed;
      }
      for (const pathname of currentOwnership.pathnames) {
        changed = mergeOwnership(ownership, importedFile, undefined, pathname) || changed;
      }
      if (changed) {
        queue.push(importedFile);
      }
    }
  }

  const modules: AnalyzedModuleBoundary[] = [...parsedModules.values()]
    .map((parsed) => {
      const fileOwnership = ownership.get(normalizePath(parsed.filePath));
      return {
        filePath: parsed.filePath,
        directive: parsed.directive,
        importSpecifiers: parsed.importSpecifiers,
        resolvedLocalImports: parsed.resolvedLocalImports,
        nodeBuiltinImports: parsed.nodeBuiltinImports,
        actionExports: parsed.actionExports,
        clientExports: parsed.clientExports,
        routeIds: [...(fileOwnership?.routeIds ?? new Set<string>())].sort(),
        pathnames: [...(fileOwnership?.pathnames ?? new Set<string>())].sort()
      };
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  const moduleByPath = new Map(modules.map((entry) => [normalizePath(entry.filePath), entry]));
  for (const module of modules) {
    if (module.directive !== "use-client") {
      continue;
    }

    if (module.clientExports.length === 0) {
      diagnostics.push({
        level: "error",
        code: "SOURCEOG_USE_CLIENT_NO_EXPORTS",
        message: `Client module "${path.basename(module.filePath)}" does not export any components.`,
        file: module.filePath,
        recoveryHint: 'Every "use client" file must export at least one component or value.'
      });
    }

    for (const builtinImport of module.nodeBuiltinImports) {
      diagnostics.push({
        level: "error",
        code: "SOURCEOG_CLIENT_IMPORTS_NODE_BUILTIN",
        message: `Client module "${path.basename(module.filePath)}" imports Node builtin "${builtinImport}".`,
        file: module.filePath,
        recoveryHint: "Move the Node-specific logic into a server module or route handler.",
        details: { import: builtinImport }
      });
    }

    for (const importedFile of module.resolvedLocalImports) {
      const importedModule = moduleByPath.get(normalizePath(importedFile))
        ?? await parseModuleSource(importedFile);
      if (importedModule?.directive === "use-server") {
        diagnostics.push({
          level: "error",
          code: "SOURCEOG_CLIENT_IMPORTS_SERVER_MODULE",
          message: `Client module "${path.basename(module.filePath)}" imports server module "${path.basename(importedFile)}".`,
          file: module.filePath,
          recoveryHint: "Pass data through props or move the import behind a server boundary.",
          details: { importedFile }
        });
      }
    }
  }

  const clientReferenceRegistry: ClientReferenceManifest["registry"] = {};
  const clientReferenceEntries = modules
    .filter((module) => module.directive === "use-client")
    .flatMap((module) => {
      const normalizedModulePath = normalizePath(module.filePath);
      const moduleId = createModuleId(module.filePath);
      const exports = module.clientExports;
      const runtimeTargets = resolveRuntimeTargets(manifest, module.routeIds, module);

      return exports.map((exportName) => {
        const manifestKey = `${normalizedModulePath}#${exportName}`;
        clientReferenceRegistry[manifestKey] = {
          id: moduleId,
          chunks: [],
          name: exportName,
          async: false,
          filepath: module.filePath,
          exports
        };

        return {
          referenceId: createReferenceId(module.filePath, "client", exportName),
          moduleId,
          filePath: module.filePath,
          manifestKey,
          exportName,
          exports,
          chunks: [],
          async: false,
          routeIds: module.routeIds,
          pathnames: module.pathnames,
          importSpecifiers: module.importSpecifiers,
          directive: "use-client" as const,
          runtimeTargets
        };
      });
    });

  const clientReferenceManifest: ClientReferenceManifest = {
    version: CONTRACTS_MANIFEST_VERSION,
    buildId: "pending",
    generatedAt: new Date().toISOString(),
    registry: clientReferenceRegistry,
    entries: clientReferenceEntries
  };

  const actionEntries = modules.flatMap((module) =>
    module.directive === "use-server"
      ? module.actionExports.map((exportName) => ({
        actionId: createActionId(module.filePath, exportName),
        exportName,
        filePath: module.filePath,
        routeIds: module.routeIds,
        pathnames: module.pathnames,
        runtime: "node" as const,
        refreshPolicy: "refresh-current-route-on-revalidate" as const,
        revalidationPolicy: "track-runtime-revalidation" as const
      }))
      : []
  );

  const serverReferenceManifest: ServerReferenceManifest = {
    version: CONTRACTS_MANIFEST_VERSION,
    buildId: "pending",
    generatedAt: new Date().toISOString(),
    entries: modules
      .filter((module) => module.directive !== "use-client")
      .map((module) => ({
        referenceId: createReferenceId(module.filePath, "server"),
        moduleId: normalizePath(module.filePath),
        filePath: module.filePath,
        routeIds: module.routeIds,
        pathnames: module.pathnames,
        importSpecifiers: module.importSpecifiers,
        directive: module.directive === "use-server" ? "use-server" : "server-default",
        actionIds: actionEntries
          .filter((entry) => normalizePath(entry.filePath) === normalizePath(module.filePath))
          .map((entry) => entry.actionId),
        runtimeTargets: resolveRuntimeTargets(manifest, module.routeIds, module)
      }))
  };

  const actionManifest: ActionManifest = {
    version: CONTRACTS_MANIFEST_VERSION,
    buildId: "pending",
    generatedAt: new Date().toISOString(),
    entries: actionEntries
  };

  return {
    modules,
    clientReferenceManifest,
    serverReferenceManifest,
    actionManifest,
    diagnostics
  };
}

function collectOwnedFiles(route: RouteManifest["pages"][number] | RouteManifest["handlers"][number]): string[] {
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

async function parseModuleSource(filePath: string): Promise<ParsedModuleSource> {
  const source = await fs.readFile(filePath, "utf8");
  const directiveState = parseDirectives(source);
  const importSpecifiers = parseImportSpecifiers(source);
  const resolvedLocalImports = (
    await Promise.all(
      importSpecifiers
        .filter((specifier) => specifier.startsWith("."))
        .map(async (specifier) => resolveLocalImport(filePath, specifier))
    )
  ).filter((value): value is string => Boolean(value));

  return {
    filePath,
    directive: directiveState.directive,
    conflictingDirectives: directiveState.conflicting,
    importSpecifiers,
    resolvedLocalImports,
    nodeBuiltinImports: importSpecifiers.filter((specifier) => specifier.startsWith("node:")),
    actionExports: directiveState.directive === "use-server" ? parseActionExports(source) : [],
    clientExports: directiveState.directive === "use-client" ? parseClientExports(source) : []
  };
}

function parseDirectives(source: string): { directive: ModuleDirective; conflicting: boolean } {
  const directives = new Set<ModuleDirective>();
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === '"use client";' || line === "'use client';") {
      directives.add("use-client");
      continue;
    }
    if (line === '"use server";' || line === "'use server';") {
      directives.add("use-server");
      continue;
    }
    break;
  }

  if (directives.size > 1) {
    return { directive: "none", conflicting: true };
  }

  const directive = directives.values().next().value ?? "none";
  return { directive, conflicting: false };
}

function parseImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers].sort();
}

function parseActionExports(source: string): string[] {
  const exports = new Set<string>();
  const patterns = [
    /\bexport\s+async\s+function\s+([A-Za-z0-9_]+)/g,
    /\bexport\s+function\s+([A-Za-z0-9_]+)/g,
    /\bexport\s+const\s+([A-Za-z0-9_]+)\s*=/g,
    /\bexport\s+default\s+async\s+function\b/g,
    /\bexport\s+default\s+function\b/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      exports.add(match[1] ?? "default");
    }
  }

  return [...exports].sort();
}

function parseClientExports(source: string): string[] {
  const exports = new Set<string>();
  const patterns = [
    /\bexport\s+default\s+(?:async\s+)?function\b/g,
    /\bexport\s+default\s+(?:class|\()/g,
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /\bexport\s+const\s+([A-Za-z0-9_]+)\s*=/g,
    /\bexport\s+class\s+([A-Za-z0-9_]+)/g,
    /\bexport\s*\{\s*([^}]+)\s*\}/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (!match[1]) {
        exports.add("default");
        continue;
      }

      for (const rawSpecifier of match[1].split(",")) {
        const specifier = rawSpecifier.trim();
        if (!specifier) {
          continue;
        }
        const aliased = /\bas\s+([A-Za-z0-9_]+)$/.exec(specifier);
        exports.add(aliased?.[1] ?? specifier.split(/\s+/)[0]);
      }
    }
  }

  return [...exports].sort();
}

async function resolveLocalImport(fromFile: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx")
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing candidates while resolving import specifiers.
    }
  }

  return null;
}

function mergeOwnership(
  ownership: Map<string, RouteOwnership>,
  filePath: string,
  routeId?: string,
  pathname?: string
): boolean {
  const normalized = normalizePath(filePath);
  const existing = ownership.get(normalized) ?? { routeIds: new Set<string>(), pathnames: new Set<string>() };
  const routeCount = existing.routeIds.size;
  const pathnameCount = existing.pathnames.size;

  if (routeId) {
    existing.routeIds.add(routeId);
  }
  if (pathname) {
    existing.pathnames.add(pathname);
  }

  ownership.set(normalized, existing);
  return existing.routeIds.size !== routeCount || existing.pathnames.size !== pathnameCount;
}

function createActionId(filePath: string, exportName: string): string {
  return createHash("sha256")
    .update(`${normalizePath(filePath)}:${exportName}`)
    .digest("hex")
    .slice(0, 16);
}

function createModuleId(filePath: string): string {
  return createHash("sha256")
    .update(normalizePath(filePath))
    .digest("hex")
    .slice(0, 16);
}

function createReferenceId(filePath: string, kind: "client" | "server", exportName?: string): string {
  return createHash("sha256")
    .update(`${kind}:${normalizePath(filePath)}${exportName ? `#${exportName}` : ""}`)
    .digest("hex")
    .slice(0, 16);
}

function resolveRuntimeTargets(
  manifest: RouteManifest,
  routeIds: string[],
  module?: Pick<AnalyzedModuleBoundary, "directive" | "nodeBuiltinImports" | "actionExports">
): Array<"node" | "edge"> {
  const matchedRoutes = [...manifest.pages, ...(manifest.handlers ?? [])].filter((route) => routeIds.includes(route.id));
  const supportsEdge = matchedRoutes.some((route) => route.capabilities.includes("edge-capable"));
  if (!supportsEdge) {
    return ["node"];
  }

  if ((module?.nodeBuiltinImports.length ?? 0) > 0) {
    return ["node"];
  }

  if (module?.directive === "use-server" && (module.actionExports.length ?? 0) > 0) {
    return ["node"];
  }

  return ["node", "edge"];
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

// ---------------------------------------------------------------------------
// Phase 6: Edge Runtime Capability Enforcement
// ---------------------------------------------------------------------------

/**
 * All Node.js built-in modules that are not available in Edge runtimes.
 * Includes both `node:` prefixed and bare-specifier equivalents.
 */
export const NODE_ONLY_MODULES = new Set([
  "node:fs", "node:path", "node:child_process", "node:crypto",
  "node:net", "node:http", "node:https", "node:stream", "node:os",
  "node:buffer", "node:events", "node:util", "node:zlib",
  // bare-specifier equivalents
  "fs", "path", "child_process", "crypto", "net",
  "http", "https", "stream", "os", "buffer", "events", "util", "zlib"
]);

export interface EdgeViolation {
  type: "node-only-import";
  importPath: string;
  importedBy: string;
  line: number;
  column: number;
  suggestion: string;
}

export interface RouteRuntimeCapability {
  routeId: string;
  runtimeTarget: "edge" | "node";
  supportsEdge: boolean;
  violations: EdgeViolation[];
}

/**
 * Traverses the full import graph of a route and collects EdgeViolation entries
 * for any node-only module imports found. Node-targeted routes skip checks entirely.
 */
export async function computeRouteRuntimeCapability(
  routeFile: string,
  routeId: string,
  runtimeTarget: "edge" | "node"
): Promise<RouteRuntimeCapability> {
  // Node-targeted routes skip edge capability checks entirely (Req 6.4)
  if (runtimeTarget === "node") {
    return { routeId, runtimeTarget, supportsEdge: false, violations: [] };
  }

  const violations: EdgeViolation[] = [];
  const visited = new Set<string>();
  const queue: string[] = [routeFile];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath) continue;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    let source: string;
    try {
      source = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = source.split(/\r?\n/);
    const importPattern = /\bimport\s+(?:[^'\"]*?from\s+)?['\"]([^'\"]+)['\"]/g;
    const requirePattern = /\brequire\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

    for (const pattern of [importPattern, requirePattern]) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1];
        if (!specifier) continue;

        if (NODE_ONLY_MODULES.has(specifier)) {
          // Find line/column of this import
          const matchIndex = match.index;
          let charCount = 0;
          let lineNum = 1;
          let lineStart = 0;
          for (let i = 0; i < lines.length; i++) {
            const lineLen = lines[i].length + 1; // +1 for newline
            if (charCount + lineLen > matchIndex) {
              lineNum = i + 1;
              lineStart = charCount;
              break;
            }
            charCount += lineLen;
          }
          const column = matchIndex - lineStart + 1;

          violations.push({
            type: "node-only-import",
            importPath: specifier,
            importedBy: filePath,
            line: lineNum,
            column,
            suggestion: `Replace "${specifier}" with an Edge-compatible alternative. ` +
              "For crypto operations use the Web Crypto API (globalThis.crypto). " +
              "For file I/O use fetch() or KV storage. " +
              "For path utilities use URL and string manipulation."
          });
        } else if (specifier.startsWith(".")) {
          // Resolve and enqueue local imports for transitive checking
          const resolved = await resolveLocalImportForEdge(filePath, specifier);
          if (resolved && !visited.has(resolved)) {
            queue.push(resolved);
          }
        }
      }
    }
  }

  return {
    routeId,
    runtimeTarget,
    supportsEdge: violations.length === 0,
    violations
  };
}

/**
 * Throws a SourceOGError with code EDGE_CAPABILITY_VIOLATION if any violations found.
 */
export function enforceEdgeCapability(capability: RouteRuntimeCapability): void {
  if (capability.violations.length === 0) return;

  const violationList = capability.violations
    .map((v) =>
      `  - "${v.importPath}" imported in ${v.importedBy}:${v.line}:${v.column}\n    Fix: ${v.suggestion}`
    )
    .join("\n");

  throw new SourceOGError(
    SOURCEOG_ERROR_CODES.EDGE_CAPABILITY_VIOLATION,
    `Route "${capability.routeId}" is configured for Edge runtime but imports Node-only modules:\n${violationList}`,
    {
      routeId: capability.routeId,
      violations: capability.violations as unknown as Record<string, unknown>[]
    } as Record<string, unknown>
  );
}

async function resolveLocalImportForEdge(fromFile: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"), path.join(base, "index.js")
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}
