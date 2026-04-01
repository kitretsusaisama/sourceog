import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@sourceog/runtime/client-island", replacement: "/packages/sourceog-runtime/src/client-island.tsx" },
      { find: "@sourceog/adapter-utils", replacement: "/packages/adapter-utils/src/index.ts" },
      { find: /^@sourceog\/adapter-([^/]+)$/, replacement: "/packages/adapter-$1/src/index.ts" },
      { find: /^@sourceog\/platform\/(.+)$/, replacement: "/packages/sourceog-platform/src/$1.ts" },
      { find: /^sourceog\/(.+)$/, replacement: "/packages/sourceog/src/$1.ts" },
      { find: "sourceog", replacement: "/packages/sourceog/src/index.ts" },
      { find: /^@sourceog\/([^/]+)\/(.+)$/, replacement: "/packages/sourceog-$1/src/$2.ts" },
      { find: /^@sourceog\/([^/]+)$/, replacement: "/packages/sourceog-$1/src/index.ts" }
    ]
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
