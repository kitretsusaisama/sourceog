import { createServer } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditSourceogPublishReadiness } from "@sourceog/compiler";
import { createSourceOGServer } from "@sourceog/server";
import { createTestInstance, type TestInstance } from "@sourceog/testing";

const appBasicRoot = path.join(process.cwd(), "examples", "app-basic");
const appEnterpriseRoot = path.join(process.cwd(), "examples", "app-enterprise");

let testInstance: TestInstance | undefined;

beforeAll(async () => {
  testInstance = await createTestInstance({ cwd: appBasicRoot, mode: "development" });
});

afterAll(async () => {
  await testInstance?.close();
});

describe("server runtime regressions", () => {
  it("loads TypeScript middleware files without unknown-extension failures", async () => {
    const response = await testInstance!.fetch("/forbidden");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Forbidden");
  });

  it("loads TypeScript route handlers through the runtime module loader", async () => {
    const response = await testInstance!.fetch("/api/hello");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Hello from SourceOG API routes");
  });

  it("allows the enterprise example to pass publish-readiness import rules", async () => {
    const report = await auditSourceogPublishReadiness(process.cwd());
    expect(
      report.findings.find((finding) => finding.file?.endsWith(path.join("examples", "app-enterprise", "app", "page.tsx"))),
    ).toBeUndefined();
  });

  it("falls back to the next free port instead of crashing on EADDRINUSE", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, resolve));
    const occupiedAddress = occupied.address();
    const occupiedPort = occupiedAddress && typeof occupiedAddress === "object" ? occupiedAddress.port : 0;

    const server = await createSourceOGServer({
      cwd: appEnterpriseRoot,
      mode: "development",
      port: occupiedPort,
      portFallback: true,
    });

    try {
      const actualPort = await server.start();
      expect(actualPort).toBeGreaterThan(occupiedPort);
      expect(server.resolvedPort).toBe(actualPort);
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())));
    }
  }, 15000);
});
