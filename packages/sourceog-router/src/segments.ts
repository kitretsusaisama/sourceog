import type { RouteSegment, RouteSegmentSemanticKind } from "./types.js";

export type { RouteSegment };

export interface ParsedRouteSegment {
  raw: string;
  value: string;
  kind: RouteSegment["kind"];
  semanticKind: RouteSegmentSemanticKind;
  pathPart: string | null;
  pathAffectsRouting: boolean;
  interceptTarget?: string;
  slotName?: string;
  groupName?: string;
  variableName?: string;
  isValid: boolean;
}

export function parseSegment(raw: string): RouteSegment {
  const interceptMatch = raw.match(/^(\((?:\.\.|\.\.\.|\.)+\))(.*)$/);
  if (interceptMatch && interceptMatch[2]) {
    return {
      raw,
      value: interceptMatch[2],
      kind: "static",
      pathPart: interceptMatch[2],
      semanticKind: "intercepting",
      pathAffectsRouting: true,
      interceptTarget: interceptMatch[1]
    };
  }

  if (raw.startsWith("[[...") && raw.endsWith("]]")) {
    return {
      raw,
      value: raw.slice(5, -2),
      kind: "optional-catchall",
      pathPart: null,
      semanticKind: "optional-catchall",
      pathAffectsRouting: true
    };
  }

  if (raw.startsWith("[...") && raw.endsWith("]")) {
    return {
      raw,
      value: raw.slice(4, -1),
      kind: "catchall",
      pathPart: null,
      semanticKind: "catchall",
      pathAffectsRouting: true
    };
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    return {
      raw,
      value: raw.slice(1, -1),
      kind: "dynamic",
      pathPart: null,
      semanticKind: "dynamic",
      pathAffectsRouting: true
    };
  }

  if (raw.startsWith("(") && raw.endsWith(")")) {
    return {
      raw,
      value: raw.slice(1, -1),
      kind: "static",
      pathPart: null,
      semanticKind: "group",
      pathAffectsRouting: false
    };
  }

  if (raw.startsWith("@")) {
    return {
      raw,
      value: raw.slice(1),
      kind: "static",
      pathPart: null,
      semanticKind: "parallel",
      pathAffectsRouting: false,
      slotName: raw.slice(1)
    };
  }

  return {
    raw,
    value: raw,
    kind: "static",
    pathPart: raw,
    semanticKind: "static",
    pathAffectsRouting: true
  };
}

export function buildPathname(segments: RouteSegment[]): string {
  const pathname = segments
    .map((segment) => {
      if (segment.pathPart !== null) {
        return segment.pathPart;
      }

      switch (segment.kind) {
        case "dynamic":
          return `[${segment.value}]`;
        case "catchall":
          return `[...${segment.value}]`;
        case "optional-catchall":
          return `[[...${segment.value}]]`;
        default:
          return null;
      }
    })
    .filter((segment): segment is string => Boolean(segment))
    .join("/");

  return pathname ? `/${pathname}` : "/";
}

const SEGMENT_PRIORITY: Record<string, number> = {
  static: 100,
  dynamic: 10,
  catchall: 1,
  "optional-catchall": 0,
  group: 0,
  parallel: 0,
  intercepting: 100,
  invalid: 0,
};

export function routeSortWeight(segments: RouteSegment[]): number {
  return segments.reduce((total, segment) => {
    return total + (SEGMENT_PRIORITY[segment.semanticKind] ?? 0);
  }, 0);
}

export function normalizeSegments(raws: string[]): RouteSegment[] {
  return raws.map(parseSegment).filter((s) => s.raw !== "");
}
