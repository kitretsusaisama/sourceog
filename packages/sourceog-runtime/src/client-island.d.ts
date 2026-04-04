import React from "react";
import type { ClientReferenceManifestRegistryEntry } from "./contracts.js";
/**
 * The shape of a React client reference object recognised by
 * react-server-dom-webpack.  Uses `$$typeof` (double-dollar) as required by
 * the React Flight serialiser.
 */
export interface ClientIslandRef {
    $$typeof: symbol;
    $$id: string;
    $$chunks: string[];
    $$name: string;
    $$async: boolean;
}
export interface ClientIslandProps<TProps extends object> {
    component: React.ComponentType<TProps>;
    props?: TProps;
    moduleId: string;
    exportName?: string;
}
/**
 * Thrown at RSC render time when a `"use client"` boundary cannot be resolved
 * to a manifest entry.  Mirrors the `CompilerError` in the compiler package so
 * that the runtime does not need to import from `@sourceog/compiler`.
 */
export declare class CompilerError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Creates the `$$typeof: Symbol.for("react.client.reference")` object that
 * react-server-dom-webpack recognises as a client reference during Flight
 * serialisation.
 *
 * @param id     - Stable 16-char hex module id (sha256 of normalised path)
 * @param name   - Export name ("default" or a named export)
 * @param chunks - Chunk hrefs for this module
 */
export declare function createClientIslandRef(id: string, name: string, chunks: string[]): ClientIslandRef;
/**
 * Wraps a `ClientReferenceManifestRegistryEntry` in a proper React client
 * reference proxy that the RSC worker can serialise into the Flight wire
 * format.
 *
 * @param entry - A resolved manifest registry entry
 * @returns A `React.ComponentType` that is actually a client reference object
 */
export declare function createClientReferenceProxy(entry: ClientReferenceManifestRegistryEntry): React.ComponentType<any>;
/**
 * `ClientIsland` renders a `"use client"` boundary.
 *
 * - **RSC worker context** (`__SOURCEOG_RSC_WORKER__ === true`): resolves the
 *   manifest entry and returns a real client reference proxy so the Flight
 *   serialiser emits a proper module reference.  If the manifest entry is
 *   missing, throws `CompilerError` with code `USE_CLIENT_NO_MANIFEST_ENTRY`
 *   — never renders a placeholder div (INV-002, Req 8.2).
 *
 * - **Browser / SSR context**: renders the component directly inside a
 *   hydration wrapper div.
 */
export declare function ClientIsland<TProps extends object>({ component: Component, props, moduleId, exportName }: ClientIslandProps<TProps>): React.JSX.Element;
