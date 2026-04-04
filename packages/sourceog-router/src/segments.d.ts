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
export declare function parseSegment(raw: string): RouteSegment;
export declare function buildPathname(segments: RouteSegment[]): string;
export declare function routeSortWeight(segments: RouteSegment[]): number;
export declare function normalizeSegments(raws: string[]): RouteSegment[];
