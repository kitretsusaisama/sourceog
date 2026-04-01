import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const repoRequire = createRequire(path.join(repoRoot, "package.json"));
const repoRuntimeSpecifiers = new Set([
  "react",
  "react-dom/client",
  "react-server-dom-webpack/client.browser"
]);

function resolveCandidate(filePath: string): string | null {
  const candidates = [
    filePath,
    `${filePath}.ts`,
    `${filePath}.tsx`,
    path.join(filePath, "index.ts"),
    path.join(filePath, "index.tsx")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveSourceOGWorkspaceSpecifier(specifier: string): string | null {
  if (specifier === "sourceog") {
    return resolveCandidate(path.join(repoRoot, "packages", "sourceog", "src", "index"));
  }

  if (specifier.startsWith("sourceog/")) {
    const subpath = specifier.slice("sourceog/".length).replaceAll("/", path.sep);
    return resolveCandidate(path.join(repoRoot, "packages", "sourceog", "src", subpath));
  }

  if (!specifier.startsWith("@sourceog/")) {
    return null;
  }

  const scopedPath = specifier.slice("@sourceog/".length);
  const [packageName, ...subpathParts] = scopedPath.split("/");
  if (!packageName) {
    return null;
  }

  const packageRoot = path.join(repoRoot, "packages", `sourceog-${packageName}`, "src");
  if (subpathParts.length === 0) {
    return resolveCandidate(path.join(packageRoot, "index"));
  }

  return resolveCandidate(path.join(packageRoot, ...subpathParts));
}

export function createSourceOGWorkspaceResolverPlugin(): Plugin {
  return {
    name: "sourceog-workspace-resolver",
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom\/client|react-server-dom-webpack\/client\.browser)$/ }, (args) => {
        if (!repoRuntimeSpecifiers.has(args.path)) {
          return null;
        }

        return {
          path: repoRequire.resolve(args.path)
        };
      });

      build.onResolve({ filter: /^(sourceog|@sourceog\/)/ }, (args) => {
        const resolved = resolveSourceOGWorkspaceSpecifier(args.path);
        if (!resolved) {
          return null;
        }

        return {
          path: resolved
        };
      });
    }
  };
}
