import { NextRequest, NextResponse } from "next/server";
import { confirmBooking, cancelBooking } from "@/lib/booking/manage";
import { formatInZone } from "@/lib/booking/format";

// Same-origin only (the manage page's own client component calls this),
// same reason app/api/booking/reminders/smsmark/route.ts carries no CORS
// headers: this route is never meant to be reachable cross-origin.

export async function POST(req: NextRequest) {
  let body: { token?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const token = body.token;
  const action = body.action;
  if (!token || (action !== "confirm" && action !== "cancel")) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  if (action === "confirm") {
    const result = await confirmBooking(token);
    if (!result.ok) {
      const status = result.reason === "invalid_token" ? 401 : result.reason === "calendar_write_failed" ? 502 : 404;
      return NextResponse.json({ ok: false, error: result.reason }, { status });
    }
    const when = formatInZone(result.managed.booking.startIso, result.managed.booking.inviteeTz);
    return NextResponse.json({ ok: true, when, alreadyConfirmed: result.alreadyConfirmed });
  }

  const result = await cancelBooking(token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: result.reason === "invalid_token" ? 401 : 404 });
  }
  const bookAgainHref = `/${result.managed.booking.eventSlug}`;
  return NextResponse.json({ ok: true, bookAgainHref });
}
