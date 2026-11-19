import { NextRequest, NextResponse } from "next/server";
import { getEventType } from "@/lib/booking/events";
import { computeMonthSlots } from "@/lib/booking/availability";
import { getBusyTimes, isGoogleConfigured } from "@/lib/booking/google";
import { corsHeaders } from "@/lib/booking/cors";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));
  const { searchParams } = new URL(req.url);

  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug_required" }, { status: 400, headers });

  const eventType = getEventType(slug);
  if (!eventType) return NextResponse.json({ error: "unknown_event_type" }, { status: 404, headers });

  const now = new Date();
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const year = yearParam ? Number(yearParam) : now.getUTCFullYear();
  const month = monthParam ? Number(monthParam) : now.getUTCMonth() + 1;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "invalid_month" }, { status: 400, headers });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  let busy: { start: string; end: string }[] = [];
  try {
    busy = await getBusyTimes(monthStart.toISOString(), monthEnd.toISOString());
  } catch {
    return NextResponse.json({ error: "availability_fetch_failed" }, { status: 502, headers });
  }

  const days = computeMonthSlots(year, month, eventType.duration, busy, now, eventType.horizonDays, eventType.hours);
  const configured = isGoogleConfigured() || process.env.BOOKING_MOCK === "1";

  return NextResponse.json(
    {
      configured,
      event: { slug: eventType.slug, name: eventType.name, duration: eventType.duration, locations: eventType.locations },
      year,
      month,
      days,
    },
    { headers }
  );
}
