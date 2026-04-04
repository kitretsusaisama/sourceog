# ADOSF-X Architecture Notes

ADOSF-X is the canonical runtime refactor for SourceOG.

Core authorities:

- `@sourceog/genbook/policy` owns request and build decisions.
- `@sourceog/genbook/graph` owns dependency tracking and invalidation.
- `@sourceog/genbook/optimistic` owns deterministic optimistic state handling.
- `@sourceog/genbook/resilience` owns typed error and fallback policy.
- `@sourceog/genbook/observability` owns metrics, traces, and debug payloads.

Canonical flow:

1. Compiler emits route and ADOSF manifests.
2. Server calls the control plane for route decisions.
3. Renderer remains Flight-first.
4. Runtime invalidation prefers resource IDs over path guessing.
5. Client runtime handles incremental updates without success-path DOM replace.

Archive rule:

- Replaced bridges, generated output artifacts, and pre-ADOSF compat surfaces
  should move under `archived/pre-adosf/`.
