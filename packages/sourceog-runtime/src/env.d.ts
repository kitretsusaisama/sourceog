export interface LoadedEnvFile {
    path: string;
    keys: string[];
}
export interface LoadEnvResult {
    files: LoadedEnvFile[];
    values: Record<string, string>;
}
export declare function getEnvCandidates(cwd: string, mode: string): string[];
export declare function loadEnv(cwd: string, mode: string): LoadEnvResult;
