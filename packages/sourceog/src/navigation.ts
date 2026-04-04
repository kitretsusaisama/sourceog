import React, { type AnchorHTMLAttributes, type ReactNode, type RefObject } from "react";
import { refreshCurrentRoute } from "@sourceog/runtime/actions";
import { notFound as runtimeNotFound, redirectTo } from "@sourceog/runtime/render-control";

export type PrefetchMode = "intent" | "viewport" | "eager" | false;

export interface SourceOGRouter {
  push(href: string, options?: { scroll?: boolean }): Promise<void>;
  replace(href: string, options?: { scroll?: boolean }): Promise<void>;
  back(): void;
  prefetch(href: string): Promise<void>;
  refresh(): Promise<void>;
  refreshRoute(href: string): Promise<void>;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  prefetch?: PrefetchMode;
  scroll?: boolean;
  replace?: boolean;
  children?: ReactNode;
}

type LocationSnapshot = {
  pathname: string;
  search: string;
  href: string;
};

const PREFETCH_CACHE = new Map<string, Promise<Response | undefined>>();
const locationListeners = new Set<() => void>();
let historyPatched = false;

function canUseDOM(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function notifyLocationListeners(): void {
  for (const listener of locationListeners) {
    listener();
  }
}

function patchHistory(): void {
  if (!canUseDOM() || historyPatched) {
    return;
  }

  historyPatched = true;
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
    originalPushState(...args);
    notifyLocationListeners();
  }) as History["pushState"];

  window.history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args);
    notifyLocationListeners();
  }) as History["replaceState"];

  window.addEventListener("popstate", notifyLocationListeners);
}

function subscribeToLocation(listener: () => void): () => void {
  if (!canUseDOM()) {
    return () => {};
  }

  patchHistory();
  locationListeners.add(listener);
  return () => {
    locationListeners.delete(listener);
  };
}

function getLocationSnapshot(): LocationSnapshot {
  if (!canUseDOM()) {
    return { pathname: "/", search: "", href: "/" };
  }

  return {
    pathname: window.location.pathname,
    search: window.location.search,
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`
  };
}

function routePatternFromClientContext(): string | undefined {
  const routeId = window.__SOURCEOG_CLIENT_CONTEXT__?.routeId ?? window.__SOURCEOG_LAST_RENDER_SNAPSHOT__?.routeId;
  if (!routeId) {
    return undefined;
  }

  const separatorIndex = routeId.indexOf(":");
  return separatorIndex >= 0 ? routeId.slice(separatorIndex + 1) : routeId;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseParamsFromPattern(pathname: string, pattern?: string): Record<string, string | string[]> {
  if (!pattern) {
    return {};
  }

  const actualSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  const params: Record<string, string | string[]> = {};
  let actualIndex = 0;

  for (const segment of patternSegments) {
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      const key = segment.slice(4, -1);
      params[key] = actualSegments.slice(actualIndex).map(decodeSegment);
      actualIndex = actualSegments.length;
      continue;
    }

    if (segment.startsWith("[") && segment.endsWith("]")) {
      const key = segment.slice(1, -1);
      params[key] = decodeSegment(actualSegments[actualIndex] ?? "");
    }

    actualIndex += 1;
  }

  return params;
}

async function navigate(href: string, replaceState: boolean, scroll = true): Promise<void> {
  if (!canUseDOM()) {
    return;
  }

  const target = new URL(href, window.location.origin);
  if (replaceState) {
    window.history.replaceState({}, "", target);
  } else {
    window.history.pushState({}, "", target);
  }

  notifyLocationListeners();
  if (scroll) {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  await refreshCurrentRoute(`${target.pathname}${target.search}`, replaceState);
}

function resolvePrefetchUrl(href: string): string | undefined {
  if (canUseDOM()) {
    return new URL(href, window.location.origin).toString();
  }

  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  const baseUrl = process.env.BASE_URL;
  return baseUrl ? new URL(href, baseUrl).toString() : undefined;
}

export async function prefetchRoute(
  href: string,
  options: { priority?: "low" | "normal" | "high" } = {}
): Promise<void> {
  const target = resolvePrefetchUrl(href);
  if (!target) {
    return;
  }

  if (!PREFETCH_CACHE.has(target)) {
    PREFETCH_CACHE.set(target, fetch(target, {
      method: "GET",
      headers: {
        "x-sourceog-prefetch": "1",
        "x-sourceog-prefetch-priority": options.priority ?? "normal"
      }
    }).catch(() => undefined));
  }

  await PREFETCH_CACHE.get(target);
}

export function prefetchOnIntent(
  elementOrRef: HTMLElement | RefObject<HTMLElement | null> | null | undefined,
  href: string,
  options?: { priority?: "low" | "normal" | "high" }
): () => void {
  const element = elementOrRef && "current" in elementOrRef ? elementOrRef.current : elementOrRef;
  if (!element) {
    return () => {};
  }

  const trigger = () => {
    void prefetchRoute(href, options);
  };

  element.addEventListener("mouseenter", trigger, { passive: true });
  element.addEventListener("focus", trigger, { passive: true });

  return () => {
    element.removeEventListener("mouseenter", trigger);
    element.removeEventListener("focus", trigger);
  };
}

export async function refresh(): Promise<void> {
  await refreshCurrentRoute();
}

export async function refreshRoute(href: string): Promise<void> {
  await refreshCurrentRoute(href, true);
}

export function redirect(href: string): never {
  return redirectTo(href, 307);
}

export function permanentRedirect(href: string): never {
  return redirectTo(href, 308);
}

export function notFound(): never {
  return runtimeNotFound();
}

export function useRouter(): SourceOGRouter {
  return React.useMemo<SourceOGRouter>(() => ({
    async push(href, options) {
      await navigate(href, false, options?.scroll ?? true);
    },
    async replace(href, options) {
      await navigate(href, true, options?.scroll ?? true);
    },
    back() {
      if (canUseDOM()) {
        window.history.back();
      }
    },
    async prefetch(href) {
      await prefetchRoute(href);
    },
    async refresh() {
      await refresh();
    },
    async refreshRoute(href) {
      await refreshRoute(href);
    }
  }), []);
}

export function usePathname(): string {
  return React.useSyncExternalStore(subscribeToLocation, () => getLocationSnapshot().pathname, () => "/");
}

export function useSearchParams(): URLSearchParams {
  const search = React.useSyncExternalStore(subscribeToLocation, () => getLocationSnapshot().search, () => "");
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<TParams extends Record<string, string | string[]> = Record<string, string | string[]>>(): TParams {
  const pathname = usePathname();
  const pattern = canUseDOM() ? routePatternFromClientContext() : undefined;
  return React.useMemo(() => parseParamsFromPattern(pathname, pattern) as TParams, [pathname, pattern]);
}

export function useSelectedLayoutSegments(): string[] {
  const pathname = usePathname();
  return React.useMemo(() => pathname.split("/").filter(Boolean).map(decodeSegment), [pathname]);
}

export function useSelectedLayoutSegment(): string | null {
  return useSelectedLayoutSegments().at(-1) ?? null;
}

export function Link({
  href,
  prefetch = "viewport",
  scroll = true,
  replace = false,
  onClick,
  onMouseEnter,
  onFocus,
  children,
  ...rest
}: LinkProps): React.ReactElement {
  const ref = React.useRef<HTMLAnchorElement | null>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (prefetch === "eager") {
      void prefetchRoute(href, { priority: "high" });
      return;
    }

    if (prefetch === "intent" && ref.current) {
      return prefetchOnIntent(ref, href);
    }

    if (prefetch === "viewport" && ref.current && typeof IntersectionObserver !== "undefined") {
      const element = ref.current;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void prefetchRoute(href);
          observer.disconnect();
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    }

    return;
  }, [href, prefetch]);

  return React.createElement("a", {
    ...rest,
    href,
    ref,
    onMouseEnter: (event: React.MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(event);
      if (prefetch === "intent") {
        void prefetchRoute(href);
      }
    },
    onFocus: (event: React.FocusEvent<HTMLAnchorElement>) => {
      onFocus?.(event);
      if (prefetch === "intent") {
        void prefetchRoute(href);
      }
    },
    onClick: async (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.altKey
        || event.ctrlKey
        || event.shiftKey
        || rest.target === "_blank"
      ) {
        return;
      }

      const target = new URL(href, canUseDOM() ? window.location.origin : "http://localhost");
      const currentOrigin = canUseDOM() ? window.location.origin : target.origin;
      if (target.origin !== currentOrigin) {
        return;
      }

      event.preventDefault();
      if (replace) {
        await router.replace(href, { scroll });
        return;
      }

      await router.push(href, { scroll });
    }
  }, children);
}
