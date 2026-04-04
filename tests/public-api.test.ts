import { describe, expect, it } from "vitest";
import {
  defineActionPolicy,
  createRequestContext,
  createRouteHandler,
  defineAutomation,
  defineAdapter,
  defineBenchmarkProfile,
  defineBudgetProfile,
  defineCanaryProfile,
  defineCompatMode,
  defineConfig,
  defineDoctorProfile,
  defineGraphProfile,
  defineMiddleware,
  defineObservabilityProfile,
  definePlugin,
  defineRoutePolicy,
  defineRuntimeProfile,
  defineRoute,
  explainDecision,
  explainRoute,
  exportDoctorReport,
  getExecutionPlan,
  defineSchedule,
  defineSecurityPolicy,
  Image,
  inspectAction,
  inspectBuildArtifacts,
  inspectCache,
  diffBuildArtifacts,
  inspectGraph,
  inspectGovernance,
  inspectDecision,
  inspectRoute,
  inspectRequestContext,
  json,
  Link,
  notFound,
  parseBody,
  prefetchRoute,
  rateLimit,
  revalidateTag,
  runDoctor,
  sourceogFetch,
  text,
  usePathname,
  useRouter,
  unstable_cache,
  verifyArtifactIntegrity
} from "sourceog";
import * as auth from "sourceog/auth";
import * as actions from "sourceog/actions";
import * as automation from "sourceog/automation";
import * as cache from "sourceog/cache";
import * as config from "sourceog/config";
import * as doctor from "sourceog/doctor";
import * as explain from "sourceog/explain";
import * as graph from "sourceog/graph";
import * as headersModule from "sourceog/headers";
import * as governance from "sourceog/governance";
import * as i18n from "sourceog/i18n";
import * as image from "sourceog/image";
import * as inspect from "sourceog/inspect";
import * as navigation from "sourceog/navigation";
import * as policies from "sourceog/policies";
import * as request from "sourceog/request";
import * as replay from "sourceog/replay";
import * as runtime from "sourceog/runtime";
import * as server from "sourceog/server";
import * as testing from "sourceog/testing";
import * as validation from "sourceog/validation";

describe("sourceog public API", () => {
  it("exports the stable root helpers used by apps", () => {
    expect(typeof defineConfig).toBe("function");
    expect(typeof defineAdapter).toBe("function");
    expect(typeof defineAutomation).toBe("function");
    expect(typeof defineSchedule).toBe("function");
    expect(typeof defineSecurityPolicy).toBe("function");
    expect(typeof defineCompatMode).toBe("function");
    expect(typeof defineRoutePolicy).toBe("function");
    expect(typeof defineActionPolicy).toBe("function");
    expect(typeof defineBudgetProfile).toBe("function");
    expect(typeof defineCanaryProfile).toBe("function");
    expect(typeof defineObservabilityProfile).toBe("function");
    expect(typeof defineDoctorProfile).toBe("function");
    expect(typeof defineRuntimeProfile).toBe("function");
    expect(typeof defineGraphProfile).toBe("function");
    expect(typeof definePlugin).toBe("function");
    expect(typeof defineBenchmarkProfile).toBe("function");
    expect(typeof defineMiddleware).toBe("function");
    expect(typeof defineRoute).toBe("function");
    expect(typeof createRouteHandler).toBe("function");
    expect(typeof sourceogFetch).toBe("function");
    expect(typeof unstable_cache).toBe("function");
    expect(typeof revalidateTag).toBe("function");
    expect(typeof prefetchRoute).toBe("function");
    expect(typeof json).toBe("function");
    expect(typeof text).toBe("function");
    expect(typeof notFound).toBe("function");
    expect(typeof useRouter).toBe("function");
    expect(typeof usePathname).toBe("function");
    expect(typeof rateLimit).toBe("function");
    expect(typeof parseBody).toBe("function");
    expect(typeof createRequestContext).toBe("function");
    expect(typeof inspectRequestContext).toBe("function");
    expect(typeof getExecutionPlan).toBe("function");
    expect(typeof inspectDecision).toBe("function");
    expect(typeof inspectBuildArtifacts).toBe("function");
    expect(typeof inspectGovernance).toBe("function");
    expect(typeof inspectRoute).toBe("function");
    expect(typeof inspectGraph).toBe("function");
    expect(typeof inspectCache).toBe("function");
    expect(typeof inspectAction).toBe("function");
    expect(typeof diffBuildArtifacts).toBe("function");
    expect(typeof explainRoute).toBe("function");
    expect(typeof explainDecision).toBe("function");
    expect(typeof verifyArtifactIntegrity).toBe("function");
    expect(typeof runDoctor).toBe("function");
    expect(typeof exportDoctorReport).toBe("function");
    expect(Image).toBeTruthy();
    expect(Link).toBeTruthy();
  });

  it("exposes stable subpath modules", () => {
    expect(typeof actions.callServerAction).toBe("function");
    expect(typeof actions.callServerActionById).toBe("function");
    expect(typeof actions.createServerAction).toBe("function");
    expect(typeof actions.createActionReceipt).toBe("function");
    expect(typeof actions.confirmActionReceipt).toBe("function");
    expect(typeof actions.useActionQueue).toBe("function");
    expect(typeof actions.refreshCurrentRoute).toBe("function");
    expect(typeof automation.defineAutomation).toBe("function");
    expect(typeof automation.defineSchedule).toBe("function");
    expect(typeof cache.unstable_cache).toBe("function");
    expect(typeof cache.revalidateTag).toBe("function");
    expect(typeof cache.invalidateResource).toBe("function");
    expect(typeof cache.cacheMode).toBe("function");
    expect(typeof cache.cacheScope).toBe("function");
    expect(typeof cache.warmRoute).toBe("function");
    expect(typeof cache.inspectRouteCache).toBe("function");
    expect(typeof config.defineConfig).toBe("function");
    expect(typeof config.defineCompatMode).toBe("function");
    expect(typeof config.defineRoutePolicy).toBe("function");
    expect(typeof auth.createJWT).toBe("function");
    expect(typeof auth.verifyJWT).toBe("function");
    expect(typeof i18n.detectLocale).toBe("function");
    expect(typeof i18n.localizePathname).toBe("function");
    expect(image.Image).toBeTruthy();
    expect(typeof headersModule.cookies).toBe("function");
    expect(typeof headersModule.headers).toBe("function");
    expect(typeof navigation.useRouter).toBe("function");
    expect(typeof navigation.usePathname).toBe("function");
    expect(typeof navigation.Link).toBe("function");
    expect(typeof request.cookies).toBe("function");
    expect(typeof request.headers).toBe("function");
    expect(typeof request.createRequestContext).toBe("function");
    expect(typeof runtime.inspectArtifactSet).toBe("function");
    expect(typeof runtime.verifyArtifactIntegrity).toBe("function");
    expect(typeof runtime.getExecutionPlan).toBe("function");
    expect(typeof policies.createPolicyMeshController).toBe("function");
    expect(typeof graph.ClientConsistencyGraph).toBe("function");
    expect(typeof governance.inspectGovernance).toBe("function");
    expect(typeof replay.exportDecisionReplay).toBe("function");
    expect(typeof server.createRouteHandler).toBe("function");
    expect(typeof doctor.scanProject).toBe("function");
    expect(typeof doctor.exportReport).toBe("function");
    expect(typeof inspect.inspectBuildArtifacts).toBe("function");
    expect(typeof inspect.inspectRoute).toBe("function");
    expect(typeof explain.explainDecision).toBe("function");
    expect(typeof explain.explainRoute).toBe("function");
    expect(typeof testing.createTestInstance).toBe("function");
    expect(typeof validation.parseBody).toBe("function");
    expect(typeof validation.parseQuery).toBe("function");
  });
});
