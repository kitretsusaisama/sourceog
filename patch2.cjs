const fs = require('fs');
const content = fs.readFileSync('packages/sourceog-renderer/src/orchestrator/worker-pool.ts', 'utf8');
const lines = content.split('\n');
const startIndex = 206;
lines.splice(startIndex, 6);
const queuedText = `      const queued: QueuedRenderRequest = {
        requestId,
        payload,
        resolve,
        reject,
        queueTimeout: setTimeout(() => {
          if (queued.node) {
            this.queue.remove(queued);
          }
          reject(new WorkerQueueTimeoutError(payload.routeId, this.queueTimeoutMs));
        }, this.queueTimeoutMs),
        renderTimeoutMs: payload.timeoutMs ?? this.workerTimeoutMs,
        onChunk: options.onChunk,
        collectChunks: options.collectChunks ?? false,
      };`;
lines.splice(startIndex, 8, ...queuedText.split('\n'));
fs.writeFileSync('packages/sourceog-renderer/src/orchestrator/worker-pool.ts', lines.join('\n'));
