import { describe, expect, it } from "vitest";
import { AutomationEngine, createAutomationManifest, defineAutomation, defineSchedule } from "@sourceog/platform";

describe("automation fabric", () => {
  it("dispatches matching automations", async () => {
    const engine = new AutomationEngine([
      defineAutomation({
        name: "build-observer",
        events: ["build.complete"],
        schedule: defineSchedule({ kind: "interval", intervalMinutes: 15 }),
        async run(context) {
          return {
            automation: "build-observer",
            status: "completed",
            message: String(context.event.payload["prerenderedRoutes"])
          };
        }
      })
    ]);

    const result = await engine.dispatch({
      name: "build.complete",
      payload: { prerenderedRoutes: 4 },
      timestamp: new Date().toISOString()
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe("4");
  });

  it("creates automation manifests", () => {
    const manifest = createAutomationManifest([
      defineAutomation({
        name: "request-audit",
        events: ["request.complete"],
        run() {
          return;
        }
      })
    ]);

    expect(manifest.version).toBe("2027.1");
    expect(manifest.automations[0]?.name).toBe("request-audit");
  });
});
