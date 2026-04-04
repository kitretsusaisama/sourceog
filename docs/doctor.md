# SourceOG Doctor

`sourceog doctor` is the first public step toward the doctor-first ADOSF platform.

Current foundation:

- builds the current app when runtime checks are requested
- verifies the generated artifact set
- checks signed manifest integrity and doctor baseline presence
- runs publish-readiness/package checks
- records docs/example gaps
- writes structured remediation artifacts into `.sourceog/doctor/`

Example commands:

```bash
sourceog doctor
sourceog doctor --area runtime
sourceog doctor --area package
sourceog doctor --area docs
sourceog inspect manifest --format text
sourceog inspect manifest --compare ../baseline-app/.sourceog --format text
sourceog inspect governance --format text
sourceog explain decision / --format text
```

Current artifact outputs:

- `.sourceog/doctor/doctor-report.json`
- `.sourceog/doctor/doctor-remediation.json`
- `.sourceog/release-evidence-index.json`
- `.sourceog/support-matrix.json`

Build outputs now also carry release-audit artifacts that doctor and verify rely on:

- `.sourceog/artifact-signature-manifest.json`
- `.sourceog/deployment-signature-manifest.json`
- `.sourceog/governance-audit-manifest.json`
- `.sourceog/release-evidence-index.json`

The release evidence index is the machine-readable bridge between doctor, verify, and governance:

- it records the active signed artifact set for the build
- it tracks whether doctor, verification, benchmark proof, and publish-readiness artifacts exist
- it links the generated support matrix so stability claims stay tied to docs/tests/export evidence
- doctor can emit targeted findings when release evidence is incomplete
- verify rewrites the same index with parity and milestone artifacts so release gating uses the same source of truth
- `sourceog release --output <dir>` bundles the canonical release evidence index and its linked artifacts into a self-contained release package

This is intentionally the foundation layer. Later phases can extend the same report system with deeper runtime, migration, benchmark, canary, and policy-mesh diagnostics.

The operator surface now pairs doctor with artifact inspection:

- `sourceog inspect manifest --compare <dist-or-project>` summarizes manifest and route drift between builds
- `sourceog inspect governance` surfaces package/runtime law status, signature alignment, and audit decision counts
- `sourceog explain decision <route>` includes doctor-linked findings and policy diagnostics
- `--format text` turns JSON artifacts into a readable operator report without losing the machine-readable mode
