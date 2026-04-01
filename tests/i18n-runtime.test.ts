import { describe, it } from "vitest";
import * as fc from "fast-check";
import { detectLocale, localizePathname, loadMessages, type I18nConfig } from "@sourceog/platform";
import type { SourceOGRequest } from "@sourceog/runtime";
import { FrameworkError } from "@sourceog/runtime";
import { expect } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: {
  pathname?: string;
  acceptLanguage?: string;
  cookieLocale?: string;
} = {}): SourceOGRequest {
  const { pathname = "/", acceptLanguage, cookieLocale } = overrides;

  const headers = new Headers();
  if (acceptLanguage) {
    headers.set("accept-language", acceptLanguage);
  }

  const cookies = new Map<string, string>();
  if (cookieLocale) {
    cookies.set("NEXT_LOCALE", cookieLocale);
  }

  return {
    url: new URL(`http://localhost${pathname}`),
    method: "GET",
    headers,
    cookies,
    requestId: "test-request-id",
    runtime: "node",
    async bodyText() { return ""; },
    async bodyJson<T>() { return {} as T; },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const localeTagArb = fc.stringMatching(/^[a-z]{2}(-[A-Z]{2})?$/);

const i18nConfigArb: fc.Arbitrary<I18nConfig> = fc
  .array(localeTagArb, { minLength: 1, maxLength: 5 })
  .chain((locales) => {
    const unique = [...new Set(locales)];
    return fc.record({
      locales: fc.constant(unique),
      defaultLocale: fc.constantFrom(...unique),
      localeDetection: fc.constantFrom(
        "header" as const,
        "cookie" as const,
        "path" as const,
        "none" as const,
        undefined
      ),
    });
  });

const acceptLanguageArb = fc.oneof(
  fc.constant(undefined),
  fc.constant("en-US,en;q=0.9"),
  fc.constant("fr-FR,fr;q=0.9,en;q=0.8"),
  fc.constant("de"),
  fc.constant("zh-CN"),
  fc.constant("ja;q=0.5"),
  fc.constant("*"),
  fc.constant("invalid-header-value"),
  localeTagArb,
);

const pathnameArb = fc.oneof(
  fc.constant("/"),
  fc.constant("/about"),
  fc.constant("/en/about"),
  fc.constant("/fr/blog"),
  fc.constant("/de"),
  fc.stringMatching(/^\/[a-z]{0,10}(\/[a-z]{0,10})?$/),
);

const requestArb: fc.Arbitrary<SourceOGRequest> = fc.record({
  pathname: pathnameArb,
  acceptLanguage: acceptLanguageArb,
  cookieLocale: fc.oneof(fc.constant(undefined), localeTagArb),
}).map(({ pathname, acceptLanguage, cookieLocale }) =>
  makeRequest({ pathname, acceptLanguage, cookieLocale })
);

// ---------------------------------------------------------------------------
// Property 28: Locale detection always returns a configured locale
// Validates: Requirements 7.3
// ---------------------------------------------------------------------------

describe("detectLocale — Property 28: Locale detection always returns a configured locale", () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any request and I18nConfig, detectLocale must always return a locale
   * that is a member of config.locales.
   */
  it("always returns a member of config.i18n.locales", async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, i18nConfigArb, async (req, config) => {
        const result = detectLocale(req, config);
        return config.locales.includes(result);
      })
    );
  });

  it("falls back to defaultLocale when no locale can be detected", async () => {
    await fc.assert(
      fc.asyncProperty(i18nConfigArb, async (config) => {
        // Request with no Accept-Language, no cookie, and no locale in path
        const req = makeRequest({ pathname: "/about" });
        const result = detectLocale(req, { ...config, localeDetection: "header" });
        // With no Accept-Language header, must fall back to defaultLocale
        return result === config.defaultLocale;
      })
    );
  });

  it("returns defaultLocale when localeDetection is 'none'", async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, i18nConfigArb, async (req, config) => {
        const result = detectLocale(req, { ...config, localeDetection: "none" });
        return result === config.defaultLocale;
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for localizePathname
// ---------------------------------------------------------------------------

describe("localizePathname — unit tests", () => {
  it("prefixes pathname with /{locale} when localePrefix is 'always'", () => {
    const config: I18nConfig = {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePrefix: "always",
    };
    expect(localizePathname("/about", "fr", config)).toBe("/fr/about");
    expect(localizePathname("/", "en", config)).toBe("/en/");
  });

  it("does not prefix when localePrefix is not 'always'", () => {
    const config: I18nConfig = {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePrefix: "as-needed",
    };
    expect(localizePathname("/about", "fr", config)).toBe("/about");
  });

  it("does not double-prefix an already-prefixed pathname", () => {
    const config: I18nConfig = {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePrefix: "always",
    };
    expect(localizePathname("/fr/about", "fr", config)).toBe("/fr/about");
  });
});

// ---------------------------------------------------------------------------
// Unit tests for loadMessages
// ---------------------------------------------------------------------------

describe("loadMessages — unit tests", () => {
  it("invokes the loader and returns messages", async () => {
    const messages = { hello: "Hello", world: "World" };
    const config: I18nConfig = {
      locales: ["en"],
      defaultLocale: "en",
      messages: {
        en: async () => messages,
      },
    };
    const result = await loadMessages("en", config);
    expect(result).toEqual(messages);
  });

  it("throws FrameworkError(I18N_LOCALE_NOT_FOUND) when loader is absent", async () => {
    const config: I18nConfig = {
      locales: ["en", "fr"],
      defaultLocale: "en",
      messages: {
        en: async () => ({ hello: "Hello" }),
      },
    };
    await expect(loadMessages("fr", config)).rejects.toMatchObject({
      code: "I18N_LOCALE_NOT_FOUND",
    });
  });

  it("throws FrameworkError when messages is undefined", async () => {
    const config: I18nConfig = {
      locales: ["en"],
      defaultLocale: "en",
    };
    await expect(loadMessages("en", config)).rejects.toBeInstanceOf(FrameworkError);
  });
});
