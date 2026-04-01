import { FrameworkError } from "@sourceog/runtime";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Messages = Record<string, string>;

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  localeDetection?: "header" | "cookie" | "path" | "none";
  localePrefix?: "always" | "as-needed" | "never";
  messages?: Record<string, () => Promise<Messages>>;
}

// ---------------------------------------------------------------------------
// detectLocale
// ---------------------------------------------------------------------------

/**
 * Detects the user's locale from the request based on `config.localeDetection`.
 *
 * Detection strategies (in order when strategy is set):
 *   - "header": parse Accept-Language header
 *   - "cookie": read "NEXT_LOCALE" (or "locale") cookie
 *   - "path": read the first path segment
 *   - "none": always return defaultLocale
 *
 * Always returns a member of `config.locales`; falls back to `defaultLocale`.
 *
 * Requirements: 7.3, 7.4
 */
export function detectLocale(req: SourceOGRequest, config: I18nConfig): string {
  const { locales, defaultLocale, localeDetection } = config;

  // Helper: return locale if it's in the configured list, else null
  function resolveLocale(candidate: string | null | undefined): string | null {
    if (!candidate) return null;
    // Exact match
    if (locales.includes(candidate)) return candidate;
    // Language-only match (e.g. "en-US" → "en")
    const lang = candidate.split("-")[0].toLowerCase();
    const match = locales.find((l) => l.toLowerCase() === lang);
    return match ?? null;
  }

  const strategy = localeDetection ?? "header";

  if (strategy === "none") {
    return defaultLocale;
  }

  if (strategy === "path") {
    const segments = req.url.pathname.split("/").filter(Boolean);
    const resolved = resolveLocale(segments[0]);
    if (resolved) return resolved;
    return defaultLocale;
  }

  if (strategy === "cookie") {
    const cookieLocale =
      req.cookies.get("NEXT_LOCALE") ?? req.cookies.get("locale") ?? null;
    const resolved = resolveLocale(cookieLocale);
    if (resolved) return resolved;
    return defaultLocale;
  }

  // Default: "header" — parse Accept-Language
  const acceptLanguage = req.headers.get("accept-language");
  if (acceptLanguage) {
    // Parse "en-US,en;q=0.9,fr;q=0.8" → ordered list of language tags
    const tags = acceptLanguage
      .split(",")
      .map((part) => {
        const [tag, q] = part.trim().split(";q=");
        return { tag: tag.trim(), q: q ? parseFloat(q) : 1.0 };
      })
      .sort((a, b) => b.q - a.q)
      .map((x) => x.tag);

    for (const tag of tags) {
      const resolved = resolveLocale(tag);
      if (resolved) return resolved;
    }
  }

  return defaultLocale;
}

// ---------------------------------------------------------------------------
// localizePathname
// ---------------------------------------------------------------------------

/**
 * Prefixes `pathname` with `/{locale}` when `config.localePrefix === "always"`.
 *
 * Requirements: 7.5
 */
export function localizePathname(
  pathname: string,
  locale: string,
  config: I18nConfig
): string {
  if (config.localePrefix === "always") {
    // Avoid double-prefixing
    const prefix = `/${locale}`;
    if (pathname.startsWith(prefix + "/") || pathname === prefix) {
      return pathname;
    }
    return `${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }
  return pathname;
}

// ---------------------------------------------------------------------------
// loadMessages
// ---------------------------------------------------------------------------

/**
 * Invokes `config.messages[locale]()` and returns the resolved Messages object.
 * Throws `FrameworkError(code: "I18N_LOCALE_NOT_FOUND")` if no loader is defined.
 *
 * Requirements: 7.6, 7.7
 */
export async function loadMessages(
  locale: string,
  config: I18nConfig
): Promise<Messages> {
  const loader = config.messages?.[locale];
  if (!loader) {
    throw new FrameworkError(
      "I18N_LOCALE_NOT_FOUND",
      `No message loader found for locale "${locale}".`,
      {
        layer: "platform",
        context: { locale },
        recoverable: false,
      }
    );
  }
  return loader();
}
