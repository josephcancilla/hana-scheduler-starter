// Auto-pick poll candidate times (2026-08-28, Joseph's spec: "The poller
// would select 5 open times across the next 2 weeks, evenly spread out").
//
// Reuses the exact availability math the booking widget uses — same weekly
// hours, minimum notice, busy-time union across all three calendars — so a
// suggested time is by construction a time a normal booking could take.
// "Evenly spread" means two things here: the picks span the whole two-week
// window (first day, last day, and evenly spaced days between), and the
// times of day vary (open, midday, close, quarter points) so five picks
// never come out as five identical 9:00 AMs.

import { computeMonthSlots, type DaySlots } from "./availability.ts";
import { getBusyTimes } from "./google.ts";
import { getEventType } from "./events.ts";

export const SUGGEST_COUNT = 5;
export const SUGGEST_DAYS_AHEAD = 14;

/** Position within each picked day's slot list, cycled so times vary. */
const DAY_FRACTIONS = [0, 0.5, 1, 0.25, 0.75];

function pickAt<T>(arr: T[], fraction: number): T {
  const idx = Math.round(fraction * (arr.length - 1));
  return arr[Math.min(arr.length - 1, Math.max(0, idx))];
}

export type SuggestResult =
  | { ok: true; startIsos: string[] }
  | { ok: false; error: string };

export async function suggestPollTimes(
  eventTypeSlug: string,
  count: number = SUGGEST_COUNT,
  daysAhead: number = SUGGEST_DAYS_AHEAD
): Promise<SuggestResult> {
  const eventType = getEventType(eventTypeSlug);
  if (!eventType) return { ok: false, error: "unknown_event_type" };

  const now = new Date();
  const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  let busy: { start: string; end: string }[];
  try {
    busy = await getBusyTimes(now.toISOString(), windowEnd.toISOString());
  } catch {
    return { ok: false, error: "availability_fetch_failed" };
  }

  // The window can straddle a month boundary; compute both months and let
  // the horizon filter (daysAhead, capped by the event's own horizon) trim.
  const horizon = Math.min(daysAhead, eventType.horizonDays);
  const months: Array<[number, number]> = [[now.getUTCFullYear(), now.getUTCMonth() + 1]];
  if (windowEnd.getUTCMonth() !== now.getUTCMonth() || windowEnd.getUTCFullYear() !== now.getUTCFullYear()) {
    months.push([windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() + 1]);
  }

  const days: DaySlots[] = [];
  for (const [y, m] of months) {
    days.push(...computeMonthSlots(y, m, eventType.duration, busy, now, horizon, eventType.hours));
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));

  if (days.length === 0) return { ok: false, error: "no_open_times_in_window" };

  const picks: string[] = [];
  const seen = new Set<string>();

  if (days.length >= count) {
    // Even day spread across the whole window: first day, last day, and
    // evenly spaced days between. Time-of-day cycles so the picks vary.
    for (let i = 0; i < count; i++) {
      const dayIdx = Math.round((i * (days.length - 1)) / (count - 1));
      const slot = pickAt(days[dayIdx].slots, DAY_FRACTIONS[i % DAY_FRACTIONS.length]);
      if (!seen.has(slot)) {
        seen.add(slot);
        picks.push(slot);
      }
    }
  }

  // Fewer open days than picks (or dedupe collisions above): walk days
  // round-robin, spreading within each day, until we have enough.
  let fractionCursor = 0;
  outer: for (let round = 0; picks.length < count; round++) {
    let added = false;
    for (const day of days) {
      if (picks.length >= count) break outer;
      const fraction = DAY_FRACTIONS[fractionCursor % DAY_FRACTIONS.length];
      fractionCursor++;
      const slot = pickAt(day.slots, fraction);
      if (!seen.has(slot)) {
        seen.add(slot);
        picks.push(slot);
        added = true;
      }
    }
    // Every day's picks exhausted — accept fewer than `count` rather than loop.
    if (!added && round > 0) break;
  }

  if (picks.length < 3) return { ok: false, error: "not_enough_open_times_in_window" };

  picks.sort();
  return { ok: true, startIsos: picks };
}
