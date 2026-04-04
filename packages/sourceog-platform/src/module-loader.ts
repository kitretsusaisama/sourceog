import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TRANSPILE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".jsx"]);
const CONFIG_NAMES = new Set([
  "sourceog.config.ts",
  "sourceog.config.js",
  "sourceog.config.mjs",
  "sourceog.config.cjs",
  "package.json",
  "pnpm-workspace.yaml",
]);

export interface RuntimeModuleLoaderOptions {
  cacheRoot?: string;
  projectRoot?: string;
  namespace?: string;
}

function shouldTranspileModule(filePath: string): boolean {
  return TRANSPILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveProjectRoot(filePath: string): string {
  let current = path.dirname(filePath);

  while (true) {
    for (const candidate of CONFIG_NAMES) {
      if (existsSync(path.join(current, candidate))) {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.dirname(filePath);
    }
    current = parent;
  }
}

function resolveCacheRoot(filePath: string, options: RuntimeModuleLoaderOptions): string {
  const projectRoot = options.projectRoot ?? resolveProjectRoot(filePath);
  return options.cacheRoot
    ?? path.join(projectRoot, ".sourceog", "runtime-cache", options.namespace ?? "modules");
}

async function computeModuleVersion(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return `${stats.size}-${stats.mtimeMs}`;
}

function toVersionedModuleHref(filePath: string, version: string): string {
  const href = pathToFileURL(filePath).href;
  return `${href}?v=${encodeURIComponent(version)}`;
}

async function transpileModule(filePath: string, options: RuntimeModuleLoaderOptions): Promise<string> {
  const cacheRoot = resolveCacheRoot(filePath, options);
  const projectRoot = options.projectRoot ?? resolveProjectRoot(filePath);
  const version = await computeModuleVersion(filePath);
  const outputName = `${createHash("sha256")
    .update(`${filePath}:${version}`)
    .digest("hex")
    .slice(0, 24)}.mjs`;
  const outfile = path.join(cacheRoot, outputName);

  if (!existsSync(outfile)) {
    const { build } = await import("esbuild");
    await fs.mkdir(cacheRoot, { recursive: true });
    await build({
      absWorkingDir: projectRoot,
      entryPoints: [filePath],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      packages: "external",
      jsx: "automatic",
      sourcemap: false,
      legalComments: "none",
    });
  }

  return outfile;
}

export async function loadRuntimeModule<TModule = Record<string, unknown>>(
  filePath: string,
  options: RuntimeModuleLoaderOptions = {},
): Promise<TModule> {
  const version = await computeModuleVersion(filePath);
  const resolvedFile = shouldTranspileModule(filePath)
    ? await transpileModule(filePath, options)
    : filePath;

  return import(toVersionedModuleHref(resolvedFile, version)) as Promise<TModule>;
}

