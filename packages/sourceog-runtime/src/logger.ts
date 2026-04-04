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

const LOG_LEVEL_PRIORITY: Record<LogRecord["level"], number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinimumLogLevel(): LogRecord["level"] {
  if (process.env.SOURCEOG_DEBUG === "true") {
    return "debug";
  }
  if (process.env.NODE_ENV === "test") {
    return "error";
  }
  if (process.env.NODE_ENV === "production") {
    return "warn";
  }
  return "info";
}

export function createLogger(requestId?: string): SourceOGLogger {
  const minimumLevel = resolveMinimumLogLevel();
  const emit = (level: LogRecord["level"], message: string, context?: Record<string, unknown>): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minimumLevel]) {
      return;
    }

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
