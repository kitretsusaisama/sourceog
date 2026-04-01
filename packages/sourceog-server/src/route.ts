import { composeMiddleware, type SourceOGMiddleware } from "@sourceog/platform";
import {
  json,
  SourceOGResponse,
  text,
  type SourceOGRequestContext,
} from "@sourceog/runtime";

export type RouteMiddlewareLike =
  | SourceOGMiddleware
  | { middleware: (context: SourceOGRequestContext) => Promise<SourceOGResponse | null> | SourceOGResponse | null };

export type RouteHandlerResult =
  | SourceOGResponse
  | Response
  | string
  | null
  | undefined
  | Record<string, unknown>;

export type RouteHandler = (
  context: SourceOGRequestContext
) => Promise<RouteHandlerResult> | RouteHandlerResult;

function normalizeMiddleware(input: RouteMiddlewareLike): SourceOGMiddleware {
  if (typeof input === "function") {
    return input;
  }

  return async (context, next) => {
    const result = await input.middleware(context);
    return result ?? next();
  };
}

async function normalizeHandlerResult(result: RouteHandlerResult): Promise<SourceOGResponse> {
  if (result instanceof Response) {
    return new SourceOGResponse(await result.text(), {
      status: result.status,
      headers: result.headers
    });
  }

  if (result instanceof SourceOGResponse) {
    return result;
  }

  if (typeof result === "string") {
    return text(result);
  }

  return json(result ?? { ok: true });
}

export function defineRoute(...parts: [...RouteMiddlewareLike[], RouteHandler]): RouteHandler {
  const handler = parts[parts.length - 1] as RouteHandler;
  const middlewareInputs = parts.slice(0, -1) as RouteMiddlewareLike[];
  const middleware = middlewareInputs.map(normalizeMiddleware);

  return async (context: SourceOGRequestContext): Promise<SourceOGResponse> => {
    const executeHandler = async (): Promise<SourceOGResponse> => normalizeHandlerResult(await handler(context));
    if (middleware.length === 0) {
      return executeHandler();
    }

    return composeMiddleware(middleware, context, executeHandler);
  };
}
