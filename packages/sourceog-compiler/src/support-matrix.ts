import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type {
  SupportClassification,
  SupportMatrix,
  SupportMatrixEntry,
} from "@sourceog/runtime";

interface PackageExportDefinition {
  import?: string;
  types?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const results: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFiles(absolutePath));
      continue;
    }
    results.push(absolutePath);
  }
  return results;
}

async function findLiteralReferences(
  filePaths: string[],
  needle: RegExp,
  workspaceRoot: string,
): Promise<string[]> {
  const references: string[] = [];

  for (const filePath of filePaths) {
    const source = await fs.readFile(filePath, "utf8");
    if (needle.test(source)) {
      references.push(path.relative(workspaceRoot, filePath).replaceAll(path.sep, "/"));
    }
  }

  return references.sort();
}

function deriveSourcePath(packageRoot: string, exportKey: string): string | undefined {
  if (exportKey === ".") {
    return path.join(packageRoot, "src", "index.ts");
  }

  if (!exportKey.startsWith("./")) {
    return undefined;
  }

  return path.join(packageRoot, "src", `${exportKey.slice(2)}.ts`);
}

function classifySupportEntry(entry: SupportMatrixEntry): SupportClassification {
  if (!entry.evidence.packageExported || !entry.evidence.runtimeImplemented) {
    return "internal";
  }

  if (entry.evidence.hasTypes && (entry.evidence.docsCovered || entry.evidence.testsCovered)) {
    return "stable";
  }

  return "preview";
}

function extractRootApiNames(indexSource: string): string[] {
  const exportBlock = /export\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["'];/g;
  const names = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = exportBlock.exec(indexSource)) !== null) {
    for (const rawPart of match[1]!.split(",")) {
      const part = rawPart.replace(/\s+/g, " ").trim();
      if (!part || part.startsWith("type ")) {
        continue;
      }

      const aliasParts = part.split(/\s+as\s+/);
      const publicName = (aliasParts[1] ?? aliasParts[0])?.trim();
      if (publicName && /^[A-Za-z_$][\w$]*$/.test(publicName)) {
        names.add(publicName);
      }
    }
  }

  return [...names].sort();
}

export async function generateSupportMatrix(
  workspaceRoot: string,
  buildId: string,
): Promise<SupportMatrix> {
  const packageRoot = path.join(workspaceRoot, "packages", "sourceog");
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    exports?: Record<string, string | PackageExportDefinition>;
  };
  const docsRoot = path.join(workspaceRoot, "docs");
  const testsRoot = path.join(workspaceRoot, "tests");
  const docsFiles = await collectFiles(docsRoot);
  const testFiles = await collectFiles(testsRoot);
  const entries: SupportMatrixEntry[] = [];

  for (const [exportKey, exportDefinition] of Object.entries(packageJson.exports ?? {})) {
    if (exportKey === "./package.json") {
      continue;
    }

    const definition = typeof exportDefinition === "string"
      ? { import: exportDefinition }
      : exportDefinition;
    const sourceFile = deriveSourcePath(packageRoot, exportKey);
    const docsRefs = await findLiteralReferences(
      docsFiles,
      new RegExp(escapeRegExp(exportKey === "." ? "sourceog" : `sourceog/${exportKey.slice(2)}`)),
      workspaceRoot,
    );
    const testRefs = await findLiteralReferences(
      testFiles,
      new RegExp(escapeRegExp(exportKey === "." ? "sourceog" : `sourceog/${exportKey.slice(2)}`)),
      workspaceRoot,
    );
    const entry: SupportMatrixEntry = {
      id: exportKey === "." ? "sourceog" : `sourceog/${exportKey.slice(2)}`,
      kind: "subpath",
      source: exportKey === "." ? "sourceog" : `sourceog/${exportKey.slice(2)}`,
      sourceFile: sourceFile && existsSync(sourceFile)
        ? path.relative(workspaceRoot, sourceFile).replaceAll(path.sep, "/")
        : undefined,
      status: "preview",
      notes: [],
      evidence: {
        packageExported: true,
        runtimeImplemented: Boolean(sourceFile && existsSync(sourceFile)),
        hasTypes: typeof definition.types === "string" && definition.types.length > 0,
        docsCovered: docsRefs.length > 0,
        testsCovered: testRefs.length > 0,
        docRefs: docsRefs,
        testRefs,
      },
    };

    if (!entry.evidence.docsCovered) {
      entry.notes.push("Missing docs reference.");
    }
    if (!entry.evidence.testsCovered) {
      entry.notes.push("Missing test reference.");
    }

    entry.status = classifySupportEntry(entry);
    entries.push(entry);
  }

  const rootIndexPath = path.join(packageRoot, "src", "index.ts");
  const rootIndexSource = await fs.readFile(rootIndexPath, "utf8");
  const rootApis = extractRootApiNames(rootIndexSource);

  for (const apiName of rootApis) {
    const docsRefs = await findLiteralReferences(
      docsFiles,
      new RegExp(`\\b${escapeRegExp(apiName)}\\b`),
      workspaceRoot,
    );
    const testRefs = await findLiteralReferences(
      testFiles,
      new RegExp(`\\b${escapeRegExp(apiName)}\\b`),
      workspaceRoot,
    );
    const entry: SupportMatrixEntry = {
      id: `sourceog#${apiName}`,
      kind: "api",
      source: "sourceog",
      exportName: apiName,
      sourceFile: path.relative(workspaceRoot, rootIndexPath).replaceAll(path.sep, "/"),
      status: "preview",
      notes: [],
      evidence: {
        packageExported: true,
        runtimeImplemented: true,
        hasTypes: true,
        docsCovered: docsRefs.length > 0,
        testsCovered: testRefs.length > 0,
        docRefs: docsRefs,
        testRefs,
      },
    };

    if (!entry.evidence.docsCovered) {
      entry.notes.push("Missing docs reference.");
    }
    if (!entry.evidence.testsCovered) {
      entry.notes.push("Missing test reference.");
    }

    entry.status = classifySupportEntry(entry);
    entries.push(entry);
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: "2027.1",
    buildId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: entries.length,
      stable: entries.filter((entry) => entry.status === "stable").length,
      preview: entries.filter((entry) => entry.status === "preview").length,
      internal: entries.filter((entry) => entry.status === "internal").length,
    },
    entries,
  };
}

export async function writeSupportMatrix(
  filePath: string,
  workspaceRoot: string,
  buildId: string,
): Promise<SupportMatrix> {
  const payload = await generateSupportMatrix(workspaceRoot, buildId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
