import { SourceOGError } from "./errors.js";
export declare class RedirectInterrupt extends SourceOGError {
    readonly location: string;
    readonly status: number;
    constructor(location: string, status?: number);
}
export declare class NotFoundInterrupt extends SourceOGError {
    constructor();
}
export declare function redirectTo(location: string, status?: number): never;
export declare function notFound(): never;
export declare function isRedirectInterrupt(error: unknown): error is RedirectInterrupt;
export declare function isNotFoundInterrupt(error: unknown): error is NotFoundInterrupt;
