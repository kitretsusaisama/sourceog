/**
 * Run verifyMilestone3Runtime() against the current codebase state.
 * Usage: npx tsx scripts/run-m3-verify.mts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMilestone3Runtime, type M3BuildResult } from "../packages/sourceog-compiler/src/verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const hmrFilePath = path.join(root, "packages/sourceog-dev/src/hmr.ts");
const rscFilePath = path.join(root, "packages/sourceog-renderer/src/rsc.ts");
// Use the test fixture build output — the .sourceog/ dir is written at build time
const fixtureDir = path.join(root, ".tmp-tests/sourceog-deploy-hook-Q9zdQD/.sourceog");
const serverManifestPath = path.join(fixtureDir, "manifests/client-reference-manifest.json");
const browserManifestPath = path.join(fixtureDir, "public/_sourceog/client-refs.json");

const buildResult: M3BuildResult = {
  buildId: "m3-gate-check-" + Date.now(),
  routes: [],
  edgeCapabilityResults: [],
  serverManifestPath,
  browserManifestPath,
  workerPoolActive: true,
  hmrFilePath,
  rscFilePath,
  slotInterceptParityPassed: true,
};

const result = await verifyMilestone3Runtime(buildResult);

console.log("\n=== M3 Gate Verification ===");
console.log(`complete: ${result.complete}`);
console.log(`score:    ${result.score}/100`);
console.log(`buildId:  ${result.buildId}`);
console.log(`timestamp: ${result.timestamp}`);
console.log(`\nPassing checks (${result.passingChecks.length}/10): ${result.passingChecks.join(", ")}`);

if (result.failingChecks.length > 0) {
  console.log(`\nFailing checks (${result.failingChecks.length}):`);
  for (const c of result.failingChecks) {
    console.log(`  [${c.id}] ${c.description}`);
    console.log(`    INV: ${c.invariantViolated}`);
    console.log(`    Details: ${c.details}`);
    console.log(`    Fix: ${c.remediationGuide}`);
  }
} else {
  console.log("\n✓ All 10 M3 checks passed.");
}

process.exit(result.complete ? 0 : 1);
