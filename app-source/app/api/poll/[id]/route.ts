import { NextRequest, NextResponse } from "next/server";
import { getPoll } from "@/lib/booking/poll";
import { getEventType } from "@/lib/booking/events";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const poll = await getPoll(id);
  if (!poll) return NextResponse.json({ error: "poll_not_found" }, { status: 404 });

  const eventType = getEventType(poll.eventTypeSlug);
  return NextResponse.json({
    ok: true,
    pollId: poll.pollId,
    status: poll.status,
    pollTitle: poll.pollTitle,
    eventType: eventType
      ? { slug: eventType.slug, name: eventType.name, duration: eventType.duration, locations: eventType.locations }
      : null,
    candidates: poll.candidates.map((c) => ({
      index: c.index,
      startIso: c.startIso,
      endIso: c.endIso,
      voteCount: c.votes.length,
    })),
    confirmed: poll.confirmed ?? null,
  });
}
