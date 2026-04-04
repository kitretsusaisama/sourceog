import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  defineBenchmarkProfile,
  defineBudgetProfile,
  defineCompatMode,
  defineConfig,
  defineDoctorProfile,
  defineGraphProfile,
  defineRoutePolicy,
  defineRuntimeProfile,
  defineTestProfile,
  defineWorkerProfile,
  resolveConfig,
} from "@sourceog/platform";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("config", () => {
  it("loads sourceog.config.ts", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const config = await resolveConfig(path.resolve(process.cwd(), "examples/app-basic"));
    expect(config.appDir).toBe("app");
    expect(config.i18n?.defaultLocale).toBe("en");
  });

  it("preserves advanced ADOSF control-plane sections during resolution", async () => {
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-config-"));

    await fs.writeFile(
      path.join(tempDir, "sourceog.config.mjs"),
      [
        "export default {",
        "  appDir: 'app',",
        "  runtime: { artifactMode: 'strict' },",
        "  runtimePolicy: { fallbackBans: ['source-probing'] },",
        "  artifactPolicy: { signatures: 'required' },",
        "  workerPolicy: { prewarm: 2 },",
        "  streamPolicy: { shellOrder: 'strict' },",
        "  cachePolicy: { namespaces: ['public'] },",
        "  graphPolicy: { pruneCadenceSeconds: 60 },",
        "  doctorPolicy: { failOnWarnings: false },",
        "  diagnostics: { explainability: true },",
        "  governance: { routeOwnership: true },",
        "  release: { benchmarkGate: true },",
        "  cost: { objective: 'latency' },",
        "  slo: { ttfbMs: 250 },",
        "  canary: { routePercentage: 5 },",
        "  testing: { tempDirIsolation: true },",
        "  replayPolicy: { retainSnapshots: 5 },",
        "  budgetsByRoute: { '/': { shellBytes: 4096 } }",
        "};",
      ].join("\n"),
      "utf8",
    );

    const config = await resolveConfig(tempDir);
    expect(config.runtime).toEqual({ artifactMode: "strict" });
    expect(config.runtimePolicy).toEqual({ fallbackBans: ["source-probing"] });
    expect(config.artifactPolicy).toEqual({ signatures: "required" });
    expect(config.workerPolicy).toEqual({ prewarm: 2 });
    expect(config.streamPolicy).toEqual({ shellOrder: "strict" });
    expect(config.cachePolicy).toEqual({ namespaces: ["public"] });
    expect(config.graphPolicy).toEqual({ pruneCadenceSeconds: 60 });
    expect(config.doctorPolicy).toEqual({ failOnWarnings: false });
    expect(config.diagnostics).toEqual({ explainability: true });
    expect(config.governance).toEqual({ routeOwnership: true });
    expect(config.release).toEqual({ benchmarkGate: true });
    expect(config.cost).toEqual({ objective: "latency" });
    expect(config.slo).toEqual({ ttfbMs: 250 });
    expect(config.canary).toEqual({ routePercentage: 5 });
    expect(config.testing).toEqual({ tempDirIsolation: true });
    expect(config.replayPolicy).toEqual({ retainSnapshots: 5 });
    expect(config.budgetsByRoute).toEqual({ "/": { shellBytes: 4096 } });
  });

  it("exposes config and profile helper factories as identity helpers", () => {
    const config = defineConfig({ runtime: { artifactMode: "strict" } });
    const compat = defineCompatMode({ nextAppRouter: "strict" });
    const routePolicy = defineRoutePolicy({ strategy: "adaptive" });
    const budgetProfile = defineBudgetProfile({ shellBytes: 4096 });
    const doctorProfile = defineDoctorProfile({ failOnWarnings: false });
    const runtimeProfile = defineRuntimeProfile({ runtime: "node" });
    const workerProfile = defineWorkerProfile({ pool: "burst" });
    const graphProfile = defineGraphProfile({ consistency: "strict" });
    const benchmarkProfile = defineBenchmarkProfile({ compare: "nextjs" });
    const testProfile = defineTestProfile({ fixture: "app-basic" });

    expect(config.runtime).toEqual({ artifactMode: "strict" });
    expect(compat.nextAppRouter).toBe("strict");
    expect(routePolicy.strategy).toBe("adaptive");
    expect(budgetProfile.shellBytes).toBe(4096);
    expect(doctorProfile.failOnWarnings).toBe(false);
    expect(runtimeProfile.runtime).toBe("node");
    expect(workerProfile.pool).toBe("burst");
    expect(graphProfile.consistency).toBe("strict");
    expect(benchmarkProfile.compare).toBe("nextjs");
    expect(testProfile.fixture).toBe("app-basic");
  });
});
