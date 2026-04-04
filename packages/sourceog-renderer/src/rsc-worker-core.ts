// sourceog-renderer/src/rsc-worker-core.ts
// Alibaba CTO 2027 Standard — Legacy Worker Core Compatibility Shim (DEPRECATED)
//
// **MIGRATION REQUIRED**: Orchestrates legacy `renderFlightStream()` workflow
// by delegating to v2 modular components. Maintained for v1 worker contracts.
//
// WORKFLOW (for reference):
// 1. resolveRouteComponents() → React.ComponentType
// 2. React.createElement() → RSC root element  
// 3. renderFlight() → text/x-component chunks
// 4. onChunk callback (streaming, legacy only)
// 5. Return WorkerRenderResponse (IPC)
//
// **NEW CODE**: Use `renderRouteToOfficialRscPayload()` public API.

import React from 'react';
import type {
  WorkerRenderResponse,
} from './types/internal.js';
import type { WorkerRenderRequest } from './types/messages.js';
import type { NormalizedClientManifest } from '@sourceog/genbook';
import type { ClientManifestRecord } from './rsc-worker-utils.js';

import {
  resolveRouteComponents,
  type RouteComponents,
} from './rsc/compat-route-loader.js';
import { renderFlight, type RenderFlightOptions } from './rsc/compat-renderer.js';
import { loadRouteModule } from './rsc/compat-module-loader.js';
import { toError } from './core/errors.js';
import { logger } from './core/logger.js';

// ---------------------------------------------------------------------------
// LEGACY TYPE RE-EXPORTS
// ---------------------------------------------------------------------------

/** @deprecated Direct WorkerRender* usage → use public API types */
export type {
  WorkerRenderRequest,
  WorkerRenderResponse,
  ClientManifestRecord,
};

/**
 * @deprecated Use modular imports:
 *   `./rsc/compat-renderer.ts` (Flight Rendering)
 *   `./rsc/compat-module-loader.ts` (Module Loading) 
 *   `./rsc/compat-route-loader.ts` (Route Resolution)
 */
export {
  loadRouteModule,
  toError,
};

/**
 * Legacy render orchestration (streaming callback API).
 *
 * **WARNING**: Direct usage discouraged. Blocks on v2 orchestrator migration.
 * 
 * @param requestId - Trace identifier (parent thread correlation).
 * @param payload - Render parameters (route + context).
 * @param manifest - Normalized client module manifest.
 * @param onChunk - Optional streaming callback (legacy streaming consumers).
 * @returns WorkerRenderResponse (chunks + metadata).
 */
export async function renderFlightStream(
  requestId: string,
  payload: WorkerRenderRequest['payload'],
  manifest: NormalizedClientManifest,
  onChunk?: (chunk: string) => void,
): Promise<WorkerRenderResponse> {
  const { route, context, timeoutMs = 5000 } = payload;
  
  logger.trace(`Legacy renderFlightStream: ${route.id}`, {
    requestId,
    timeoutMs,
    hasOnChunk: !!onChunk,
  });

  try {
    // PHASE 1: Route Resolution (module → component)
    const components: RouteComponents = await resolveRouteComponents(route);

    // PHASE 2: React Element Construction
    // Supports legacy component shape (stateless functional / class components)
    const element = React.createElement(
      components.component as React.ComponentType<{ params: Record<string, string>; searchParams: Record<string, string> }>,
      {
        params: context.params ?? {},
        searchParams: Object.fromEntries(context.query ?? []),
      }
    );

    // PHASE 3: RSC Flight Serialization
    const renderOptions: RenderFlightOptions = {
      routeId: route.id,
      timeoutMs,
    };

    const chunks = await renderFlight(element, manifest, renderOptions);

    // PHASE 4: Legacy Streaming Callback (if provided)
    if (onChunk) {
      chunks.forEach((chunk, index) => {
        try {
          onChunk(chunk);
        } catch (callbackError) {
          logger.warn(`Legacy onChunk callback failed (chunk ${index})`, {
            requestId,
            error: toError(callbackError),
          });
        }
      });
    }

    // PHASE 5: Success Response
    return {
      format: 'react-flight-text',
      chunks,
      usedClientRefs: [], // Populated by future analyzer integration
    };
  } catch (rawError) {
    const error = toError(rawError);
    
    logger.error(`Legacy renderFlightStream failed: ${route.id}`, {
      requestId,
      routeId: route.id,
      error: {
        name: error.name,
        message: error.message,
        code: (error as Error & { code?: unknown }).code,
        stack: error.stack,
      },
    });

    // Rethrow → legacy callers expect Error propagation
    throw error;
  }
}

// ---------------------------------------------------------------------------
// DEPRECATION GOVERNANCE
// ---------------------------------------------------------------------------

if (import.meta.url.includes('__tests__') === false) {
  console.warn(
    '🚨 DEPRECATED: rsc-worker-core.ts::renderFlightStream()',
    '\n  → Migrate to renderRouteToOfficialRscPayload()',
    '\n  → See ./rsc.ts public facade',
    '\n  → Removal: v3.0.0 (2026-Q4)',
  );
}

/**
 * Migration metadata for tooling / linters.
 */
export const DEPRECATION_METADATA = {
  since: 'v2.0.0',
  status: 'maintenance-mode' as const,
  replacement: './rsc.ts::renderRouteToOfficialRscPayload()',
  breakingChange: false,
  docs: 'https://sourceog.dev/renderer/v2/migration#rsc-worker-core',
} as const;
