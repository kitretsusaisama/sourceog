import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const distRoot = path.join(packageRoot, "dist");
const tsconfigPath = path.join(workspaceRoot, "tsconfig.base.json");
const typeMirrorRoot = path.join(distRoot, "_types");
const verifyMirrorRoot = path.join(distRoot, "_verify");
const rendererRoot = path.join(workspaceRoot, "packages", "sourceog-renderer", "src");
const verifyMirrorSources = [
  {
    sourcePath: path.join(workspaceRoot, "packages", "sourceog-server", "src", "server.ts"),
    destinationPath: path.join(verifyMirrorRoot, "sourceog-server", "server.ts.txt"),
  },
  {
    sourcePath: path.join(workspaceRoot, "packages", "sourceog-renderer", "src", "render.ts"),
    destinationPath: path.join(verifyMirrorRoot, "sourceog-renderer", "render.ts.txt"),
  },
  {
    sourcePath: path.join(workspaceRoot, "packages", "sourceog-renderer", "src", "rsc.ts"),
    destinationPath: path.join(verifyMirrorRoot, "sourceog-renderer", "rsc.ts.txt"),
  },
  {
    sourcePath: path.join(workspaceRoot, "packages", "sourceog-runtime", "src", "client-island.tsx"),
    destinationPath: path.join(verifyMirrorRoot, "sourceog-runtime", "client-island.tsx.txt"),
  },
];

const libraryEntryPoints = {
  index: path.join(packageRoot, "src", "index.ts"),
  actions: path.join(packageRoot, "src", "actions.ts"),
  auth: path.join(packageRoot, "src", "auth.ts"),
  automation: path.join(packageRoot, "src", "automation.ts"),
  cache: path.join(packageRoot, "src", "cache.ts"),
  "client-island": path.join(packageRoot, "src", "client-island.ts"),
  config: path.join(packageRoot, "src", "config.ts"),
  doctor: path.join(packageRoot, "src", "doctor.ts"),
  explain: path.join(packageRoot, "src", "explain.ts"),
  graph: path.join(packageRoot, "src", "graph.ts"),
  headers: path.join(packageRoot, "src", "headers.ts"),
  governance: path.join(packageRoot, "src", "governance.ts"),
  i18n: path.join(packageRoot, "src", "i18n.ts"),
  image: path.join(packageRoot, "src", "image.ts"),
  inspect: path.join(packageRoot, "src", "inspect.ts"),
  navigation: path.join(packageRoot, "src", "navigation.ts"),
  platform: path.join(packageRoot, "src", "platform.ts"),
  policies: path.join(packageRoot, "src", "policies.ts"),
  request: path.join(packageRoot, "src", "request.ts"),
  replay: path.join(packageRoot, "src", "replay.ts"),
  runtime: path.join(packageRoot, "src", "runtime.ts"),
  server: path.join(packageRoot, "src", "server.ts"),
  testing: path.join(packageRoot, "src", "testing.ts"),
  validation: path.join(packageRoot, "src", "validation.ts"),
};

const runtimeExternal = [
  "chokidar",
  "dotenv",
  "esbuild",
  "jose",
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "react-server-dom-webpack",
  "react-server-dom-webpack/*",
  "ws",
  "zod",
];

const typeMirrorSources = [
  {
    sourceRoot: path.join(workspaceRoot, "packages", "sourceog-runtime", "src"),
    destinationRoot: path.join(typeMirrorRoot, "sourceog-runtime", "src"),
  },
  {
    sourceRoot: path.join(workspaceRoot, "packages", "sourceog-platform", "src"),
    destinationRoot: path.join(typeMirrorRoot, "sourceog-platform", "src"),
  },
  {
    sourceRoot: path.join(workspaceRoot, "packages", "sourceog-router", "src"),
    destinationRoot: path.join(typeMirrorRoot, "sourceog-router", "src"),
  },
  {
    sourceRoot: path.join(workspaceRoot, "packages", "sourceog-server", "src"),
    destinationRoot: path.join(typeMirrorRoot, "sourceog-server", "src"),
  },
  {
    sourceRoot: path.join(workspaceRoot, "packages", "genbook", "src", "types"),
    destinationRoot: path.join(typeMirrorRoot, "sourceog-genbook-types"),
  },
];

const internalSpecifierTargets = {
  "@sourceog/runtime": path.join(typeMirrorRoot, "sourceog-runtime", "src", "index.js"),
  "@sourceog/runtime/artifacts": path.join(typeMirrorRoot, "sourceog-runtime", "src", "artifacts.js"),
  "@sourceog/runtime/actions": path.join(typeMirrorRoot, "sourceog-runtime", "src", "actions.js"),
  "@sourceog/runtime/cache": path.join(typeMirrorRoot, "sourceog-runtime", "src", "cache.js"),
  "@sourceog/runtime/client-island": path.join(typeMirrorRoot, "sourceog-runtime", "src", "client-island.js"),
  "@sourceog/runtime/context": path.join(typeMirrorRoot, "sourceog-runtime", "src", "context.js"),
  "@sourceog/runtime/contracts": path.join(typeMirrorRoot, "sourceog-runtime", "src", "contracts.js"),
  "@sourceog/runtime/data-cache": path.join(typeMirrorRoot, "sourceog-runtime", "src", "data-cache.js"),
  "@sourceog/runtime/errors": path.join(typeMirrorRoot, "sourceog-runtime", "src", "errors.js"),
  "@sourceog/runtime/execution-plan": path.join(typeMirrorRoot, "sourceog-runtime", "src", "execution-plan.js"),
  "@sourceog/runtime/fetch": path.join(typeMirrorRoot, "sourceog-runtime", "src", "fetch.js"),
  "@sourceog/runtime/filesystem-cache-store": path.join(typeMirrorRoot, "sourceog-runtime", "src", "filesystem-cache-store.js"),
  "@sourceog/runtime/render-control": path.join(typeMirrorRoot, "sourceog-runtime", "src", "render-control.js"),
  "@sourceog/runtime/request": path.join(typeMirrorRoot, "sourceog-runtime", "src", "request.js"),
  "@sourceog/runtime/request-helpers": path.join(typeMirrorRoot, "sourceog-runtime", "src", "request-helpers.js"),
  "@sourceog/runtime/revalidate": path.join(typeMirrorRoot, "sourceog-runtime", "src", "revalidate.js"),
  "@sourceog/platform": path.join(typeMirrorRoot, "sourceog-platform", "src", "index.js"),
  "@sourceog/platform/image": path.join(typeMirrorRoot, "sourceog-platform", "src", "image.js"),
  "@sourceog/router": path.join(typeMirrorRoot, "sourceog-router", "src", "index.js"),
  "@sourceog/server/route": path.join(typeMirrorRoot, "sourceog-server", "src", "route.js"),
  "@sourceog/genbook/types": path.join(typeMirrorRoot, "sourceog-genbook-types", "index.js"),
};

const publicTypeTargets = {
  "@sourceog/runtime": path.join(distRoot, "_types", "sourceog-runtime", "src", "index.js"),
  "@sourceog/runtime/artifacts": path.join(distRoot, "_types", "sourceog-runtime", "src", "artifacts.js"),
  "@sourceog/runtime/actions": path.join(distRoot, "_types", "sourceog-runtime", "src", "actions.js"),
  "@sourceog/runtime/cache": path.join(distRoot, "_types", "sourceog-runtime", "src", "cache.js"),
  "@sourceog/runtime/client-island": path.join(distRoot, "_types", "sourceog-runtime", "src", "client-island.js"),
  "@sourceog/runtime/context": path.join(distRoot, "_types", "sourceog-runtime", "src", "context.js"),
  "@sourceog/runtime/contracts": path.join(distRoot, "_types", "sourceog-runtime", "src", "contracts.js"),
  "@sourceog/runtime/data-cache": path.join(distRoot, "_types", "sourceog-runtime", "src", "data-cache.js"),
  "@sourceog/runtime/errors": path.join(distRoot, "_types", "sourceog-runtime", "src", "errors.js"),
  "@sourceog/runtime/execution-plan": path.join(distRoot, "_types", "sourceog-runtime", "src", "execution-plan.js"),
  "@sourceog/runtime/fetch": path.join(distRoot, "_types", "sourceog-runtime", "src", "fetch.js"),
  "@sourceog/runtime/filesystem-cache-store": path.join(distRoot, "_types", "sourceog-runtime", "src", "filesystem-cache-store.js"),
  "@sourceog/runtime/render-control": path.join(distRoot, "_types", "sourceog-runtime", "src", "render-control.js"),
  "@sourceog/runtime/request": path.join(distRoot, "_types", "sourceog-runtime", "src", "request.js"),
  "@sourceog/runtime/request-helpers": path.join(distRoot, "_types", "sourceog-runtime", "src", "request-helpers.js"),
  "@sourceog/runtime/revalidate": path.join(distRoot, "_types", "sourceog-runtime", "src", "revalidate.js"),
  "@sourceog/platform": path.join(distRoot, "_types", "sourceog-platform", "src", "index.js"),
  "@sourceog/platform/image": path.join(distRoot, "_types", "sourceog-platform", "src", "image.js"),
  "@sourceog/router": path.join(distRoot, "_types", "sourceog-router", "src", "index.js"),
  "@sourceog/server/route": path.join(distRoot, "_types", "sourceog-server", "src", "route.js"),
  "@sourceog/genbook/types": path.join(distRoot, "_types", "sourceog-genbook-types", "index.js"),
};

function rewriteModuleSpecifiers(source, currentFile, replacements) {
  let rewritten = source;
  for (const [specifier, absoluteTarget] of Object.entries(replacements)) {
    const relativeTarget = path
      .relative(path.dirname(currentFile), absoluteTarget)
      .replaceAll("\\", "/");
    const normalizedTarget = relativeTarget.startsWith(".") ? relativeTarget : `./${relativeTarget}`;
    const quotedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(
      new RegExp(`(["'])${quotedSpecifier}\\1`, "g"),
      (_match, quote) => `${quote}${normalizedTarget}${quote}`,
    );
  }
  return rewritten;
}

async function copyDeclarationTree(sourceRoot, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);

    if (entry.isDirectory()) {
      await copyDeclarationTree(sourcePath, destinationPath);
      continue;
    }

    if (!entry.name.endsWith(".d.ts")) {
      continue;
    }

    const source = await readFile(sourcePath, "utf8");
    const rewritten = rewriteModuleSpecifiers(source, destinationPath, internalSpecifierTargets);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, rewritten, "utf8");
  }
}

async function buildTypeMirror() {
  for (const mirror of typeMirrorSources) {
    await copyDeclarationTree(mirror.sourceRoot, mirror.destinationRoot);
  }
}

async function buildPublicDeclarations() {
  for (const [entryName, sourcePath] of Object.entries(libraryEntryPoints)) {
    const declarationSourcePath = sourcePath.replace(/\.ts$/, ".d.ts");
    const source = await readFile(existsSync(declarationSourcePath) ? declarationSourcePath : sourcePath, "utf8");
    const destinationPath = path.join(distRoot, `${entryName}.d.ts`);
    const rewritten = rewriteModuleSpecifiers(source, destinationPath, publicTypeTargets);
    await writeFile(destinationPath, rewritten, "utf8");
  }
}

async function buildWorkerRuntimeAssets() {
  await writeFile(
    path.join(distRoot, "rsc-worker-bootstrap.mjs"),
    await readFile(path.join(rendererRoot, "rsc-worker-bootstrap.mjs"), "utf8"),
    "utf8",
  );

  await build({
    entryPoints: [path.join(rendererRoot, "workers", "worker-entry.ts")],
    outfile: path.join(distRoot, "workers", "worker-entry.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    legalComments: "none",
    tsconfig: tsconfigPath,
    external: runtimeExternal,
  });
}

async function buildVerifySourceMirror() {
  for (const entry of verifyMirrorSources) {
    await mkdir(path.dirname(entry.destinationPath), { recursive: true });
    await writeFile(entry.destinationPath, await readFile(entry.sourcePath, "utf8"), "utf8");
  }
}

await rm(distRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(distRoot, { recursive: true });

await build({
  entryPoints: libraryEntryPoints,
  outdir: distRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  tsconfig: tsconfigPath,
  external: runtimeExternal,
  outExtension: { ".js": ".js" },
});

await build({
  entryPoints: [path.join(packageRoot, "src", "bin.ts")],
  outfile: path.join(distRoot, "bin.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  tsconfig: tsconfigPath,
  external: runtimeExternal,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

await buildTypeMirror();
await buildPublicDeclarations();
await buildWorkerRuntimeAssets();
await buildVerifySourceMirror();
