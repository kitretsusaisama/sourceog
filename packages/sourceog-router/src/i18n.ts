// packages/sourceog-router/src/i18n.ts
import type { I18nConfig, RouteNode, RouteTree } from "./types.js";

export interface LocaleVariantRouteNode extends RouteNode {
  sourceRouteKey: string;
  localePathname: string;
  localeRouteKey: string;
  isLocaleVariant: true;
}

function shouldExpandNode(node: RouteNode): boolean {
  return node.renderMode === "ssg";
}

/**
 * Returns the prefix segment to use for a given locale.
 * - "never": no prefix for any locale
 * - "always": always prefix, even for the default locale
 * - "as-needed" (default): prefix all non-default locales only
 * - localePathnames override: use the mapped value (empty string = no prefix)
 */
function getLocalePrefix(locale: string, i18n: I18nConfig): string {
  // localePathnames takes highest priority
  if (i18n.localePathnames) {
    const mapped = i18n.localePathnames[locale];
    return mapped ?? locale;
  }

  const mode = i18n.localePrefix ?? "as-needed";

  if (mode === "never") return "";
  if (mode === "always") return locale;
  // as-needed: prefix only non-default locales
  return locale === i18n.defaultLocale ? "" : locale;
}

function buildLocalePattern(pattern: string, locale: string, i18n: I18nConfig): string {
  const prefix = getLocalePrefix(locale, i18n);
  if (!prefix) return pattern;
  const normalized = pattern === "/" ? "" : pattern;
  return `/${prefix}${normalized}` || `/${prefix}`;
}

function buildLocaleRouteKey(routeKey: string, locale: string): string {
  return `${locale}::${routeKey}`;
}

function cloneWithLocale(node: RouteNode, locale: string, i18n: I18nConfig): LocaleVariantRouteNode {
  const localePattern = buildLocalePattern(node.pattern, locale, i18n);
  const localeRouteKey = buildLocaleRouteKey(node.routeKey, locale);

  return {
    ...node,
    locale,
    pattern: localePattern,
    routeKey: localeRouteKey,
    sourceRouteKey: node.routeKey,
    localePathname: localePattern,
    localeRouteKey,
    isLocaleVariant: true,
    parent: null,
    children: [],
  };
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
export function applyI18nExpansion(tree: RouteTree, i18n: I18nConfig): void {
  tree.localeVariants.clear();

  for (const locale of i18n.locales) {
    tree.localeVariants.set(locale, []);
  }

  for (const node of tree.index.values()) {
    if (!shouldExpandNode(node)) continue;

    for (const locale of i18n.locales) {
      const localeNode = cloneWithLocale(node, locale, i18n);
      tree.localeVariants.get(locale)!.push(localeNode);
    }
  }
}
