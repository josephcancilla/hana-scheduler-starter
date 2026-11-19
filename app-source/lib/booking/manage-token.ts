// Signed self-service links for the reminder emails + the confirmation
// email's "Manage this meeting" line. No database: the token IS the proof.
//
// Shape: base64url("<calendarEventId>.<sig16>") where sig16 is the first 16
// hex characters of HMAC-SHA256("manage:<calendarEventId>", BOOKING_WEBHOOK_SECRET).
// Reuses the same secret + signature style as lib/booking/podio-notify.ts
// (hana-booking-signature header) rather than inventing a second secret.
//
// Never expires by design (Joseph's spec: "never expire before the
// meeting") -- there is no timestamp in the token at all, so it stays valid
// for exactly as long as the calendar event itself exists. Deleting the
// event (cancel, or the reschedule delete) is what retires a link.

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "manage:";
const SIG_HEX_LEN = 16;

function sign16(eventId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}${eventId}`).digest("hex").slice(0, SIG_HEX_LEN);
}

/** Signs a manage token for a calendar event id. Returns null when BOOKING_WEBHOOK_SECRET is unset -- a manage link cannot exist without it. */
export function signManageToken(eventId: string): string | null {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret || !eventId) return null;
  const sig = sign16(eventId, secret);
  return Buffer.from(`${eventId}.${sig}`, "utf-8").toString("base64url");
}

/**
 * Verifies a manage token and returns the calendar event id it names, or
 * null if the token is malformed, unsigned, or forged. Never throws --
 * every decode/parse failure is just an invalid token.
 */
export function verifyManageToken(token: string | null | undefined): string | null {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret || !token) return null;

  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;

  const eventId = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  if (providedSig.length !== SIG_HEX_LEN) return null;

  const expectedSig = sign16(eventId, secret);
  const a = Buffer.from(providedSig, "utf-8");
  const b = Buffer.from(expectedSig, "utf-8");
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? eventId : null;
}

export interface ManageUrls {
  /** The self-service hub page: meeting info + all three buttons. */
  hub: string;
  confirm: string;
  reschedule: string;
  cancel: string;
}

function siteBaseUrl(): string {
  // Same convention as lib/booking/poll.ts's baseUrl().
  return process.env.NEXT_PUBLIC_BASE_URL || "https://calendar.hana.events";
}

/** Builds every manage link for one calendar event, or null when unsigned (no BOOKING_WEBHOOK_SECRET). Callers degrade to "no manage links" cleanly. */
export function manageUrlsForEvent(eventId: string): ManageUrls | null {
  const token = signManageToken(eventId);
  if (!token) return null;
  const hub = `${siteBaseUrl()}/manage/${token}`;
  return { hub, confirm: `${hub}?a=confirm`, reschedule: `${hub}?a=reschedule`, cancel: `${hub}?a=cancel` };
}
