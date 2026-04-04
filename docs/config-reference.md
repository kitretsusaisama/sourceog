# SourceOG Config Reference

`sourceog.config.ts` should export `defineConfig(...)` from `sourceog`.

## Current stable config fields

```ts
import {
  defineBudgetProfile,
  defineCompatMode,
  defineConfig,
  defineDoctorProfile,
  defineGraphProfile,
  defineRoutePolicy,
  defineRuntimeProfile,
  defineWorkerProfile,
} from "sourceog";

export default defineConfig({
  appDir: "app",
  srcDir: ".",
  distDir: ".sourceog",
  basePath: "",
  experimental: {},
  budgets: {
    "/": 150_000,
  },
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
    localeDetection: true,
  },
  images: {
    domains: [],
    formats: ["webp", "avif"],
  },
  env: {
    required: [],
  },
  security: {
    contentSecurityPolicy: "default-src 'self'",
  },
  runtime: defineRuntimeProfile({
    artifactMode: "strict",
  }),
  runtimePolicy: {
    fallbackBans: ["source-probing", "runtime-transpile"],
  },
  artifactPolicy: {
    signatures: "required",
    replayRetention: 10,
  },
  workerPolicy: defineWorkerProfile({
    prewarm: 2,
    pool: "burst",
  }),
  cachePolicy: {
    namespaces: ["public"],
  },
  graphPolicy: defineGraphProfile({
    consistency: "strict",
  }),
  doctorPolicy: defineDoctorProfile({
    failOnWarnings: false,
  }),
  compat: defineCompatMode({
    nextAppRouter: "strict",
  }),
  budgetsByRoute: {
    "/": defineBudgetProfile({
      shellBytes: 150_000,
    }),
  },
  canary: {
    routePolicy: defineRoutePolicy({
      strategy: "adaptive",
    }),
  },
  manifestVersion: "2027.1",
  stability: "stable",
});
```

## Field notes

- `appDir`: app directory name under the configured source root.
- `srcDir`: source root, relative to project root.
- `distDir`: build output root.
- `basePath`: URL base path.
- `experimental`: feature flags reserved for non-stable behaviors.
- `budgets`: route bundle budgets used by release verification.
- `i18n`: locale configuration for route expansion and localization helpers.
- `images`: current Image-domain and format policy.
- `env.required`: required environment variables enforced during config resolution.
- `security`: security policy defaults used by the platform layer.
- `runtime`, `runtimePolicy`, `artifactPolicy`: artifact-mode, capability, and signature-control sections for the ADOSF runtime contract.
- `workerPolicy`: worker prewarm, pool, and lifecycle controls.
- `cachePolicy`: namespace, invalidation, and stampede-control settings.
- `graphPolicy`: graph consistency and invalidation controls.
- `doctorPolicy`: doctor fail levels and remediation verbosity.
- `compat`: compatibility contracts and migration posture.
- `budgetsByRoute`: route-scoped budget profiles layered on top of global `budgets`.
- `release`: release-signature bundles, evidence indexes, and benchmark gating.
- `governance`: route ownership, package governance, and change-risk policy controls.
- `manifestVersion`: emitted build manifest contract version.
- `stability`: release channel marker.

## Control-plane sections

The config resolver now preserves the ADOSF control-plane sections so `sourceog.config.ts` can act as the typed product control plane:

- `app`, `routing`, `rendering`
- `runtime`, `runtimePolicy`, `artifactPolicy`
- `workers`, `workerPolicy`
- `streaming`, `streamPolicy`
- `cache`, `cachePolicy`, `invalidations`
- `graph`, `graphPolicy`
- `assets`, `images`, `scripts`, `fonts`, `styling`
- `forms`, `security`, `auth`, `automation`, `observability`
- `doctor`, `doctorPolicy`, `diagnostics`
- `deployment`, `budgets`, `budgetsByRoute`
- `profiles`, `regions`, `canary`, `compat`, `testing`
- `replayPolicy`, `governance`, `release`, `cost`, `slo`
- `scaffolds`, `benchmarks`, `experimental`

These sections are now passed through the public config contract, but only the behaviors already implemented in the runtime, doctor, and verification layers should be considered semantically stable.

## Release evidence

The ADOSF release contract now emits a release evidence index into the build output:

- `.sourceog/release-evidence-index.json`

That index is written first by the compiler from signed governance artifacts, then enriched by `sourceog verify` and `sourceog doctor` with operator evidence such as:

- doctor report and remediation output
- parity scoreboard and milestone dashboard
- publish-readiness findings
- benchmark report presence

This keeps runtime law, doctor law, replay law, policy law, and governance law attached to the same machine-readable release bundle.
