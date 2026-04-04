// sourceog-renderer/src/planning/segment-graph.ts
// Alibaba CTO 2027 Standard — Segment Graph Construction

import type { RouteDefinition } from '@sourceog/router';
import type {
  ExecutionPlanSegment,
  RenderStrategy,
  CachePolicy,
} from '../types/planning.js';

/**
 * Represents a node in the render segment tree.
 */
export interface SegmentNode {
  id: string;
  type: 'layout' | 'template' | 'page' | 'parallel' | 'root';
  filePath: string;
  children: SegmentNode[];
}

/**
 * Constructs the segment graph for a given route.
 *
 * This graph dictates the order and nesting of rendering operations.
 *
 * Root
 *  └─ Layouts (outer → inner)
 *      └─ Template (optional)
 *          └─ Page
 *          └─ Parallel slots (siblings of Page under same parent)
 */
export function buildSegmentGraph(route: RouteDefinition): SegmentNode {
  const rootNode: SegmentNode = {
    id: 'root',
    type: 'root',
    filePath: '',
    children: [],
  };

  let cursor = rootNode;

  // 1. Add Layout Segments (top-down order)
  for (const layoutFile of route.layouts) {
    const layoutNode: SegmentNode = {
      id: `layout:${layoutFile}`,
      type: 'layout',
      filePath: layoutFile,
      children: [],
    };

    cursor.children.push(layoutNode);
    cursor = layoutNode;
  }

  // 2. Add Template Segment (if exists)
  if (route.templateFile) {
    const templateNode: SegmentNode = {
      id: `template:${route.templateFile}`,
      type: 'template',
      filePath: route.templateFile,
      children: [],
    };

    cursor.children.push(templateNode);
    cursor = templateNode;
  }

  // 3. Add Page Segment
  const pageNode: SegmentNode = {
    id: `page:${route.file}`,
    type: 'page',
    filePath: route.file,
    children: [],
  };

  cursor.children.push(pageNode);

  // 4. Add Parallel Route Slots (optional extension point)
  const routeAny = route as any;
  if (routeAny.parallelRoutes) {
    for (const [slot, slotRoute] of Object.entries(routeAny.parallelRoutes as Record<string, { file: string }>)) {
      const parallelNode: SegmentNode = {
        id: `parallel:${slot}:${slotRoute.file}`,
        type: 'parallel',
        filePath: slotRoute.file,
        children: [],
      };

      cursor.children.push(parallelNode);
    }
  }

  return rootNode;
}

/**
 * Flattens the segment graph into a linear execution list.
 *
 * Order is determined by render priority:
 * - Layouts first (outer → inner)
 * - Template
 * - Page
 * - Parallel slots
 */
export function flattenSegmentGraph(
  root: SegmentNode,
  defaultStrategy: RenderStrategy,
  defaultCache: CachePolicy,
): ExecutionPlanSegment[] {
  const segments: ExecutionPlanSegment[] = [];

  function visit(node: SegmentNode, depth: number) {
    if (node.type !== 'root') {
      segments.push({
        id: node.id,
        kind:
          node.type === 'parallel'
            ? 'deferred'
            : (node.type as ExecutionPlanSegment['kind']),
        strategy: defaultStrategy,
        // Higher depth → lower priority; layouts (depth 1, 2, ...) get higher priority.
        priority: 100 - depth,
        cache: defaultCache,
      });
    }

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);

  return segments;
}