// Pure slot math. No I/O, fully unit-testable. `now` is always an injected
// argument — that is what lets the whole engine be tested without mocking
// the system clock.
//
// Timezone shortcut (blueprint Section 3, satisfied here on purpose):
// America/Phoenix has no daylight saving, so local-time-to-UTC is a fixed
// UTC-7 offset year round and the math below is exact with no timezone
// library. Porting this file to a DST-observing timezone means replacing
// `phoenixTimeToUtcMs` with a real conversion (Intl.DateTimeFormat with a
// timeZone + offset extraction, or a small tz library) — skipping that
// produces slots that are correct for half the year and an hour wrong for
// the other half.

export interface BusyBlock {
  /** UTC ISO instant */
  start: string;
  /** UTC ISO instant */
  end: string;
}

export type WeekHours = { open: number; close: number } | null;

/** Hours are in 24h Phoenix local time. Sunday closed. */
export const WEEKLY_HOURS: Record<number, WeekHours> = {
  0: null, // Sunday
  1: { open: 9, close: 17 }, // Monday
  2: { open: 9, close: 17 }, // Tuesday
  3: { open: 9, close: 17 }, // Wednesday
  4: { open: 9, close: 17 }, // Thursday
  5: { open: 9, close: 17 }, // Friday
  6: null, // Saturday closed (Joseph order 2026-10-02: no meetings dropping into Saturdays; was 10am-2pm)
};

export const SLOT_STEP_MIN = 30;
export const MIN_NOTICE_HOURS = 24;

/**
 * Quiet gap kept clear before AND after everything already on Joseph's
 * calendar. Joseph order 2026-10-02: no back-to-back client calls, because the
 * next person was walking into his Zoom room while he was still on with the
 * last one. On the 30-minute grid a 15-minute pad blocks the whole adjacent
 * slot on each side, so a 10:00-10:30 meeting leaves 9:30 and 10:30 unbookable.
 */
export const BUFFER_MIN = 15;

/** Busy blocks as epoch ms, each widened by BUFFER_MIN on both sides. */
function paddedBusyMs(busy: BusyBlock[]): { start: number; end: number }[] {
  const pad = BUFFER_MIN * 60 * 1000;
  return busy
    .map((b) => ({ start: Date.parse(b.start) - pad, end: Date.parse(b.end) + pad }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}

/** Fixed year-round. America/Phoenix does not observe DST. */
export const PHOENIX_UTC_OFFSET_HOURS = 7;

/**
 * Converts a Phoenix wall-clock time to a UTC epoch ms. `month` is
 * 1-indexed so call sites read naturally (month=1 is January).
 */
export function phoenixTimeToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour + PHOENIX_UTC_OFFSET_HOURS, minute, 0, 0);
}

/** Inverse of phoenixTimeToUtcMs: recovers the Phoenix wall-clock fields for a UTC instant. */
function utcMsToPhoenixFields(ms: number): { year: number; month: number; day: number; minuteOfDay: number } {
  const shifted = new Date(ms - PHOENIX_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the following (0-indexed) month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface DaySlots {
  /** YYYY-MM-DD, Phoenix-local calendar date */
  date: string;
  /** UTC ISO start times */
  slots: string[];
}

/**
 * Every open slot in one Phoenix-local calendar month for one event
 * duration, minus minimum notice, minus the booking horizon, minus busy
 * time. `busy` is a flat list of UTC intervals already unioned across every
 * calendar in BOOKING_CALENDAR_ID — an all-day OPAQUE calendar event just
 * needs to arrive here as a UTC interval spanning the full day; the overlap
 * check handles it with no special casing.
 */
/**
 * Intersects the global weekly hours with an optional per-event window.
 * The event window can only narrow the day, never widen it; a day whose
 * intersection is empty closes entirely.
 */
export function effectiveHours(global: WeekHours, eventHours?: { open: number; close: number }): WeekHours {
  if (!global) return null;
  if (!eventHours) return global;
  const open = Math.max(global.open, eventHours.open);
  const close = Math.min(global.close, eventHours.close);
  return open < close ? { open, close } : null;
}

export function computeMonthSlots(
  year: number,
  month: number, // 1-indexed
  durationMin: number,
  busy: BusyBlock[],
  now: Date,
  horizonDays: number,
  eventHours?: { open: number; close: number }
): DaySlots[] {
  const nowMs = now.getTime();
  const earliestBookableMs = nowMs + MIN_NOTICE_HOURS * 60 * 60 * 1000;
  const horizonMs = nowMs + horizonDays * 24 * 60 * 60 * 1000;

  const busyMs = paddedBusyMs(busy);

  const totalDays = daysInMonth(year, month);
  const result: DaySlots[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const hours = effectiveHours(WEEKLY_HOURS[dayOfWeek(year, month, day)], eventHours);
    if (!hours) continue;

    const slots: string[] = [];
    for (let minutes = hours.open * 60; minutes + durationMin <= hours.close * 60; minutes += SLOT_STEP_MIN) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      const startMs = phoenixTimeToUtcMs(year, month, day, h, m);
      const endMs = startMs + durationMin * 60 * 1000;

      if (startMs < earliestBookableMs) continue;
      if (startMs > horizonMs) continue;
      if (busyMs.some((b) => overlaps(startMs, endMs, b.start, b.end))) continue;

      slots.push(new Date(startMs).toISOString());
    }

    if (slots.length > 0) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      result.push({ date: dateStr, slots });
    }
  }

  return result;
}

/**
 * Re-runs the same computation for exactly one slot. This is what the
 * booking route calls right before it writes the calendar event, so a slot
 * that went stale between page-load and submit returns false instead of
 * double-booking. Must agree with computeMonthSlots for every slot it
 * would have produced.
 */
export function isSlotBookable(
  startIso: string,
  durationMin: number,
  busy: BusyBlock[],
  now: Date,
  horizonDays: number,
  eventHours?: { open: number; close: number }
): boolean {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return false;

  const { year, month, day, minuteOfDay } = utcMsToPhoenixFields(startMs);
  const hours = effectiveHours(WEEKLY_HOURS[dayOfWeek(year, month, day)], eventHours);
  if (!hours) return false;
  if (minuteOfDay < hours.open * 60) return false;
  if (minuteOfDay + durationMin > hours.close * 60) return false;
  if (minuteOfDay % SLOT_STEP_MIN !== 0) return false;

  const nowMs = now.getTime();
  if (startMs < nowMs + MIN_NOTICE_HOURS * 60 * 60 * 1000) return false;
  if (startMs > nowMs + horizonDays * 24 * 60 * 60 * 1000) return false;

  const endMs = startMs + durationMin * 60 * 1000;
  const busyMs = paddedBusyMs(busy);
  if (busyMs.some((b) => overlaps(startMs, endMs, b.start, b.end))) return false;

  return true;
}
