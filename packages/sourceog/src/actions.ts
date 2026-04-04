import React from "react";
import ReactDOM from "react-dom";
import {
  callServerAction as runtimeCallServerAction,
  callServerActionById,
  refreshCurrentRoute,
  type ClientActionReference
} from "@sourceog/runtime/actions";
import { SourceOGError, SOURCEOG_ERROR_CODES } from "@sourceog/runtime/errors";

export type AnyActionArgs = unknown[];

export interface ServerAction<TArgs extends AnyActionArgs = AnyActionArgs, TResult = unknown> {
  (...args: TArgs): Promise<TResult>;
  $$typeof: "sourceog.server.action";
  actionId: string;
  exportName: string;
}

export interface CreateServerActionOptions {
  actionId?: string;
  exportName?: string;
}

export interface ActionReceipt {
  token: string;
  actionId: string;
  userId?: string;
  createdAt: string;
  consumed: boolean;
  consumedAt?: string;
}

export interface CreateActionReceiptInput {
  actionId: string;
  userId?: string;
}

export interface ConfirmedActionReceipt extends ActionReceipt {
  consumed: true;
  consumedAt: string;
}

export interface OptimisticScope<TState, TPayload> {
  id: string;
  reducer: (state: TState, payload: TPayload) => TState;
}

export interface ActionQueueStatus<TResult = unknown> {
  pending: boolean;
  size: number;
  completed: number;
  failed: number;
  settled: number;
  lastResult?: TResult;
  lastError?: unknown;
}

export interface ActionQueueApi<TResult = unknown> {
  enqueue(action: ServerAction | string | ((...args: unknown[]) => Promise<unknown> | unknown), ...args: unknown[]): void;
  drain(): Promise<void>;
  status: ActionQueueStatus<TResult>;
}

type ActionLike = ServerAction | string | ((...args: unknown[]) => Promise<unknown> | unknown);

const reactDomUseFormStatus = (ReactDOM as typeof import("react-dom")).useFormStatus;
const reactUseActionState = (React as typeof import("react")).useActionState;
const reactUseMemo = (React as typeof import("react")).useMemo;
const reactUseRef = (React as typeof import("react")).useRef;
const reactUseState = (React as typeof import("react")).useState;

const RECEIPT_STORE = new Map<string, ActionReceipt>();

function randomToken(): string {
  return `receipt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function invokeAction<TResult>(action: ActionLike, args: unknown[]): Promise<TResult> {
  if (typeof action === "function" && "$$typeof" in action && action.$$typeof === "sourceog.server.action") {
    return callServerAction(action as ServerAction, ...args);
  }

  if (typeof action === "string") {
    return runtimeCallServerAction<TResult>(action, ...args);
  }

  return await action(...args) as TResult;
}

export function createServerAction<TArgs extends AnyActionArgs, TResult>(
  handler: (...args: TArgs) => Promise<TResult> | TResult,
  options: CreateServerActionOptions = {}
): ServerAction<TArgs, TResult> {
  const exportName = options.exportName ?? handler.name ?? "anonymousAction";
  const actionId = options.actionId ?? `action::${exportName}`;
  const action = (async (...args: TArgs) => await handler(...args)) as ServerAction<TArgs, TResult>;
  action.$$typeof = "sourceog.server.action";
  action.actionId = actionId;
  action.exportName = exportName;
  return action;
}

export async function callServerAction<TResult = unknown>(
  action: ServerAction | string,
  ...args: unknown[]
): Promise<TResult> {
  if (typeof action === "string") {
    return runtimeCallServerAction<TResult>(action, ...args);
  }

  if (action.actionId) {
    return callServerActionById<TResult>(action.actionId, ...args);
  }

  return runtimeCallServerAction<TResult>(action.exportName, ...args);
}

export async function createActionReceipt(input: CreateActionReceiptInput): Promise<ActionReceipt> {
  const token = randomToken();
  const receipt: ActionReceipt = {
    token,
    actionId: input.actionId,
    userId: input.userId,
    createdAt: new Date().toISOString(),
    consumed: false
  };
  RECEIPT_STORE.set(token, receipt);
  return receipt;
}

export async function confirmActionReceipt(token: string): Promise<ConfirmedActionReceipt> {
  const receipt = RECEIPT_STORE.get(token);
  if (!receipt) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.ACTION_NOT_FOUND,
      `No action receipt exists for token "${token}".`,
      { token }
    );
  }

  if (receipt.consumed) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.ACTION_EXECUTION_FAILED,
      `Action receipt "${token}" has already been consumed.`,
      { token, code: "RECEIPT_ALREADY_CONSUMED" }
    );
  }

  const consumedAt = new Date().toISOString();
  const confirmed: ConfirmedActionReceipt = {
    ...receipt,
    consumed: true,
    consumedAt
  };
  RECEIPT_STORE.set(token, confirmed);
  return confirmed;
}

export function useActionQueue<TResult = unknown>(): ActionQueueApi<TResult> {
  const queueRef = reactUseRef<Array<{ action: ActionLike; args: unknown[] }>>([]);
  const statusRef = reactUseRef<ActionQueueStatus<TResult>>({
    pending: false,
    size: 0,
    completed: 0,
    failed: 0,
    settled: 0
  });
  const [, forceRender] = reactUseState(0);
  const inFlightRef = reactUseRef<Promise<void> | null>(null);

  const runQueue = async (): Promise<void> => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    inFlightRef.current = (async () => {
      statusRef.current = { ...statusRef.current, pending: true, size: queueRef.current.length };
      forceRender((value) => value + 1);

      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) {
          break;
        }
        try {
          const result = await invokeAction<TResult>(next.action, next.args);
          statusRef.current = {
            ...statusRef.current,
            completed: statusRef.current.completed + 1,
            settled: statusRef.current.settled + 1,
            size: queueRef.current.length,
            lastResult: result,
            lastError: undefined
          };
        } catch (error) {
          statusRef.current = {
            ...statusRef.current,
            failed: statusRef.current.failed + 1,
            settled: statusRef.current.settled + 1,
            size: queueRef.current.length,
            lastError: error
          };
        }
        forceRender((value) => value + 1);
      }

      statusRef.current = {
        ...statusRef.current,
        pending: false,
        size: 0
      };
      forceRender((value) => value + 1);
      inFlightRef.current = null;
    })();

    return inFlightRef.current;
  };

  return reactUseMemo<ActionQueueApi<TResult>>(() => ({
    enqueue(action, ...args) {
      queueRef.current.push({ action, args });
      statusRef.current = {
        ...statusRef.current,
        size: queueRef.current.length
      };
      forceRender((value) => value + 1);
    },
    async drain() {
      await runQueue();
    },
    get status() {
      return statusRef.current;
    }
  }), []);
}

export function createOptimisticScope<TState, TPayload>(
  id: string,
  reducer: (state: TState, payload: TPayload) => TState
): OptimisticScope<TState, TPayload> {
  return { id, reducer };
}

export function useOptimistic<TState, TPayload>(
  state: TState,
  scope: OptimisticScope<TState, TPayload> | ((state: TState, payload: TPayload) => TState)
): [TState, (payload: TPayload) => void] {
  const reducer = typeof scope === "function" ? scope : scope.reducer;
  return React.useOptimistic(state, reducer);
}

export function useFormStatus(): ReturnType<typeof reactDomUseFormStatus> {
  if (typeof reactDomUseFormStatus !== "function") {
    return { pending: false, data: undefined, method: undefined, action: undefined } as ReturnType<typeof reactDomUseFormStatus>;
  }

  return reactDomUseFormStatus();
}

export function useFormState<TState, TPayload>(
  action: ServerAction<[TPayload], TState | void> | ((payload: TPayload) => Promise<TState | void> | TState | void),
  initialState: TState
) : [TState, (payload: TPayload) => void] {
  const formState = reactUseActionState(
    async (_previousState: Awaited<TState>, payload: TPayload): Promise<Awaited<TState>> => {
      const result = await invokeAction<TState | void>(action as ActionLike, [payload]);
      return (result ?? initialState) as Awaited<TState>;
    },
    initialState as Awaited<Awaited<TState>>
  );

  return [formState[0] as TState, formState[1] as (payload: TPayload) => void];
}

export { callServerActionById, refreshCurrentRoute, refreshCurrentRoute as refresh, type ClientActionReference };
