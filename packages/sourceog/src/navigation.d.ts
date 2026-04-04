import type { AnchorHTMLAttributes, ReactElement, ReactNode, RefObject } from "react";

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

export declare function prefetchRoute(href: string, options?: { priority?: "low" | "normal" | "high" }): Promise<void>;
export declare function prefetchOnIntent(
  elementOrRef: HTMLElement | RefObject<HTMLElement | null> | null | undefined,
  href: string,
  options?: { priority?: "low" | "normal" | "high" }
): () => void;
export declare function refresh(): Promise<void>;
export declare function refreshRoute(href: string): Promise<void>;
export declare function redirect(href: string): never;
export declare function permanentRedirect(href: string): never;
export declare function notFound(): never;
export declare function useRouter(): SourceOGRouter;
export declare function usePathname(): string;
export declare function useSearchParams(): URLSearchParams;
export declare function useParams<TParams extends Record<string, string | string[]> = Record<string, string | string[]>>(): TParams;
export declare function useSelectedLayoutSegments(): string[];
export declare function useSelectedLayoutSegment(): string | null;
export declare function Link(props: LinkProps): ReactElement;
