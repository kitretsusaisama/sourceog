// sourceog-renderer/src/rsc/compat-route-loader.ts
// Alibaba CTO 2027 Standard — Route Loading Conventions

import type { WorkerRouteDefinition } from '../types/internal.js';
import { loadRouteModule } from './compat-module-loader.js';
import { RenderError } from '../core/errors.js';

/**
 * Represents a loaded route module with resolved component references.
 */
export interface LoadedRouteComponent {
  id: string;
  pathname: string;
  /** The main component to render (default export or 'Page' export). */
  component: unknown;
  /** Loaded layout components (nested order). */
  layouts: unknown[];
  /** Loaded template component (if present). */
  template: unknown | null;
}

/**
 * Loads the route definition and resolves the React components necessary for rendering.
 * Handles the "Alibaba CTO 2027" convention:
 * - `default` export is the Page.
 * - `Page` export is also checked.
 * - Layouts are `default` exports from layout files.
 */
export async function resolveRouteComponents(
  route: WorkerRouteDefinition
): Promise<LoadedRouteComponent> {
  // 1. Load Page Component
  const pageModule = await loadRouteModule(route.file);
  
  // Convention: Prefer `default`, fallback to `Page` named export
  const pageComponent = pageModule.default ?? (pageModule as any).Page;
  
  if (typeof pageComponent !== 'function') {
    throw new RenderError(
      'INVALID_ROUTE_MODULE',
      `Route "${route.id}" does not export a valid React component.`,
      route.id
    );
  }

  // 2. Load Layout Components
  const layouts: unknown[] = [];
  for (const layoutFile of route.layouts) {
    const layoutModule = await loadRouteModule(layoutFile);
    const layoutComponent = layoutModule.default;
    
    if (typeof layoutComponent !== 'function') {
      console.warn(`[SOURCEOG] Layout "${layoutFile}" does not have a valid default export.`);
      continue;
    }
    layouts.push(layoutComponent);
  }

  // 3. Load Template Component (if present)
  let template: unknown | null = null;
  if (route.templateFile) {
    const templateModule = await loadRouteModule(route.templateFile);
    template = templateModule.default;
    if (typeof template !== 'function') {
      console.warn(`[SOURCEOG] Template "${route.templateFile}" is not a valid component.`);
      template = null;
    }
  }

  return {
    id: route.id,
    pathname: route.pathname,
    component: pageComponent,
    layouts,
    template,
  };
}

export type RouteComponents = LoadedRouteComponent;
