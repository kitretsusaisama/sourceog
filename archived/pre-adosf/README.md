# Pre-ADOSF Archive

This directory is the quarantine boundary for code and artifacts replaced by
the ADOSF-X runtime refactor.

Rules:

- Files archived here are not allowed to be imported by production packages,
  examples, or tests.
- Each archived slice should include a short note describing what replaced it.
- The archive exists to preserve searchability and migration context while
  keeping canonical runtime paths clean.

Current migration policy:

- Prefer archiving generated or legacy bridge artifacts instead of keeping them
  in active package roots.
- Do not add new runtime dependencies on anything under `archived/pre-adosf/`.
