import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@sourceog/platform/image", replacement: "/packages/sourceog-platform/src/image.tsx" },
      { find: "@sourceog/runtime/client-island", replacement: "/packages/sourceog-runtime/src/client-island.tsx" },
      { find: "@sourceog/adapter-utils", replacement: "/packages/adapter-utils/src/index.ts" },
      { find: /^@sourceog\/adapter-([^/]+)$/, replacement: "/packages/adapter-$1/src/index.ts" },
      { find: /^@sourceog\/platform\/(.+)$/, replacement: "/packages/sourceog-platform/src/$1.ts" },
      { find: /^sourceog\/(.+)$/, replacement: "/packages/sourceog/src/$1.ts" },
      { find: "sourceog", replacement: "/packages/sourceog/src/index.ts" },
      { find: "@sourceog/genbook/errors", replacement: "/packages/genbook/src/errors/index.ts" },
      { find: "@sourceog/genbook/policy", replacement: "/packages/genbook/src/policy/index.ts" },
      { find: "@sourceog/genbook/graph", replacement: "/packages/genbook/src/graph/index.ts" },
      { find: "@sourceog/genbook/optimistic", replacement: "/packages/genbook/src/optimistic/index.ts" },
      { find: "@sourceog/genbook/resilience", replacement: "/packages/genbook/src/resilience/index.ts" },
      { find: "@sourceog/genbook/observability", replacement: "/packages/genbook/src/observability/index.ts" },
      { find: "@sourceog/genbook/types", replacement: "/packages/genbook/src/types/index.ts" },
      { find: "@sourceog/genbook", replacement: "/packages/genbook/src/index.ts" },
      { find: /^@sourceog\/([^/]+)\/(.+)$/, replacement: "/packages/sourceog-$1/src/$2.ts" },
      { find: /^@sourceog\/([^/]+)$/, replacement: "/packages/sourceog-$1/src/index.ts" }
    ]
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
