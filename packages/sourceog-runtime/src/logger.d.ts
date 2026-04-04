export interface LogRecord {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: string;
    requestId?: string;
    context?: Record<string, unknown>;
}
export interface SourceOGLogger {
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
}
export declare function createLogger(requestId?: string): SourceOGLogger;
export interface Span {
    end(context?: Record<string, unknown>): void;
}
export interface SourceOGTracer {
    startSpan(name: string, context?: Record<string, unknown>): Span;
}
export declare function createTracer(logger: SourceOGLogger): SourceOGTracer;
