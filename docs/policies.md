# SourceOG Policies

SourceOG now emits and validates:

- `policy-replay-manifest.json`
- `artifact-signature-manifest.json`
- `deployment-signature-manifest.json`
- `governance-audit-manifest.json`

These sit alongside the control-plane manifest and tuner snapshot so the ADOSF runtime can be replayed, audited, and verified from artifacts instead of source probing.

The public package also exposes ADOSF policy helpers through:

- `sourceog/policies`
- `sourceog/graph`
- `sourceog/replay`

This first slice is intentionally conservative:

- the production build records reducer phases and loop names
- the production build records compiler/runtime/deployment signatures
- governance artifacts record the artifact-only, no-source-probing, and no-runtime-transpile contract
- the public policy controller supports snapshot export and replay
- graph and optimistic primitives are available to tests and framework consumers

Future slices can deepen this into the full multi-loop policy mesh described in the 2027 plan.
