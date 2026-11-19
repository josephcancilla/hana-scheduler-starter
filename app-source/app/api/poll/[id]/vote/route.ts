import { NextRequest, NextResponse } from "next/server";
import { castVote } from "@/lib/booking/poll";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { name?: string; email?: string; tz?: string; candidateIndexes?: number[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await castVote({
    pollId: id,
    name: body?.name ?? "",
    email: body?.email ?? "",
    tz: body?.tz,
    candidateIndexes: body?.candidateIndexes ?? [],
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    autoConfirmed: result.autoConfirmed,
    confirmedStartIso: result.confirmedStartIso,
    tally: result.tally,
  });
}
