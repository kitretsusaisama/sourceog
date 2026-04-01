#!/usr/bin/env node
import path from "node:path";
import { buildApplication, exportApplication, verifyApplication } from "@sourceog/compiler";
import { resolveConfig } from "@sourceog/platform";
import { createSourceOGServer } from "@sourceog/server";
import { runFirstPartyAdapterParityVerification } from "./verify-parity.js";

type CommandName = "dev" | "build" | "start" | "export" | "verify";

interface ParsedArgs {
  command: CommandName;
  cwd: string;
  port: number;
  outDir?: string;
  help: boolean;
  skipTypecheck: boolean;
  skipTests: boolean;
  skipParity: boolean;
}

function printHelp(command?: CommandName): void {
  const common = [
    "Usage: sourceog <command> [path] [--cwd <dir>] [--port <port>] [--outDir <dir>] [--help]",
    "",
    "Commands:",
    "  dev     Start the development server",
    "  build   Run the full production build pipeline",
    "  start   Start the production server from the configured app",
    "  export  Build and export static output",
    "  verify  Run the GA release verification gate",
    ""
  ];

  const commandText: Record<CommandName, string[]> = {
    dev: ["sourceog dev [path] [--cwd <dir>] [--port <port>]"],
    build: ["sourceog build [path] [--cwd <dir>]"],
    start: ["sourceog start [path] [--cwd <dir>] [--port <port>]"],
    export: ["sourceog export [path] [--cwd <dir>] [--outDir <dir>]"],
    verify: ["sourceog verify [path] [--cwd <dir>] [--skipTypecheck] [--skipTests] [--skipParity]"]
  };

  const lines = command ? commandText[command] : common;
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , maybeCommand, maybeTarget, ...rest] = argv;
  const command = (maybeCommand && ["dev", "build", "start", "export", "verify"].includes(maybeCommand)
    ? maybeCommand
    : "dev") as CommandName;

  const hasPositionalTarget = maybeTarget && !maybeTarget.startsWith("--");
  const rawTarget = hasPositionalTarget ? maybeTarget : ".";
  const values = hasPositionalTarget ? rest : [maybeTarget, ...rest].filter(Boolean) as string[];

  const readValue = (flag: string): string | undefined => {
    const index = values.indexOf(flag);
    return index === -1 ? undefined : values[index + 1];
  };

  return {
    command,
    cwd: path.resolve(readValue("--cwd") ?? process.cwd(), rawTarget),
    port: Number.parseInt(readValue("--port") ?? "3000", 10),
    outDir: readValue("--outDir"),
    help: values.includes("--help") || values.includes("-h"),
    skipTypecheck: values.includes("--skipTypecheck"),
    skipTests: values.includes("--skipTests"),
    skipParity: values.includes("--skipParity")
  };
}

function printStructuredError(error: unknown): void {
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const payload = {
      name: details.name ?? "Error",
      message: details.message ?? String(error),
      code: details.code,
      context: details.context ?? details.details
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stderr.write(`${String(error)}\n`);
}

async function runBuild(cwd: string): Promise<void> {
  const result = await buildApplication(cwd);
  if (!result.budgetReport.passed) {
    throw new Error("Build failed because one or more route bundles exceeded the configured budget.");
  }
}

async function runExport(cwd: string, outDir?: string): Promise<void> {
  await runBuild(cwd);
  await exportApplication(cwd, outDir);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp(args.command);
    return;
  }

  switch (args.command) {
    case "dev": {
      const server = await createSourceOGServer({ cwd: args.cwd, mode: "development", port: args.port });
      await server.start();
      process.stdout.write(`SourceOG dev server running at http://localhost:${args.port} (${server.config.stability})\n`);
      break;
    }
    case "build": {
      await runBuild(args.cwd);
      process.stdout.write("SourceOG build completed successfully.\n");
      break;
    }
    case "start": {
      const config = await resolveConfig(args.cwd);
      const server = await createSourceOGServer({ cwd: args.cwd, mode: "production", port: args.port });
      await server.start();
      process.stdout.write(`SourceOG production server running at http://localhost:${args.port} using ${config.distRoot}\n`);
      break;
    }
    case "export": {
      await runExport(args.cwd, args.outDir);
      process.stdout.write(`SourceOG export completed${args.outDir ? ` to ${args.outDir}` : ""}.\n`);
      break;
    }
    case "verify": {
      const report = await verifyApplication(args.cwd, {
        runTypecheck: !args.skipTypecheck,
        runTests: !args.skipTests
      });
      if (!args.skipParity) {
        await runFirstPartyAdapterParityVerification(report.buildResult.deploymentManifest);
      }
      process.stdout.write(
        `SourceOG verification completed successfully for build ${report.buildId} (${report.checkedManifests.length} manifests checked, readiness ${report.parityScoreboard.overallCompetitiveReadiness}/100, current milestone ${report.milestoneDashboard.currentMilestone}).\n`
      );
      process.stdout.write(
        `Artifacts: parity scoreboard -> ${report.artifactPaths.parityScoreboard}; milestone dashboard -> ${report.artifactPaths.milestoneDashboard}.\n`
      );
      break;
    }
    default: {
      printHelp();
    }
  }
}

void main().catch((error) => {
  printStructuredError(error);
  process.exitCode = 1;
});
