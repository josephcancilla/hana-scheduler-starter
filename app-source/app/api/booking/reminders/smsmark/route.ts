import { NextRequest, NextResponse } from "next/server";
import { getCalendarEvent, patchBookingMarkers } from "@/lib/booking/google";

// Called by the local Atlas pulse after it delivers a morning text via
// iMessage (the sms=list flow in ../route.ts). Bearer-only, same secret as
// the sweep. Idempotent: marking an already-marked event is a no-op.

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { calendarId?: string; eventId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.calendarId || !body.eventId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const ev = await getCalendarEvent(body.calendarId, body.eventId);
  if (!ev) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }
  if (ev.props.smsMorning) {
    return NextResponse.json({ ok: true, alreadyMarked: true });
  }

  await patchBookingMarkers(ev.calendarId, ev.id, ev.etag, { smsMorning: "1" });
  return NextResponse.json({ ok: true });
}
