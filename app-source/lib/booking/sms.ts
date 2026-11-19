// Twilio SMS, raw REST, no SDK. All three env vars or none. Launch is
// email-only by design (no client has ever gotten a text from this system),
// so an absent Twilio config is not a degraded state — it is the normal
// starting state, and every call below no-ops cleanly and silently.

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function isMock(): boolean {
  return process.env.BOOKING_MOCK === "1";
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** Loose E.164-ish normalization for US numbers. Returns null when it can't produce something plausible, which is a silent skip, not an error. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isMock()) {
    console.log("[BOOKING_MOCK] would send SMS", { to, body });
    return { ok: true };
  }

  if (!isSmsConfigured()) {
    // Clean, silent no-op. This is the expected state at launch.
    return { ok: false, error: "sms_not_configured" };
  }

  const normalized = normalizePhone(to);
  if (!normalized) {
    return { ok: false, error: "invalid_phone" };
  }

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const basic = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalized,
        From: process.env.TWILIO_FROM!,
        Body: body,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `twilio_send_failed: ${res.status} ${errBody}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
