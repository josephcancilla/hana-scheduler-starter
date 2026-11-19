// Invitee self-service: confirm, cancel. (Reschedule's actual work happens
// in lib/booking/perform.ts — it re-runs the normal booking flow with a
// token attached — this file only resolves a token to a booking for the
// hub/confirm/cancel pages and the two non-reschedule actions.)
//
// Every write here is best-effort past the calendar itself: a Podio or
// email hiccup must never leave the invitee's click looking like it failed
// when the calendar already reflects it (same fail-soft posture as
// lib/booking/podio-notify.ts and the rest of this engine).

import {
  bookingCalendarIds,
  getCalendarEvent,
  patchEventPropsRaw,
  patchEventSummaryAndProps,
  deleteCalendarEvent,
  type GoogleBookingEvent,
} from "./google.ts";
import { verifyManageToken } from "./manage-token.ts";
import { bookingFromEvent } from "./reminders.ts";
import { notifyPodio } from "./podio-notify.ts";
import { sendEmail } from "./mail.ts";
import {
  confirmedByInviteeOperatorEmail,
  cancelledByInviteeOperatorEmail,
  brandAssets,
  type EmailContent,
  type NotificationBooking,
} from "./templates.ts";

function writeCalendarId(): string {
  return bookingCalendarIds()[0] ?? "primary";
}

export interface ManagedBooking {
  event: GoogleBookingEvent;
  booking: NotificationBooking;
}

export type LoadManagedResult =
  | { ok: true; managed: ManagedBooking }
  | { ok: false; reason: "invalid_token" | "not_found" };

/** Verifies a manage token and loads the calendar event it names. Never throws — a fetch error reads the same as "not found" to the caller (done-bar item 6: friendly page, never a stack trace). */
export async function loadManagedBooking(token: string | null | undefined): Promise<LoadManagedResult> {
  const eventId = verifyManageToken(token);
  if (!eventId) return { ok: false, reason: "invalid_token" };

  const event = await getCalendarEvent(writeCalendarId(), eventId).catch(() => null);
  if (!event) return { ok: false, reason: "not_found" };

  const booking = bookingFromEvent(event);
  if (!booking) return { ok: false, reason: "not_found" };

  return { ok: true, managed: { event, booking } };
}

/**
 * Sends one of the operator notices to Joseph, fully dressed.
 *
 * This used to take (subject, text) and wrap the text in a bare <p>, which
 * threw away the branded HTML the template had already built and landed a
 * naked one-liner in his inbox (found 2026-09-08, Joseph: "I don't want any
 * emails going out to anyone, confirmation or otherwise, that are plain
 * text"). It now takes the whole EmailContent, so the html can never be
 * dropped again, and carries the booking's own brand on the envelope: an
 * Unbound booking arrives from Unbound, a Hana booking from Hana.
 */
async function ownerEmail(email: EmailContent, booking: NotificationBooking): Promise<void> {
  const to = process.env.CONTACT_TO || "joseph@hana.events";
  const brand = brandAssets(booking);
  await sendEmail({
    to,
    fromName: brand.fromName,
    fromEmail: brand.fromEmail,
    // Replies go to the person who booked, not to the brand inbox — Joseph
    // hits reply on these to talk to the client.
    replyTo: booking.inviteeEmail || brand.replyTo,
    subject: email.subject,
    text: email.text,
    html: email.html,
  }).catch((err) => console.error("[manage] owner_email_send_error", err));
}

export type ConfirmResult =
  | { ok: true; managed: ManagedBooking; alreadyConfirmed: boolean }
  | { ok: false; reason: "invalid_token" | "not_found" | "calendar_write_failed" };

/**
 * Idempotent: a second click (or a retried POST) on an already-confirmed
 * event is a no-op read, never a second " CONFIRMED" suffix and never a
 * second owner email / webhook.
 */
export async function confirmBooking(token: string | null | undefined): Promise<ConfirmResult> {
  const loaded = await loadManagedBooking(token);
  if (!loaded.ok) return loaded;

  const { event, booking } = loaded.managed;

  if (event.props.confirmed === "1") {
    return { ok: true, managed: loaded.managed, alreadyConfirmed: true };
  }

  const newSummary = event.summary.endsWith(" CONFIRMED") ? event.summary : `${event.summary} CONFIRMED`;
  const nowIso = new Date().toISOString();

  // sendUpdates=none: Google Calendar's documented behavior is that this
  // param controls attendee notifications for every write (insert/patch/
  // delete) on an event with attendees — "none" suppresses them regardless
  // of which fields changed, including summary. High confidence; this is
  // exactly the mechanism Joseph's spec calls for ("without resending them
  // the meeting invite").
  const patched = await patchEventSummaryAndProps(
    event.calendarId,
    event.id,
    event.etag,
    { summary: newSummary, props: { confirmed: "1", confirmedAt: nowIso } },
    "none"
  );

  // Never report a confirmation the calendar does not reflect. A failed
  // Google write (etag conflict, 5xx, network) surfaces to the invitee as
  // "try again" and fires NO owner email and NO Podio note, because both
  // would become a permanent false record.
  if (!patched.ok) {
    console.error(`manage_confirm_patch_failed event=${event.id} status=${patched.status}`);
    return { ok: false, reason: "calendar_write_failed" };
  }
  const finalEvent: GoogleBookingEvent =
    patched.event ?? { ...event, summary: newSummary, props: { ...event.props, confirmed: "1", confirmedAt: nowIso } };

  const email = confirmedByInviteeOperatorEmail(booking);
  await ownerEmail(email, booking);

  const podio = await notifyPodio({
    event: "booking.confirmed",
    slug: booking.eventSlug,
    eventName: booking.eventName,
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    startIso: booking.startIso,
    endIso: new Date(Date.parse(booking.startIso) + booking.durationMin * 60_000).toISOString(),
    inviteeTz: booking.inviteeTz,
    location: booking.location,
    joinUrl: booking.joinUrl,
    calendarEventId: event.id,
  }).catch((err) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err) }));
  if (!podio.ok) console.error(`podio_notify_failed event=booking.confirmed id=${event.id} reason=${podio.reason}`);

  return { ok: true, managed: { event: finalEvent, booking }, alreadyConfirmed: false };
}

export type CancelResult =
  | { ok: true; managed: ManagedBooking }
  | { ok: false; reason: "invalid_token" | "not_found" };

export async function cancelBooking(token: string | null | undefined): Promise<CancelResult> {
  const loaded = await loadManagedBooking(token);
  if (!loaded.ok) return loaded;

  const { event, booking } = loaded.managed;
  const nowIso = new Date().toISOString();

  // Patch the cancellation markers BEFORE delete, per spec, so a
  // showDeleted listing on the Mac side still carries who/when even if the
  // delete's own response never makes it back.
  await patchEventPropsRaw(event.calendarId, event.id, event.etag, { cancelledBy: "invitee", cancelledAt: nowIso }).catch((err) =>
    console.error(`manage_cancel_marker_patch_failed event=${event.id}`, err)
  );

  await deleteCalendarEvent(event.calendarId, event.id, "all");

  const email = cancelledByInviteeOperatorEmail(booking);
  await ownerEmail(email, booking);

  const podio = await notifyPodio({
    event: "booking.cancelled",
    slug: booking.eventSlug,
    eventName: booking.eventName,
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    startIso: booking.startIso,
    endIso: new Date(Date.parse(booking.startIso) + booking.durationMin * 60_000).toISOString(),
    inviteeTz: booking.inviteeTz,
    location: booking.location,
    calendarEventId: event.id,
    reason: "invitee_cancelled",
  }).catch((err) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err) }));
  if (!podio.ok) console.error(`podio_notify_failed event=booking.cancelled id=${event.id} reason=${podio.reason}`);

  return { ok: true, managed: loaded.managed };
}
