import { getConfig, type LogLevel } from "@/lib/env";

/**
 * Structured JSON logging with a redaction layer.
 * Secret-bearing values are never serialized, even by accident (spec §19, §12).
 */

const SECRET_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|authoriz|cookie|api[-_]?key|totp|otp|recovery|credential|bearer|signature|sessionid|session_id)/i;

const LEVEL_WEIGHT: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

type LogMeta = Record<string, unknown> | undefined;
type LogWriter = (line: string) => void;

interface LogState {
  level: LogLevel;
  writer: LogWriter;
}

const state: LogState = {
  level: "info",
  writer: (line) => process.stdout.write(`${line}\n`),
};

let initialized = false;

export function configureLogging(options: { level?: LogLevel; writer?: LogWriter }): void {
  if (options.level) state.level = options.level;
  if (options.writer) state.writer = options.writer;
  initialized = true;
}

function ensureInitialized(): void {
  if (initialized) {
    state.level = state.level ?? "info";
    return;
  }
  try {
    state.level = getConfig().logLevel;
  } catch {
    state.level = "info";
  }
}

export function isLogLevelEnabled(level: LogLevel): boolean {
  ensureInitialized();
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[state.level];
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value ?? null;

  const type = typeof value;
  if (type === "bigint") return value.toString();
  if (type !== "object") return value;

  if (value instanceof Error) {
    // Stack traces stay out of production output; message is enough for triage.
    return { name: value.name, message: value.message };
  }
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [
        String(key),
        SECRET_KEY_PATTERN.test(String(key)) ? "[redacted]" : redactValue(item, seen, depth + 1),
      ]),
    );
  }
  if (value instanceof Set) return [...value].map((item) => redactValue(item, seen, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(item, seen, depth + 1);
  }
  return output;
}

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

export class Logger {
  constructor(private readonly scope: string) {}

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    ensureInitialized();
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[state.level]) return;

    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
    };
    if (meta) record.data = redactValue(meta, new WeakSet<object>(), 0);

    try {
      state.writer(JSON.stringify(record));
    } catch {
      state.writer(
        JSON.stringify({
          time: new Date().toISOString(),
          level: "error",
          scope: this.scope,
          message: "log serialization failed",
        }),
      );
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.write("debug", message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    this.write("info", message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    this.write("warn", message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    this.write("error", message, meta);
  }
  child(childScope: string): Logger {
    return new Logger(`${this.scope}:${childScope}`);
  }
}

export function getLogger(scope = "app"): Logger {
  return new Logger(scope);
}

/** Flushes environment warnings once, without importing env->log cycles. */
export function logStartupWarnings(warnings: string[], scope = "env"): void {
  const logger = new Logger(scope);
  for (const warning of warnings) logger.warn(warning);
}
