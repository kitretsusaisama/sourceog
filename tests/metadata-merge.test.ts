import { describe, it } from "vitest";
import * as fc from "fast-check";
import { mergeMetadata, type Metadata } from "@sourceog/platform";

// ---------------------------------------------------------------------------
// Property 20: Metadata merges root-to-leaf
// Validates: Requirements 14.1
//
// For any layout chain (array of Metadata objects), mergeMetadata must produce
// a result where leaf (last) values override root (first) values for every key.
// ---------------------------------------------------------------------------

// Arbitrary for a single Metadata object with optional scalar fields
const metadataArb: fc.Arbitrary<Metadata> = fc.record(
  {
    title: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: undefined }),
    description: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    canonicalUrl: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    robots: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    openGraph: fc.option(
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 80 })
      ),
      { nil: undefined }
    ),
    twitter: fc.option(
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 80 })
      ),
      { nil: undefined }
    ),
    alternates: fc.option(
      fc.dictionary(
        fc.string({ minLength: 2, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 100 })
      ),
      { nil: undefined }
    ),
  },
  { requiredKeys: [] }
);

// A layout chain is an array of Metadata objects ordered root-to-leaf.
// minLength: 2 so there is always at least a root and a leaf to compare.
const layoutChainArb: fc.Arbitrary<Metadata[]> = fc.array(metadataArb, {
  minLength: 2,
  maxLength: 8,
});

describe("mergeMetadata — Property 20: Metadata merges root-to-leaf", () => {
  it("leaf scalar values override root scalar values for every key", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a chain where the leaf explicitly sets a title and description
        // so we can assert they win over any earlier value.
        fc.array(metadataArb, { minLength: 1, maxLength: 6 }),
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 80 }),
          description: fc.string({ minLength: 1, maxLength: 200 }),
          canonicalUrl: fc.string({ minLength: 1, maxLength: 100 }),
          robots: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        async (rootLayers, leafValues) => {
          const leaf: Metadata = leafValues;
          const chain: Metadata[] = [...rootLayers, leaf];
          const merged = mergeMetadata(...chain);

          // Leaf values must win for every scalar key that the leaf defines
          if (merged.title !== leaf.title) return false;
          if (merged.description !== leaf.description) return false;
          if (merged.canonicalUrl !== leaf.canonicalUrl) return false;
          if (merged.robots !== leaf.robots) return false;

          return true;
        }
      )
    );
  });

  it("leaf openGraph keys override root openGraph keys", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Root layer with some openGraph keys
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 80 })
        ),
        // Leaf layer with overlapping openGraph keys (different values)
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 80 })
        ),
        async (rootOG, leafOG) => {
          const root: Metadata = { openGraph: rootOG };
          const leaf: Metadata = { openGraph: leafOG };
          const merged = mergeMetadata(root, leaf);

          // Every key defined in the leaf must appear with the leaf's value
          for (const [key, value] of Object.entries(leafOG)) {
            if (merged.openGraph?.[key] !== value) return false;
          }
          return true;
        }
      )
    );
  });

  it("leaf twitter keys override root twitter keys", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 80 })
        ),
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 80 })
        ),
        async (rootTwitter, leafTwitter) => {
          const root: Metadata = { twitter: rootTwitter };
          const leaf: Metadata = { twitter: leafTwitter };
          const merged = mergeMetadata(root, leaf);

          for (const [key, value] of Object.entries(leafTwitter)) {
            if (merged.twitter?.[key] !== value) return false;
          }
          return true;
        }
      )
    );
  });

  it("root-only keys are preserved when leaf does not define them", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        async (rootTitle, leafDescription) => {
          // Root sets title, leaf sets only description — root title must survive
          const root: Metadata = { title: rootTitle };
          const leaf: Metadata = { description: leafDescription };
          const merged = mergeMetadata(root, leaf);

          return merged.title === rootTitle && merged.description === leafDescription;
        }
      )
    );
  });

  it("merging an arbitrary chain always produces a result where the last defined value wins", async () => {
    await fc.assert(
      fc.asyncProperty(
        layoutChainArb,
        async (chain) => {
          const merged = mergeMetadata(...chain);

          // For each scalar key, find the last layer that defines it and assert it wins
          const scalarKeys: Array<keyof Pick<Metadata, "title" | "description" | "canonicalUrl" | "robots">> =
            ["title", "description", "canonicalUrl", "robots"];

          for (const key of scalarKeys) {
            // Find the last layer that defines this key
            let lastDefined: string | undefined;
            for (const layer of chain) {
              if (layer[key] !== undefined) {
                lastDefined = layer[key] as string;
              }
            }
            if (lastDefined !== undefined && merged[key] !== lastDefined) {
              return false;
            }
          }

          return true;
        }
      )
    );
  });
});
