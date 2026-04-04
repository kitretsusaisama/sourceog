/**
 * Allows a type to be either the raw value or a Promise resolving to that value.
 */
export type MaybePromise<T> = T | Promise<T>;
/**
 * Recursively makes all properties in an object optional.
 */
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
/**
 * Prevents TypeScript from inferring the type from a value.
 */
export type NoInfer<T> = [T][T extends any ? 0 : never];
/**
 * Marks specific keys of an object as optional, leaving others required.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
/**
 * Extracts the type of the items in an array.
 */
export type ArrayItem<T> = T extends Array<infer I> ? I : never;
/**
 * Ensures a type is not `null` or `undefined`.
 */
export type NonNullable<T> = T extends null | undefined ? never : T;
/**
 * Configuration options for LRU Cache implementations across the system.
 */
export interface LRUOptions {
    /** Maximum number of items to hold. */
    max: number;
    /** Time-to-live in milliseconds. (Optional: Infinity if omitted) */
    ttlMs?: number;
    /** Function to call when an item is evicted. */
    dispose?: (key: string, value: unknown) => void;
}
