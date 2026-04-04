import { type SourceOGMiddleware } from "@sourceog/platform";
import { SourceOGResponse, type SourceOGRequestContext } from "@sourceog/runtime";
export type RouteMiddlewareLike = SourceOGMiddleware | {
    middleware: (context: SourceOGRequestContext) => Promise<SourceOGResponse | null> | SourceOGResponse | null;
};
export type RouteHandlerResult = SourceOGResponse | Response | string | null | undefined | Record<string, unknown>;
export type RouteHandler = (context: SourceOGRequestContext) => Promise<RouteHandlerResult> | RouteHandlerResult;
export declare function defineRoute(...parts: [...RouteMiddlewareLike[], RouteHandler]): RouteHandler;
