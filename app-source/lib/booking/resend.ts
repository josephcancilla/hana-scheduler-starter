// DORMANT fallback. Not called anywhere in this build — lib/booking/mail.ts
// (Gmail REST, sending as joseph@hana.events on the same OAuth credential as
// calendar access) is the live email path per this build's spec. This file
// exists only so a future instance that wants a dedicated transactional-email
// provider instead of Gmail has the shape ready without re-deriving it.
//
// To activate: set RESEND_API_KEY, swap the import in perform.ts from
// ./mail to ./resend, and drop this comment.

const RESEND_API = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

function isMock(): boolean {
  return process.env.BOOKING_MOCK === "1";
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.BOOKING_FROM);
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (isMock()) {
    console.log("[BOOKING_MOCK] (resend, dormant) would send email", { to: input.to, subject: input.subject });
    return { ok: true, id: `mock-resend-${Date.now()}` };
  }

  if (!isResendConfigured()) {
    return { ok: false, error: "resend_not_configured" };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.BOOKING_FROM,
        to: input.to,
        reply_to: input.replyTo,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `resend_send_failed: ${res.status} ${body}` };
    }

    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
