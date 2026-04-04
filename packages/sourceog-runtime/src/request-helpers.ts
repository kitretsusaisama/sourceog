import { getRequestContext, requireRequestContext } from "./context.js";
import type { SourceOGRequest, SourceOGRequestContext, SourceOGRequestRuntimeState } from "./request.js";

export interface DraftModeState {
  isEnabled: boolean;
  enable(): void;
  disable(): void;
}

export function createRequestContext(input: {
  request: SourceOGRequest;
  params?: Record<string, string | string[]>;
  query?: URLSearchParams;
  locale?: string;
  runtimeState?: SourceOGRequestRuntimeState;
}): SourceOGRequestContext {
  return {
    request: input.request,
    params: input.params ?? {},
    query: input.query ?? new URLSearchParams(input.request.url.search),
    locale: input.locale,
    runtimeState: input.runtimeState,
  };
}

export function headers(): Headers {
  return requireRequestContext().request.headers;
}

export function cookies(): Map<string, string> {
  return requireRequestContext().request.cookies;
}

export function draftMode(): DraftModeState {
  const context = requireRequestContext();
  const isEnabled =
    context.request.cookies.get("__sourceog_draft_mode") === "1"
    || context.request.headers.get("x-sourceog-draft-mode") === "1";

  return {
    isEnabled,
    enable() {
      context.request.cookies.set("__sourceog_draft_mode", "1");
    },
    disable() {
      context.request.cookies.delete("__sourceog_draft_mode");
    },
  };
}

export async function after(callback: () => void | Promise<void>): Promise<void> {
  queueMicrotask(() => {
    void Promise.resolve()
      .then(callback)
      .catch(() => {
        // Intentionally swallow post-response callbacks at this layer.
      });
  });
}

export function inspectRequestContext(): Record<string, unknown> {
  const context = getRequestContext();
  if (!context) {
    return {
      active: false,
    };
  }

  return {
    active: true,
    requestId: context.request.requestId,
    pathname: context.request.url.pathname,
    method: context.request.method,
    runtime: context.request.runtime,
    locale: context.locale ?? null,
    params: context.params,
    query: Object.fromEntries(context.query.entries()),
    buildId: context.runtimeState?.buildId ?? null,
    hasExecutionPlan: Boolean(context.runtimeState?.executionPlan),
  };
}
