import { afterEach, describe, expect, it } from "vitest";
import { configureLogging, getLogger, redact } from "@/lib/log";

function capture(level: "silent" | "error" | "warn" | "info" | "debug" = "debug"): string[] {
  const lines: string[] = [];
  configureLogging({ level, writer: (line) => lines.push(line) });
  return lines;
}

afterEach(() => {
  configureLogging({ level: "silent", writer: () => undefined });
});

describe("log redaction", () => {
  it("reduces secret-looking keys without touching safe keys", () => {
    const result = redact({
      userId: 7,
      password: "hunter2",
      data: { accessToken: "abc", displayName: "Ada" },
      smtpPassword: "smtp",
      apiKey: ["a", "b"],
    }) as Record<string, unknown>;

    expect(result.userId).toBe(7);
    expect(result.password).toBe("[redacted]");
    expect(result.smtpPassword).toBe("[redacted]");
    expect(result.apiKey).toBe("[redacted]");
    const nested = result.data as Record<string, unknown>;
    expect(nested.accessToken).toBe("[redacted]");
    expect(nested.displayName).toBe("Ada");
  });

  it("keeps error messages but drops stack traces", () => {
    const error = new Error("database busy");
    const result = redact(error) as { name: string; message: string; stack?: unknown };

    expect(result.name).toBe("Error");
    expect(result.message).toBe("database busy");
    expect(result.stack).toBeUndefined();
  });

  it("survives circular structures and deep nesting", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;
    expect(redact(circular)).toEqual({ name: "root", self: "[circular]" });

    let deep: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    const json = JSON.stringify(redact(deep));
    expect(json).toContain("depth-limit");
  });

  it("serializes dates and binary payloads safely", () => {
    const result = redact({ at: new Date("2026-11-22T10:00:00.000Z"), blob: Buffer.from("abcd") });
    expect(result).toEqual({ at: "2026-11-22T10:00:00.000Z", blob: "[binary 4B]" });
  });
});

describe("logger", () => {
  it("writes one JSON record per call with scope and data", () => {
    const lines = capture("debug");
    getLogger("test").info("request handled", { status: 200, cookie: "session=abc" });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record.level).toBe("info");
    expect(record.scope).toBe("test");
    expect(record.message).toBe("request handled");
    const data = record.data as Record<string, unknown>;
    expect(data.status).toBe(200);
    expect(data.cookie).toBe("[redacted]");
    expect(typeof record.time).toBe("string");
  });

  it("suppresses records above the configured level", () => {
    const lines = capture("error");
    const logger = getLogger("test");
    logger.info("hidden");
    logger.warn("hidden");
    logger.error("shown");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").level).toBe("error");
  });

  it("supports scoped child loggers", () => {
    const lines = capture("debug");
    getLogger("jobs").child("email.deliver").warn("retry scheduled", { attempt: 2 });

    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record.scope).toBe("jobs:email.deliver");
  });
});
