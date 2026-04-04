export interface TestInstanceOptions {
  cwd: string;
  mode?: "development" | "production";
}

export interface NormalizedTestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TestInstance {
  cwd: string;
  fetch(pathname: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface FixtureRequest {
  pathname: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FixtureResult {
  fixtureName: string;
  request: FixtureRequest;
  response: NormalizedTestResponse;
}

export interface AdapterParityMismatch {
  fixtureName: string;
  field: "status" | "headers" | "body";
  adapterNames: string[];
  values: unknown[];
}

export interface AdapterLike {
  name: string;
  createRequestHandler?(manifest: unknown): unknown;
}

export declare function createTestInstance(options: TestInstanceOptions): Promise<TestInstance>;
export declare function runFixture(instance: TestInstance, fixtureName: string): Promise<FixtureResult>;
export declare function adapterParityHarness(input: {
  fixtures: Array<{ name: string; request: FixtureRequest }>;
  adapters: AdapterLike[];
  manifest: unknown;
}): Promise<{ passed: boolean; mismatches: AdapterParityMismatch[] }>;
export declare function describeFixture(name: string, fn: () => void): void;
export declare function itMatchesSnapshot(
  name: string,
  fn: (context: unknown) => Promise<unknown> | unknown
): void;
