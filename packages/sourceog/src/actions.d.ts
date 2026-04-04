import type { ClientActionReference } from "@sourceog/runtime/actions";

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

export declare function createServerAction<TArgs extends AnyActionArgs, TResult>(
  handler: (...args: TArgs) => Promise<TResult> | TResult,
  options?: CreateServerActionOptions
): ServerAction<TArgs, TResult>;

export declare function callServerAction<TResult = unknown>(
  action: ServerAction | string,
  ...args: unknown[]
): Promise<TResult>;

export declare function callServerActionById<TResult = unknown>(
  actionId: string,
  ...args: unknown[]
): Promise<TResult>;

export declare function createActionReceipt(input: CreateActionReceiptInput): Promise<ActionReceipt>;
export declare function confirmActionReceipt(token: string): Promise<ConfirmedActionReceipt>;
export declare function useActionQueue<TResult = unknown>(): ActionQueueApi<TResult>;
export declare function createOptimisticScope<TState, TPayload>(
  id: string,
  reducer: (state: TState, payload: TPayload) => TState
): OptimisticScope<TState, TPayload>;
export declare function useOptimistic<TState, TPayload>(
  state: TState,
  scope: OptimisticScope<TState, TPayload> | ((state: TState, payload: TPayload) => TState)
): [TState, (payload: TPayload) => void];
export declare function useFormStatus(): {
  pending: boolean;
  data?: FormData;
  method?: string;
  action?: string;
};
export declare function useFormState<TState, TPayload>(
  action: ServerAction<[TPayload], TState | void> | ((payload: TPayload) => Promise<TState | void> | TState | void),
  initialState: TState
): [TState, (payload: TPayload) => void];
export declare function refreshCurrentRoute(url?: string, replaceState?: boolean): Promise<void>;
export declare const refresh: typeof refreshCurrentRoute;
export type { ClientActionReference };
