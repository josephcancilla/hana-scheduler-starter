// Validation, slot re-check, calendar write, both confirmation emails.
// This is the second and third of the three availability checks (the first
// is the slot list the visitor saw, which may be minutes stale).

import { getEventType, type LocationKind } from "./events.ts";
import { notifyPodio } from "./podio-notify.ts";
import { isSlotBookable } from "./availability.ts";
import {
  getBusyTimes,
  findExistingBooking,
  createBookingEvent,
  bookingSummary,
  listBookingsByEmail,
  isGoogleConfigured,
  bookingCalendarIds,
  getCalendarEvent,
  patchEventPropsRaw,
  deleteCalendarEvent,
  type GoogleBookingEvent,
} from "./google.ts";
import { ZOOM_LANDING_URL, zoomLandingFor, standingRoom, isZoomConfigured } from "./zoom.ts";
import { sendEmail } from "./mail.ts";
import { confirmationInviteeEmail, confirmationOperatorEmail, rescheduledOperatorEmail, type NotificationBooking, brandAssets } from "./templates.ts";
import { verifyManageToken, manageUrlsForEvent } from "./manage-token.ts";
import { bookingFromEvent } from "./reminders.ts";
import { buildInviteIcs } from "./ics.ts";
import type { ZoomMeeting } from "./zoom.ts";

const MAX_NAME_LEN = 200;
const MAX_EMAIL_LEN = 320;
const MAX_PHONE_LEN = 40;
const MAX_ANSWER_LEN = 2000;
const MAX_EXTRA_KEYS = 12;
const HISTORY_LOOKBACK_YEARS = 2;

export interface BookingRequestPayload {
  slug: string;
  startIso: string;
  name: string;
  email: string;
  phone?: string;
  location: string;
  answers: Record<string, string>;
  inviteeTz: string;
  /** Structured fields beyond the declared question list, for a future satellite front end. Capped at 12 keys. */
  extra?: Record<string, string>;
  /** Set when this submit came from the "Reschedule" flow (manage page -> ?reschedule=<token> on the booking widget). A malformed/foreign/missing token is never a hard failure -- it just falls back to booking a normal new event. */
  rescheduleToken?: string;
}

export type PerformBookingResult =
  | { ok: true; eventId: string; startIso: string; joinUrl?: string }
  | { ok: false; status: number; error: string };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function humanLocation(location: LocationKind): string {
  if (location === "zoom") return "Zoom";
  if (location === "phone") return "Phone call";
  return "In person";
}

function validate(payload: BookingRequestPayload): { ok: true } | { ok: false; error: string } {
  const eventType = getEventType(payload.slug);
  if (!eventType) return { ok: false, error: "unknown_event_type" };

  const name = (payload.name ?? "").trim();
  if (!name) return { ok: false, error: "name_required" };
  if (name.length > MAX_NAME_LEN) return { ok: false, error: "name_too_long" };

  const email = (payload.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };
  if (email.length > MAX_EMAIL_LEN) return { ok: false, error: "email_too_long" };

  const location = payload.location as LocationKind;
  if (!eventType.locations.includes(location)) return { ok: false, error: "invalid_location" };

  if (location === "phone") {
    const phone = (payload.phone ?? "").trim();
    if (!phone) return { ok: false, error: "phone_required" };
    if (phone.length > MAX_PHONE_LEN) return { ok: false, error: "phone_too_long" };
  }

  for (const q of eventType.questions) {
    if (!q.required) continue;
    const answer = (payload.answers?.[q.label] ?? "").trim();
    if (!answer) return { ok: false, error: `missing_required_answer: ${q.label}` };
  }

  for (const [, value] of Object.entries(payload.answers ?? {})) {
    if (typeof value === "string" && value.length > MAX_ANSWER_LEN) {
      return { ok: false, error: "answer_too_long" };
    }
  }

  const extraKeys = Object.keys(payload.extra ?? {});
  if (extraKeys.length > MAX_EXTRA_KEYS) return { ok: false, error: "too_many_extra_fields" };

  if (!payload.inviteeTz || payload.inviteeTz.length > 100) return { ok: false, error: "invalid_timezone" };

  return { ok: true };
}

/** "555-0100" from "0000000000" — the way Zoom prints meeting IDs. */
function formatMeetingId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return id;
}

/** The written-out Zoom block for calendar notes: join URL, meeting ID,
 * passcode (Joseph 2026-08-29 — so nobody has to dig for the passcode). */
/**
 * The one Zoom link that goes to clients, in the invite location, the notes,
 * every email and the text: Joseph's Hana landing page at zoom.hana.events
 * (Joseph order 2026-10-02; was hana-events.zoom.us, which bounced visitors
 * signed into their own Zoom to zoom.com). Never the long per-meeting URL.
 */
export const HANA_ZOOM_LINK = ZOOM_LANDING_URL;

export function zoomNotesBlock(_meeting: ZoomMeeting, link: string = HANA_ZOOM_LINK): string[] {
  return ["Join Zoom here:", link];
}

function buildDescription(
  eventName: string,
  location: LocationKind,
  inviteeTz: string,
  answers: Record<string, string>,
  meeting: ZoomMeeting | null,
  zoomRequested: boolean
): string {
  const lines = [
    `Booked via calendar.hana.events (${eventName}).`,
    `Location: ${humanLocation(location)}`,
    `Visitor timezone: ${inviteeTz}`,
  ];

  if (zoomRequested && !meeting) {
    lines.push("Zoom unconfigured, send the join link manually.");
  }
  if (meeting) {
    lines.push("", ...zoomNotesBlock(meeting, zoomLandingFor(undefined, eventName)));
  }

  const qa = Object.entries(answers).filter(([, v]) => v && v.trim());
  if (qa.length > 0) {
    lines.push("", "Answers:");
    for (const [q, a] of qa) lines.push(`${q}: ${a}`);
  }

  return lines.join("\n");
}

export async function performBooking(payload: BookingRequestPayload): Promise<PerformBookingResult> {
  const validation = validate(payload);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }

  const eventType = getEventType(payload.slug)!;
  const location = payload.location as LocationKind;
  const startMs = Date.parse(payload.startIso);
  if (!Number.isFinite(startMs)) return { ok: false, status: 400, error: "invalid_start" };
  const endIso = new Date(startMs + eventType.duration * 60 * 1000).toISOString();

  // Reschedule source, resolved up front. A malformed/foreign/expired-by-
  // deletion token is never a hard failure -- it just falls back to a plain
  // new booking, matching "I don't want to be the bottleneck": the invitee
  // still gets their new time even if the old-event link is somehow stale.
  let rescheduleSource: { event: GoogleBookingEvent; booking: NotificationBooking } | null = null;
  if (payload.rescheduleToken) {
    const oldEventId = verifyManageToken(payload.rescheduleToken);
    if (oldEventId) {
      const oldEvent = await getCalendarEvent(bookingCalendarIds()[0] ?? "primary", oldEventId).catch(() => null);
      const oldBooking = oldEvent ? bookingFromEvent(oldEvent) : null;
      if (oldEvent && oldBooking && oldBooking.eventSlug === eventType.slug) {
        rescheduleSource = { event: oldEvent, booking: oldBooking };
      }
    }
  }

  // Idempotency FIRST: a retried submit or a double-click returns the
  // booking that already landed instead of falling into the availability
  // check below, which would see our own event as busy time and answer
  // "slot taken" to the very person who took it.
  const existing = await findExistingBooking(payload.email.trim(), payload.slug, payload.startIso).catch(() => null);
  if (existing) {
    return { ok: true, eventId: existing.id, startIso: payload.startIso, joinUrl: existing.props.joinUrl || undefined };
  }

  // Second availability check: re-fetch busy time and re-run the exact slot.
  let busy;
  try {
    busy = await getBusyTimes(payload.startIso, endIso);
  } catch (err) {
    return { ok: false, status: 502, error: `availability_check_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const stillBookable = isSlotBookable(payload.startIso, eventType.duration, busy, new Date(), eventType.horizonDays, eventType.hours);
  if (!stillBookable) {
    return { ok: false, status: 409, error: "slot_no_longer_available" };
  }

  // Zoom meeting must exist before the calendar write, its join link rides
  // in the event description + location field + both emails.
  let joinUrl: string | undefined;
  let meeting: ZoomMeeting | null = null;
  if (location === "zoom") {
    // No per-booking Zoom meeting any more (Joseph order 2026-10-02): every
    // client joins his standing room through the landing page.
    meeting = standingRoom(eventType.slug);
    joinUrl = zoomLandingFor(eventType.slug);
  }

  const description = buildDescription(
    eventType.name,
    location,
    payload.inviteeTz,
    payload.answers ?? {},
    meeting,
    location === "zoom"
  );

  let created;
  try {
    created = await createBookingEvent({
      eventName: eventType.name,
      eventSlug: eventType.slug,
      startIso: payload.startIso,
      endIso,
      inviteeName: payload.name.trim(),
      inviteeEmail: payload.email.trim(),
      inviteePhone: payload.phone?.trim(),
      location,
      locationText: description,
      inviteeTz: payload.inviteeTz,
      answersJson: JSON.stringify(payload.answers ?? {}),
      joinUrl,
      extraPrivateProps: rescheduleSource
        ? { rescheduledFrom: rescheduleSource.event.id, rescheduledFromStart: rescheduleSource.booking.startIso }
        : undefined,
    });
  } catch (err) {
    return { ok: false, status: 502, error: `calendar_write_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Hand the booking to Podio (Networking / Unbound) before the emails go out,
  // so a mail hiccup can never leave the contact record missing. Never throws.
  const podio = await notifyPodio({
    event: "booking.created",
    slug: eventType.slug,
    eventName: eventType.name,
    inviteeName: payload.name.trim(),
    inviteeEmail: payload.email.trim(),
    inviteePhone: payload.phone?.trim(),
    startIso: payload.startIso,
    endIso,
    inviteeTz: payload.inviteeTz,
    location,
    joinUrl,
    answers: payload.answers ?? {},
    calendarEventId: created.id,
    ...(rescheduleSource
      ? { rescheduledFromEventId: rescheduleSource.event.id, rescheduledFromStartIso: rescheduleSource.booking.startIso }
      : {}),
  });
  if (!podio.ok) console.error(`podio_notify_failed slug=${eventType.slug} email=${payload.email.trim()} reason=${podio.reason}`);

  // Reschedule cleanup: the old event is only ever touched AFTER the new
  // one is confirmed created above, so a failed new booking always leaves
  // the old event untouched (spec's explicit requirement). Best-effort past
  // this point -- a Google/Podio hiccup here must never cost the invitee
  // their new booking, which already exists.
  if (rescheduleSource) {
    const oldEvent = rescheduleSource.event;
    const oldBooking = rescheduleSource.booking;
    await patchEventPropsRaw(oldEvent.calendarId, oldEvent.id, oldEvent.etag, { rescheduledTo: created.id }).catch((err) =>
      console.error(`reschedule_old_marker_patch_failed event=${oldEvent.id}`, err)
    );
    // sendUpdates=all: the invitee gets Google's own cancellation email for
    // the old time, same as a plain self-service cancel.
    await deleteCalendarEvent(oldEvent.calendarId, oldEvent.id, "all").catch((err) =>
      console.error(`reschedule_old_delete_failed event=${oldEvent.id}`, err)
    );
    const cancelledWebhook = await notifyPodio({
      event: "booking.cancelled",
      slug: oldBooking.eventSlug,
      eventName: oldBooking.eventName,
      inviteeName: oldBooking.inviteeName,
      inviteeEmail: oldBooking.inviteeEmail,
      startIso: oldBooking.startIso,
      endIso: new Date(Date.parse(oldBooking.startIso) + oldBooking.durationMin * 60_000).toISOString(),
      inviteeTz: oldBooking.inviteeTz,
      location: oldBooking.location,
      calendarEventId: oldEvent.id,
      reason: "rescheduled",
      newStartIso: payload.startIso,
    }).catch((err) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err) }));
    if (!cancelledWebhook.ok) console.error(`podio_notify_failed event=booking.cancelled(rescheduled) id=${oldEvent.id} reason=${cancelledWebhook.reason}`);
  }

  // Third availability check happens implicitly: findExistingBooking above
  // plus Google's own event creation is the final word — there is no
  // payment step in this build (all 9 event types are free) so there is no
  // post-payment re-check to run.

  const notificationData: NotificationBooking = {
    inviteeName: payload.name.trim(),
    inviteeEmail: payload.email.trim(),
    inviteePhone: payload.phone?.trim(),
    eventName: eventType.name,
    eventSlug: eventType.slug,
    startIso: payload.startIso,
    durationMin: eventType.duration,
    inviteeTz: payload.inviteeTz,
    location,
    joinUrl,
    answers: payload.answers ?? {},
  };

  // null when BOOKING_WEBHOOK_SECRET is unset -- confirmationInviteeEmail
  // just omits the "Manage this meeting" line in that case.
  const manageUrls = manageUrlsForEvent(created.id) ?? undefined;
  const inviteeEmail = confirmationInviteeEmail(notificationData, manageUrls);
  // The confirmation email IS the invite: a real text/calendar part makes
  // every mail client show its native add-to-calendar UI (Joseph 2026-08-28
  // -- Siri text-detection fired on one test email and not another; this is
  // deterministic). UID matches Google's invite so accepting never dupes.
  const ics = buildInviteIcs({
    googleEventId: created.id,
    startIso: payload.startIso,
    endIso,
    summary: bookingSummary(eventType.name, payload.name),
    description,
    location: joinUrl ? zoomLandingFor(eventType.slug) : undefined,
    attendees: [{ name: payload.name.trim(), email: payload.email.trim() }],
  });
  // Joseph order 2026-09-06: an Unbound booking is an Unbound email, on both
  // sides. The From ADDRESS stays the authenticated Hana mailbox until
  // hello@unboundmind.ai is a verified send-as alias, so Reply-To carries the
  // Unbound inbox and replies still land in the right place.
  const brand = brandAssets(notificationData);
  await sendEmail({
    to: notificationData.inviteeEmail,
    fromName: brand.fromName,
    fromEmail: brand.fromEmail,
    replyTo: brand.replyTo,
    subject: inviteeEmail.subject,
    text: inviteeEmail.text,
    html: inviteeEmail.html,
    ics,
  }).catch((err) => console.error("[booking] invitee_email_send_error", err));

  // History lookup failure is swallowed — client history is never worth
  // failing a booking over.
  let history: { eventName: string; startIso: string }[] = [];
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - HISTORY_LOOKBACK_YEARS);
    history = await listBookingsByEmail(notificationData.inviteeEmail, since.toISOString());
  } catch {
    history = [];
  }

  // A reschedule gets Joseph the reschedule-worded alert instead of the
  // standard "new booking" one -- one email about one meeting, not two.
  const operatorEmail = rescheduleSource
    ? rescheduledOperatorEmail({
        booking: notificationData,
        oldStartIso: rescheduleSource.booking.startIso,
      })
    : confirmationOperatorEmail({ ...notificationData, history });
  await sendEmail({
    to: process.env.CONTACT_TO || "joseph@hana.events",
    fromName: brand.fromName,
    fromEmail: brand.fromEmail,
    replyTo: notificationData.inviteeEmail,
    subject: operatorEmail.subject,
    text: operatorEmail.text,
    html: operatorEmail.html,
  }).catch((err) => console.error("[booking] operator_email_send_error", err));

  return { ok: true, eventId: created.id, startIso: payload.startIso, joinUrl };
}

export function bookingConfigured(): { google: boolean; zoom: boolean } {
  return { google: isGoogleConfigured(), zoom: isZoomConfigured() };
}
