import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceOGRequestContext } from "./request.js";

const requestContextStorage = new AsyncLocalStorage<SourceOGRequestContext>();

export function runWithRequestContext<T>(context: SourceOGRequestContext, callback: () => T): T {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): SourceOGRequestContext | undefined {
  return requestContextStorage.getStore();
}

export function requireRequestContext(): SourceOGRequestContext {
  const context = getRequestContext();
  if (!context) {
    throw new Error("No SourceOG request context is currently active.");
  }
  return context;
}
