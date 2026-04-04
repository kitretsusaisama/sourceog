// sourceog-renderer/src/workers/worker-entry.ts
// Alibaba CTO 2027 Standard — Worker Thread Entry Point

import { workerData, parentPort, isMainThread } from 'node:worker_threads';
import { logger } from '../core/logger.js';
import { configureModuleLoader } from '../rsc/compat-module-loader.js';
import { handleRenderRequest, initializeWorkerRouter } from './worker-router.js';
import { loadManifestFromPath, normalizeClientManifest } from '../rsc-worker-utils.js';

if (isMainThread) {
  throw new Error('[SOURCEOG] This module must be run as a Worker Thread.');
}

if (!parentPort) {
  throw new Error('[SOURCEOG] parentPort is not available.');
}

const { manifestPath, useInlineTransform } = workerData || {};

configureModuleLoader({ useInlineTransform: true });

const rawManifest = manifestPath ? loadManifestFromPath(manifestPath) : {};
const clientManifest = normalizeClientManifest(rawManifest);
initializeWorkerRouter(parentPort);

logger.debug(`Worker initialized. InlineTransform: true (bootstrap requested: ${useInlineTransform})`);

const port = parentPort;

port.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  void handleRenderRequest(message, clientManifest, port);
});

process.on('SIGTERM', () => {
  logger.debug('Worker received SIGTERM. Draining...');
  process.exit(0);
});
