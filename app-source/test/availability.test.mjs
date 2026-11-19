import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeMonthSlots,
  isSlotBookable,
  phoenixTimeToUtcMs,
} from "../lib/booking/availability.ts";

function iso(year, month, day, hour, minute) {
  return new Date(phoenixTimeToUtcMs(year, month, day, hour, minute)).toISOString();
}

describe("computeMonthSlots — hours boundaries", () => {
  const now = new Date("2026-08-01T00:00:00Z"); // well before September, permissive notice/horizon
  const days = computeMonthSlots(2026, 9, 60, [], now, 60);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.slots]));

  test("Monday (Sept 7) runs 9:00 to 16:00 last-start, 15 slots", () => {
    const mon = byDate["2026-09-07"];
    assert.ok(mon, "Monday should have slots");
    assert.equal(mon.length, 15);
    assert.equal(mon[0], iso(2026, 9, 7, 9, 0));
    assert.equal(mon[mon.length - 1], iso(2026, 9, 7, 16, 0));
  });

  test("Saturday (Sept 5) is closed, no entry at all (Joseph order 2026-10-02: no Saturday meetings)", () => {
    assert.equal(byDate["2026-09-05"], undefined);
  });

  test("Sunday (Sept 6) is closed, no entry at all", () => {
    assert.equal(byDate["2026-09-06"], undefined);
  });
});

describe("computeMonthSlots — 24 hour minimum notice", () => {
  // Monday Sept 7, 2026, 10:00am Phoenix.
  const now = new Date(phoenixTimeToUtcMs(2026, 9, 7, 10, 0));
  const days = computeMonthSlots(2026, 9, 60, [], now, 30);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.slots]));

  test("today (Sept 7) has nothing left — earliest bookable is 24h out", () => {
    assert.equal(byDate["2026-09-07"], undefined);
  });

  test("tomorrow (Sept 8) only opens from 10:00 Phoenix onward", () => {
    const tue = byDate["2026-09-08"];
    assert.ok(tue, "Tuesday should still have slots");
    assert.equal(tue[0], iso(2026, 9, 8, 10, 0));
    assert.equal(tue.length, 13); // 10:00 through 16:00 last-start
  });
});

describe("computeMonthSlots — per-event horizon cutoff", () => {
  // Tuesday Sept 1, 2026, 05:00 Phoenix. horizonDays=6 -> cutoff is
  // Sept 7 05:00 Phoenix, which is BEFORE Monday's 9am open, so Monday
  // Sept 7 is wholly beyond the horizon and should be dropped entirely.
  const now = new Date(phoenixTimeToUtcMs(2026, 9, 1, 5, 0));
  const days = computeMonthSlots(2026, 9, 60, [], now, 6);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.slots]));

  test("Friday Sept 4 is well inside the horizon", () => {
    assert.ok(byDate["2026-09-04"]);
  });

  test("Monday Sept 7 is entirely past the 6-day horizon", () => {
    assert.equal(byDate["2026-09-07"], undefined);
  });
});

describe("computeMonthSlots — busy-block subtraction", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  test("an all-day OPAQUE event wipes the whole day", () => {
    const busy = [
      {
        // A full Phoenix calendar day, as freeBusy returns for an all-day event.
        start: iso(2026, 9, 8, 0, 0),
        end: iso(2026, 9, 9, 0, 0),
      },
    ];
    const days = computeMonthSlots(2026, 9, 60, busy, now, 60);
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.slots]));
    assert.equal(byDate["2026-09-08"], undefined, "Tuesday should be wiped out entirely");
    assert.ok(byDate["2026-09-09"], "Wednesday should be untouched");
  });

  test("a partial busy block removes only the overlapping starts", () => {
    const busy = [{ start: iso(2026, 9, 9, 9, 0), end: iso(2026, 9, 9, 12, 0) }];
    const days = computeMonthSlots(2026, 9, 60, busy, now, 60);
    const wed = days.find((d) => d.date === "2026-09-09").slots;
    assert.equal(wed[0], iso(2026, 9, 9, 12, 30), "first open start is 12:30: the 9-12 block plus its 15-minute buffer");
  });
});

describe("15-minute buffer around every busy block (Joseph order 2026-10-02)", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  // A 30-minute call 10:00-10:30 on Wednesday Sept 9.
  const busy = [{ start: iso(2026, 9, 9, 10, 0), end: iso(2026, 9, 9, 10, 30) }];
  const days = computeMonthSlots(2026, 9, 30, busy, now, 60);
  const wed = days.find((d) => d.date === "2026-09-09").slots;

  test("the 30-minute slot right before a meeting is not offered", () => {
    assert.ok(!wed.includes(iso(2026, 9, 9, 9, 30)));
  });

  test("the 30-minute slot right after a meeting is not offered", () => {
    assert.ok(!wed.includes(iso(2026, 9, 9, 10, 30)));
  });

  test("slots one step further out stay open", () => {
    assert.ok(wed.includes(iso(2026, 9, 9, 9, 0)));
    assert.ok(wed.includes(iso(2026, 9, 9, 11, 0)));
  });

  test("the booking-time re-check refuses the slots inside the buffer too", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 9, 9, 30), 30, busy, now, 60), false);
    assert.equal(isSlotBookable(iso(2026, 9, 9, 10, 30), 30, busy, now, 60), false);
    assert.equal(isSlotBookable(iso(2026, 9, 9, 11, 0), 30, busy, now, 60), true);
  });

  test("a 60-minute booking cannot end right where another meeting starts", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 9, 9, 0), 60, busy, now, 60), false);
    assert.equal(isSlotBookable(iso(2026, 9, 9, 8, 30), 60, busy, now, 60), false, "8:30 is before opening anyway");
  });

  test("a time on a Saturday is never bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 5, 10, 0), 30, [], now, 60), false);
  });
});

describe("computeMonthSlots — month boundary behavior", () => {
  test("December (31 days) never leaks into another month's dates", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const days = computeMonthSlots(2026, 12, 30, [], now, 90);
    for (const d of days) {
      assert.ok(d.date.startsWith("2026-12-"), `${d.date} should belong to December`);
    }
    const maxDay = Math.max(...days.map((d) => Number(d.date.slice(-2))));
    assert.ok(maxDay <= 31);
  });

  test("crossing a year boundary (Dec 2026 -> Jan 2027) does not crash and stays in-month", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const days = computeMonthSlots(2027, 1, 30, [], now, 90);
    for (const d of days) {
      assert.ok(d.date.startsWith("2027-01-"), `${d.date} should belong to January 2027`);
    }
  });

  test("February 2026 (not a leap year) stops at day 28", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const days = computeMonthSlots(2026, 2, 30, [], now, 90);
    const maxDay = Math.max(...days.map((d) => Number(d.date.slice(-2))));
    assert.ok(maxDay <= 28, `expected no day past 28, got ${maxDay}`);
  });
});

describe("isSlotBookable agrees with computeMonthSlots", () => {
  const now = new Date(phoenixTimeToUtcMs(2026, 9, 1, 8, 0));
  const busy = [{ start: iso(2026, 9, 9, 9, 0), end: iso(2026, 9, 9, 12, 0) }];
  const horizonDays = 20;
  const durationMin = 60;
  const days = computeMonthSlots(2026, 9, durationMin, busy, now, horizonDays);

  test("every slot computeMonthSlots produced is independently bookable", () => {
    for (const day of days) {
      for (const slot of day.slots) {
        assert.equal(
          isSlotBookable(slot, durationMin, busy, now, horizonDays),
          true,
          `${slot} should be bookable`
        );
      }
    }
  });

  test("a time outside business hours is not bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 8, 7, 0), durationMin, busy, now, horizonDays), false);
  });

  test("a time on a closed Sunday is not bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 6, 10, 0), durationMin, busy, now, horizonDays), false);
  });

  test("a time inside the busy block is not bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 9, 10, 0), durationMin, busy, now, horizonDays), false);
  });

  test("a time inside the 24h notice window is not bookable", () => {
    // now is Sept 1 08:00 Phoenix; Sept 1 09:00 is only 1 hour out.
    assert.equal(isSlotBookable(iso(2026, 9, 1, 9, 0), durationMin, busy, now, horizonDays), false);
  });

  test("a time past the horizon is not bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 30, 9, 0), durationMin, busy, now, horizonDays), false);
  });

  test("a non-30-minute-aligned time is not bookable", () => {
    assert.equal(isSlotBookable(iso(2026, 9, 8, 9, 15), durationMin, busy, now, horizonDays), false);
  });
});
