# SourceOG vs Next.js

This document is intentionally conservative. It should track real framework behavior, not aspiration.

## Where SourceOG is already strong

- rich route graph semantics for parallel and intercepting routes
- explicit render-context identity
- Flight transport and render-context invariants
- cache and invalidation primitives
- ADOSF-oriented long-term architecture for graph invalidation and policy control

## Where SourceOG is still behind

- worker/runtime truth must be fully release-blocking
- public package type completeness
- docs and migration depth
- Fast Refresh maturity
- complete platform story for script, font, styling, and asset orchestration
- starter/scaffold experience

## Current release posture

SourceOG should only claim competitiveness from evidence produced by:
- `sourceog verify`
- `sourceog audit`
- packed-artifact consumer tests
- public API type tests
- benchmark and example fixture reports

## Product rule

If a feature is not:
1. implemented,
2. documented,
3. covered by tests or benchmarks, and
4. represented in a passing release artifact,

then it must not be represented as production-ready parity.
