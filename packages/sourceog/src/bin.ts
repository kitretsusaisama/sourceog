import path from "node:path";
import { existsSync } from "node:fs";
import {
  auditSourceogPublishReadiness,
  buildApplication,
  diffBuildArtifacts,
  explainDecision,
  explainRoute,
  exportApplication,
  inspectAction,
  inspectBuildArtifacts,
  inspectCache,
  inspectGovernance,
  inspectGraph,
  inspectRoute,
  releaseApplication,
  runDoctor,
  verifyApplication
} from "@sourceog/compiler";
import { createSourceOGServer } from "@sourceog/server";
import { runFirstPartyAdapterParityVerification } from "./verify-parity.js";
import type { DoctorArea } from "./doctor.js";

type CommandName = "dev" | "build" | "start" | "export" | "verify" | "audit" | "doctor" | "inspect" | "explain" | "release";

interface ParsedArgs {
  command: CommandName;
  cwd: string;
  port?: number;
  outDir?: string;
  area?: string;
  subject?: string;
  selector?: string;
  compare?: string;
  diff?: string;
  format: "json" | "text";
  help: boolean;
  skipTypecheck: boolean;
  skipTests: boolean;
  skipParity: boolean;
  sign: boolean;
  portFallback: boolean;
}

function printHelp(command?: CommandName): void {
  const common = [
    "Usage: sourceog <command> [path] [--cwd <dir>] [--port <port>] [--output <dir>] [--no-port-fallback] [--help]",
    "",
    "Commands:",
    "  dev     Start the development server",
    "  build   Run the full production build pipeline",
    "  start   Start the production server from the configured app",
    "  export  Build and export static output",
    "  verify  Run the release verification gate",
    "  audit   Run the publish-readiness and package-governance audit",
    "  doctor  Run SourceOG doctor checks and emit remediation artifacts",
    "  release Verify, doctor, and bundle release evidence artifacts",
    "  inspect Inspect SourceOG build artifacts, governance, routes, graph, cache, or actions",
    "  explain Explain SourceOG route and policy decisions",
    ""
  ];

  const commandText: Record<CommandName, string[]> = {
    dev: ["sourceog dev [path] [--cwd <dir>] [--port <port>] [--no-port-fallback]"],
    build: ["sourceog build [path] [--cwd <dir>]"],
    start: ["sourceog start [path] [--cwd <dir>] [--port <port>] [--no-port-fallback]"],
    export: ["sourceog export [path] [--cwd <dir>] [--output <dir>]"],
    verify: ["sourceog verify [path] [--cwd <dir>] [--skipTypecheck] [--skipTests] [--skipParity]"],
    audit: ["sourceog audit [path] [--cwd <dir>]"],
    doctor: ["sourceog doctor [path] [--cwd <dir>] [--area <all|runtime|package|docs|examples|migration|benchmark|security>]"],
    release: ["sourceog release [path] [--cwd <dir>] [--output <dir>] [--diff <bundle-or-index>] [--skipTypecheck] [--skipTests] [--sign]"],
    inspect: ["sourceog inspect <manifest|governance|route|graph|cache|action> [selector] [--cwd <dir>] [--compare <dir>] [--format <json|text>]"],
    explain: ["sourceog explain <route|decision> [selector] [--cwd <dir>] [--format <json|text>]" ]
  };

  const lines = command ? commandText[command] : common;
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , maybeCommand, ...rest] = argv;
  const command = (maybeCommand && ["dev", "build", "start", "export", "verify", "audit", "doctor", "inspect", "explain", "release"].includes(maybeCommand)
    ? maybeCommand
    : "dev") as CommandName;
  const tokens = maybeCommand === command ? rest : [maybeCommand, ...rest].filter(Boolean) as string[];
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(token, true);
      continue;
    }

    flags.set(token, next);
    index += 1;
  }

  const readValue = (flag: string): string | undefined => {
    const value = flags.get(flag);
    return typeof value === "string" ? value : undefined;
  };

  const subject = command === "inspect" || command === "explain" ? positionals[0] : undefined;
  const selector = command === "inspect" || command === "explain" ? positionals[1] : undefined;
  const rawTarget = command === "inspect" || command === "explain"
    ? positionals[2] ?? "."
    : positionals[0] ?? ".";

  const portStr = readValue("--port");

  return {
    command,
    cwd: path.resolve(readValue("--cwd") ?? process.cwd(), rawTarget),
    port: portStr ? Number.parseInt(portStr, 10) : undefined,
    outDir: readValue("--output") ?? readValue("--outDir"),
    area: readValue("--area"),
    subject,
    selector,
    compare: readValue("--compare"),
    diff: readValue("--diff"),
    format: readValue("--format") === "text" ? "text" : "json",
    help: flags.has("--help") || tokens.includes("-h"),
    skipTypecheck: flags.has("--skipTypecheck"),
    skipTests: flags.has("--skipTests"),
    skipParity: flags.has("--skipParity"),
    sign: flags.has("--sign"),
    portFallback: !flags.has("--no-port-fallback") && !flags.has("--strict-port"),
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

function findWorkspaceRoot(startCwd: string): string {
  let current = path.resolve(startCwd);

  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startCwd;
    }
    current = parent;
  }
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

interface InspectManifestPayload {
  buildId: string;
  distRoot: string;
  stability: string;
  routeCount: number;
  pageRouteCount: number;
  handlerRouteCount: number;
  prerenderedRouteCount: number;
  runtimeTargets?: string[];
  manifestNames?: string[];
  signatureSummary?: {
    compiler: string;
    runtime: string;
    deployment: string;
  };
  doctor?: {
    passed: boolean;
    summary: {
      errors: number;
      warnings: number;
      infos: number;
    };
  };
  policyMesh?: {
    objective: string;
    loopNames?: string[];
    reducerPhases?: string[];
  };
}

function formatInspectText(subject: string, payload: InspectManifestPayload): string {
  if (subject === "manifest" || subject === "manifests") {
    const lines = [
      `Build ${payload.buildId} in ${payload.distRoot}`,
      `Stability: ${payload.stability}`,
      `Routes: ${payload.routeCount} total (${payload.pageRouteCount} pages, ${payload.handlerRouteCount} handlers, ${payload.prerenderedRouteCount} prerendered)`,
      `Runtime targets: ${(payload.runtimeTargets ?? []).join(", ") || "none"}`,
      `Manifests: ${(payload.manifestNames ?? []).join(", ")}`,
    ];
    if (payload.signatureSummary) {
      lines.push(
        `Signatures: compiler=${payload.signatureSummary.compiler}, runtime=${payload.signatureSummary.runtime}, deployment=${payload.signatureSummary.deployment}`,
      );
    }
    if (payload.doctor) {
      lines.push(
        `Doctor: ${payload.doctor.passed ? "passed" : "issues found"} (${payload.doctor.summary.errors} error(s), ${payload.doctor.summary.warnings} warning(s), ${payload.doctor.summary.infos} info)`,
      );
    }
    if (payload.policyMesh) {
      lines.push(
        `Policy mesh: objective=${payload.policyMesh.objective}, loops=${(payload.policyMesh.loopNames ?? []).join(", ")}, phases=${(payload.policyMesh.reducerPhases ?? []).join(" -> ")}`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  if (subject === "route") {
    const lines = [
      `Route ${payload.route?.pathname ?? payload.selector} (${payload.route?.routeId ?? "unknown"})`,
      `Runtime: ${payload.route?.runtime ?? "unknown"}`,
      `Graph nodes: ${payload.graph?.nodes?.length ?? 0}, consistency nodes: ${payload.graph?.consistencyNodes?.length ?? 0}`,
      `Cache entries: ${payload.cache?.entries?.length ?? 0}, invalidation links: ${payload.cache?.invalidationLinks?.length ?? 0}`,
      `Boundaries: ${payload.boundaries?.count ?? 0} (${payload.boundaries?.hydrationMode ?? "none"})`,
      `Actions: ${payload.actions?.length ?? 0}`,
      `Policy mesh: objective=${payload.policyDiagnostics?.objective ?? "n/a"}, changed fields=${(payload.policyDiagnostics?.changedDecisionFields ?? []).join(", ") || "none"}`,
    ];
    if (payload.doctor?.summary) {
      lines.push(
        `Doctor: ${payload.doctor.summary.passed ? "passed" : "issues found"} with ${payload.doctor.findings?.length ?? 0} route-linked finding(s)`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  if (subject === "governance") {
    return [
      `Governance inspection for build ${payload.buildId}`,
      `Adapter: ${payload.selectedAdapter ?? "unknown"}`,
      `Runtime fingerprint: ${payload.runtimeFingerprint ?? "unknown"}`,
      `Package contract: ${payload.packageContract?.publicPackage ?? "unknown"}`,
      `Runtime contract: artifactOnly=${payload.runtimeContract?.artifactOnlyProduction}, sourceProbingDisallowed=${payload.runtimeContract?.sourceProbingDisallowed}, transpilerFallbackDisallowed=${payload.runtimeContract?.transpilerFallbackDisallowed}`,
      `Laws: doctor=${payload.laws?.doctorLaw}, replay=${payload.laws?.replayLaw}, policy=${payload.laws?.policyLaw}, runtime=${payload.laws?.runtimeLaw}, governance=${payload.laws?.governanceLaw}`,
      `Decision counts: routes=${payload.decisionCounts?.routeCount ?? 0}, cache=${payload.decisionCounts?.cacheEntryCount ?? 0}, graphNodes=${payload.decisionCounts?.graphNodeCount ?? 0}, actions=${payload.decisionCounts?.actionCount ?? 0}`,
      `Signature alignment: compiler=${payload.signatureAlignment?.compiler}, runtime=${payload.signatureAlignment?.runtime}, deployment=${payload.signatureAlignment?.deployment}`,
    ].join("\n") + "\n";
  }

  if (subject === "graph") {
    return [
      `Graph inspection for ${payload.route?.pathname ?? payload.selector}`,
      `Route nodes: ${payload.routeNodes?.length ?? 0}`,
      `Consistency nodes: ${payload.consistencyNodes?.length ?? 0}`,
      `Consistency edges: ${payload.consistencyEdges?.length ?? 0}`,
    ].join("\n") + "\n";
  }

  if (subject === "cache") {
    return [
      `Cache inspection (${payload.matchedBy}) for ${payload.selector}`,
      `Entries: ${payload.entries?.length ?? 0}`,
      `Invalidation links: ${payload.invalidationLinks?.length ?? 0}`,
    ].join("\n") + "\n";
  }

  if (subject === "action") {
    return [
      `Action inspection for ${payload.selector}`,
      `Entries: ${payload.entries?.length ?? 0}`,
    ].join("\n") + "\n";
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

type DiffPayload = {
  current: { buildId: string };
  baseline: { buildId: string };
  manifests: { added: string[]; removed: string[]; changed: string[] };
  routes: {
    added: { pathname: string; changes: string[] }[];
    removed: { pathname: string; changes: string[] }[];
    changed: { pathname: string; changes: string[] }[];
  };
  policyMesh: {
    objectiveChanged: boolean;
    reducerPhasesChanged: boolean;
    changedRoutes: number;
  };
  doctor?: {
    regressions?: string[];
  };
};

function formatDiffText(payload: DiffPayload): string {
  const lines = [
    `Compared ${payload.current.buildId} against ${payload.baseline.buildId}`,
    `Manifest changes: +${payload.manifests.added.length} / -${payload.manifests.removed.length} / ~${payload.manifests.changed.length}`,
    `Route changes: +${payload.routes.added.length} / -${payload.routes.removed.length} / ~${payload.routes.changed.length}`,
    `Policy mesh: objectiveChanged=${payload.policyMesh.objectiveChanged}, reducerPhasesChanged=${payload.policyMesh.reducerPhasesChanged}, changedRoutes=${payload.policyMesh.changedRoutes}`,
  ];
  if (payload.doctor) {
    lines.push(`Doctor regressions: ${(payload.doctor.regressions ?? []).join(", ") || "none"}`);
  }
  if ((payload.routes.changed ?? []).length > 0) {
    lines.push("Changed routes:");
    for (const route of payload.routes.changed.slice(0, 10)) {
      lines.push(`- ${route.pathname}: ${route.changes.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatExplainText(payload: {
  summary: string;
  reducerPhases?: string[];
  loopNames?: string[];
  reasons?: string[];
  policyDiagnostics?: {
    objective?: string;
    changedDecisionFields?: string[];
    decisionTraceCount?: number;
  };
  doctor?: {
    summary: { passed: boolean };
    findings?: unknown[];
  };
}): string {
  const lines = [
    payload.summary,
    `Reducer phases: ${(payload.reducerPhases ?? []).join(" -> ")}`,
    `Policy loops: ${(payload.loopNames ?? []).join(", ")}`,
    `Reasons: ${(payload.reasons ?? []).join(" | ")}`,
  ];
  if (payload.policyDiagnostics) {
    lines.push(
      `Diagnostics: objective=${payload.policyDiagnostics.objective ?? "n/a"}, changedFields=${(payload.policyDiagnostics.changedDecisionFields ?? []).join(", ") || "none"}, decisionTraces=${payload.policyDiagnostics.decisionTraceCount ?? 0}`,
    );
  }
  if (payload.doctor) {
    lines.push(
      `Doctor: ${payload.doctor.summary.passed ? "passed" : "issues found"} with ${payload.doctor.findings?.length ?? 0} route-linked finding(s)`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp(args.command);
    return;
  }

  switch (args.command) {
    case "dev": {
      const server = await createSourceOGServer({
        cwd: args.cwd,
        mode: "development",
        port: args.port,
        portFallback: args.portFallback,
      });
      const port = await server.start();
      process.stdout.write(`SourceOG dev server running at http://localhost:${port} (${server.config.stability})\n`);
      break;
    }
    case "build": {
      await runBuild(args.cwd);
      process.stdout.write("SourceOG build completed successfully.\n");
      break;
    }
    case "start": {
      const server = await createSourceOGServer({
        cwd: args.cwd,
        mode: "production",
        port: args.port,
        portFallback: args.portFallback,
      });
      const port = await server.start();
      process.stdout.write(`SourceOG production server running at http://localhost:${port} using ${server.config.distRoot}\n`);
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
        `Artifacts: parity scoreboard -> ${report.artifactPaths.parityScoreboard}; milestone dashboard -> ${report.artifactPaths.milestoneDashboard}; support matrix -> ${report.artifactPaths.supportMatrix}; release evidence -> ${report.artifactPaths.releaseEvidenceIndex}.\n`
      );
      break;
    }
    case "audit": {
      const report = await auditSourceogPublishReadiness(findWorkspaceRoot(args.cwd));
      process.stdout.write(
        `SourceOG publish-readiness audit ${report.passed ? "passed" : "failed"} with ${report.findings.length} finding(s).\n`
      );
      process.stdout.write(
        `Artifacts: findings -> ${report.artifactPaths.auditFindings}; governance -> ${report.artifactPaths.packageGovernance}; readiness -> ${report.artifactPaths.publishReadiness}.\n`
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
      break;
    }
    case "release": {
      const report = await releaseApplication(args.cwd, {
        outputDir: args.outDir,
        diff: args.diff,
        runTypecheck: !args.skipTypecheck,
        runTests: !args.skipTests,
        signBundle: args.sign,
      });
      process.stdout.write(
        `SourceOG release bundle completed for build ${report.buildId} into ${report.outputDir}.\n`
      );
      process.stdout.write(
        `Artifacts: release evidence -> ${report.artifactPaths.releaseEvidenceIndex}; support matrix -> ${report.artifactPaths.supportMatrix ?? "n/a"}.\n`
      );
      if (report.artifactPaths.diffReport) {
        process.stdout.write(`Diff: ${report.artifactPaths.diffReport}.\n`);
      }
      break;
    }
    case "doctor": {
      const report = await runDoctor(args.cwd, {
        area: (args.area as DoctorArea | undefined) ?? "all",
      });
      process.stdout.write(
        `SourceOG doctor ${report.passed ? "passed" : "found issues"} for ${report.area} with ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), and ${report.summary.infos} info finding(s).\n`
      );
      process.stdout.write(
        `Artifacts: report -> ${report.artifactPaths.report}; remediation -> ${report.artifactPaths.remediation}; release evidence -> ${report.artifactPaths.releaseEvidenceIndex}.\n`
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
      break;
    }
    case "inspect": {
      if (!args.subject) {
        throw new Error("Inspect requires a subject such as manifest, governance, route, graph, cache, or action.");
      }

      let payload: unknown;
      switch (args.subject) {
        case "manifest":
        case "manifests":
          payload = args.compare
            ? await diffBuildArtifacts(args.cwd, path.resolve(args.cwd, args.compare))
            : await inspectBuildArtifacts(args.cwd);
          break;
        case "governance":
          payload = await inspectGovernance(args.cwd);
          break;
        case "route":
          payload = await inspectRoute(args.cwd, args.selector ?? "/");
          break;
        case "graph":
          payload = await inspectGraph(args.cwd, args.selector ?? "/");
          break;
        case "cache":
          payload = await inspectCache(args.cwd, args.selector ?? "all");
          break;
        case "action":
          payload = await inspectAction(args.cwd, args.selector ?? "");
          break;
        default:
          throw new Error(`Unsupported inspect subject "${args.subject}".`);
      }

      if (args.format === "text") {
        process.stdout.write(
          args.subject === "manifest" || args.subject === "manifests"
            ? (args.compare ? formatDiffText(payload) : formatInspectText(args.subject, payload))
            : formatInspectText(args.subject, payload),
        );
      } else {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      }
      break;
    }
    case "explain": {
      if (!args.subject) {
        throw new Error("Explain requires a subject such as route or decision.");
      }

      let payload: unknown;
      switch (args.subject) {
        case "route":
          payload = await explainRoute(args.cwd, args.selector ?? "/");
          break;
        case "decision":
          payload = await explainDecision(args.cwd, args.selector ?? "/");
          break;
        default:
          throw new Error(`Unsupported explain subject "${args.subject}".`);
      }

      if (args.format === "text") {
        process.stdout.write(formatExplainText(payload));
      } else {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      }
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
