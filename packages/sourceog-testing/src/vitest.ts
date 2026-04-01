import { describe, expect, it, type TestContext } from "vitest";

export function describeFixture(name: string, fn: () => void): void {
  describe(`fixture:${name}`, fn);
}

export function itMatchesSnapshot(
  name: string,
  fn: (context: TestContext) => Promise<unknown> | unknown
): void {
  it(name, async (context) => {
    const result = await fn(context);
    expect(result).toMatchSnapshot();
  });
}
