import type { SourceOGRequestContext } from "./request.js";
export declare function runWithRequestContext<T>(context: SourceOGRequestContext, callback: () => T): T;
export declare function getRequestContext(): SourceOGRequestContext | undefined;
export declare function requireRequestContext(): SourceOGRequestContext;
