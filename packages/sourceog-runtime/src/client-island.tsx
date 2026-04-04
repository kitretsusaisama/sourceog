import React from "react";
import type { ClientReferenceManifestRegistryEntry } from "./contracts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

const CLIENT_REFERENCE_TAG = Symbol.for("react.client.reference");

export interface ClientIslandProps<TProps extends object> {
  component: React.ComponentType<TProps>;
  props?: TProps;
  moduleId: string;
  exportName?: string;
}

// ---------------------------------------------------------------------------
// CompilerError — thrown in RSC worker context when manifest entry is missing
// ---------------------------------------------------------------------------

/**
 * Thrown at RSC render time when a `"use client"` boundary cannot be resolved
 * to a manifest entry.  Mirrors the `CompilerError` in the compiler package so
 * that the runtime does not need to import from `@sourceog/compiler`.
 */
export class CompilerError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CompilerError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldRenderClientBoundaryPlaceholder(): boolean {
  const runtimeGlobals = globalThis as typeof globalThis & {
    __SOURCEOG_RSC_WORKER__?: boolean;
  };
  return runtimeGlobals.__SOURCEOG_RSC_WORKER__ === true;
}

function normalizeSpecifier(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function resolveRelativeModulePath(parentFile: string, moduleId: string): string {
  const normalizedParent = parentFile.replaceAll("\\", "/");
  const normalizedModule = moduleId.replaceAll("\\", "/");
  if (!normalizedModule.startsWith(".")) {
    return normalizedModule;
  }

  const segments = normalizedParent.split("/");
  segments.pop();

  for (const part of normalizedModule.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  return segments.join("/");
}

function resolveClientReferenceEntry(
  moduleId: string,
  exportName: string,
  component?: React.ComponentType<unknown>
): ClientReferenceManifestRegistryEntry | null {
  const runtimeGlobals = globalThis as typeof globalThis & {
    __SOURCEOG_CLIENT_REFERENCE_MANIFEST__?: Record<string, ClientReferenceManifestRegistryEntry>;
    __SOURCEOG_RSC_PARENT_MODULE_FILE__?: string;
  };
  const registry = runtimeGlobals.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ ?? {};
  const normalizedModuleId = normalizeSpecifier(moduleId);
  const parentFile = runtimeGlobals.__SOURCEOG_RSC_PARENT_MODULE_FILE__;
  const normalizedResolvedPath = parentFile
    ? normalizeSpecifier(resolveRelativeModulePath(parentFile, moduleId))
    : "";

  for (const [manifestKey, entry] of Object.entries(registry)) {
    const keyMatches = manifestKey.toLowerCase().endsWith(`#${exportName.toLowerCase()}`);
    if (!keyMatches) {
      continue;
    }

    const filePath = normalizeSpecifier(entry.filepath);
    const fileName = filePath.split("/").pop() ?? "";
    if (
      filePath.endsWith(normalizedModuleId)
      || fileName === normalizedModuleId
      || (normalizedResolvedPath && filePath === normalizedResolvedPath)
    ) {
      return entry;
    }
  }

  const normalizedComponentName = normalizeSpecifier(component?.displayName ?? component?.name ?? "");
  if (!normalizedComponentName) {
    return null;
  }

  for (const [manifestKey, entry] of Object.entries(registry)) {
    const keyMatches = manifestKey.toLowerCase().endsWith(`#${exportName.toLowerCase()}`);
    if (!keyMatches) {
      continue;
    }

    const filePath = normalizeSpecifier(entry.filepath);
    const fileName = filePath.split("/").pop() ?? "";
    if (filePath.endsWith(normalizedComponentName) || fileName === normalizedComponentName) {
      return entry;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates the `$$typeof: Symbol.for("react.client.reference")` object that
 * react-server-dom-webpack recognises as a client reference during Flight
 * serialisation.
 *
 * @param id     - Stable 16-char hex module id (sha256 of normalised path)
 * @param name   - Export name ("default" or a named export)
 * @param chunks - Chunk hrefs for this module
 */
export function createClientIslandRef(
  id: string,
  name: string,
  chunks: string[]
): ClientIslandRef {
  return {
    $$typeof: CLIENT_REFERENCE_TAG,
    $$id: `${id}#${name}`,
    $$chunks: chunks,
    $$name: name,
    $$async: false
  };
}

/**
 * Wraps a `ClientReferenceManifestRegistryEntry` in a proper React client
 * reference proxy that the RSC worker can serialise into the Flight wire
 * format.
 *
 * @param entry - A resolved manifest registry entry
 * @returns A `React.ComponentType` that is actually a client reference object
 */
export function createClientReferenceProxy(
  entry: ClientReferenceManifestRegistryEntry
): React.ComponentType<unknown> {
  return createClientIslandRef(
    entry.id,
    entry.name,
    entry.chunks
  ) as React.ComponentType<unknown>;
}

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
export function ClientIsland<TProps extends object>({
  component: Component,
  props,
  moduleId,
  exportName = "default"
}: ClientIslandProps<TProps>): React.JSX.Element {
  // RSC worker context check must happen before any hook calls — hooks are
  // not valid in the RSC worker environment (INV-002, Req 1.1, 8.2).
  if (shouldRenderClientBoundaryPlaceholder()) {
    const manifestEntry = resolveClientReferenceEntry(moduleId, exportName, Component);

    if (!manifestEntry) {
      // Req 1.1, 8.2 (INV-002) — missing manifest entry is a hard error in
      // RSC worker context; never fall back to a placeholder div.
      throw new CompilerError(
        "USE_CLIENT_NO_MANIFEST_ENTRY",
        `[SOURCEOG] Missing client reference manifest entry for "${moduleId}#${exportName}". ` +
        'Ensure the "use client" file is included in the build and the manifest has been generated. ' +
        `Component: ${Component.displayName ?? Component.name ?? "unknown"}`
      );
    }

    const proxy = createClientReferenceProxy(manifestEntry);
    return React.createElement(proxy, (props ?? {}) as TProps);
  }

  // Browser / SSR context — hooks are valid here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const islandId = React.useId();
  const serializedProps = encodeURIComponent(JSON.stringify(props ?? {}));

  return (
    <div
      data-sourceog-client-island={islandId}
      data-sourceog-client-boundary={moduleId}
      data-sourceog-client-module={moduleId}
      data-sourceog-client-export={exportName}
      data-sourceog-client-props={serializedProps}
    >
      <Component {...((props ?? {}) as TProps)} />
    </div>
  );
}
