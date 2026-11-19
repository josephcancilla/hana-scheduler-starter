import { NextRequest, NextResponse } from "next/server";
import { performBooking, type BookingRequestPayload } from "@/lib/booking/perform";
import { corsHeaders } from "@/lib/booking/cors";

// A cold booking (fresh Google + Zoom tokens, calendar write, two emails)
// can run past the platform's default function timeout, which surfaced to a
// real visitor as "Couldn't reach the booking server" on 2026-08-28.
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));

  let payload: Partial<BookingRequestPayload>;
  try {
    payload = await req.json();
  } catch {
    console.error("[booking] invalid_json on submit");
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers });
  }

  if (!payload || typeof payload !== "object" || !payload.slug || !payload.startIso) {
    console.error(
      `[booking] missing_fields slug=${payload?.slug ?? "<none>"} startIso=${payload?.startIso ?? "<none>"}`
    );
    return NextResponse.json({ error: "missing_fields" }, { status: 400, headers });
  }

  const result = await performBooking(payload as BookingRequestPayload);

  if (!result.ok) {
    // Log every rejection with enough context to diagnose it after the fact
    // without logging PII. Found 2026-10-01 after a Networking submit failed
    // five times with no server-side evidence of which field was rejected.
    console.error(
      `[booking] rejected slug=${payload.slug} status=${result.status} error=${result.error} ` +
        `has_name=${Boolean(payload.name)} has_email=${Boolean(payload.email)} ` +
        `location=${payload.location ?? "<none>"} tz=${payload.inviteeTz ?? "<none>"} ` +
        `startIso=${payload.startIso}`
    );
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }

  return NextResponse.json(
    { ok: true, eventId: result.eventId, startIso: result.startIso, joinUrl: result.joinUrl },
    { headers }
  );
}
