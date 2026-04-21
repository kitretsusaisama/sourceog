## 1. EXECUTIVE REALITY CHECK
The SourceOG framework claims to be an enterprise-ready Next.js alternative with parallel routes, Flight transport, and cache primitives. In reality, it is a **broken prototype** with a fatal structural flaw in its rendering architecture.

It fails because its core React Server Components (RSC) rendering model relies on dynamically transpiling and executing code inside worker threads (`.sourceog/worker-transforms/*`) at runtime. This transpilation strategy loses relative module resolution context (e.g., `../core/logger.js`), causing immediate, unrecoverable crashes (`WORKER_SPAWN_FAILED`) upon any render attempt.

Furthermore, the monorepo suffers from severe internal drift—missing core Node.js imports (`fs`, `path`, `crypto`) and duplicate symbol declarations in build scripts prevent the framework from even compiling from a clean clone without manual patching.

**What must be fixed first (non-negotiable):**
The dynamic runtime transpilation of worker threads must be completely ripped out and replaced with a static, build-time compilation step. The monorepo must be stabilized to build deterministically without missing imports.

---

## 2. ROOT CAUSE BREAKDOWN (FIRST PRINCIPLES)

### A. Build System Failure
- **Exact Cause:** Missing `node:fs`, `node:path`, `node:crypto` imports across `sourceog-compiler`, `sourceog-server`, and `sourceog-runtime`. Duplicate symbol declarations (`onError`, `queued`) in `server.ts` and `worker-pool.ts`. Missing export `CONTRACTS_MANIFEST_VERSION`.
- **Structural Cause:** The monorepo lacks strict, enforced linting and type-checking across package boundaries during the CI/CD or pre-publish phases. Refactors were merged without validating that the entire workspace still compiled.
- **Recurrence Risk:** Without a deterministic, CI-gated build pipeline that blocks on `tsc --noEmit` and `eslint`, package boundaries will continue to drift.

### B. Worker Bootstrap Failure
- **Exact Cause:** `packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs` invokes `esbuild` (or `sucrase`) dynamically to compile `worker-entry.ts` into `.sourceog/worker-transforms/worker-entry-<hash>.mjs`. When Node.js executes this temporary file, relative imports like `../core/logger.js` resolve against the temporary directory instead of the original source directory, throwing `ERR_MODULE_NOT_FOUND`.
- **Structural Cause:** Attempting to treat a runtime worker pool as a dynamic bundler.
- **Danger:** Dynamic transpilation is unstable, masks dependency errors until runtime, destroys source maps, and introduces massive cold-start latency.

### C. Runtime Collapse
- **Exact Cause:** The server (`sourceog-server`) successfully binds a port but cannot serve any RSC requests because the `WorkerPool` crashes immediately upon initialization.
- **Coupling Issues:** The server blindly trusts that the `sourceog-renderer` worker pool is healthy. It lacks a readiness probe or fallback mechanism when the worker bootstrap fails.

### D. Verification Failure
- **Exact Cause:** `sourceog verify` checks for the existence of manifests and artifacts but does not validate that the resulting worker code is actually executable.
- **Mismatch:** Tests pass unit-level assertions but fail entirely during integration because the actual end-to-end execution path is broken by the module resolution failure.

---

## 3. NON-NEGOTIABLE REFACTOR PRINCIPLES
- **NO DYNAMIC RUNTIME TRANSPILATION:** `esbuild` and `sucrase` must be removed from the worker runtime path entirely.
- **DETERMINISTIC BUILD ARTIFACTS ONLY:** The worker entry point must be compiled *once* during `sourceog build`.
- **STRICT MODULE RESOLUTION:** No relative ambiguity; use package `#exports` or absolute build paths.
- **ZERO MISSING IMPORTS:** Code must compile cleanly via `tsc` before any bundler runs.
- **NO TEMPORARY DIRECTORIES AT RUNTIME:** The runtime must execute entirely from pre-compiled `dist/` or `.sourceog/server/` folders.
- **VERIFY MUST EXECUTE:** `sourceog verify` must spawn the actual server, make a request, and assert a 200 OK HTML response.

*Any code violating these rules (e.g., `loadWithInlineTransform` in `transpiler/worker-bootstrap.ts`) is marked for immediate deletion.*

---

## 4. PHASE-WISE REFACTOR PLAN (REAL, NOT IDEALISTIC)

### Phase 0 — Stabilization (MANDATORY FIRST)
**Goal:** Make build succeed on a clean clone.
**Actions:**
- Add missing `node:fs`, `node:path`, `node:crypto` imports across the workspace.
- Fix syntax errors and duplicate variables in `worker-pool.ts` and `server.ts`.
- Export `CONTRACTS_MANIFEST_VERSION` in `sourceog-runtime`.
**Exit Criteria:** `pnpm install && pnpm run build` completes with zero errors.

### Phase 1 — Worker System Rewrite
**Goal:** Eliminate worker bootstrap failure (`ERR_MODULE_NOT_FOUND`).
**Actions:**
- Delete `packages/sourceog-renderer/src/transpiler/*`.
- Rewrite `packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs` to load a pre-compiled `dist/workers/worker-entry.js`.
- Update `sourceog-compiler` to explicitly bundle the worker entry point during the build step, ensuring all internal monorepo dependencies are bundled or correctly externalized.
**Exit Criteria:** Worker threads initialize without crashing; example app logs "Worker initialized."

### Phase 2 — Build Pipeline Determinism
**Goal:** Make compiler outputs reproducible.
**Actions:**
- Standardize the `.sourceog` output directory structure.
- Ensure manifests (`route-manifest.json`, `client-reference-manifest.json`) are locked and signed during build.
**Exit Criteria:** Running `sourceog build` twice produces bit-for-bit identical `.sourceog` artifacts.

### Phase 3 — Runtime Integrity
**Goal:** Make server boot and render reliably.
**Actions:**
- Implement a health check between `sourceog-server` and `sourceog-renderer`.
- Ensure `handleRenderRequest` properly catches and surfaces errors instead of exiting the process.
**Exit Criteria:** `examples/app-basic` boots and successfully renders a React Server Component to HTML.

### Phase 4 — Security Hardening
**Goal:** Eliminate execution risks.
**Actions:**
- Remove `esbuild` and `sucrase` from `dependencies` in `sourceog-renderer` and `sourceog-server`.
- Enforce that workers only load modules from a signed manifest.
**Exit Criteria:** No dynamic `import()` of non-statically analyzed paths exists in the worker runtime.

### Phase 5 — Test & Verify Alignment
**Goal:** Make `verify` meaningful.
**Actions:**
- Rewrite `packages/sourceog-compiler/src/verify.ts` to spin up the actual HTTP server.
- Issue a real `GET` request to `/` and validate the Flight payload and HTML shell.
**Exit Criteria:** `sourceog verify` fails immediately if the worker crashes.

### Phase 6 — Documentation Alignment
**Goal:** Eliminate doc/runtime contradiction.
**Actions:**
- Rewrite `docs/sourceog-vs-nextjs.md` to reflect the new static-build worker architecture.
- Remove claims of "Fast Refresh maturity" until it is actually implemented.
**Exit Criteria:** Documentation matches the capabilities of the `master` branch exactly.

### Phase 7 — Enterprise Readiness
**Goal:** Reach audit 100/100.
**Actions:**
- Add GitHub Actions for CI gating (lint, typecheck, test, verify).
- Add structured JSON logging to the worker pool.
**Exit Criteria:** PRs cannot merge without passing the end-to-end rendering verification.

---

## 5. FILE-BY-FILE ACTION PLAN

**Delete:**
- `packages/sourceog-renderer/src/transpiler/worker-bootstrap.ts` (Dynamic transpilation is dead)
- `packages/sourceog-renderer/src/transpiler/transpiler-core.ts`

**Rewrite:**
- `packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs`: Remove all `esbuild` logic. Load `worker-entry.js` directly from the build output.
- `packages/sourceog-compiler/src/build.ts`: Add a step to bundle `worker-entry.ts` into the application's `.sourceog/server/` directory during compilation.
- `packages/sourceog-compiler/src/verify.ts`: Add end-to-end HTTP health check assertion.

**Stabilize (Already Patched Locally):**
- `packages/sourceog-server/src/server.ts` (duplicate `onError`, missing imports)
- `packages/sourceog-renderer/src/orchestrator/worker-pool.ts` (duplicate `queued`)
- `packages/sourceog-compiler/src/boundary.ts` (missing imports)
- `packages/sourceog-compiler/src/client.ts` (missing imports)

---

## 6. TEST & VERIFICATION PLAN
- **Build Test:** `pnpm run build` must pass on a fresh clone. (Deterministic, Automated, Blocking)
- **Worker Spawn Test:** A dedicated test invoking `WorkerPool` directly to ensure it boots without `ERR_MODULE_NOT_FOUND`. (Deterministic, Automated, Blocking)
- **RSC Render Test:** Spin up `sourceog start`, request `/`, assert output contains expected React hydration scripts. (Deterministic, Automated, Blocking)

---

## 7. DOCUMENTATION ARCHITECTURE (MNC GRADE)
- **README.md:** Honest status ("Alpha / Prototype"). Explain the static build pipeline.
- **Architecture.md:** Map the new execution flow: `sourceog build` -> `esbuild worker-entry` -> `sourceog start` -> `WorkerPool loads static .js`.
- **Troubleshooting.md:** Document how to debug RSC payload errors (since `WORKER_SPAWN_FAILED` will be eliminated).
- **Contribution.md:** Strict rules: "No dynamic code execution in runtime packages."

---

## 8. AUDIT SCORE RECOVERY PLAN
- **Phase 0–1 (Stabilization & Worker Rewrite): 8 → 40.** Fixing the fatal crash makes the framework theoretically usable.
- **Phase 2–3 (Determinism & Runtime Integrity): 40 → 70.** Ensuring builds are reproducible and servers don't crash under load establishes a baseline framework.
- **Phase 4–5 (Security & Verify Alignment): 70 → 90.** Ripping out runtime transpilation removes the biggest security and performance risks. Making `verify` test real execution proves reliability.
- **Phase 6–7 (Docs & Enterprise Gates): 90 → 100.** Honest documentation and CI/CD strictness make it enterprise-ready.

---

## 9. TOP 10 FAILURE MODES (POST-REFACTOR RISKS)
1. **Worker Deadlocks:** High concurrency exhausting the static worker pool.
2. **Cache Corruption:** `FilesystemCacheStore` race conditions during parallel writes.
3. **Module Boundary Leaks:** Client components accidentally importing server-only code (needs strict compiler enforcement).
4. **Flight Payload Desync:** Client React version mismatching Server React version.
5. **Memory Leaks:** Worker threads retaining request context across boundaries.
6. **Cold Start Latency:** Serverless edge functions taking too long to initialize the RSC pool.
7. **Hydration Mismatches:** Differences between server-rendered HTML and client expectation.
8. **Routing Ambiguity:** Catch-all routes conflicting with static file serving.
9. **Action Serialization Failures:** Unserializable data passed to Server Actions.
10. **Build-Time Memory Exhaustion:** Bundling large applications OOMs the build process.

---

## 10. NEXT 10 ACTIONS (IMMEDIATE EXECUTION)
1. Open `packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs`.
2. Delete the `loadWithInlineTransform`, `ensureDynamicTransformers`, and `esbuild` invocation logic.
3. Rewrite `resolveWorkerEntrypoint` to simply `await import(pathToFileURL(path.join(process.cwd(), '.sourceog', 'server', 'worker-entry.js')))`.
4. Open `packages/sourceog-compiler/src/build.ts`.
5. Add an `esbuild` step to bundle `packages/sourceog-renderer/src/workers/worker-entry.ts` into the `.sourceog/server/` directory of the target app.
6. Run `pnpm run build` in the root to recompile the framework.
7. Run `pnpm run build` inside `examples/app-basic`.
8. Run `pnpm run start` inside `examples/app-basic` to verify the worker boots.
9. Delete the `packages/sourceog-renderer/src/transpiler/` directory.
10. Commit the refactor.
