import { describe, expect, it } from "vitest";
import {
  defineAutomation,
  defineAdapter,
  defineConfig,
  defineMiddleware,
  defineRoute,
  defineSchedule,
  defineSecurityPolicy,
  Image,
  json,
  notFound,
  parseBody,
  rateLimit,
  revalidateTag,
  sourceogFetch,
  text,
  unstable_cache
} from "sourceog";
import * as auth from "../packages/sourceog/src/auth";
import * as actions from "../packages/sourceog/src/actions";
import * as i18n from "../packages/sourceog/src/i18n";
import * as image from "../packages/sourceog/src/image";
import * as validation from "../packages/sourceog/src/validation";

describe("sourceog public API", () => {
  it("exports the stable root helpers used by apps", () => {
    expect(typeof defineConfig).toBe("function");
    expect(typeof defineAdapter).toBe("function");
    expect(typeof defineAutomation).toBe("function");
    expect(typeof defineSchedule).toBe("function");
    expect(typeof defineSecurityPolicy).toBe("function");
    expect(typeof defineMiddleware).toBe("function");
    expect(typeof defineRoute).toBe("function");
    expect(typeof sourceogFetch).toBe("function");
    expect(typeof unstable_cache).toBe("function");
    expect(typeof revalidateTag).toBe("function");
    expect(typeof json).toBe("function");
    expect(typeof text).toBe("function");
    expect(typeof notFound).toBe("function");
    expect(typeof rateLimit).toBe("function");
    expect(typeof parseBody).toBe("function");
    expect(Image).toBeTruthy();
  });

  it("exposes stable subpath modules", () => {
    expect(typeof actions.callServerAction).toBe("function");
    expect(typeof actions.callServerActionById).toBe("function");
    expect(typeof actions.refreshCurrentRoute).toBe("function");
    expect(typeof auth.createJWT).toBe("function");
    expect(typeof auth.verifyJWT).toBe("function");
    expect(typeof i18n.detectLocale).toBe("function");
    expect(typeof i18n.localizePathname).toBe("function");
    expect(image.Image).toBeTruthy();
    expect(typeof validation.parseBody).toBe("function");
    expect(typeof validation.parseQuery).toBe("function");
  });
});
