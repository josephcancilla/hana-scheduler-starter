import { NextRequest, NextResponse } from "next/server";
import { confirmPoll, checkAdminSecret, getPoll } from "@/lib/booking/poll";

// Admin-only (Joseph or auto-confirm calling itself server-side). Requires
// the CRON_SECRET as `Authorization: Bearer` or a `secret` body field.

// GET is the one-tap "Accept & Schedule" button in Joseph's completion
// email. Authenticated by the poll's own adminKey (minted at create, lives
// only in that email + the candidate events) so the CRON_SECRET never rides
// in a mailto-able URL. Confirms the winner, then lands on the poll page,
// which now shows the confirmed time.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = req.nextUrl.searchParams.get("key") ?? "";

  const poll = await getPoll(id);
  if (!poll) return NextResponse.json({ error: "poll_not_found" }, { status: 404 });
  if (!poll.adminKey || key !== poll.adminKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await confirmPoll({ pollId: id });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.redirect(new URL(`/poll/${id}`, req.nextUrl.origin), 302);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { secret?: string; candidateIndex?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (!checkAdminSecret(req.headers.get("authorization"), body?.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await confirmPoll({ pollId: id, candidateIndex: body?.candidateIndex });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    alreadyConfirmed: result.alreadyConfirmed,
    startIso: result.startIso,
    eventId: result.eventId,
    joinUrl: result.joinUrl,
  });
}
