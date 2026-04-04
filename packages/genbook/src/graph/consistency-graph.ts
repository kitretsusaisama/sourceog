import type {
  ConsistencyGraphManifest,
  GraphNode,
  GraphNodeType,
  InvalidationResult,
} from "../types/adosf.js";

function nodeTypeFromId(id: string): GraphNodeType {
  if (id.startsWith("data:")) return "data";
  if (id.startsWith("cmp:")) return "component";
  if (id.startsWith("route:")) return "route";
  return "optimistic";
}

export class ConsistencyGraph {
  private readonly nodes = new Map<string, GraphNode>();

  seedFromManifest(manifest: ConsistencyGraphManifest): void {
    this.nodes.clear();
    for (const node of manifest.nodes) {
      this.nodes.set(node.id, { ...node, deps: [...node.deps], dependents: [...node.dependents] });
    }
  }

  trackDep(dataId: string, componentId: string, routeId: string): void {
    this.link(componentId, dataId);
    this.link(routeId, componentId);
  }

  link(fromId: string, toId: string): void {
    const fromNode = this.ensureNode(fromId);
    const toNode = this.ensureNode(toId);

    if (!fromNode.deps.includes(toId)) {
      fromNode.deps.push(toId);
    }
    if (!toNode.dependents.includes(fromId)) {
      toNode.dependents.push(fromId);
    }
  }

  invalidate(nodeId: string): InvalidationResult {
    const startedAt = Date.now();
    const target = this.ensureNode(nodeId);
    target.lastInvalidated = startedAt;

    const queue = [...target.dependents];
    const visited = new Set<string>();
    const affected: string[] = [];
    const serverRoutes: string[] = [];
    const clientNodes: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);
      affected.push(currentId);

      const node = this.ensureNode(currentId);
      if (node.type === "route") {
        serverRoutes.push(currentId);
      } else {
        clientNodes.push(currentId);
      }

      for (const dependent of node.dependents) {
        if (!visited.has(dependent)) {
          queue.push(dependent);
        }
      }
    }

    return {
      affected,
      serverRoutes,
      clientNodes,
      cacheKeys: serverRoutes.map((routeId) => `route:${routeId}`),
      propagationMs: Date.now() - startedAt,
    };
  }

  dependentsOf(nodeId: string, maxDepth = Number.POSITIVE_INFINITY): GraphNode[] {
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    const visited = new Set<string>();
    const result: GraphNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) {
        continue;
      }

      const node = this.nodes.get(current.id);
      if (!node) {
        continue;
      }

      for (const dependent of node.dependents) {
        if (visited.has(dependent)) {
          continue;
        }
        visited.add(dependent);
        const dependentNode = this.ensureNode(dependent);
        result.push(dependentNode);
        queue.push({ id: dependent, depth: current.depth + 1 });
      }
    }

    return result;
  }

  nodeExists(id: string): boolean {
    return this.nodes.has(id);
  }

  size(): number {
    return this.nodes.size;
  }

  toJSON(): ConsistencyGraphManifest {
    const nodes = [...this.nodes.values()].map((node) => ({
      ...node,
      deps: [...node.deps].sort(),
      dependents: [...node.dependents].sort(),
    }));
    const edges = nodes.flatMap((node) => node.deps.map((dep) => ({ from: node.id, to: dep })));
    return {
      version: "adosf-x/1",
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
    };
  }

  fromJSON(manifest: ConsistencyGraphManifest): void {
    this.seedFromManifest(manifest);
  }

  private ensureNode(id: string): GraphNode {
    const existing = this.nodes.get(id);
    if (existing) {
      return existing;
    }

    const node: GraphNode = {
      id,
      type: nodeTypeFromId(id),
      deps: [],
      dependents: [],
    };
    this.nodes.set(id, node);
    return node;
  }
}
