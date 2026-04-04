# SourceOG Getting Started

## Install

```bash
npm install sourceog react react-dom
```

SourceOG is designed to be consumed as a single public package. End users should not install any `@sourceog/*` packages directly.

## Create `sourceog.config.ts`

```ts
import { defineConfig } from "sourceog";

export default defineConfig({
  appDir: "app",
  distDir: ".sourceog",
});
```

## Basic commands

```bash
sourceog dev .
sourceog build .
sourceog start .
sourceog export .
sourceog verify .
sourceog audit .
```

## Example app package scripts

Each first-party example now exposes customer-style scripts:

```json
{
  "scripts": {
    "dev": "sourceog dev .",
    "build": "sourceog build .",
    "start": "sourceog start .",
    "export": "sourceog export .",
    "verify": "sourceog verify .",
    "audit": "sourceog audit ."
  }
}
```

## Current product truth

SourceOG is still in active productization. The framework already has:
- route graph scanning
- Flight transport
- cache and invalidation primitives
- server actions
- single-package publish direction

The framework is still closing product gaps around:
- renderer worker truth
- full public type packaging
- docs breadth
- example fixture maturity
- platform feature parity

Use `sourceog verify` and `sourceog audit` as the authoritative release checks rather than relying on assumptions from internal architecture documents.
