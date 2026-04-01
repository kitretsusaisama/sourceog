import { createCloudflareAdapter } from "../../adapter-cloudflare/src/index.js";
import { createNodeAdapter } from "../../adapter-node/src/index.js";
import { createVercelEdgeAdapter } from "../../adapter-vercel-edge/src/index.js";
import { createVercelNodeAdapter } from "../../adapter-vercel-node/src/index.js";
import {
  SOURCEOG_ERROR_CODES,
  SourceOGError,
  type DeploymentManifest
} from "@sourceog/runtime";
import { adapterParityHarness, type FixtureRequest } from "../../sourceog-testing/src/harness.js";

export interface AdapterParityVerificationReport {
  passed: boolean;
  fixtureCount: number;
}

export async function runFirstPartyAdapterParityVerification(
  manifest: DeploymentManifest
): Promise<AdapterParityVerificationReport> {
  const fixtures = createAdapterParityFixtures(manifest);
  const result = await adapterParityHarness({
    manifest,
    fixtures,
    adapters: [
      createNodeAdapter(),
      createCloudflareAdapter(),
      createVercelNodeAdapter(),
      createVercelEdgeAdapter()
    ]
  });

  if (!result.passed) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.ADAPTER_PARITY_FAILED,
      "First-party adapter parity verification failed.",
      { mismatches: result.mismatches }
    );
  }

  return {
    passed: true,
    fixtureCount: fixtures.length
  };
}

export function createAdapterParityFixtures(
  manifest: DeploymentManifest
): Array<{ name: string; request: FixtureRequest }> {
  const routeFixtures = [...new Set(manifest.routes.map((route) => materializePathname(route.pathname)))]
    .map((pathname, index) => ({
      name: `route-${index + 1}`,
      request: {
        pathname,
        method: "GET"
      }
    }));

  return [
    ...routeFixtures,
    {
      name: "missing-route",
      request: {
        pathname: "/__sourceog_missing__",
        method: "GET"
      }
    }
  ];
}

export function materializePathname(pathname: string): string {
  const optionalCatchAllNormalized = pathname.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "");
  const catchAllNormalized = optionalCatchAllNormalized.replace(/\[\.\.\.[^\]]+\]/g, "sourceog/parity");
  const dynamicNormalized = catchAllNormalized.replace(/\[[^\]]+\]/g, "sourceog");
  const collapsed = catchAllNormalized === "/"
    ? "/"
    : dynamicNormalized.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return collapsed || "/";
}
