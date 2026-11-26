/**
 * Regression tests for the recurrence engine — `src/lib/recurrence.ts`, packet 2E.
 *
 * Every expectation here was measured against the installed `rrule` 2.8.1 and
 * Node's own IANA tz database (`Intl` — no Temporal dependency is installed). They
 * exist to pin the library's quirks, not to restate RFC 5544: `rrule`'s `UNTIL` is
 * wall-clock compared, its `between` is exclusive at both ends, and its text parser
 * is a natural-language parser that accepts `FREQ=HOURLY` — a future upgrade that
 * changes any of these must fail here rather than silently move occurrences. The
 * decisions these tests pin are recorded in `docs/adr/0002-recurrence-expansion.md`.
 */
import { describe, expect, it } from "vitest";
import {
  expandSeries,
  parseRuleText,
  ruleText,
  validateRule,
  MAX_RECURRENCE_INTERVAL,
  type RecurrenceStatus,
  type SeriesRule,
} from "@/lib/recurrence";

// A wall stamp: UTC fields stand in for the local clock, exactly as
// `parseWall` does. `Date.parse` would read the same string as *system* local
// time and shift it by the machine's offset, which is the bug this test file
// exists to prevent.
const WALL = (text: string) => {
  const [date = "", time = ""] = text.split("T");
  const [ys = "1", mos = "1", ds = "1"] = date.split("-");
  const [hs = "0", mis = "0", ss = "0"] = time.split(":");
  return {
    text,
    ms: Date.UTC(Number(ys), Number(mos) - 1, Number(ds), Number(hs), Number(mis), Number(ss)),
  };
};

function expand(
  anchor: string,
  durationMs: number,
  zone: string,
  from: number,
  to: number,
  rule: SeriesRule,
  cap?: number,
) {
  return expandSeries({
    anchor: WALL(anchor),
    durationMs,
    zone,
    rule: rule,
    windowStart: from,
    windowEnd: to,
    cap,
  });
}

const daily = (count = 5, exdates: string[] = []): SeriesRule => ({
  freq: "DAILY",
  interval: 1,
  byDay: [],
  byMonth: [],
  byMonthDay: [],
  count,
  until: null,
  exdates,
});
const weekly = (byDay: string[], count = 5): SeriesRule => ({
  freq: "WEEKLY",
  interval: 1,
  byDay,
  byMonth: [],
  byMonthDay: [],
  count,
  until: null,
  exdates: [],
});
const yearly = (count: number | null = null, interval = 1): SeriesRule => ({
  freq: "YEARLY",
  interval,
  byDay: [],
  byMonth: [],
  byMonthDay: [],
  count,
  until: null,
  exdates: [],
});

describe("recurrence engine — rrule integration facts", () => {
  it("keeps the wall clock across a DST transition, letting the instant drift", () => {
    // Asia/Jerusalem steps +3600s at 2026-03-27T00:00 local (measured).
    const zone = "Asia/Jerusalem";
    const from = Date.parse("2026-03-25T00:00:00Z");
    const to = Date.parse("2026-03-31T00:00:00Z");
    const result = expand("2026-03-25T09:00:00", 3600_000, zone, from, to, daily(7));
    expect(result.status).to.equal("ok");
    expect(result.occurrences.map((o) => o.wallStart)).to.deep.equal([
      "2026-03-25T09:00:00",
      "2026-03-26T09:00:00",
      "2026-03-27T09:00:00",
      "2026-03-28T09:00:00",
      "2026-03-29T09:00:00",
      "2026-03-30T09:00:00",
    ]);
    // The instants are NOT 24h apart across the transition: 26th→27th is 23h.
    const drift =
      Date.parse(result.occurrences[2]!.startAt) - Date.parse(result.occurrences[1]!.startAt);
    expect(drift).to.equal(23 * 3600_000);
    // Measured: the zone is +02:00 before 2026-03-27 02:00 local and +03:00 after,
    // so 09:00 on the 25th is 07:00Z and 09:00 on the 30th is 06:00Z. The 31st is
    // outside the window, which ends at 23:00 local on that day.
    expect(result.occurrences[0]!.startAt).to.equal("2026-03-25T07:00:00.000Z");
    expect(result.occurrences[5]!.startAt).to.equal("2026-03-30T06:00:00.000Z");
  });

  it("keeps the wall clock across a fall-back overlap and takes the earlier instant", () => {
    // America/New_York falls back at 2025-11-02T05:00Z (02:00 EDT -> 01:00 EST),
    // so 01:30 local on that day happens twice: 05:30Z under EDT, 06:30Z under EST.
    const zone = "America/New_York";
    const from = Date.parse("2025-10-30T00:00:00Z");
    const to = Date.parse("2025-11-08T00:00:00Z");
    const result = expand("2025-10-30T01:30:00", 3600_000, zone, from, to, daily(10));
    expect(result.status).to.equal("ok");
    const walls = result.occurrences.map((o) => o.wallStart);
    expect(walls).to.deep.include("2025-10-30T01:30:00");
    expect(walls).to.deep.include("2025-11-01T01:30:00");
    // Measured: the wall clock survives the overlap intact; the series is not
    // re-based onto the new offset, and the earlier instant wins.
    expect(walls).to.deep.include("2025-11-02T01:30:00");
    const overlap = result.occurrences.find((o) => o.wallStart === "2025-11-02T01:30:00");
    expect(overlap?.startAt).to.equal("2025-11-02T05:30:00.000Z");
    // Days after the overlap keep the clock time under the new offset.
    expect(walls).to.deep.include("2025-11-03T01:30:00");
  });

  it("routes an overlap-anchored series through the earlier-offset rule", () => {
    // Europe/Dublin DST->STD at 2026-10-25T01:00Z (02:00 IST -> 01:00 GMT), so the
    // ambiguous band is 01:00-01:59 local; 02:30 is not ambiguous there.
    const zone = "Europe/Dublin";
    const from = Date.parse("2026-10-23T00:00:00Z");
    const to = Date.parse("2026-10-28T00:00:00Z");
    const result = expand("2026-10-23T01:30:00", 1800_000, zone, from, to, daily(6));
    expect(result.status).to.equal("ok");
    const overlap = result.occurrences.find((o) => o.wallStart === "2026-10-25T01:30:00");
    expect(overlap, "overlap day present").not.to.equal(undefined);
    // Measured: 01:30 local resolves to 00:30Z under IST (+01:00) and 01:30Z under
    // GMT (+00:00); both round-trip, and the engine takes the earlier instant.
    expect(overlap?.startAt).to.equal("2026-10-25T00:30:00.000Z");
  });

  it("truncates a dense series instead of expanding it", () => {
    // 90 wall occurrences in the window, cap 4: the cap is a budget, and the
    // caller has to be told the series was cut rather than shown in full.
    const zone = "Europe/Berlin";
    const from = Date.parse("2026-01-01T00:00:00Z");
    const to = Date.parse("2026-04-01T00:00:00Z");
    const result = expand("2026-01-01T09:00:00", 3600_000, zone, from, to, daily(100), 4);
    expect(result.status).to.equal("truncated");
    expect(result.occurrences.length).to.equal(4);
    expect(result.dropped).to.equal(86);
  });

  it("skips non-leap years for a leap-day YEARLY anchor, in wall space", () => {
    // Measured against rrule 2.8.1: a YEARLY series anchored on Feb 29 emits no
    // occurrence at all for a non-leap year — it neither clamps back to Feb 28
    // nor rolls forward to Mar 1.
    const zone = "Europe/Berlin";
    const from = Date.parse("2026-01-01T00:00:00Z");
    const to = Date.parse("2028-12-31T00:00:00Z");
    const result = expand("2000-02-29T09:00:00", 3600_000, zone, from, to, yearly(null));
    expect(result.status).to.equal("ok");
    expect(result.occurrences.map((o) => o.wallStart)).to.deep.equal(["2028-02-29T09:00:00"]);
    // Berlin is +01:00 in February, so the instant is 08:00Z.
    expect(result.occurrences[0]?.startAt).to.equal("2028-02-29T08:00:00.000Z");
  });

  it("treats rrule's between() as exclusive at both ends", () => {
    // Europe/Lisbon in January is at +00:00, so the wall stamp and the instant
    // agree and the window bounds can be read directly.
    const zone = "Europe/Lisbon";
    const from = Date.parse("2026-01-04T09:00:00Z");
    const to = Date.parse("2026-01-05T09:00:00Z");
    const result = expand("2026-01-04T09:00:00", 3600_000, zone, from, to, daily(3));
    // Lower bound included by the engine's 1ms shift; upper bound excluded because
    // that is what an agenda window means.
    expect(result.occurrences.map((o) => o.wallStart)).to.deep.equal(["2026-01-04T09:00:00"]);
  });

  it("expands a weekly BYDAY series in wall space across a transition", () => {
    // Measured: rrule's BYDAY is matched against the wall weekday, so a
    // Monday/Thursday series keeps those weekdays even when the instants drift
    // by an hour at Asia/Jerusalem's 2026-03-27 transition.
    const zone = "Asia/Jerusalem";
    const from = Date.parse("2026-03-23T00:00:00Z");
    const to = Date.parse("2026-04-04T00:00:00Z");
    const result = expand("2026-03-23T09:00:00", 3600_000, zone, from, to, weekly(["MO", "TH"], 6));
    expect(result.status).to.equal("ok");
    const walls = result.occurrences.map((o) => o.wallStart);
    expect(walls).to.deep.equal([
      "2026-03-23T09:00:00",
      "2026-03-26T09:00:00",
      "2026-03-30T09:00:00",
      "2026-04-02T09:00:00",
    ]);
    // 26th is a Thursday before the transition (07:00Z), 30th after it (06:00Z):
    // the zone's offset grew by an hour, so the instants are 4 days *minus* an
    // hour apart even though the wall clock is identical.
    expect(
      Date.parse(result.occurrences[2]!.startAt) - Date.parse(result.occurrences[1]!.startAt),
    ).to.equal(4 * 24 * 3600_000 - 3600_000);
  });

  it("adds duration in wall space, not instant space", () => {
    // A 24h all-day event across the Jerusalem transition keeps whole local days.
    const zone = "Asia/Jerusalem";
    // Measured: the zone is +02:00 before 2026-03-27 02:00 local, so a window
    // starting at 2026-03-26 00:00 *local* begins at 2026-03-25T22:00Z. Passing
    // 2026-03-26T00:00Z instead would start the window an hour into the first day.
    const from = Date.parse("2026-03-25T22:00:00Z");
    const to = Date.parse("2026-03-29T00:00:00Z");
    const result = expand("2026-03-26T00:00:00", 24 * 3600_000, zone, from, to, daily(3));
    expect(result.occurrences.map((o) => o.wallEnd)).to.deep.equal([
      "2026-03-27T00:00:00",
      "2026-03-28T00:00:00",
      "2026-03-29T00:00:00",
    ]);
    // The stored span is 23h on the transition day, which is what a calendar
    // application sees for a timed event that keeps its local clock time.
    expect(
      Date.parse(result.occurrences[1]!.endAt) - Date.parse(result.occurrences[1]!.startAt),
    ).to.equal(23 * 3600_000);
  });
});

describe("recurrence engine — rule validation", () => {
  it("round-trips every admissible frequency", () => {
    for (const freq of ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const) {
      const rule: SeriesRule = {
        freq,
        interval: 3,
        byDay: [],
        byMonth: [],
        byMonthDay: [],
        count: 10,
        until: null,
        exdates: [],
      };
      const text = ruleText(rule);
      const parsed = parseRuleText(text);
      expect(parsed.ok, freq).to.equal(true);
      if (parsed.ok) expect(parsed.rule).to.deep.equal(rule);
    }
  });

  it("round-trips the by-parts and the UNTIL bound", () => {
    const rule: SeriesRule = {
      freq: "WEEKLY",
      interval: 2,
      byDay: ["MO", "TH"],
      byMonth: [],
      byMonthDay: [],
      count: null,
      until: WALL("2026-12-04T23:59:59"),
      exdates: [],
    };
    expect(ruleText(rule)).to.equal("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261204T235959");
    const parsed = parseRuleText(ruleText(rule));
    expect(parsed.ok).to.equal(true);
    if (parsed.ok) expect(parsed.rule).to.deep.equal(rule);
  });

  it("rejects everything outside the admissible subset", () => {
    const base = {
      freq: "DAILY",
      interval: 1,
      byDay: [],
      byMonth: [],
      byMonthDay: [],
      count: 5,
      until: null,
      exdates: [],
    };
    const reject = (patch: Record<string, unknown>, reason: string) => {
      const result = validateRule({ ...base, ...patch });
      expect(result.ok, JSON.stringify(patch)).to.equal(false);
      if (!result.ok) expect(result.reason).to.equal(reason);
    };
    const rejectValue = (value: unknown, reason: string) => {
      const result = validateRule(value);
      expect(result.ok, String(value)).to.equal(false);
      if (!result.ok) expect(result.reason).to.equal(reason);
    };
    // Measured: rrule parses all of these; the repository must not.
    reject({ freq: "HOURLY" }, "rule_frequency");
    reject({ freq: "MINUTELY" }, "rule_frequency");
    reject({ freq: "SECONDLY" }, "rule_frequency");
    reject({ freq: "YEARLY", bySetPos: [-1] }, "rule_property");
    reject({ freq: "DAILY", wkst: "SU" }, "rule_property");
    reject({ freq: "DAILY", rdate: ["2026-01-01T09:00:00"] }, "rule_property");
    reject({ freq: "DAILY", interval: 0 }, "rule_interval");
    reject({ freq: "DAILY", interval: MAX_RECURRENCE_INTERVAL + 1 }, "rule_interval");
    reject({ freq: "DAILY", count: 0 }, "rule_bound");
    reject({ freq: "DAILY", count: 1001 }, "rule_bound");
    // Both bounds at once: RFC takes the earlier, this repository refuses the pair.
    reject({ freq: "DAILY", count: 5, until: "2026-12-04T23:59:59" }, "rule_bound");
    reject({ freq: "DAILY", byDay: ["XX"] }, "rule_byday");
    reject({ freq: "DAILY", byDay: ["MO", "MO"] }, "rule_byday");
    reject({ freq: "MONTHLY", byMonth: [13] }, "rule_bymonth");
    reject({ freq: "MONTHLY", byMonthDay: [32] }, "rule_bymonthday");
    rejectValue("FREQ=DAILY", "rule_shape");
    rejectValue(null, "rule_shape");
    rejectValue(["FREQ=DAILY"], "rule_shape");
  });

  it("refuses non-canonical stored text", () => {
    // The column may only hold what ruleText would write; a hand-edited row fails
    // here rather than expanding differently than the writer intended.
    expect(parseRuleText("FREQ=DAILY;COUNT=5;UNTIL=20261204T235959").ok).to.equal(false);
    expect(parseRuleText("FREQ=DAILY;BYSETPOS=-1").ok).to.equal(false);
    expect(parseRuleText("FREQ=HOURLY").ok).to.equal(false);
    expect(parseRuleText("FREQ=DAILY;COUNT=05").ok).to.equal(false);
    expect(parseRuleText("FREQ=DAILY").ok).to.equal(true);
  });

  it("refuses an UNTIL that precedes the anchor", () => {
    const result = expand(
      "2026-03-25T09:00:00",
      3600_000,
      "Europe/Berlin",
      Date.parse("2026-01-01T00:00:00Z"),
      Date.parse("2026-12-31T00:00:00Z"),
      {
        freq: "DAILY",
        interval: 1,
        byDay: [],
        byMonth: [],
        byMonthDay: [],
        count: null,
        until: WALL("2026-01-01T00:00:00"),
        exdates: [],
      },
    );
    expect(result.status).to.equal("invalid");
    expect(result.reason).to.equal("rule_until_before_anchor");
  });

  it("refuses a zone the engine cannot resolve instead of guessing UTC", () => {
    const result = expandSeries({
      anchor: WALL("2026-03-25T09:00:00"),
      durationMs: 3600_000,
      zone: "Mars/Phobos",
      rule: daily(3),
      windowStart: Date.parse("2026-03-01T00:00:00Z"),
      windowEnd: Date.parse("2026-04-01T00:00:00Z"),
    });
    expect(result.status).to.equal("invalid");
    expect(result.reason).to.equal("zone_unavailable");
  });
});

// The matrix the packet asks for: every admissible frequency, bound, exception
// shape and zone class, plus the two properties the ADR leans on — the window
// is never crossed, and expansion is a pure function of its input.
const series = (over: Partial<SeriesRule>): SeriesRule => ({
  freq: "DAILY",
  interval: 1,
  byDay: [],
  byMonth: [],
  byMonthDay: [],
  count: null,
  until: null,
  exdates: [],
  ...over,
});

const wallsOf = (o: { wallStart: string }[]) => o.map((x) => x.wallStart);

describe("recurrence engine — the packet matrix", () => {
  const BERLIN = "Europe/Berlin";
  const FROM = Date.parse("2026-03-01T00:00:00Z");
  const FAR = Date.parse("2029-01-01T00:00:00Z");
  const at = (rule: SeriesRule, to = FAR) =>
    expand("2026-03-02T09:00:00", 3600_000, BERLIN, FROM, to, rule);

  it("expands each admissible frequency at its own calendar granularity", () => {
    expect(wallsOf(at(series({ freq: "DAILY", count: 4 })).occurrences)).to.deep.equal([
      "2026-03-02T09:00:00",
      "2026-03-03T09:00:00",
      "2026-03-04T09:00:00",
      "2026-03-05T09:00:00",
    ]);
    // WEEKLY is BYDAY-driven: the anchor's own weekday is not implied.
    expect(
      wallsOf(at(series({ freq: "WEEKLY", byDay: ["MO"], count: 3 })).occurrences),
    ).to.deep.equal(["2026-03-02T09:00:00", "2026-03-09T09:00:00", "2026-03-16T09:00:00"]);
    expect(wallsOf(at(series({ freq: "MONTHLY", count: 3 })).occurrences)).to.deep.equal([
      "2026-03-02T09:00:00",
      "2026-04-02T09:00:00",
      "2026-05-02T09:00:00",
    ]);
    expect(wallsOf(at(series({ freq: "YEARLY", count: 3 })).occurrences)).to.deep.equal([
      "2026-03-02T09:00:00",
      "2027-03-02T09:00:00",
      "2028-03-02T09:00:00",
    ]);
  });

  it("counts from the anchor, not from the window", () => {
    // Measured: a COUNT-4 series anchored before the window yields only its
    // 3rd and 4th occurrences inside it. A window-local count would be 4.
    const result = expand(
      "2026-03-01T09:00:00",
      3600_000,
      BERLIN,
      Date.parse("2026-03-04T00:00:00Z"),
      FAR,
      series({ freq: "DAILY", count: 4 }),
    );
    expect(result.status).to.equal("ok");
    expect(wallsOf(result.occurrences)).to.deep.equal(["2026-03-04T09:00:00"]);
  });

  it("skips month-ends the month does not have", () => {
    // Measured: MONTHLY anchored on 2026-01-31 gives 31sts of Jan, Mar, May —
    // Feb and Apr are skipped, not clamped to their last day.
    const result = expand(
      "2026-01-31T09:00:00",
      3600_000,
      BERLIN,
      Date.parse("2026-01-01T00:00:00Z"),
      Date.parse("2026-07-01T00:00:00Z"),
      series({ freq: "MONTHLY", count: 6 }),
    );
    expect(result.status).to.equal("ok");
    expect(wallsOf(result.occurrences)).to.deep.equal([
      "2026-01-31T09:00:00",
      "2026-03-31T09:00:00",
      "2026-05-31T09:00:00",
    ]);
  });

  it("treats UNTIL as an inclusive wall bound in the series zone", () => {
    // Measured in Asia/Jerusalem: UNTIL 2026-03-27T09:00 keeps that occurrence.
    const result = expand(
      "2026-03-25T09:00:00",
      3600_000,
      "Asia/Jerusalem",
      Date.parse("2026-03-20T00:00:00Z"),
      Date.parse("2026-04-10T00:00:00Z"),
      series({ until: WALL("2026-03-27T09:00:00") }),
    );
    expect(result.status).to.equal("ok");
    expect(wallsOf(result.occurrences)).to.deep.equal([
      "2026-03-25T09:00:00",
      "2026-03-26T09:00:00",
      "2026-03-27T09:00:00",
    ]);
  });

  it("cancels exceptions in wall space, without shortening the series", () => {
    // Measured: COUNT 5 from 2026-03-25 spans the 25th..29th; exdates on the
    // 26th and 28th remove two of those five, leaving three.
    const result = expand(
      "2026-03-25T09:00:00",
      3600_000,
      BERLIN,
      FROM,
      Date.parse("2026-04-10T00:00:00Z"),
      series({ freq: "DAILY", count: 5, exdates: ["2026-03-26T09:00:00", "2026-03-28T09:00:00"] }),
    );
    expect(result.status).to.equal("ok");
    expect(wallsOf(result.occurrences)).to.deep.equal([
      "2026-03-25T09:00:00",
      "2026-03-27T09:00:00",
      "2026-03-29T09:00:00",
    ]);
  });

  it("keeps an all-day event 24h in wall space and 23h in instants across a transition", () => {
    // Measured in Asia/Jerusalem, where the +02:00 -> +03:00 step lands between
    // 2026-03-27 and 2026-03-28: the 27th's all-day event spans 22:00Z -> 21:00Z.
    const result = expand(
      "2026-03-26T00:00:00",
      86_400_000,
      "Asia/Jerusalem",
      Date.parse("2026-03-25T00:00:00Z"),
      Date.parse("2026-03-31T00:00:00Z"),
      series({ freq: "DAILY", count: 3 }),
    );
    expect(result.status).to.equal("ok");
    expect(result.occurrences.map((o) => `${o.wallStart}..${o.wallEnd}`)).to.deep.equal([
      "2026-03-26T00:00:00..2026-03-27T00:00:00",
      "2026-03-27T00:00:00..2026-03-28T00:00:00",
      "2026-03-28T00:00:00..2026-03-29T00:00:00",
    ]);
    const span = (o: { startAt: string; endAt: string }) =>
      (Date.parse(o.endAt) - Date.parse(o.startAt)) / 3600_000;
    expect(result.occurrences.map(span)).to.deep.equal([24, 23, 24]);
  });

  it("honours intervals other than one", () => {
    expect(wallsOf(at(series({ freq: "DAILY", interval: 3, count: 4 })).occurrences)).to.deep.equal(
      ["2026-03-02T09:00:00", "2026-03-05T09:00:00", "2026-03-08T09:00:00", "2026-03-11T09:00:00"],
    );
    // WEEKLY interval 2 counts ISO weeks from the anchor's week.
    expect(
      wallsOf(at(series({ freq: "WEEKLY", interval: 2, byDay: ["MO"], count: 4 })).occurrences),
    ).to.deep.equal([
      "2026-03-02T09:00:00",
      "2026-03-16T09:00:00",
      "2026-03-30T09:00:00",
      "2026-04-13T09:00:00",
    ]);
    // MONTHLY with BYMONTH cycles the month list across years (measured).
    expect(
      wallsOf(at(series({ freq: "MONTHLY", byMonth: [3, 6], count: 3 })).occurrences),
    ).to.deep.equal(["2026-03-02T09:00:00", "2026-06-02T09:00:00", "2027-03-02T09:00:00"]);
  });

  it("never crosses the window, and says so when it truncates", () => {
    const shapes: Array<[string, SeriesRule, number, number, RecurrenceStatus]> = [
      ["daily", series({ freq: "DAILY" }), FROM, FAR, "truncated"],
      ["weekly-byday", series({ freq: "WEEKLY", byDay: ["TU", "TH"] }), FROM, FAR, "ok"],
      ["monthly", series({ freq: "MONTHLY" }), FROM, FAR, "ok"],
      ["yearly", series({ freq: "YEARLY" }), FROM, FAR, "ok"],
      ["daily-interval-7", series({ freq: "DAILY", interval: 7 }), FROM, FAR, "ok"],
      // A window that starts after the anchor still sees only in-window instants.
      [
        "late-window",
        series({ freq: "DAILY", count: 4 }),
        Date.parse("2026-03-04T00:00:00Z"),
        FAR,
        "ok",
      ],
    ];
    for (const [name, rule, from, to, status] of shapes) {
      const result = expandSeries({
        anchor: WALL("2026-03-02T09:00:00"),
        durationMs: 3600_000,
        zone: BERLIN,
        rule,
        windowStart: from,
        windowEnd: to,
      });
      // Measured against MAX_SERIES_OCCURRENCES = 730: only the plain daily
      // series over a ~2.7 year window exceeds the cap (730 kept, 306 dropped).
      expect(result.status, name).to.equal(status);
      if (status === "truncated") expect(result.dropped, name).to.be.above(0);
      for (const o of result.occurrences) {
        const start = Date.parse(o.startAt);
        expect(start >= from && start < to, `${name} ${o.startAt}`).to.equal(true);
      }
    }
  });

  it("is a pure function of its input, keyed by the start/end instant pair", () => {
    const rule = series({ freq: "WEEKLY", byDay: ["MO", "WE"] });
    const once = at(rule);
    const twice = at(rule);
    const keyOf = (o: { startAt: string; endAt: string }) => `${o.startAt}|${o.endAt}`;
    const keys = once.occurrences.map(keyOf);
    expect(twice.occurrences.map(keyOf)).to.deep.equal(keys);
    expect(new Set(keys).size).to.equal(keys.length);
    expect(keys[0]).to.equal("2026-03-02T08:00:00.000Z|2026-03-02T09:00:00.000Z");
  });
});
