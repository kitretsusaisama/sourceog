import { Worker } from "node:worker_threads";
import { describe, it } from "vitest";
import { WORKER_FILE_PATH } from "@sourceog/renderer/core/constants";

describe.sequential("rsc worker bootstrap", () => {
  it("starts the canonical worker bootstrap without syntax or spawn failure", async () => {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let terminating = false;
      const worker = new Worker(WORKER_FILE_PATH, {
        workerData: {
          useInlineTransform: true,
          workerIndex: 0,
        },
      });

      let failed = false;
      const timer = setTimeout(() => {
        if (!failed && !settled) {
          terminating = true;
          void worker.terminate().then(() => {
            settled = true;
            resolve();
          }, reject);
        }
      }, 750);

      worker.on("message", (message) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          (message as { type?: string }).type === "bootstrap_error"
        ) {
          failed = true;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          reject(new Error(`worker bootstrap error: ${JSON.stringify(message)}`));
        }
      });

      worker.on("error", (error) => {
        failed = true;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      worker.on("exit", (code) => {
        if (!failed && !terminating && !settled && code !== 0) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`worker exited before bootstrap settled with code ${code}`));
        }
      });
    });
  });
});
