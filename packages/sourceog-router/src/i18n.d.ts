import type { I18nConfig, RouteNode, RouteTree } from "./types.js";
export interface LocaleVariantRouteNode extends RouteNode {
    sourceRouteKey: string;
    localePathname: string;
    localeRouteKey: string;
    isLocaleVariant: true;
}
/**
 * Expands locale variants for statically generatable routes.
 *
 * Behavior:
 * - Clears prior localeVariants to make the operation idempotent.
 * - Expands only locale-eligible nodes (ssg/isr renderMode).
 * - Applies localePrefix mode or localePathnames overrides.
 * - Preserves sourceRouteKey for reverse lookup.
 */
export declare function applyI18nExpansion(tree: RouteTree, i18n: I18nConfig): void;
