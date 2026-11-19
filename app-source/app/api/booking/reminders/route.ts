import { NextRequest, NextResponse } from "next/server";
import { runReminderSweep, type SweepWindow, type SmsMode } from "@/lib/booking/reminders";

// Bearer-authorized, idempotent, safe to call often. Vercel's own cron
// sends `Authorization: Bearer $CRON_SECRET` automatically whenever that
// env var exists (see vercel.json). No CORS headers here on purpose — this
// route is never reachable cross-origin, Bearer-only.

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const windowParam = searchParams.get("window");
  const window: SweepWindow = windowParam === "tight" ? "tight" : "daily";

  let now = new Date();
  const testNowParam = searchParams.get("test_now");
  if (testNowParam) {
    const parsed = new Date(testNowParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  // sms=list: return due morning texts for the local pulse to deliver via
  // iMessage instead of attempting (unconfigured) Twilio.
  const smsMode: SmsMode = searchParams.get("sms") === "list" ? "list" : "twilio";

  const result = await runReminderSweep(now, window, smsMode);
  return NextResponse.json(result);
}
