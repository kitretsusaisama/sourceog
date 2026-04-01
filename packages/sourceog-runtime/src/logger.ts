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

export function createLogger(requestId?: string): SourceOGLogger {
  const emit = (level: LogRecord["level"], message: string, context?: Record<string, unknown>): void => {
    const record: LogRecord = {
      level,
      message,
      timestamp: new Date().toISOString(),
      requestId,
      context
    };

    console[level === "debug" ? "log" : level](JSON.stringify(record));
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context)
  };
}

export interface Span {
  end(context?: Record<string, unknown>): void;
}

export interface SourceOGTracer {
  startSpan(name: string, context?: Record<string, unknown>): Span;
}

export function createTracer(logger: SourceOGLogger): SourceOGTracer {
  return {
    startSpan(name, context) {
      const startedAt = Date.now();
      logger.debug(`span:start:${name}`, context);
      return {
        end(extra) {
          logger.debug(`span:end:${name}`, {
            durationMs: Date.now() - startedAt,
            ...context,
            ...extra
          });
        }
      };
    }
  };
}
