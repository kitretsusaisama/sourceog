import { defineConfig } from "sourceog";

export default defineConfig({
  appDir: "app",
  distDir: ".sourceog",
  experimental: {
    edge: true
  }
});
