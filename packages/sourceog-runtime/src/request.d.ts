import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { CacheStore } from "./cache.js";
import type { CacheManifest } from "./contracts.js";
export type SourceOGRuntimeName = "node" | "edge" | "cloudflare" | "vercel-node" | "vercel-edge" | "deno";
export interface SourceOGRequestMemoizationState {
    entries: Map<string, Promise<unknown>>;
}
export interface SourceOGRequestRuntimeState {
    requestMemoization?: SourceOGRequestMemoizationState;
    dataCacheStore?: CacheStore;
    buildId?: string;
    cacheManifest?: CacheManifest;
}
export interface SourceOGRequest {
    url: URL;
    method: string;
    headers: Headers;
    cookies: Map<string, string>;
    requestId: string;
    runtime: SourceOGRuntimeName;
    raw?: IncomingMessage | Request;
    bodyText(): Promise<string>;
    bodyJson<T>(): Promise<T>;
}
export interface SourceOGResponseInit {
    status?: number;
    headers?: HeadersInit;
}
export declare class SourceOGResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body: string | Readable | Uint8Array | null;
    constructor(body: string | Readable | Uint8Array | null, init?: SourceOGResponseInit);
}
export interface SourceOGRequestContext {
    request: SourceOGRequest;
    params: Record<string, string | string[]>;
    query: URLSearchParams;
    locale?: string;
    runtimeState?: SourceOGRequestRuntimeState;
}
export declare function parseCookies(cookieHeader?: string | null): Map<string, string>;
export declare function createNodeRequest(req: IncomingMessage, baseUrl: string): SourceOGRequest;
export declare function sendNodeResponse(res: ServerResponse, response: SourceOGResponse): Promise<void>;
export declare function html(body: string, init?: SourceOGResponseInit): SourceOGResponse;
export declare function json(data: unknown, init?: SourceOGResponseInit): SourceOGResponse;
export declare function text(body: string, init?: SourceOGResponseInit): SourceOGResponse;
export declare function redirect(location: string, status?: number): SourceOGResponse;
