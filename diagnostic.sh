#!/bin/bash
echo "=== ENVIRONMENT ==="
echo "NODE=$(node --version) PNPM=$(pnpm --version)"

echo
echo "=== GIT STATUS (SHORT) ==="
git status --porcelain || echo "GIT STATUS FAILED"

echo
echo "=== CLEAN INSTALL ==="
rm -rf node_modules pnpm-lock.yaml .sourceog 2>/dev/null
time pnpm install || echo "PNPM INSTALL FAILED"

echo
echo "=== BUILD LOG (ROOT) ==="
time pnpm run build 2>&1 | tee build.log || echo "BUILD FAILED"

echo
echo "=== VERIFY LOG (ROOT) ==="
time pnpm run verify 2>&1 | tee verify.log || echo "VERIFY FAILED"

echo
echo "=== APP-BASIC BUILD/DEV ==="
cd examples/app-basic || echo "MISSING app-basic"
echo "--- app-basic: build ---"
time pnpm run build 2>&1 | tee ../../app-basic-build.log || echo "APP-BASIC BUILD FAILED"
echo "--- app-basic: dev (10s) ---"
time pnpm run dev 2>&1 | tee ../../app-basic-dev.log & sleep 10; pkill -f "app-basic" || true
cd ../../

echo
echo "=== CORE RENDERER / WORKER FILES ==="
echo "--- rsc-worker-bootstrap.mjs ---"
cat packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs 2>/dev/null || echo "MISSING"

echo
echo "--- transpiler/worker-bootstrap.ts ---"
cat packages/sourceog-renderer/src/transpiler/worker-bootstrap.ts 2>/dev/null || echo "MISSING"

echo
echo "--- rsc-worker-core.ts ---"
cat packages/sourceog-renderer/src/rsc-worker-core.ts 2>/dev/null || echo "MISSING"

echo
echo "--- workers/worker-entry.ts ---"
cat packages/sourceog-renderer/src/workers/worker-entry.ts 2>/dev/null || echo "MISSING"

echo
echo "=== COMPILER / BUILD / VERIFY ==="
echo "--- sourceog-compiler/src/build.ts ---"
cat packages/sourceog-compiler/src/build.ts 2>/dev/null || echo "MISSING"

echo
echo "--- sourceog-compiler/src/verify.ts ---"
cat packages/sourceog-compiler/src/verify.ts 2>/dev/null || echo "MISSING"

echo
echo "=== SERVER / WORKER-POOL INTEGRATION ==="
echo "--- sourceog-server/src/server.ts ---"
cat packages/sourceog-server/src/server.ts 2>/dev/null || echo "MISSING"

echo
echo "--- sourceog-renderer/src/orchestrator/worker-pool.ts ---"
cat packages/sourceog-renderer/src/orchestrator/worker-pool.ts 2>/dev/null || echo "MISSING"

echo
echo "=== RUNTIME CONTRACTS / POLICY HOOKS ==="
echo "--- sourceog-runtime/src/contracts.ts ---"
cat packages/sourceog-runtime/src/contracts.ts 2>/dev/null || echo "MISSING"

echo
echo "--- sourceog-runtime/src/policy-mesh.ts ---"
cat packages/sourceog-runtime/src/policy-mesh.ts 2>/dev/null || echo "MISSING"

echo
echo "=== PACKAGE CONFIGS (RENDERER / RUNTIME / SERVER) ==="
echo "--- packages/sourceog-renderer/package.json ---"
cat packages/sourceog-renderer/package.json 2>/dev/null || echo "MISSING"

echo
echo "--- packages/sourceog-runtime/package.json ---"
cat packages/sourceog-runtime/package.json 2>/dev/null || echo "MISSING"

echo
echo "--- packages/sourceog-server/package.json ---"
cat packages/sourceog-server/package.json 2>/dev/null || echo "MISSING"

echo
echo "=== TS CONFIGS (ROOT + RENDERER) ==="
echo "--- tsconfig.base.json ---"
cat tsconfig.base.json 2>/dev/null || echo "MISSING"

echo
echo "--- packages/sourceog-renderer/tsconfig.json ---"
cat packages/sourceog-renderer/tsconfig.json 2>/dev/null || echo "MISSING"

echo
echo "=== WORKSPACE DEFINITION ==="
cat pnpm-workspace.yaml 2>/dev/null || echo "MISSING"

echo
echo "=== CRITICAL DEPENDENCIES (BUNDLERS) ==="
pnpm why esbuild sucrase tsup rollup 2>/dev/null | sed -e '1,80p'

echo
echo "=== KEY TESTS (RSC / WORKERS / BUILD) HEADS ==="
echo "--- tests/rsc-worker-bootstrap-smoke.test.ts ---"
sed -e '1,120p' tests/rsc-worker-bootstrap-smoke.test.ts 2>/dev/null || echo "MISSING"

echo
echo "--- tests/rsc-worker-pool.test.ts ---"
sed -e '1,120p' tests/rsc-worker-pool.test.ts 2>/dev/null || echo "MISSING"

echo
echo "--- tests/build.test.ts ---"
sed -e '1,120p' tests/build.test.ts 2>/dev/null || echo "MISSING"

echo
echo "=== END SOURCEOG DIAGNOSTIC v2.0 ==="
