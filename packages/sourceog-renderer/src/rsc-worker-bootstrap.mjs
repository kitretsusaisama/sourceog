import { workerData, parentPort, isMainThread } from "node:worker_threads";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const CONFIG = {
  useInlineTransform: workerData?.useInlineTransform !== false,
  workerIndex: Number(workerData?.workerIndex ?? 0),
  transformTmpDir: path.join(process.cwd(), ".sourceog", "worker-transforms"),
};

if (!existsSync(CONFIG.transformTmpDir)) {
  try {
    mkdirSync(CONFIG.transformTmpDir, { recursive: true });
  } catch (error) {
    console.warn("[SOURCEOG bootstrap] Failed to create worker transform temp directory", {
      workerIndex: CONFIG.workerIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let esbuildTransform = null;
let sucraseTransform = null;

function findNearestTsconfig(startPath) {
  let current = path.dirname(startPath);
  while (true) {
    for (const candidate of ["tsconfig.base.json", "tsconfig.json"]) {
      const resolved = path.join(current, candidate);
      if (existsSync(resolved)) {
        return resolved;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function writeCachedModuleAtomically(targetPath, contents) {
  const tempPath = `${targetPath}.${process.pid}.${CONFIG.workerIndex}.${Date.now()}.tmp`;
  writeFileSync(tempPath, contents, "utf8");

  try {
    if (!existsSync(targetPath)) {
      renameSync(tempPath, targetPath);
      return;
    }
  } finally {
    if (existsSync(tempPath)) {
      rmSync(tempPath, { force: true });
    }
  }
}

function normalizeEsbuildModule(moduleValue) {
  if (moduleValue && typeof moduleValue.build === "function") {
    return moduleValue;
  }

  if (moduleValue && moduleValue.default && typeof moduleValue.default.build === "function") {
    return moduleValue.default;
  }

  throw new Error("Resolved esbuild module does not expose a usable build() API.");
}

async function ensureDynamicTransformers() {
  if (esbuildTransform || sucraseTransform) {
    return;
  }

  try {
    const esbuild = normalizeEsbuildModule(await import("esbuild"));
    esbuildTransform = async (code, filename) => {
      const result = await esbuild.transform(code, {
        loader: filename.endsWith(".tsx")
          ? "tsx"
          : filename.endsWith(".jsx")
            ? "jsx"
            : filename.endsWith(".ts")
              ? "ts"
              : "js",
        target: "es2022",
        format: "esm",
        jsx: "automatic",
        logLevel: "silent",
      });
      return result.code ?? "";
    };
  } catch {
    esbuildTransform = null;
  }

  try {
    const sucrase = await import("sucrase");
    sucraseTransform = async (code, filename) => {
      return sucrase.transform(code, {
        transforms: filename.endsWith(".jsx") ? ["jsx"] : ["typescript", "jsx"],
        jsxRuntime: "automatic",
      }).code;
    };
  } catch {
    sucraseTransform = null;
  }
}

async function loadWithInlineTransform(fsPath) {
  const source = readFileSync(fsPath, "utf8");
  const hash = createHash("sha256")
    .update(source)
    .update(fsPath)
    .digest("hex")
    .slice(0, 12);

  const cachedPath = path.join(
    CONFIG.transformTmpDir,
    `${path.basename(fsPath).replace(/\.[^.]+$/, "")}-${hash}.mjs`,
  );

  if (existsSync(cachedPath)) {
    try {
      return await import(pathToFileURL(cachedPath).href + `?t=${Date.now()}`);
    } catch {
      rmSync(cachedPath, { force: true });
    }
  }

  try {
    const esbuild = normalizeEsbuildModule(await import("esbuild"));
    const tsconfig = findNearestTsconfig(fsPath);
    const result = await esbuild.build({
      absWorkingDir: process.cwd(),
      format: "esm",
      bundle: true,
      conditions: ["react-server"],
      entryPoints: [fsPath],
      external: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/server",
        "react-server-dom-webpack",
        "react-server-dom-webpack/*",
      ],
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "react",
      logLevel: "silent",
      platform: "node",
      sourcemap: "inline",
      target: "es2022",
      ...(tsconfig ? { tsconfig } : {}),
      write: false,
    });

    const bundled = result.outputFiles?.[0]?.text;
    if (!bundled) {
      throw new Error(`No bundled worker output produced for ${fsPath}.`);
    }

    writeCachedModuleAtomically(cachedPath, bundled);
    return import(pathToFileURL(cachedPath).href + `?t=${Date.now()}`);
  } catch (bundleError) {
    await ensureDynamicTransformers();

    const transformer = esbuildTransform ?? sucraseTransform;
    if (!transformer) {
      throw new Error(
        `No dynamic transpiler is available for worker bootstrap file ${fsPath}: ${
          bundleError instanceof Error ? bundleError.message : String(bundleError)
        }`,
      );
    }

    const transformed = await transformer(source, fsPath);
    writeCachedModuleAtomically(cachedPath, transformed);
    return import(pathToFileURL(cachedPath).href + `?t=${Date.now()}`);
  }
}

async function resolveWorkerEntrypoint() {
  const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
  const jsEntry = path.join(bootstrapDir, "workers", "worker-entry.js");
  const tsEntry = path.join(bootstrapDir, "workers", "worker-entry.ts");

  if (existsSync(jsEntry)) {
    await import(pathToFileURL(jsEntry).href);
    return;
  }

  if (existsSync(tsEntry)) {
    await loadWithInlineTransform(tsEntry);
    return;
  }

  throw new Error(
    `Worker entrypoint resolution failed. Missing ${jsEntry} and ${tsEntry}.`,
  );
}

if (isMainThread) {
  throw new Error("rsc-worker-bootstrap.mjs must only run inside a worker thread.");
}

if (!parentPort) {
  throw new Error("rsc-worker-bootstrap.mjs requires parentPort.");
}

resolveWorkerEntrypoint().catch((error) => {
  console.error("[SOURCEOG bootstrap] SourceOG worker bootstrap failed", {
    workerIndex: CONFIG.workerIndex,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  parentPort.postMessage({
    type: "bootstrap_error",
    error: error instanceof Error ? error.message : String(error),
  });

  process.exit(1);
});
