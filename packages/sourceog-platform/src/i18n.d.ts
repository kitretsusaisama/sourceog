import type { SourceOGRequest } from "@sourceog/runtime";
export type Messages = Record<string, string>;
export interface I18nConfig {
    locales: string[];
    defaultLocale: string;
    localeDetection?: "header" | "cookie" | "path" | "none";
    localePrefix?: "always" | "as-needed" | "never";
    messages?: Record<string, () => Promise<Messages>>;
}
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
export declare function detectLocale(req: SourceOGRequest, config: I18nConfig): string;
/**
 * Prefixes `pathname` with `/{locale}` when `config.localePrefix === "always"`.
 *
 * Requirements: 7.5
 */
export declare function localizePathname(pathname: string, locale: string, config: I18nConfig): string;
/**
 * Invokes `config.messages[locale]()` and returns the resolved Messages object.
 * Throws `FrameworkError(code: "I18N_LOCALE_NOT_FOUND")` if no loader is defined.
 *
 * Requirements: 7.6, 7.7
 */
export declare function loadMessages(locale: string, config: I18nConfig): Promise<Messages>;
