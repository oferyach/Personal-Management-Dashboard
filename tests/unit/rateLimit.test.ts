import { describe, expect, it } from "vitest";

import { evaluateRateLimit } from "@/lib/rateLimit";

describe("rate-limit bucket math", () => {
  it("opens a new fixed window and increments within it", () => {
    expect(evaluateRateLimit(null, 100, 60, 3)).toEqual({
      allowed: true,
      count: 1,
      windowStartedAt: 100,
      retryAfterSec: 0,
    });
    expect(evaluateRateLimit({ count: 1, lastRequest: 100 }, 120, 60, 3).count).toBe(2);
  });

  it("blocks at the limit and reports the remaining fixed-window time", () => {
    expect(evaluateRateLimit({ count: 3, lastRequest: 100 }, 125, 60, 3)).toEqual({
      allowed: false,
      count: 3,
      windowStartedAt: 100,
      retryAfterSec: 35,
    });
  });

  it("resets after the window expires", () => {
    expect(evaluateRateLimit({ count: 9, lastRequest: 100 }, 160, 60, 3)).toEqual({
      allowed: true,
      count: 1,
      windowStartedAt: 160,
      retryAfterSec: 0,
    });
  });
});
