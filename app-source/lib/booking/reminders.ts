// The reminder sweep. Idempotent, safe to call as often as anything wants
// to call it. Sent-state lives as a marker property on the calendar event
// itself (reminder3d, reminder1d, smsMorning) — nothing is queued anywhere,
// so a missed sweep just catches up on the next one instead of dropping a
// message.
//
// Two windows per email leg: "tight" (68-76h / 22-28h) for a frequent
// pulse, "daily" (60-84h / 18-42h) as a once-a-day backstop that still
// catches everything even if the tight pulse never runs. smsMorning has its
// own narrow day-of window and is evaluated on every sweep call regardless
// of which window was requested.

import { listUpcomingBookings, patchBookingMarkers, bookingTypeName, type GoogleBookingEvent } from "./google.ts";
import { sendEmail } from "./mail.ts";
import { sendSms } from "./sms.ts";
import { reminder3dEmail, reminder1dEmail, morningText, type NotificationBooking, brandAssets } from "./templates.ts";
import { manageUrlsForEvent } from "./manage-token.ts";
import type { LocationKind } from "./events.ts";

export type SweepWindow = "tight" | "daily";

const REMINDER_WINDOWS: Record<SweepWindow, { r3d: [number, number]; r1d: [number, number] }> = {
  tight: { r3d: [68, 76], r1d: [22, 28] },
  daily: { r3d: [60, 84], r1d: [18, 42] },
};

const LOOKAHEAD_DAYS = 4;

function tzOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return (asUtc - date.getTime()) / 60000;
}

/** Local hour-of-day (0-23) for a UTC instant in a given IANA timezone. */
function localHour(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" });
  return Number(dtf.format(date));
}

function morningSmsWindow(startMs: number, inviteeTz: string): { start: number; end: number } {
  const startDate = new Date(startMs);
  const meetingLocalHour = localHour(inviteeTz, startDate);

  if (meetingLocalHour >= 8) {
    // 7am invitee-local on the meeting's own calendar day, through start minus 60 minutes.
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: inviteeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(startDate);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const offsetAtStart = tzOffsetMinutes(inviteeTz, startDate);
    const sevenAmLocalMs = Date.UTC(+map.year, +map.month - 1, +map.day, 7, 0, 0) - offsetAtStart * 60000;
    return { start: sevenAmLocalMs, end: startMs - 60 * 60 * 1000 };
  }

  // Meeting starts too early for a same-day 7am window; send the evening before instead.
  return { start: startMs - 20 * 60 * 60 * 1000, end: startMs - 17 * 60 * 60 * 1000 };
}

/**
 * Reconstructs the booking shape from an event's private props. Exported so
 * lib/booking/manage.ts (self-service confirm/reschedule/cancel) and
 * lib/booking/perform.ts (reschedule's old-event lookup) can read the same
 * calendar event without a second, drifting implementation.
 */
export function bookingFromEvent(ev: GoogleBookingEvent): NotificationBooking | null {
  const p = ev.props;
  if (!p.inviteeName || !p.inviteeEmail || !p.inviteeTz) return null;

  let answers: Record<string, string> = {};
  if (p.answers) {
    try {
      answers = JSON.parse(p.answers);
    } catch {
      answers = {};
    }
  }

  return {
    inviteeName: p.inviteeName,
    inviteeEmail: p.inviteeEmail,
    inviteePhone: p.inviteePhone || undefined,
    eventName: bookingTypeName(ev.summary, p.eventSlug),
    eventSlug: p.eventSlug || "",
    startIso: ev.start,
    durationMin: Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60000),
    inviteeTz: p.inviteeTz,
    location: (p.location as LocationKind) || "zoom",
    joinUrl: p.joinUrl || undefined,
    answers,
  };
}

/**
 * Extra people who should get the same reminders as the invitee (Joseph order
 * 2026-10-17: "make they both get the reminder emails & the morning of short
 * friendly text"). Stored on the event as a `guests` private prop, a JSON list
 * of {name, email, phone?}. A bad or missing prop means no guests, never a
 * failed sweep. Guests get no manage links, so only the invitee can move or
 * cancel the booking.
 */
export function guestBookings(ev: GoogleBookingEvent, primary: NotificationBooking): NotificationBooking[] {
  const raw = ev.props.guests;
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: NotificationBooking[] = [];
  const seen = new Set([primary.inviteeEmail.toLowerCase()]);
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    const name = typeof g.name === "string" ? g.name.trim() : "";
    const email = typeof g.email === "string" ? g.email.trim() : "";
    if (!name || !email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const phone = typeof g.phone === "string" && g.phone.trim() ? g.phone.trim() : undefined;
    out.push({ ...primary, inviteeName: name, inviteeEmail: email, inviteePhone: phone });
  }
  return out;
}

// Twilio was never provisioned, so morning texts have a second delivery
// path: smsMode "list" returns due texts to the caller instead of sending,
// and the local Atlas pulse (which runs on a Mac that can send iMessage)
// delivers them and then marks them via the smsmark route.
export type SmsMode = "twilio" | "list";

export interface DueSms {
  calendarId: string;
  eventId: string;
  phone: string;
  body: string;
}

export interface SweepResult {
  window: SweepWindow;
  now: string;
  checked: number;
  reminder3dSent: number;
  reminder1dSent: number;
  smsMorningSent: number;
  smsDue: DueSms[];
  errors: string[];
}

export async function runReminderSweep(now: Date, window: SweepWindow, smsMode: SmsMode = "twilio"): Promise<SweepResult> {
  const result: SweepResult = {
    window,
    now: now.toISOString(),
    checked: 0,
    reminder3dSent: 0,
    reminder1dSent: 0,
    smsMorningSent: 0,
    smsDue: [],
    errors: [],
  };

  const windowStartIso = now.toISOString();
  const windowEndIso = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let events: GoogleBookingEvent[];
  try {
    events = await listUpcomingBookings(windowStartIso, windowEndIso);
  } catch (err) {
    result.errors.push(`list_upcoming_failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const { r3d, r1d } = REMINDER_WINDOWS[window];
  const nowMs = now.getTime();

  for (const ev of events) {
    result.checked += 1;
    const booking = bookingFromEvent(ev);
    if (!booking) continue;

    const startMs = Date.parse(booking.startIso);
    const hoursUntil = (startMs - nowMs) / (60 * 60 * 1000);
    const markers: Record<string, string> = {};

    // ev.props.confirmed=1 only changes the calendar title (see
    // lib/booking/manage.ts confirmBooking) — it never suppresses a
    // reminder. Both legs below fire purely off the reminder3d/reminder1d
    // markers, same as before self-service existed.
    const manageUrls = manageUrlsForEvent(ev.id);
    // Joseph order 2026-09-06: reminders carry the booking's own brand, so an
    // Unbound session never reminds the client in Hana's name.
    const brand = brandAssets(booking);
    const guests = guestBookings(ev, booking);

    if (!ev.props.reminder3d && hoursUntil >= r3d[0] && hoursUntil <= r3d[1]) {
      const email = reminder3dEmail(booking, manageUrls ?? undefined);
      const sent = await sendEmail({ to: booking.inviteeEmail, fromName: brand.fromName, fromEmail: brand.fromEmail, replyTo: brand.replyTo, subject: email.subject, text: email.text, html: email.html });
      if (sent.ok) {
        markers.reminder3d = "1";
        result.reminder3dSent += 1;
        for (const g of guests) {
          const ge = reminder3dEmail(g);
          const gs = await sendEmail({ to: g.inviteeEmail, fromName: brand.fromName, fromEmail: brand.fromEmail, replyTo: brand.replyTo, subject: ge.subject, text: ge.text, html: ge.html });
          if (gs.ok) result.reminder3dSent += 1;
          else result.errors.push(`reminder3d_send_failed for ${g.inviteeEmail}: ${gs.error}`);
        }
      } else {
        result.errors.push(`reminder3d_send_failed for ${booking.inviteeEmail}: ${sent.error}`);
      }
    }

    if (!ev.props.reminder1d && hoursUntil >= r1d[0] && hoursUntil <= r1d[1]) {
      const email = reminder1dEmail(booking, manageUrls ?? undefined);
      const sent = await sendEmail({ to: booking.inviteeEmail, fromName: brand.fromName, fromEmail: brand.fromEmail, replyTo: brand.replyTo, subject: email.subject, text: email.text, html: email.html });
      if (sent.ok) {
        markers.reminder1d = "1";
        result.reminder1dSent += 1;
        for (const g of guests) {
          const ge = reminder1dEmail(g);
          const gs = await sendEmail({ to: g.inviteeEmail, fromName: brand.fromName, fromEmail: brand.fromEmail, replyTo: brand.replyTo, subject: ge.subject, text: ge.text, html: ge.html });
          if (gs.ok) result.reminder1dSent += 1;
          else result.errors.push(`reminder1d_send_failed for ${g.inviteeEmail}: ${gs.error}`);
        }
      } else {
        result.errors.push(`reminder1d_send_failed for ${booking.inviteeEmail}: ${sent.error}`);
      }
    }

    // Evaluated on every sweep call regardless of window, and only when we
    // have a phone number to text at all.
    const texters = [booking, ...guests].filter((b) => b.inviteePhone);
    if (!ev.props.smsMorning && texters.length > 0) {
      const { start, end } = morningSmsWindow(startMs, booking.inviteeTz);
      if (end >= start && nowMs >= start && nowMs <= end) {
        if (smsMode === "list") {
          // Hand the due text to the caller; the caller sends it and then
          // marks it via the smsmark route. No marker written here, so an
          // unclaimed text stays due for the next pulse.
          for (const t of texters) {
            result.smsDue.push({
              calendarId: ev.calendarId,
              eventId: ev.id,
              phone: t.inviteePhone as string,
              body: morningText(t),
            });
          }
        } else {
          for (const t of texters) {
            const sent = await sendSms(t.inviteePhone as string, morningText(t));
            if (sent.ok) {
              markers.smsMorning = "1";
              result.smsMorningSent += 1;
            }
          }
          // sms_not_configured / invalid_phone are silent no-ops by design,
          // never logged as sweep errors.
        }
      }
    }

    if (Object.keys(markers).length > 0) {
      try {
        await patchBookingMarkers(ev.calendarId, ev.id, ev.etag, markers);
      } catch (err) {
        result.errors.push(`marker_patch_failed for ${ev.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return result;
}
