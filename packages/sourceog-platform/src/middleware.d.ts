import type { SourceOGRequestContext, SourceOGResponse } from "@sourceog/runtime";
export type NextMiddleware = () => Promise<SourceOGResponse | void>;
export type SourceOGMiddleware = (context: SourceOGRequestContext, next: NextMiddleware) => Promise<SourceOGResponse | void> | SourceOGResponse | void;
export declare function defineMiddleware(middleware: SourceOGMiddleware): SourceOGMiddleware;
export declare function composeMiddleware(middleware: SourceOGMiddleware[], context: SourceOGRequestContext, finalHandler: () => Promise<SourceOGResponse>): Promise<SourceOGResponse>;
