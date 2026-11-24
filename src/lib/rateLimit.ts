import "server-only";

import { randomUUID } from "node:crypto";

import { getSqlite } from "@/db/client";

export interface RateLimitRow {
  count: number;
  lastRequest: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  windowStartedAt: number;
  retryAfterSec: number;
}

export function evaluateRateLimit(
  row: RateLimitRow | null,
  nowSec: number,
  windowSec: number,
  maxRequests: number,
): RateLimitDecision {
  if (!row || nowSec - row.lastRequest >= windowSec) {
    return { allowed: true, count: 1, windowStartedAt: nowSec, retryAfterSec: 0 };
  }
  if (row.count >= maxRequests) {
    return {
      allowed: false,
      count: row.count,
      windowStartedAt: row.lastRequest,
      retryAfterSec: Math.max(windowSec - (nowSec - row.lastRequest), 1),
    };
  }
  return {
    allowed: true,
    count: row.count + 1,
    windowStartedAt: row.lastRequest,
    retryAfterSec: 0,
  };
}

export function consumeRateLimit(
  key: string,
  options: { windowSec: number; maxRequests: number; nowSec?: number },
): RateLimitDecision {
  const sqlite = getSqlite();
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const storageKey = `pmd:action:${key}`;

  return sqlite.transaction(() => {
    const existing = sqlite
      .prepare("SELECT count, last_request FROM rate_limit WHERE key = ?")
      .get(storageKey) as { count: number; last_request: number } | undefined;
    const decision = evaluateRateLimit(
      existing ? { count: existing.count, lastRequest: existing.last_request } : null,
      nowSec,
      options.windowSec,
      options.maxRequests,
    );

    if (decision.allowed) {
      sqlite
        .prepare(
          `INSERT INTO rate_limit (id, key, count, last_request)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET count = excluded.count, last_request = excluded.last_request`,
        )
        .run(randomUUID(), storageKey, decision.count, decision.windowStartedAt);
    }
    return decision;
  })();
}
