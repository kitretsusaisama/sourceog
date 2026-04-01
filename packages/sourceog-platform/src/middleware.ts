import type { SourceOGRequestContext, SourceOGResponse } from "@sourceog/runtime";

export type NextMiddleware = () => Promise<SourceOGResponse | void>;
export type SourceOGMiddleware = (
  context: SourceOGRequestContext,
  next: NextMiddleware
) => Promise<SourceOGResponse | void> | SourceOGResponse | void;

export function defineMiddleware(middleware: SourceOGMiddleware): SourceOGMiddleware {
  return middleware;
}

export function composeMiddleware(
  middleware: SourceOGMiddleware[],
  context: SourceOGRequestContext,
  finalHandler: () => Promise<SourceOGResponse>
): Promise<SourceOGResponse> {
  const dispatch = async (index: number): Promise<SourceOGResponse> => {
    const layer = middleware[index];
    if (!layer) {
      return finalHandler();
    }

    const result = await layer(context, () => dispatch(index + 1));
    return result ?? dispatch(index + 1);
  };

  return dispatch(0);
}
