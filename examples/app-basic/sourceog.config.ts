import { defineAutomation, defineConfig, defineSchedule, defineSecurityPolicy } from "sourceog";

export default defineConfig({
  appDir: "app",
  distDir: ".sourceog",
  security: defineSecurityPolicy({
    extraHeaders: {
      "x-sourceog-example": "enabled"
    }
  }),
  automations: [
    defineAutomation({
      name: "build-summary",
      events: ["build.complete"],
      schedule: defineSchedule({ kind: "interval", intervalMinutes: 30 }),
      async run(context) {
        context.emitDiagnostic("Build automation observed event", {
          event: context.event.name
        });
      }
    }),
    defineAutomation({
      name: "request-audit",
      events: ["request.complete"],
      async run(context) {
        return {
          automation: "request-audit",
          status: "completed",
          message: `Observed ${context.event.name}`
        };
      }
    })
  ],
  i18n: {
    locales: ["en", "fr"],
    defaultLocale: "en",
    localeDetection: true
  },
  env: {
    required: ["SOURCEOG_SESSION_SECRET"]
  }
});
