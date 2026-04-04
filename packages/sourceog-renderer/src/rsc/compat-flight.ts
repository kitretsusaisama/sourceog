// sourceog-renderer/src/rsc/compat-flight.ts
// Alibaba CTO 2027 Standard — Flight Protocol Utilities

import type { ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

/**
 * The official MIME type for React Server Components payloads.
 *
 * This mirrors the upstream RSC content type used by react-server-dom-webpack.
 */
export const RSCCONTENTTYPE = 'text/x-component';

/**
 * Standard headers applied to all RSC (Flight) responses.
 *
 * Notes:
 * - Connection semantics (keep-alive) are typically handled by the HTTP server,
 *   but we include an explicit X-SourceOG-RSC marker for observability.
 */
export const RSCHEADERS: Record<string, string> = {
  'Content-Type': RSCCONTENTTYPE,
  'X-SourceOG-RSC': '1',
};

/**
 * Returns true if the client explicitly accepts React Flight (RSC) responses.
 *
 * @param acceptHeader - The raw value of the `Accept` header.
 */
export function acceptsFlight(
  acceptHeader: string | null | undefined,
): boolean {
  if (!acceptHeader) {
    return false;
  }

  // Simple substring check is sufficient; upstream RSC implementations do the same.
  return acceptHeader.includes(RSCCONTENTTYPE);
}

/**
 * Pipes a Flight (RSC) stream into a Node.js `ServerResponse`, attaching
 * the appropriate headers and wiring backpressure and error propagation.
 *
 * This is intended for Node HTTP servers (e.g., `http`, `http2`, or frameworks
 * that expose a compatible `ServerResponse` API).
 *
 * @param stream - The PassThrough (or readable) stream containing the RSC payload.
 * @param res - The Node.js `ServerResponse` instance to write into.
 */
export function pipeFlightToResponse(
  stream: PassThrough,
  res: ServerResponse,
): void {
  // 1. Set required headers before any data is written.
  for (const [key, value] of Object.entries(RSCHEADERS)) {
    res.setHeader(key, value);
  }

  // 2. Propagate stream errors to the HTTP response.
  stream.on('error', (err) => {
    // Fallback logging; in production this should go through the structured logger.
    // eslint-disable-next-line no-console
    console.error('RSC Flight Stream error', err);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('RSC Stream Error');
    } else {
      // If headers/body already started, we cannot change the status code,
      // so we destroy the connection to avoid sending a partial payload.
      res.destroy();
    }
  });

  // 3. Pipe the Flight stream to the response, letting Node handle backpressure.
  stream.pipe(res);
}

/**
 * Decodes a raw chunk from the Flight stream into a UTF-8 string.
 *
 * This is primarily used when collecting chunks server-side in order to
 * embed them into an HTML shell for hybrid SSR + RSC responses.
 *
 * @param chunk - The raw buffer or string chunk from the stream.
 * @returns The decoded string representation of the chunk.
 */
export function decodeChunk(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
}