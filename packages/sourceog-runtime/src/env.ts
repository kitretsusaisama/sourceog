import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

export interface LoadedEnvFile {
  path: string;
  keys: string[];
}

export interface LoadEnvResult {
  files: LoadedEnvFile[];
  values: Record<string, string>;
}

export function getEnvCandidates(cwd: string, mode: string): string[] {
  return [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`
  ].map((fileName) => path.join(cwd, fileName));
}

export function loadEnv(cwd: string, mode: string): LoadEnvResult {
  const values: Record<string, string> = {};
  const files: LoadedEnvFile[] = [];

  for (const candidate of getEnvCandidates(cwd, mode)) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = parse(readFileSync(candidate, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }

      values[key] = process.env[key] ?? value;
    }

    files.push({
      path: candidate,
      keys: Object.keys(parsed)
    });
  }

  return { files, values };
}
