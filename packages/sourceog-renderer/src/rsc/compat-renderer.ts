// sourceog-renderer/src/rsc/compat-renderer.ts
// Alibaba CTO 2027 Standard — RSC Compatibility Layer (Renderer)

import React from 'react';
import { PassThrough } from 'node:stream';
import { RenderTimeoutError } from '@sourceog/genbook/errors';
import { RenderError } from '../core/errors.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Dynamic Imports for React Server Dom
// ---------------------------------------------------------------------------

// We lazy load the renderer to avoid loading it in environments that don't use RSC.
type RenderToPipeableStreamFn = (
  model: unknown,
  webpackMap: unknown,
  options?: { onError?: (error: unknown) => void }
) => {
  pipe: (destination: NodeJS.WritableStream) => NodeJS.WritableStream;
  abort?: (reason?: unknown) => void;
};

let _renderToPipeableStream: RenderToPipeableStreamFn | null = null;

async function getRenderer(): Promise<RenderToPipeableStreamFn> {
  if (_renderToPipeableStream) return _renderToPipeableStream;

  try {
    // @ts-ignore - React Server DOM Webpack is not typed in standard React types
    const mod = await import('react-server-dom-webpack/server.node');
    _renderToPipeableStream = mod.renderToPipeableStream;
    return _renderToPipeableStream!;
  } catch (error) {
    logger.error('Failed to load react-server-dom-webpack. Ensure "react-server-dom-webpack" is installed.', error);
    throw new RenderError(
      'RENDERER_UNAVAILABLE', 
      'RSC Renderer (react-server-dom-webpack) is not available.'
    );
  }
}

// ---------------------------------------------------------------------------
// Public API: renderFlight
// ---------------------------------------------------------------------------

export interface RenderFlightOptions {
  timeoutMs: number;
  routeId: string;
}

/**
 * Renders a React element tree to a React Flight (RSC) stream.
 * Handles timeout, error boundaries, and stream collection.
 * 
 * @param element - The root React element.
 * @param manifest - The normalized client reference manifest.
 * @param options - Rendering options (timeout, context).
 * @returns A promise resolving to the collected chunks.
 */
export async function renderFlight(
  element: React.ReactElement,
  manifest: Record<string, unknown>,
  options: RenderFlightOptions
): Promise<string[]> {
  const renderToPipeableStream = await getRenderer();
  
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const stream = new PassThrough();
    
    // 1. Setup Timeout
    const timeout = setTimeout(() => {
      stream.destroy();
      reject(new RenderTimeoutError(options.routeId, options.timeoutMs));
    }, options.timeoutMs);

    // 2. Handle Stream Events
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(chunk.toString('utf8'));
    });

    stream.on('error', (err) => {
      clearTimeout(timeout);
      reject(new RenderError('STREAM_ERROR', err.message, options.routeId));
    });

    stream.on('end', () => {
      clearTimeout(timeout);
      resolve(chunks);
    });

    // 3. Execute Render
    try {
      const flightStream = renderToPipeableStream(element, manifest, {
        onError(error) {
          clearTimeout(timeout);
          const msg = error instanceof Error ? error.message : String(error);
          // Reject promise if the render fails before streaming starts
          reject(new RenderError('RENDER_ERROR', msg, options.routeId));
        },
      });

      flightStream.pipe(stream);
    } catch (err) {
      clearTimeout(timeout);
      reject(new RenderError('SETUP_ERROR', (err as Error).message, options.routeId));
    }
  });
}