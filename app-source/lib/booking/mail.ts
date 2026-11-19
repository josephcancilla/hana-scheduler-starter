// Outbound email via the Gmail REST API, sending AS joseph@hana.events using
// the same OAuth credential as calendar access (ATLAS_GOOGLE_CLIENT_ID /
// ATLAS_GOOGLE_CLIENT_SECRET / ATLAS_GOOGLE_REFRESH_TOKEN). Raw RFC-2822,
// base64url-encoded, multipart HTML + plain text. No SDK.
//
// lib/booking/resend.ts holds a dormant Resend implementation as an unused
// fallback in case the Gmail-send scope on the shared credential is ever a
// problem — nothing in this build calls it.

import { getAccessToken, isGoogleConfigured } from "./google.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const FROM_ADDRESS = "joseph@hana.events";
const FROM_NAME = "Joseph Cancilla";

export interface SendEmailInput {
  to: string;
  replyTo?: string;
  /**
   * Display name on the From header, per brand.
   */
  fromName?: string;
  /**
   * From ADDRESS. Must be an address this Gmail account is verified to send
   * as, or Gmail silently rewrites it back to the authenticated mailbox.
   * Joseph added hello@unboundmind.ai as a send-as alias on 2026-09-06, which
   * is what lets an Unbound booking actually come FROM Unbound.
   */
  fromEmail?: string;
  subject: string;
  text: string;
  html: string;
  /** iCalendar METHOD:REQUEST content (lib/booking/ics.ts). When present the
   * message is multipart/mixed with a text/calendar part, which is what makes
   * Apple Mail / Gmail / Outlook render their native add-to-calendar UI. */
  ics?: string;
}

function isMock(): boolean {
  return process.env.BOOKING_MOCK === "1";
}

export function isEmailConfigured(): boolean {
  return isGoogleConfigured();
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeHeader(value: string): string {
  // MIME-encode any non-ASCII header value (subjects are ASCII-only by
  // policy already, but this keeps the raw message spec-correct regardless).
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function buildRawMessage(input: SendEmailInput): string {
  const boundary = `hana-boundary-${Date.now()}`;
  const altParts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  if (!input.ics) {
    const headers = [
      `From: ${encodeHeader(input.fromName || FROM_NAME)} <${input.fromEmail || FROM_ADDRESS}>`,
      `To: ${input.to}`,
      input.replyTo ? `Reply-To: ${input.replyTo}` : null,
      `Subject: ${encodeHeader(input.subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter((h): h is string => Boolean(h));
    return [...headers, "", altParts].join("\r\n");
  }

  // multipart/mixed: [ multipart/alternative(text, html), text/calendar ].
  // The calendar part is base64-encoded so no line in the ICS can collide
  // with a MIME boundary or get mangled by transport.
  const mixedBoundary = `hana-mixed-${Date.now()}`;
  const icsB64 = Buffer.from(input.ics, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const headers = [
    `From: ${encodeHeader(input.fromName || FROM_NAME)} <${input.fromEmail || FROM_ADDRESS}>`,
    `To: ${input.to}`,
    input.replyTo ? `Reply-To: ${input.replyTo}` : null,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ].filter((h): h is string => Boolean(h));

  const body = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    altParts,
    "",
    `--${mixedBoundary}`,
    'Content-Type: text/calendar; charset=UTF-8; method=REQUEST; name="invite.ics"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    icsB64,
    "",
    `--${mixedBoundary}--`,
  ].join("\r\n");

  return [...headers, "", body].join("\r\n");
}

/**
 * Last look before anything leaves the building.
 *
 * The 2026-09-08 bugs all had the same shape: a caller quietly handed over a
 * naked or unbranded message and every layer below happily sent it. The test
 * suite now catches that shape at commit time; this catches it in production,
 * where a path nobody tested can still reach.
 *
 * It NEVER blocks the send. A client who booked deserves their confirmation
 * even if it goes out looking wrong, and a guard that eats real mail is a
 * worse failure than an ugly email. It only makes the drift loud in the logs
 * instead of invisible.
 */
function warnIfUnbranded(input: SendEmailInput): void {
  const problems: string[] = [];
  const html = input.html ?? "";
  if (!html.includes("<!DOCTYPE html>")) problems.push("html is not a full document");
  if (html.length < 800) problems.push(`html is only ${html.length} chars`);
  if (/^\s*<p>/.test(html)) problems.push("html looks hand-built rather than a branded template");
  if (!input.fromName || !input.fromEmail) problems.push("no brand-aware sender, this defaults to Hana");
  for (const leak of ["undefined", "null", "NaN", "[object Object]"]) {
    if (input.subject.includes(leak)) problems.push(`subject rendered "${leak}"`);
  }
  if (problems.length > 0) {
    console.error("[booking] UNBRANDED_EMAIL", {
      to: input.to,
      subject: input.subject,
      problems,
    });
  }
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  warnIfUnbranded(input);

  if (isMock()) {
    console.log("[BOOKING_MOCK] would send email", { to: input.to, subject: input.subject });
    return { ok: true, id: `mock-email-${Date.now()}` };
  }

  if (!isGoogleConfigured()) {
    console.warn("[booking] email not configured, skipping send", { to: input.to, subject: input.subject });
    return { ok: false, error: "google_not_configured" };
  }

  try {
    const token = await getAccessToken();
    const raw = base64UrlEncode(buildRawMessage(input));
    const res = await fetch(GMAIL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `gmail_send_failed: ${res.status} ${body}` };
    }

    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
