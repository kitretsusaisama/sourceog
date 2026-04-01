export interface Metadata {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  robots?: string;
  openGraph?: Record<string, string>;
  twitter?: Record<string, string>;
  alternates?: Record<string, string>;
}

/** Remove keys whose value is `undefined` so they don't shadow earlier defined values. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function mergeMetadata(...parts: Array<Metadata | undefined>): Metadata {
  return parts.reduce<Metadata>((accumulator, current) => {
    if (!current) {
      return accumulator;
    }

    const { openGraph, twitter, alternates, ...scalars } = current;

    return {
      ...accumulator,
      ...stripUndefined(scalars),
      openGraph: openGraph !== undefined
        ? { ...accumulator.openGraph, ...openGraph }
        : accumulator.openGraph,
      twitter: twitter !== undefined
        ? { ...accumulator.twitter, ...twitter }
        : accumulator.twitter,
      alternates: alternates !== undefined
        ? { ...accumulator.alternates, ...alternates }
        : accumulator.alternates,
    };
  }, {});
}

export function renderMetadataToHead(metadata: Metadata): string {
  const tags: string[] = [];
  if (metadata.title) {
    tags.push(`<title>${escapeHtml(metadata.title)}</title>`);
  }
  if (metadata.description) {
    tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}" />`);
  }
  if (metadata.canonicalUrl) {
    tags.push(`<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`);
  }
  if (metadata.robots) {
    tags.push(`<meta name="robots" content="${escapeHtml(metadata.robots)}" />`);
  }

  for (const [key, value] of Object.entries(metadata.openGraph ?? {})) {
    tags.push(`<meta property="og:${escapeHtml(key)}" content="${escapeHtml(value)}" />`);
  }
  for (const [key, value] of Object.entries(metadata.twitter ?? {})) {
    tags.push(`<meta name="twitter:${escapeHtml(key)}" content="${escapeHtml(value)}" />`);
  }
  for (const [locale, href] of Object.entries(metadata.alternates ?? {})) {
    tags.push(`<link rel="alternate" hreflang="${escapeHtml(locale)}" href="${escapeHtml(href)}" />`);
  }

  return tags.join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
