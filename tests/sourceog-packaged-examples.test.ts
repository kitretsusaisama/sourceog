import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const EXAMPLE_DIRS = [
  "examples/app-basic",
  "examples/app-edge",
  "examples/app-enterprise",
  "examples/app-static",
] as const;

const DEV_PORTS: Record<string, number> = {
  "app-basic": 4301,
  "app-edge": 4302,
  "app-enterprise": 4303,
  "app-static": 4304,
};

const START_PORTS: Record<string, number> = {
  "app-basic": 4401,
  "app-edge": 4402,
  "app-enterprise": 4403,
  "app-static": 4404,
};

let tempDir: string | undefined;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(command: string, args: string[], code: number | null, stdout: string, stderr: string): string {
  const output = [stdout, stderr].filter(Boolean).join("\n");
  return `${command} ${args.join(" ")} failed with exit code ${code ?? 1}: ${output}`;
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill();
  await Promise.race([
    waitForExit(child),
    delay(5_000),
  ]);

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        shell: false,
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  } else {
    child.kill("SIGKILL");
  }

  await waitForExit(child);
}

function run(command: string, args: string[], cwd: string, timeoutMs = 180_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(async () => {
      await terminateProcess(child);
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(toErrorMessage(command, args, code, stdout, stderr)));
    });
  });
}

function runUntilReady(
  command: string,
  args: string[],
  cwd: string,
  readyText: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) {
        return;
      }

      settled = true;
      await terminateProcess(child);
      reject(
        new Error(
          `Timed out waiting for "${readyText}" from ${command} ${args.join(" ")}.\n${[stdout, stderr].filter(Boolean).join("\n")}`,
        ),
      );
    }, timeoutMs);

    const onChunk = (target: "stdout" | "stderr", chunk: Buffer | string): void => {
      const text = chunk.toString();
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }

      const combined = `${stdout}\n${stderr}`;
      if (!settled && combined.includes(readyText)) {
        settled = true;
        clearTimeout(timeout);
        void terminateProcess(child)
          .then(() => resolve({ stdout, stderr }))
          .catch(reject);
      }
    };

    child.stdout.on("data", (chunk) => onChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => onChunk("stderr", chunk));
    child.on("error", async (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      await terminateProcess(child);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(toErrorMessage(command, args, code, stdout, stderr)));
    });
  });
}

async function stageBuiltPackage(packageRoot: string, stagedPackageRoot: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await run(process.execPath, [path.join(packageRoot, "scripts", "build.mjs")], packageRoot, 240_000);
      await fs.rm(stagedPackageRoot, { recursive: true, force: true });
      await fs.mkdir(stagedPackageRoot, { recursive: true });
      await fs.cp(path.join(packageRoot, "dist"), path.join(stagedPackageRoot, "dist"), { recursive: true });
      await fs.copyFile(path.join(packageRoot, "package.json"), path.join(stagedPackageRoot, "package.json"));
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function installStagedPackage(exampleRoot: string, stagedPackageRoot: string, packageRoot: string): Promise<string> {
  const packageInstallRoot = path.join(exampleRoot, "node_modules", "sourceog");
  await fs.rm(packageInstallRoot, { recursive: true, force: true });
  await fs.mkdir(packageInstallRoot, { recursive: true });
  await fs.cp(path.join(stagedPackageRoot, "dist"), path.join(packageInstallRoot, "dist"), { recursive: true });
  await fs.copyFile(path.join(stagedPackageRoot, "package.json"), path.join(packageInstallRoot, "package.json"));
  await fs.symlink(
    path.join(packageRoot, "node_modules"),
    path.join(packageInstallRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const cliPath = path.join(packageInstallRoot, "dist", "bin.js");
  await fs.access(cliPath);
  return cliPath;
}

async function prepareExampleWorkspace(
  repoRoot: string,
  workspaceRoot: string,
  exampleDir: string,
  stagedPackageRoot: string,
  packageRoot: string,
): Promise<{ cliPath: string; exampleRoot: string; exampleName: string }> {
  const exampleName = path.basename(exampleDir);
  const exampleRoot = path.join(workspaceRoot, exampleName);
  await fs.cp(path.join(repoRoot, exampleDir), exampleRoot, {
    recursive: true,
    filter: shouldCopyFixture,
  });
  const cliPath = await installStagedPackage(exampleRoot, stagedPackageRoot, packageRoot);
  return { cliPath, exampleRoot, exampleName };
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("sourceog packaged examples", () => {
  it("runs the packaged CLI matrix across all example apps", async () => {
    const repoRoot = process.cwd();
    const packageRoot = path.join(repoRoot, "packages", "sourceog");
    const tempRoot = path.join(repoRoot, ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-packaged-examples-"));

    const stagedPackageRoot = path.join(tempDir, "staged-sourceog");
    await stageBuiltPackage(packageRoot, stagedPackageRoot);

    for (const exampleDir of EXAMPLE_DIRS) {
      const { cliPath, exampleRoot, exampleName } = await prepareExampleWorkspace(
        repoRoot,
        tempDir,
        exampleDir,
        stagedPackageRoot,
        packageRoot,
      );

      const devResult = await runUntilReady(
        process.execPath,
        [cliPath, "dev", ".", "--port", String(DEV_PORTS[exampleName])],
        exampleRoot,
        `SourceOG dev server running at http://localhost:${DEV_PORTS[exampleName]}`,
      );

      expect(`${devResult.stdout}\n${devResult.stderr}`).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");

      await run(process.execPath, [cliPath, "build", "."], exampleRoot, 240_000);

      const startResult = await runUntilReady(
        process.execPath,
        [cliPath, "start", ".", "--port", String(START_PORTS[exampleName])],
        exampleRoot,
        `SourceOG production server running at http://localhost:${START_PORTS[exampleName]}`,
      );

      expect(`${startResult.stdout}\n${startResult.stderr}`).toContain(".sourceog");

      await run(process.execPath, [cliPath, "export", "."], exampleRoot, 240_000);
      await run(process.execPath, [cliPath, "audit", "."], exampleRoot, 240_000);
      await run(
        process.execPath,
        [cliPath, "verify", ".", "--skipTypecheck", "--skipTests"],
        exampleRoot,
        300_000,
      );
    }
  }, 900_000);
});
