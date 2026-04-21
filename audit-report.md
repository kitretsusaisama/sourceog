# SourceOG Architecture Audit Report

**VERDICT: Prototype with promise, not yet an enterprise-ready Next.js alternative.**

The framework claims to be a Next.js alternative featuring parallel routes, flight transport, and cache primitives. However, our code-level audit proves the claims are far ahead of the implementation. It requires extensive manual codebase repairs just to build, fails to cleanly verify its own output, and suffers from fundamental defects in worker-thread module resolution and runtime initialization. It is not ready for production use.

────────────────────────────────────────
1. SYSTEM MODEL
────────────────────────────────────────
Based strictly on the code structure (`packages/sourceog-*`):

**Execution Model**
- **Architecture:** Intended as a dual-runtime model (Client/Server) using React Server Components (RSC).
- **Request Lifecycle:** Server intercepts, delegates RSC rendering to worker threads (`rsc-worker-bootstrap.mjs`), and streams Flight payload.
- **Concurrency/Isolation:** Workers orchestrated via `WorkerPool`. Fails in practice due to broken bootstrap path resolution for transpiled modules.
- **Cold Starts & Cancellation:** UNKNOWN (Cannot reliably boot example app to test load behavior).

**Rendering Model**
- **SSR / SSG:** Partial implementation evident in build primitives (`packages/sourceog-compiler`).
- **Streaming SSR:** Claimed, uses Flight transport.
- **Hydration/Recovery:** Claimed, uses `react-server-dom-webpack`.
- **Error Boundaries:** Defined in `router/scan.ts`, but unproven at runtime.

**Routing Model**
- **File-based Routing:** Implemented (`page.tsx`, `layout.tsx`, `template.tsx`, `error.tsx`, `loading.tsx`).
- **Parallel Routes / Intercepting Routes:** Claimed, AST parsing code exists.
- **Middleware:** Mentioned in scanner (`middleware.ts`), pipeline unproven.

**Data Model**
- **Fetch Abstraction / Caching:** `FilesystemCacheStore` implemented in `sourceog-runtime`. Revalidation primitives defined but end-to-end cache invalidation is unproven.

**Deployment Model**
- **Self-hosting:** Primary target via `sourceog-server`.
- **Edge Run-times:** Adapters exist (`adapter-cloudflare`, `adapter-vercel-edge`), untested.

**Security Boundaries**
- UNKNOWN / UNPROVEN. Build integrity issues block deep security runtime testing.

────────────────────────────────────────
2. NEXT.JS PARITY MATRIX
────────────────────────────────────────

| Domain | Feature | Next.js Support | Target Support | Support Type | Prod Readiness | Gap Severity | Score | Notes |
|---|---|---|---|---|---|---|---|---|
| Routing | File-based routing | Native | Native | Native | Medium | Low | 3 | Scans `page.tsx`, `layout.tsx`. |
| Routing | Parallel/Intercepting | Native | Partial | Unproven | Low | High | 1 | Code exists, but worker boot fails. |
| Routing | Middleware | Native | Partial | Unproven | Low | High | 1 | Scanner detects it, pipeline untested. |
| Rendering | Server Components | Native | Partial | Unverified | Low | Critical | 1 | Relies on RSC, but worker threads crash. |
| Rendering | Streaming SSR | Native | Partial | Unproven | Low | High | 1 | Uses Flight format, end-to-end unverified. |
| Data Fetch | Caching | Native | Partial | Unverified | Low | High | 1 | File cache exists, stability unknown. |
| DX | Fast Refresh/HMR | Native | Partial | Unproven | Low | High | 1 | Code in `sourceog-dev`, maturity low. |
| DX | Docs Accuracy | Native | Partial | Contradicted | Low | Critical | 0 | Docs claim readiness, code crashes. |

────────────────────────────────────────
3. HIDDEN ASSUMPTIONS
────────────────────────────────────────
**Assumption:** The custom RSC worker pipeline can reliably transpile and execute on the fly using `esbuild`/`sucrase`.
- **Break Scenario:** In production or varied environments, relative path resolution inside dynamically generated ES modules (`.sourceog/worker-transforms/*.mjs`) fails to find local monorepo packages (e.g., `../core/logger.js`).
- **Observed Behavior:** Fatal `WORKER_SPAWN_FAILED` during build/verification.
- **Impact:** Complete failure to render Server Components.
- **Mitigation:** Requires fundamental rewrite of how worker transpilation handles import specifier rewriting.

**Assumption:** Monorepo architecture is clean and strictly bounded.
- **Break Scenario:** Out-of-sync refactors lead to missing `fs` and `path` imports, and missing exports (e.g., `CONTRACTS_MANIFEST_VERSION`).
- **Observed Behavior:** Build throws immediate `ReferenceError` exceptions.
- **Impact:** Source modification required just to run standard build.

────────────────────────────────────────
4. FAILURE MODE ANALYSIS
────────────────────────────────────────
- **Failure:** Rendering Crash (Worker Bootstrap Failure)
- **Behavior:** `tsx packages/sourceog/src/bin.ts build` fails with `Worker exited with code 1`.
- **Recovery:** None. Process exits.
- **User Impact:** 100% downtime / Complete inability to build or serve the app.
- **Data Risk:** Low (fails before data access).
- **Verdict:** Unacceptable for production.

────────────────────────────────────────
5. SECURITY RED-TEAM FINDINGS
────────────────────────────────────────
- **Structural Integrity:** Poor. The build pipeline dynamically compiles worker code into a temporary directory (`.sourceog/worker-transforms/`) and executes it. This is a severe injection risk vector if not perfectly sanitized, though current failure prevents exploiting it.
- **Cache Poisoning / SSR Injection:** UNKNOWN. Blocked by build failures.

────────────────────────────────────────
6. ECONOMIC ABUSE MODEL
────────────────────────────────────────
- **Build-Time Blowups:** High Risk. The custom esbuild/sucrase transpilation step inside the worker pool is a CPU/memory bottleneck. Repeated cold starts or large route graphs could result in massive build-time resource consumption.

────────────────────────────────────────
7. PERFORMANCE BREAKPOINTS
────────────────────────────────────────
- **1K+ Concurrent Users:** UNKNOWN.
- **First Bottleneck:** The framework collapses at **Build Time / Verify Step**. It cannot even start the server for a single user without local source patching and worker module resolution fixes.

────────────────────────────────────────
8. ARCHITECTURAL INTEGRITY REVIEW
────────────────────────────────────────
- **Modularity:** Attempted (split into `router`, `renderer`, `runtime`, `server`), but tightly coupled and extremely fragile.
- **Abstraction Quality:** Low. The build scripts and verify tools directly mutate files and use hardcoded paths.
- **Runtime Portability:** The design separates Node and Edge adapters, but the core Node worker pipeline is deeply broken.

────────────────────────────────────────
9. DX REVIEW
────────────────────────────────────────
- **Onboarding Speed:** Extremely Poor. The example app (`app-basic`) does not build cleanly out of the box.
- **Operability:** A mid-level engineer would spend hours just fixing missing imports and broken `esbuild` transpilation logic before seeing a single page render.

────────────────────────────────────────
10. FUTURE READINESS REVIEW
────────────────────────────────────────
- **Verdict:** Not future-ready. The custom RSC transpiler/worker approach is highly unstable and likely requires an architectural rewrite to utilize standard bundler plugins (like Rollup/Webpack) instead of ad-hoc dynamic `esbuild` execution.

────────────────────────────────────────
11. CROSS-LAYER CONSISTENCY FINDINGS
────────────────────────────────────────
- **Contradiction:** Docs claim "SourceOG verify and audit as the authoritative release checks", but running `pnpm run verify` yields immediate syntax errors, reference errors, and fatal worker crashes.

────────────────────────────────────────
12. SCORECARD
────────────────────────────────────────
- Feature parity: 4/20
- Stability: 0/15
- Performance: 0/15
- Security: ?/15 (Scored 0 due to unknowns)
- Scalability: 0/15
- DX: 1/10
- Deployment flexibility: 2/5
- Observability: 1/3
- Future readiness: 0/2

**TOTAL SCORE: 8 / 100**

────────────────────────────────────────
13. CRITICAL GAPS RANKED
────────────────────────────────────────
1. **Broken Build System:** Missing imports (`fs`, `path`, `createHash`), duplicate symbol declarations.
2. **Fatal Worker Bootstrap:** Transpiled worker entry points fail to resolve relative imports (e.g., `../core/logger.js`).
3. **End-to-End Execution:** Lack of a functioning, verified rendering path for Server Components.

────────────────────────────────────────
14. WHAT MUST BE REBUILT
────────────────────────────────────────
- The `rsc-worker-bootstrap.mjs` and transpilation strategy must be completely redesigned to correctly handle module resolution.
- The monorepo linting/build integrity checks must be enforced to prevent missing standard library imports.

────────────────────────────────────────
15. WHAT IS STRONG
────────────────────────────────────────
- The ambition of the architecture (ADOSF policy control, Flight transport integration, strict file-based routing semantics).

────────────────────────────────────────
16. FINAL VERDICT
────────────────────────────────────────
**Prototype with promise.**
If a framework cannot reliably build, verify, and start its own worker path from code on a clean checkout without extensive manual patching, it is not yet an enterprise-grade alternative, no matter how polished the documentation sounds. Its claims are significantly ahead of its executable reality.
