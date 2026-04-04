<!-- sourceog MDX Prompt Guide - MNC Grade | DX-Friendly | Edge-Case Hardened -->
<!-- Version: 2.0.0 | Stability: Stable unless marked [preview] -->

# sourceog Prompt Guide

> **Audience:** Platform engineers, senior frontend developers, and DX leads at MNC scale.
> **Scope:** Stable root APIs · config semantics · route-level exports · policy mesh ·
> Doctor subsystem · testing harnesses · CLI · plugin/adapter system · multi-tenancy ·
> observability · workflows · benchmarks · compat mode · full edge-case reference · glossary.

---

## Table of Contents

1. [Mental Model](#mental-model)
2. [Artifact Pipeline](#artifact-pipeline)
3. [Navigation APIs](#navigation-apis)
4. [Actions and Forms](#actions-and-forms)
5. [Request and Runtime APIs](#request-and-runtime-apis)
6. [Cache and Graph APIs](#cache-and-graph-apis)
7. [Platform Helpers](#platform-helpers)
8. [Config Semantics (`sourceog.config.ts`)](#config-semantics-sourceogconfigts)
9. [Route-Level Exports](#route-level-exports)
10. [Policy Mesh](#policy-mesh)
11. [Doctor Subsystem](#doctor-subsystem)
12. [Worker Fabric](#worker-fabric)
13. [CLI Reference](#cli-reference)
14. [Testing Harnesses](#testing-harnesses)
15. [Edge Cases and Failure Modes](#edge-cases-and-failure-modes)
16. [Migration Checklist](#migration-checklist)
17. [Governance and Release Artifacts](#governance-and-release-artifacts)
18. [Middleware](#middleware)
19. [Automation, Scheduling, and Workflows](#automation-scheduling-and-workflows)
20. [Advanced Rendering and Streaming](#advanced-rendering-and-streaming)
21. [Data and Graph System](#data-and-graph-system)
22. [Plugin System](#plugin-system)
23. [Adapter System](#adapter-system)
24. [Observability Deep-Dive](#observability-deep-dive)
25. [Multi-Tenancy Patterns](#multi-tenancy-patterns)
26. [TypeScript Patterns](#typescript-patterns)
27. [Benchmark Profiles](#benchmark-profiles)
28. [Compat Mode](#compat-mode)
29. [Asset Pipeline Deep-Dive](#asset-pipeline-deep-dive)
30. [Advanced Testing Patterns](#advanced-testing-patterns)
31. [IDE and DevTools Integration](#ide-and-devtools-integration)
32. [Canary and Regional Policy Loops](#canary-and-regional-policy-loops)
33. [Error Handling Patterns](#error-handling-patterns)
34. [Complete Edge-Case Reference Table](#complete-edge-case-reference-table)
35. [Glossary](#glossary)

---

## Mental Model

sourceog is an **artifact-first, policy-driven** platform. Unlike conventional meta-frameworks
that let the runtime probe the source tree at request time, sourceog enforces a strict pipeline:

```text
Source -> Compiler -> Signed Manifests -> Packed Artifact -> Runtime
```

**Three invariants that never break:**

| Invariant | Enforcement point | Failure mode |
|-----------|-------------------|--------------|
| No source probing in production | Runtime boot | Hard crash with `ARTIFACT_INTEGRITY_VIOLATION` |
| Signature chain must be complete | Deployment validation | Deploy rejected |
| Policy reducer precedence is fixed | Policy mesh | Cannot be overridden at call site |

> **DX tip:** Run `sourceog doctor` before every deploy. It is the single source of truth for
> artifact health, policy drift, and release-evidence completeness.

---

## Artifact Pipeline

### What the Compiler Emits

The compiler owns and signs every manifest. Never construct or patch a manifest by hand.

```ts
// Manifests emitted by the compiler (read-only at runtime)
compiled-module-map
execution-graph-manifest
capability-manifest
action-graph-manifest
asset-dependency-manifest
render-checkpoint-manifest
hydration-manifest
stream-topology-manifest
worker-topology-manifest
doctor-baseline-manifest
policy-replay-manifest
route-execution-signature-manifest
route-budget-manifest
release-signature-manifest
deployment-signature-manifest
```

### What the Runtime Consumes

```ts
// Manifests consumed by the runtime (never authored manually)
deployment-manifest
control-plane-manifest
policy-replay-manifest
tuner-snapshot-manifest
consistency-graph-manifest
render-manifest
cache-manifest
asset-manifest
action-manifest
client-server-reference-manifests
signature-manifests
```

### What Deployment Validates

```ts
verifyArtifactIntegrity() // validates all four:
// 1. compiler signature
// 2. runtime signature
// 3. deployment signature
// 4. artifact schema compatibility
// 5. adapter capability fit
// 6. release evidence completeness
```

**Edge case - partial manifest:** If any manifest is missing, deployment rejects with a diff
showing the absent nodes. Use `sourceog inspect --manifest <name>` to debug.

**Edge case - schema drift:** Upgrading the framework minor version can bump manifest schemas.
Always run `sourceog doctor migration` before upgrading to get a pre-flight schema diff.

---

## Navigation APIs

All navigation hooks are stable. They are safe to use in Server Components, Client Components,
and Middleware without feature-flag guards.

### `useRouter`

```ts
import { useRouter } from 'sourceog/navigation'

// Client Component only
const router = useRouter()

router.push('/dashboard')
router.replace('/login', { scroll: false })
router.back()
router.prefetch('/heavy-route')        // manual prefetch
router.refresh()                       // revalidate current route subtree
router.refreshRoute('/other')          // revalidate a specific route
```

**Edge case - concurrent navigation:** Calling `router.push` while a previous push is in
flight does not queue - it replaces the pending navigation. Wrap in a transition if you need
sequential guarantees:

```ts
startTransition(() => router.push('/next'))
```

**Edge case - prefetch in middleware:** `prefetchRoute` is a server-side import only.
Using `useRouter().prefetch` inside middleware throws at compile time.

---

### `usePathname`

```ts
import { usePathname } from 'sourceog/navigation'

const pathname = usePathname() // '/dashboard/settings'
```

**Edge case - parallel routes:** In parallel route segments, `usePathname` returns the slot's
matched segment, not the root pathname. Use `useSelectedLayoutSegments()` to get full breadcrumb.

---

### `useSearchParams`

```ts
import { useSearchParams } from 'sourceog/navigation'

const params = useSearchParams()
const tab = params.get('tab') ?? 'overview'
```

**Edge case - server rendering:** `useSearchParams` suspends the component during SSR unless
wrapped in a `<Suspense>` boundary. The compiler emits a warning if the boundary is missing.
Doctor check: `sourceog doctor render --check missing-suspense-boundary`.

---

### `useParams`

```ts
import { useParams } from 'sourceog/navigation'

// Route: /products/[category]/[id]
const { category, id } = useParams<{ category: string; id: string }>()
```

---

### `useSelectedLayoutSegment` / `useSelectedLayoutSegments`

```ts
import {
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from 'sourceog/navigation'

// Returns the active child segment of the closest layout
const segment = useSelectedLayoutSegment()   // 'settings'
const segments = useSelectedLayoutSegments() // ['dashboard', 'settings']
```

**Use case:** Breadcrumbs, tab active states, animated layout indicators.

---

### `Link`

```tsx
import { Link } from 'sourceog/navigation'

<Link
  href="/docs/api"
  prefetch="intent"          // 'intent' | 'viewport' | 'eager' | false
  scroll={false}
  replace={false}
>
  API Reference
</Link>
```

**Edge case - `prefetch="intent"` + auth gates:** If the prefetched route has a
`requireCapability` check that will fail for the current user, the prefetch still fires but
the page will redirect on navigation. This is by design - prefetch is optimistic.

---

### `redirect` / `permanentRedirect`

```ts
import { redirect, permanentRedirect } from 'sourceog/navigation'

// Inside Server Component or Route Handler
redirect('/login')                   // 307 temporary
permanentRedirect('/new-canonical')  // 308 permanent
```

**Edge case - redirect inside action:** `redirect()` inside a Server Action throws a special
redirect signal that is caught by the action runtime, not by the nearest try/catch. Do not
wrap Server Action bodies in a broad try/catch unless you re-throw `NEXT_REDIRECT`.

---

### `prefetchRoute` / `prefetchOnIntent` / `refresh` / `refreshRoute`

```ts
import {
  prefetchRoute,
  prefetchOnIntent,
  refresh,
  refreshRoute,
} from 'sourceog/navigation'

// Server-side route warming utility
await prefetchRoute('/dashboard', { priority: 'high' })

// Attach to a DOM element - fires prefetch on hover/focus
prefetchOnIntent(elementRef, '/reports')

// Revalidate the current route tree (server-side)
refresh()

// Revalidate a specific route subtree
refreshRoute('/api/data')
```

---

## Actions and Forms

### `createServerAction`

```ts
import { createServerAction } from 'sourceog/actions'

const updateProfile = createServerAction(async (formData: FormData) => {
  'use server'
  const name = formData.get('name') as string
  await db.user.update({ where: { id: session.userId }, data: { name } })
})
```

### `callServerAction` / `callServerActionById`

```ts
import { callServerAction, callServerActionById } from 'sourceog/actions'

// Programmatic invocation (non-form context)
const result = await callServerAction(updateProfile, payload)

// By stable ID (useful for action replay and audit logs)
const result = await callServerActionById('action::updateProfile::v2', payload)
```

**Edge case - action ID stability:** Action IDs are derived from the module path and export
name. Renaming the file or the export changes the ID. If you rely on `callServerActionById`
for replay, register a stable alias in `defineActionPolicy`:

```ts
// sourceog.config.ts
export default defineConfig({
  forms: {
    actionPolicy: defineActionPolicy({
      aliases: {
        'action::updateProfile::v2': './actions/profile#updateProfile',
      },
    }),
  },
})
```

---

### `createActionReceipt` / `confirmActionReceipt`

```ts
import { createActionReceipt, confirmActionReceipt } from 'sourceog/actions'

// Issue a receipt token for idempotency
const receipt = await createActionReceipt({ actionId: 'updateProfile', userId })

// Confirm the receipt was consumed (prevents double-execution)
await confirmActionReceipt(receipt.token)
```

**Edge case - distributed systems:** Receipts use optimistic locking. If two workers race
on the same receipt token, only one will confirm successfully. The losing worker receives
`RECEIPT_ALREADY_CONSUMED` and must not retry the action body.

---

### `useActionQueue`

```ts
import { useActionQueue } from 'sourceog/actions'

const { enqueue, drain, status } = useActionQueue()

// Queue multiple actions for ordered execution
enqueue(updateProfile, profileData)
enqueue(sendNotification, notifData)

// Wait for all to settle
await drain()
```

---

### `createOptimisticScope` / `useOptimistic`

```ts
import { createOptimisticScope, useOptimistic } from 'sourceog/actions'

// Server: define the scope
export const cartScope = createOptimisticScope('cart', cartReducer)

// Client: apply optimistic update
const [optimisticCart, applyOptimistic] = useOptimistic(cart, cartScope)

function addItem(item) {
  applyOptimistic({ type: 'ADD_ITEM', payload: item })
  startTransition(() => addToCart(item))
}
```

**Edge case - conflict-aware reconciliation:** If the server response conflicts with the
optimistic state (e.g., stock ran out), the scope reducer receives a `CONFLICT` action and
must return a reconciled state. Failing to handle `CONFLICT` causes the optimistic state to
persist indefinitely.

---

### `useFormStatus` / `useFormState`

```tsx
import { useFormStatus, useFormState } from 'sourceog/actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>
}

function ProfileForm() {
  const [state, action] = useFormState(updateProfile, { error: null })
  return (
    <form action={action}>
      {state.error && <p role="alert">{state.error}</p>}
      <input name="name" />
      <SubmitButton />
    </form>
  )
}
```

---

## Request and Runtime APIs

### `cookies` / `headers` / `draftMode`

```ts
import { cookies, headers, draftMode } from 'sourceog/headers'

// Server Component or Route Handler
const cookieStore = cookies()
const token = cookieStore.get('session')?.value

const requestHeaders = headers()
const ua = requestHeaders.get('user-agent')

const { isEnabled } = draftMode()
```

**Edge case - `cookies()` in middleware:** Middleware runs on the edge before the cookie
store is fully hydrated. Mutations via `cookies().set()` in middleware are written to the
response, but the set cookie is not available to subsequent `cookies()` reads within the
same middleware invocation.

---

### `after`

```ts
import { after } from 'sourceog/runtime'

// Execute side-effects after the response is sent
// Does not block streaming or TTFB
export async function GET() {
  const data = await fetchData()
  after(async () => {
    await analytics.track('api.get', { ts: Date.now() })
  })
  return Response.json(data)
}
```

**Edge case - `after` + serverless cold starts:** On cold-start invocations, the runtime
may not guarantee execution of `after` callbacks if the function instance is recycled before
the callback fires. Use `defineWorkerProfile({ afterGuarantee: 'best-effort' | 'at-least-once' })`
to opt into stronger delivery semantics (requires a durable worker class).

---

### `createRouteHandler` / `createRequestContext`

```ts
import { createRouteHandler, createRequestContext } from 'sourceog/runtime'

export const GET = createRouteHandler(async (req, ctx) => {
  const context = createRequestContext(req)
  const user = await context.resolve('currentUser')
  return Response.json(user)
})
```

---

### `getExecutionPlan` / `inspectDecision` / `inspectRequestContext`

```ts
import {
  getExecutionPlan,
  inspectDecision,
  inspectRequestContext,
} from 'sourceog/runtime'

// Debug rendering and caching decisions
const plan = getExecutionPlan('/dashboard')
const decision = inspectDecision(plan, 'cacheLayer')
const ctx = inspectRequestContext()

console.log(decision.reason)   // 'stale-while-revalidate - tag: user-42'
```

---

### `requireCapability` / `verifyArtifactIntegrity`

```ts
import { requireCapability, verifyArtifactIntegrity } from 'sourceog/runtime'

// Fail fast if the adapter cannot satisfy the capability
requireCapability('edge-streaming')
requireCapability('durable-workers')

// Validate all signed manifests at startup
await verifyArtifactIntegrity()
```

---

## Cache and Graph APIs

### `revalidatePath` / `revalidateTag` / `updateTag`

```ts
import { revalidatePath, revalidateTag, updateTag } from 'sourceog/cache'

// Purge by path
revalidatePath('/products/[id]', 'page')

// Purge all entries tagged with this key
revalidateTag('product-42')

// Rename a tag (useful when canonical IDs change)
updateTag('product-42-old', 'product-42-new')
```

**Edge case - tag fan-out at scale:** At MNC scale, a single `revalidateTag` can cascade
across millions of cache entries. Use `cacheScope` to partition tags by region or tenant to
bound invalidation blast radius.

---

### `cacheTag` / `cacheLife` / `cacheMode` / `cacheScope`

```ts
import { cacheTag, cacheLife, cacheMode, cacheScope } from 'sourceog/cache'

export async function ProductCard({ id }: { id: string }) {
  cacheTag(`product-${id}`, 'catalog')
  cacheLife('1h')                          // max-age 1 hour
  cacheMode('stale-while-revalidate')
  cacheScope('tenant', tenantId)           // per-tenant partition

  const product = await fetchProduct(id)
  return <div>{product.name}</div>
}
```

---

### `invalidateResource` / `unstable_cache` / `sourceogFetch`

```ts
import { invalidateResource, unstable_cache, sourceogFetch } from 'sourceog/cache'

// Targeted resource invalidation (finer than tag)
invalidateResource({ type: 'product', id: '42' })

// Low-level cache primitive (avoid unless building platform abstractions)
const cachedFetch = unstable_cache(
  async (id: string) => fetchProduct(id),
  ['product-detail'],
  { revalidate: 3600, tags: ['catalog'] }
)

// Graph-aware fetch - registers in the execution graph
const data = await sourceogFetch('/api/products', {
  graphNode: 'productList',
  cacheProfile: 'catalog',
})
```

---

### Route Warming APIs

```ts
import { warmRoute, warmTag, warmRouteSubtree } from 'sourceog/cache'

// Pre-warm a single route's cache
await warmRoute('/products/featured')

// Pre-warm all routes tagged with this key
await warmTag('catalog')

// Pre-warm an entire route subtree
await warmRouteSubtree('/products')
```

**Edge case - warming during deploy:** `warmRouteSubtree` triggered immediately after a
deploy before the new artifact is fully propagated to all edge nodes will partially warm
with stale manifests. Gate warming with `verifyArtifactIntegrity()` first.

---

### Cache Inspection

```ts
import { inspectRouteCache, inspectGraphNode } from 'sourceog/cache'

const cacheState = await inspectRouteCache('/products/42')
console.log(cacheState.hit, cacheState.age, cacheState.tags, cacheState.hotness)

const node = await inspectGraphNode('productList')
console.log(node.version, node.edges, node.invalidationHistory)
```

---

## Platform Helpers

### `Image`

```tsx
import { Image } from 'sourceog/platform'

<Image
  src="/hero.webp"
  alt="Hero image"
  width={1200}
  height={630}
  priority                   // LCP - skip lazy loading
  quality={85}
  placeholder="blur"
  blurDataURL={blurHash}
  cacheProfile="immutable"  // asset-level cache policy
/>
```

**Edge case - dynamic `src`:** Dynamic `src` values (e.g., from a CMS) must be allowlisted
in `defineAssetPolicy({ allowedDomains: ['cdn.example.com'] })`. Unallowlisted origins
fail at compile time.

---

### `Script`

```tsx
import { Script } from 'sourceog/platform'

<Script
  src="https://cdn.example.com/analytics.js"
  strategy="afterInteractive"   // 'beforeInteractive' | 'afterInteractive' | 'lazyOnload' | 'worker'
  onLoad={() => console.log('analytics ready')}
/>
```

---

### `Font`

```ts
import { Font } from 'sourceog/platform'

export const fontConfig = Font({
  family: 'Inter',
  subsets: ['latin'],
  weights: [400, 600, 700],
  display: 'swap',
  preload: true,
  routeSubset: ['/marketing/**'],  // route-aware subsetting
})
```

---

### `MetadataOutlet` / `SecurityHeaders`

```tsx
import { MetadataOutlet, SecurityHeaders } from 'sourceog/platform'

// In your root layout
export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <MetadataOutlet />
        <SecurityHeaders policy="strict" />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

---

## Config Semantics (`sourceog.config.ts`)

`sourceog.config.ts` is the single configuration surface. All sections are validated
against their schemas at compile time. Unrecognized keys fail the build.

```ts
// sourceog.config.ts - minimal MNC-grade config skeleton
import { defineConfig } from 'sourceog'

export default defineConfig({
  app: {
    name: 'acme-platform',
    baseUrl: process.env.BASE_URL,
  },

  runtime: {
    target: 'edge',                  // 'node' | 'edge' | 'workerd'
    artifactMode: 'strict',          // 'strict' | 'compat'
    fallbackBans: ['source-probe', 'transpiler-fallback'],
  },

  artifactPolicy: defineArtifactPolicy({
    signatureEnforcement: 'hard',
    manifestCompleteness: 'required',
    schemaCompatibility: 'strict',
    replayRetention: '30d',
  }),

  cache: defineCacheProfile({
    defaultLayer: 'distributed',
    antiStampede: { strategy: 'lock', ttl: '5s' },
    stalePolicy: 'stale-while-revalidate',
    namespaceRotation: 'on-deploy',
  }),

  workerPolicy: defineWorkerProfile({
    topology: 'pinned',
    warmPoolSize: 10,
    drainPolicy: 'graceful',
    quarantineThreshold: 5,          // errors before quarantine
    memoryBudget: '512mb',
  }),

  streamPolicy: defineRenderProfile({
    lanePriority: ['shell', 'critical', 'below-fold'],
    checkpointRules: 'auto',
    byteBudget: '200kb',
    computeBudget: '100ms',
  }),

  doctorPolicy: defineDoctorProfile({
    requiredChecks: ['artifact', 'security', 'budget', 'graph'],
    ciFailLevel: 'error',
    reportRetention: '90d',
    remediationVerbosity: 'detailed',
  }),

  governance: {
    routeOwnership: './owners.yaml',
    changeRiskScoring: 'auto',
    approvalPolicy: 'required-for-high-risk',
  },

  release: {
    signatureBundle: true,
    evidenceIndex: './release-evidence',
    benchmarkGating: true,
  },

  observability: defineObservabilityProfile({
    tracing: 'opentelemetry',
    metricsEndpoint: process.env.METRICS_URL,
    logLevel: 'info',
  }),

  deployment: {
    regions: ['sin', 'iad', 'fra'],
    canary: defineCanaryProfile({
      traffic: 0.05,
      successMetric: 'error-rate < 0.1%',
      rollbackTrigger: 'auto',
    }),
  },

  budgets: {
    global: { renderMs: 500, streamKb: 200 },
    budgetsByRoute: {
      '/checkout/**': { renderMs: 300, streamKb: 150 },
      '/marketing/**': { renderMs: 800, streamKb: 400 },
    },
  },
})
```

---

## Route-Level Exports

Route files can export metadata that overrides config defaults for that specific route.

### Next-Compatible Exports

```ts
// app/dashboard/page.tsx

// Identical semantics to Next.js App Router
export const runtime = 'edge'
export const preferredRegion = ['sin', 'iad']
export const maxDuration = 30
export const dynamic = 'force-dynamic'
export const revalidate = 60
export const fetchCache = 'force-cache'
```

### ADOSF-Native Exports

```ts
// app/checkout/page.tsx - ADOSF-native route policy
export const strategy = 'static-with-revalidation'
export const consistency = 'strong'
export const optimistic = true
export const priority = 'critical'

export const renderBudget = { ms: 300, streamKb: 150 }
export const streamingPolicy = defineStreamPolicy({ checkpoints: ['shell', 'payment-form'] })
export const cacheProfile = defineCacheProfile({ layer: 'memory', ttl: '0' })
export const assetPolicy = defineAssetPolicy({ preload: ['fonts', 'critical-css'] })
export const doctorProfile = defineDoctorProfile({ checks: ['pci-compliance', 'csp'] })
export const workerClass = 'durable'
export const degradePolicy = { onWorkerFailure: 'static-fallback' }
export const securityProfile = defineSecurityPolicy({ csp: 'strict', hsts: true })
export const traceProfile = defineObservabilityProfile({ sample: 1.0 }) // 100% on checkout
export const cacheNamespace = 'checkout-v2'
export const errorPolicy = { boundary: 'route', fallback: '/error/checkout' }
```

**Edge case - export conflict:** If a route exports both `revalidate = 60` (Next-compatible)
and `cacheProfile` (ADOSF-native), ADOSF-native wins. The compiler emits a `POLICY_CONFLICT`
warning. Always prefer ADOSF-native exports for new routes.

---

## Policy Mesh

The policy mesh is the enforcement layer between configuration and runtime behavior.

### Reducer Precedence (fixed, cannot be overridden at call site)

```text
1. Compatibility constraints          <- highest authority
2. Static route policy
3. Runtime and capability constraints
4. Loop proposals (tuning loops)
5. Safety envelope
6. Emergency override                 <- operator only, audit logged
```

### Defining a Custom Policy Loop

```ts
// sourceog.config.ts
import { defineCacheProfile } from 'sourceog'

export default defineConfig({
  cachePolicy: defineCacheProfile({
    loops: [
      {
        id: 'error-rate-cache-throttle',
        metric: 'cache-miss-rate',
        window: { type: 'rolling', duration: '5m' },
        thresholds: { warn: 0.3, critical: 0.6 },
        cooldown: '2m',
        hysteresis: 0.05,
        maxDeltaPerInterval: 0.1,
        onAnomaly: 'freeze',
        onCritical: 'rollback',
        confidenceThreshold: 0.9,
      },
    ],
  }),
})
```

**Edge case - loop stacking:** Multiple loops targeting the same metric can produce conflicting
proposals. The reducer resolves by taking the most conservative proposal. If two loops are in
the `freeze` state simultaneously, the system stays frozen until both cooldowns expire.

---

## Doctor Subsystem

Doctor is a first-class platform subsystem, not just a lint tool.

### Command Families

```bash
# Full system health
sourceog doctor

# Subsystem-specific
sourceog doctor runtime
sourceog doctor compile
sourceog doctor render
sourceog doctor stream
sourceog doctor worker
sourceog doctor graph
sourceog doctor cache
sourceog doctor migration
sourceog doctor package
sourceog doctor deployment
sourceog doctor security
sourceog doctor docs
sourceog doctor examples
sourceog doctor benchmark
sourceog doctor canary
```

### Reading Doctor Output

```bash
sourceog doctor --format json | jq '.checks[] | select(.status == "fail")'
```

Each check has:

```ts
interface DoctorCheck {
  id: string                    // e.g. 'artifact.signature.complete'
  status: 'pass' | 'warn' | 'fail' | 'skip'
  message: string
  remediation?: string          // actionable fix text
  docsUrl?: string
  linkedManifest?: string
  severity: 'info' | 'warning' | 'error' | 'critical'
}
```

### Diffing Between Builds

```bash
# Compare current doctor report against baseline
sourceog doctor --diff ./baseline-report.json

# Compare two build artifacts
sourceog doctor --diff build-a.artifact build-b.artifact
```

**Edge case - CI integration:** Set `doctorPolicy.ciFailLevel = 'warning'` during migration
periods to allow deploys while tracking regressions. Switch to `'error'` before production GA.

---

## Worker Fabric

### Worker Classes

| Class | Lifecycle | Use case |
|-------|-----------|----------|
| `ephemeral` | Per-request | Stateless API handlers |
| `warm-pool` | Pre-warmed, reused | Low-latency routes |
| `pinned` | Long-lived | WebSocket, SSE |
| `durable` | Persisted state | Checkout, payments, queues |

### Configuring Topology

```ts
export default defineConfig({
  workerPolicy: defineWorkerProfile({
    topology: 'warm-pool',
    warmPoolSize: 20,
    routePinning: {
      '/checkout/**': 'durable',
      '/api/stream/**': 'pinned',
    },
    affinityScoring: {
      strategy: 'latency',
      regionWeight: 0.7,
      loadWeight: 0.3,
    },
    failoverReplay: true,
    deterministic: true,           // deterministic worker IDs for audit trails
    heartbeat: { interval: '10s', timeout: '30s' },
  }),
})
```

---

## CLI Reference

### Development

```bash
sourceog dev                        # start dev server with HMR
sourceog dev --turbo                # enable turbo mode
sourceog dev --inspect              # attach Node inspector
```

### Build and Verify

```bash
sourceog build                      # full production build
sourceog build --profile            # emit render budget reports
sourceog verify                     # verify artifact signatures
sourceog audit                      # security and policy audit
```

### Inspection and Debugging

```bash
sourceog inspect route /dashboard
sourceog inspect manifest execution-graph
sourceog inspect cache /products/42
sourceog inspect graph productList
sourceog inspect action updateProfile

sourceog explain --route /checkout --phase cache
sourceog explain --decision cache-miss --request-id abc123

sourceog trace --route /dashboard --request-id xyz
sourceog replay --artifact build-a.artifact --route /dashboard
```

### Release

```bash
sourceog release --sign             # sign and bundle release evidence
sourceog release --diff HEAD~1      # compare release evidence
sourceog benchmark --gate           # run benchmark suite with gating
```

### Scaffolding

```bash
sourceog create app my-app --starter enterprise
sourceog scaffold route dashboard
sourceog scaffold middleware auth
sourceog scaffold worker durable-checkout
sourceog migrate --from next@14 --dry-run
sourceog migrate --from next@14 --apply
```

---

## Testing Harnesses

### Route Harness

```ts
import { createRouteTestHarness } from 'sourceog/testing'

const harness = createRouteTestHarness({
  route: '/dashboard',
  mockGraph: createMockGraph({
    nodes: {
      userProfile: { data: { name: 'Alice', role: 'admin' } },
    },
  }),
  mockRequestContext: createMockRequestContext({
    cookies: { session: 'valid-token' },
    headers: { 'x-tenant-id': 'acme' },
  }),
})

const response = await harness.render()

expect(response.status).toBe(200)
expect(response.cacheDecision).toBe('stale-while-revalidate')
expect(response.streamCheckpoints).toContain('shell')
```

### Action Harness

```ts
import { createRouteTestHarness, createMockActionRuntime } from 'sourceog/testing'

const actionRuntime = createMockActionRuntime({
  receipt: { enforce: true },
  optimisticScope: cartScope,
})

const result = await actionRuntime.invoke(addToCart, { productId: '42', qty: 1 })

expect(result.optimisticState.items).toHaveLength(1)
expect(result.receipt.consumed).toBe(true)
```

### Doctor Fixture

```ts
import { createDoctorFixture } from 'sourceog/testing'

const fixture = createDoctorFixture({
  scenario: 'missing-signature',
  manifest: 'route-execution-signature-manifest',
})

const report = await fixture.run()

expect(report.checks['artifact.signature.complete'].status).toBe('fail')
expect(report.checks['artifact.signature.complete'].remediation).toMatch(/sourceog verify/)
```

### Performance Fixture

```ts
import { createPerformanceFixture } from 'sourceog/testing'

const perf = createPerformanceFixture({
  route: '/checkout',
  budget: { renderMs: 300, streamKb: 150 },
  runs: 50,
  warmup: 5,
})

const result = await perf.run()

expect(result.p95.renderMs).toBeLessThan(300)
expect(result.p99.streamKb).toBeLessThan(150)
expect(result.varianceMs).toBeLessThan(20)   // stability check
```

---

## Edge Cases and Failure Modes

### Artifact Integrity Failures

| Scenario | Error code | Resolution |
|----------|------------|------------|
| Missing manifest | `MANIFEST_ABSENT` | Re-run `sourceog build` |
| Signature mismatch | `SIGNATURE_INVALID` | Check CI artifact caching - stale artifact |
| Schema version drift | `SCHEMA_INCOMPATIBLE` | Run `sourceog doctor migration` |
| Adapter capability gap | `CAPABILITY_UNSUPPORTED` | Change `runtime.target` or switch adapter |

### Cache Stampede Protection

```ts
// Anti-stampede: only one worker revalidates; others serve stale
defineCacheProfile({
  antiStampede: {
    strategy: 'lock',
    lockTtl: '5s',
    fallback: 'serve-stale',  // 'serve-stale' | 'queue' | 'error'
  },
})
```

**Edge case - lock expiry under slow revalidation:** If the revalidation worker takes longer
than `lockTtl`, the lock expires and a second worker begins revalidating. Both will write to
cache (last-write-wins). Set `lockTtl` >= 2x p99 revalidation latency.

### Optimistic Reconciliation Conflicts

```ts
// cartScope reducer must handle CONFLICT
function cartReducer(state, action) {
  if (action.type === 'CONFLICT') {
    // Server truth wins; merge local UI state where safe
    return {
      ...action.serverState,
      pendingRemovals: state.pendingRemovals,  // keep UI-only state
    }
  }
  // ... normal cases
}
```

### Streaming Boundary Priority

```ts
// Explicitly order streaming lanes to prevent layout shift
export const streamingPolicy = defineStreamPolicy({
  lanes: [
    { id: 'shell',        priority: 0, checkpoint: true  },
    { id: 'nav',          priority: 1, checkpoint: false },
    { id: 'main-content', priority: 2, checkpoint: true  },
    { id: 'below-fold',   priority: 3, checkpoint: false },
    { id: 'analytics',    priority: 4, checkpoint: false },
  ],
  shellGuarantee: 'before-any-data',
})
```

**Edge case - redirect signal injection mid-stream:** If a `redirect()` is called after the
shell has already been flushed, the runtime injects a client-side redirect signal into the
stream. The user sees the shell flash briefly before redirect. Guard with auth checks in
middleware before the shell renders.

### Worker Quarantine Recovery

```ts
// Workers are quarantined after threshold failures
// Recovery is automatic after drain + health check
defineWorkerProfile({
  quarantineThreshold: 5,
  quarantineRecovery: {
    drainFirst: true,
    healthCheckRoute: '/api/health',
    cooldown: '60s',
  },
})
```

---

## Migration Checklist

Use this checklist when migrating from Next.js 14+ to sourceog.

```bash
# Step 1: Pre-flight
sourceog migrate --from next@14 --dry-run

# Step 2: Review diff
sourceog doctor migration

# Step 3: Apply codemods
sourceog migrate --from next@14 --apply

# Step 4: Verify artifact
sourceog build
sourceog verify

# Step 5: Run doctor
sourceog doctor --format json > baseline-report.json

# Step 6: Run tests
sourceog doctor benchmark
```

### Manual Migration Points (not covered by codemods)

- [ ] Replace `next/image` -> `sourceog/platform` `Image`
- [ ] Replace `next/script` -> `sourceog/platform` `Script`
- [ ] Replace `next/font` -> `sourceog/platform` `Font`
- [ ] Replace `next/navigation` hooks -> `sourceog/navigation`
- [ ] Replace `next/headers` -> `sourceog/headers`
- [ ] Replace `next/server` `NextResponse` -> `sourceog/runtime` `createRouteHandler`
- [ ] Add `verifyArtifactIntegrity()` to startup sequence
- [ ] Define `artifactPolicy.signatureEnforcement = 'hard'` for production
- [ ] Replace `unstable_cache` usages with `sourceogFetch` + `cacheTag`
- [ ] Add `defineWorkerProfile` if using durable state patterns
- [ ] Register action aliases if using `callServerActionById`
- [ ] Set `doctorPolicy.ciFailLevel = 'error'` before first GA deploy

---

## Governance and Release Artifacts

### Defining Route Ownership

```yaml
# owners.yaml
routes:
  /checkout/**:
    team: payments
    riskLevel: critical
    approvers: [eng-lead, security]
  /marketing/**:
    team: growth
    riskLevel: low
    approvers: [eng-lead]
```

### Release Evidence Index

Every release emits a signed evidence bundle:

```bash
sourceog release --sign --output ./release-evidence/v1.2.3/
```

Contents:
- `compiler.sig` - compiler signature
- `runtime.sig` - runtime signature
- `deployment.sig` - deployment signature
- `doctor-report.json` - full doctor output
- `benchmark-results.json` - gated benchmark results
- `support-matrix.json` - capability evidence
- `slo-attestation.json` - SLO compliance proof

### SLO and Cost Attribution

```ts
export default defineConfig({
  observability: defineObservabilityProfile({
    slo: {
      errorRate: { target: 0.001, window: '7d' },
      p99Latency: { target: 300, window: '7d' },
      availability: { target: 0.9999, window: '30d' },
    },
    costAttribution: {
      byRoute: true,
      byTenant: true,
      exportFormat: 'opencost',
    },
  }),
})
```

---

## Middleware

### `defineMiddleware`

Middleware runs on every matched request before any route handler or Server Component.
It is the correct place for auth gates, tenant resolution, feature flags, and geo-redirects.

```ts
// middleware.ts
import { defineMiddleware } from 'sourceog/middleware'
import { cookies, headers } from 'sourceog/headers'
import { redirect } from 'sourceog/navigation'

export default defineMiddleware({
  matcher: ['/((?!_next|api/public|static).*)'],

  async handler(req, ctx) {
    const session = req.cookies.get('session')?.value

    if (!session) {
      return redirect('/login')
    }

    // Attach resolved tenant to downstream context
    const tenantId = req.headers.get('x-tenant-id') ?? 'default'
    ctx.set('tenantId', tenantId)

    return ctx.next()
  },
})
```

**Middleware composition:** Chain multiple middlewares with `composeMiddleware`.
They run in declaration order; the first to return a `Response` short-circuits the chain.

```ts
import { composeMiddleware } from 'sourceog/middleware'
import { authMiddleware } from './middleware/auth'
import { tenantMiddleware } from './middleware/tenant'
import { rateLimitMiddleware } from './middleware/rate-limit'

export default composeMiddleware([
  rateLimitMiddleware,   // always first - reject bots before auth overhead
  authMiddleware,
  tenantMiddleware,
])
```

**Edge case - middleware + edge streaming:** Middleware response headers are merged into
the stream headers. If middleware sets `Cache-Control: no-store`, the stream layer honours
it and bypasses all cache layers regardless of `cacheProfile`.

**Edge case - matcher over-breadth:** A `matcher: ['/**']` pattern includes `/_next/static`
and causes asset requests to run middleware logic. Always exclude static paths explicitly.

---

### `defineSecurityPolicy`

```ts
import { defineSecurityPolicy } from 'sourceog'

export const checkoutSecurity = defineSecurityPolicy({
  csp: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'nonce-{nonce}'", 'https://js.stripe.com'],
      styleSrc:  ["'self'", "'unsafe-inline'"],
      frameSrc:  ['https://js.stripe.com'],
      imgSrc:    ["'self'", 'data:', 'https://cdn.example.com'],
      connectSrc:["'self'", 'https://api.stripe.com'],
    },
    reportUri: '/api/csp-report',
    reportOnly: false,
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  frameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: ['self'],
  },
})
```

**Edge case - nonce injection:** The `{nonce}` placeholder is replaced per-request by
the runtime. If you render a `<script>` without the matching nonce at runtime, CSP will
block it silently in production. Use the `<Script nonce={nonce}>` platform helper to
guarantee nonce propagation.

**Edge case - CSP + third-party embeds:** Adding a new third-party script (analytics,
chat widgets) without updating `scriptSrc` will silently fail in production. Gate all
third-party script additions behind `sourceog doctor security --check csp-drift`.
