import { createHmac } from "node:crypto";
import type { LocationKind } from "./events.ts";

// Every confirmed booking is handed to the Mac-side Podio pipe so the person
// lands in Networking (Hana) or the Unbound workspace, with a comment, a paper
// trail and a vault note. Joseph order 2026-09-01, replacing the Calendly
// webhook that used to be the only path into Podio.
//
// Fail-soft on purpose: a Podio outage must never cost a client their booking.
// The receiver acks instantly and does the Podio work out of band, so the
// bounded wait here is only for the network hop.

export interface BookingCreatedPayload {
  event: "booking.created";
  slug: string;
  eventName: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteePhone?: string;
  startIso: string;
  endIso: string;
  inviteeTz: string;
  location: LocationKind;
  joinUrl?: string;
  answers: Record<string, string>;
  calendarEventId: string;
  /** Set only when this booking replaced an earlier one via the self-service Reschedule button. */
  rescheduledFromEventId?: string;
  rescheduledFromStartIso?: string;
}

export interface BookingConfirmedPayload {
  event: "booking.confirmed";
  slug: string;
  eventName: string;
  inviteeName: string;
  inviteeEmail: string;
  startIso: string;
  endIso: string;
  inviteeTz: string;
  location: LocationKind;
  joinUrl?: string;
  calendarEventId: string;
}

export interface BookingCancelledPayload {
  event: "booking.cancelled";
  slug: string;
  eventName: string;
  inviteeName: string;
  inviteeEmail: string;
  startIso: string;
  endIso: string;
  inviteeTz: string;
  location: LocationKind;
  calendarEventId: string;
  reason: "invitee_cancelled" | "rescheduled";
  /** Only set when reason is "rescheduled" — the new event's start time. */
  newStartIso?: string;
}

export type BookingNotifyPayload = BookingCreatedPayload | BookingConfirmedPayload | BookingCancelledPayload;

const RECEIVER_URL = process.env.BOOKING_WEBHOOK_URL || "https://your-crm-webhook.example.com/booking";
const TIMEOUT_MS = 6000;

export async function notifyPodio(payload: BookingNotifyPayload): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "no_secret" };

  const rawBody = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RECEIVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "hana-booking-signature": `t=${t},v1=${v1}` },
      body: rawBody,
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
