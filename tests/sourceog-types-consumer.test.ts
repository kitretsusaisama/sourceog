import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { describe, it } from "vitest";

const require = createRequire(import.meta.url);

function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}: ${stderr || stdout}`));
    });
  });
}

async function stageBuiltPackage(packageRoot: string, stagingRoot: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await run(process.execPath, [path.join(packageRoot, "scripts", "build.mjs")], packageRoot);
      await fs.rm(stagingRoot, { recursive: true, force: true });
      await fs.mkdir(stagingRoot, { recursive: true });
      await fs.cp(path.join(packageRoot, "dist"), path.join(stagingRoot, "dist"), { recursive: true });
      await fs.copyFile(path.join(packageRoot, "package.json"), path.join(stagingRoot, "package.json"));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe.sequential("sourceog public type consumer", () => {
  it("typechecks against the packaged public API without internal workspace packages", async () => {
    const packageRoot = path.join(process.cwd(), "packages", "sourceog");
    const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "sourceog-types-"));
    const projectRoot = path.join(tempRoot, "consumer");
    const stagedPackageRoot = path.join(tempRoot, "staged-package");
    const packageInstallRoot = path.join(projectRoot, "node_modules", "sourceog");
    const tscPath = require.resolve("typescript/lib/tsc");

    await stageBuiltPackage(packageRoot, stagedPackageRoot);

    await fs.mkdir(packageInstallRoot, { recursive: true });
    await fs.cp(path.join(stagedPackageRoot, "dist"), path.join(packageInstallRoot, "dist"), { recursive: true });
    await fs.copyFile(path.join(stagedPackageRoot, "package.json"), path.join(packageInstallRoot, "package.json"));
    await fs.mkdir(projectRoot, { recursive: true });

    await fs.writeFile(
      path.join(projectRoot, "index.ts"),
      [
        'import { defineConfig, defineRoutePolicy, inspectDecision, unstable_cache, diffBuildArtifacts, useRouter } from "sourceog";',
        'import { revalidateTag } from "sourceog/cache";',
        'import { defineAutomation } from "sourceog/automation";',
        'import { callServerAction, createServerAction } from "sourceog/actions";',
        'import { defineBudgetProfile } from "sourceog/config";',
        'import { scanProject } from "sourceog/doctor";',
        'import { explainDecision } from "sourceog/explain";',
        'import { ConsistencyGraph } from "sourceog/graph";',
        'import { inspectGovernance } from "sourceog/governance";',
        'import { headers } from "sourceog/headers";',
        'import type { SourceOGImageProps } from "sourceog/image";',
        'import { inspectRoute } from "sourceog/inspect";',
        'import { Link, usePathname } from "sourceog/navigation";',
        'import { createPolicyMeshController } from "sourceog/policies";',
        'import { exportDecisionReplay } from "sourceog/replay";',
        'import { getExecutionPlan } from "sourceog/runtime";',
        'import { createTestInstance } from "sourceog/testing";',
        "",
        "const config = defineConfig({});",
        'const routePolicy = defineRoutePolicy({ strategy: "adaptive" });',
        'const budgetProfile = defineBudgetProfile({ shellBytes: 2048 });',
        'const automation = defineAutomation({ name: "warm-cache", schedule: { kind: "manual" }, run() { return { automation: "warm-cache", status: "completed" } as const; } });',
        'const action = createServerAction(async (payload: FormData) => ({ ok: Boolean(payload) }));',
        'const cached = unstable_cache(async () => "ok", ["demo"]);',
        "void config;",
        "void routePolicy;",
        "void budgetProfile;",
        "void automation;",
        "void action;",
        "void cached;",
        "void revalidateTag;",
        "void callServerAction;",
        "void scanProject;",
        "void explainDecision;",
        "void ConsistencyGraph;",
        "void inspectGovernance;",
        "void inspectRoute;",
        "void diffBuildArtifacts;",
        "void headers;",
        "void Link;",
        "void usePathname;",
        "void useRouter;",
        "const controller = createPolicyMeshController();",
        "void exportDecisionReplay(controller);",
        "void getExecutionPlan;",
        "void createTestInstance;",
        "void inspectDecision;",
        "const props: SourceOGImageProps = { width: 120, height: 80 };",
        "void props;",
      ].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(projectRoot, "react-shim.d.ts"),
      [
        'declare module "react" {',
        "  const React: any;",
        "  export default React;",
        "  export type ComponentType<P = any> = any;",
        "  export type ReactNode = any;",
        "  export interface RefObject<T> { current: T | null }",
        "  export interface ImgHTMLAttributes<T = any> { [key: string]: any }",
        "  export interface AnchorHTMLAttributes<T = any> { [key: string]: any }",
        "  export namespace JSX {",
        "    interface Element {}",
        "  }",
        "}",
        'declare module "react-dom" {',
        "  export function useFormStatus(): { pending: boolean; data?: FormData; method?: string; action?: string };",
        "}",
        'declare module "react/jsx-runtime" {',
        "  export const Fragment: any;",
        "  export function jsx(...args: any[]): any;",
        "  export function jsxs(...args: any[]): any;",
        "}",
      ].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(projectRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            jsx: "react-jsx",
            types: [],
            baseUrl: ".",
          },
          include: ["index.ts", "react-shim.d.ts"],
        },
        null,
        2,
      ),
      "utf8",
    );
    await run(process.execPath, [tscPath, "--noEmit", "-p", path.join(projectRoot, "tsconfig.json")], projectRoot);

    await fs.rm(tempRoot, { recursive: true, force: true });
  }, 120_000);
});
