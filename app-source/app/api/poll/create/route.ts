import { NextRequest, NextResponse } from "next/server";
import {
  createPoll,
  checkAdminSecret,
  normalizeInviteeEmails,
  sendPollInvites,
  type CreatePollInput,
} from "@/lib/booking/poll";
import { suggestPollTimes } from "@/lib/booking/poll-suggest";

// Admin-only. Requires the CRON_SECRET, either as `Authorization: Bearer`
// or a `secret` field in the JSON body (the /poll/new form posts it as a
// field since Joseph fills a web form, not curl).
//
// Two creation modes (2026-08-28, Joseph's spec):
//   autoTimes: true  -> the engine picks 5 genuinely-open times across the
//                       next 2 weeks, evenly spread (poll-suggest.ts).
//   candidateStartIsos -> manual times, the original path.
// inviteeEmails (up to 20): each gets the branded invitation email with the
// vote link the moment the poll exists. expectedVoters defaults to the
// invitee count so auto-confirm "everyone voted" means everyone invited.

export async function POST(req: NextRequest) {
  let body: Partial<CreatePollInput> & { secret?: string; autoTimes?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!checkAdminSecret(req.headers.get("authorization"), body?.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!body || typeof body !== "object" || !body.title || !body.eventTypeSlug) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const invitees = normalizeInviteeEmails(body.inviteeEmails);
  if (!invitees.ok) {
    return NextResponse.json({ error: invitees.error }, { status: 400 });
  }

  let candidateStartIsos = body.candidateStartIsos;
  if (body.autoTimes) {
    const suggested = await suggestPollTimes(body.eventTypeSlug);
    if (!suggested.ok) {
      return NextResponse.json({ error: suggested.error }, { status: 409 });
    }
    candidateStartIsos = suggested.startIsos;
  }
  if (!candidateStartIsos || candidateStartIsos.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const expectedVoters =
    Number(body.expectedVoters) > 0 ? Number(body.expectedVoters) : invitees.emails.length || 1;

  const result = await createPoll({
    title: body.title,
    eventTypeSlug: body.eventTypeSlug,
    candidateStartIsos,
    expectedVoters,
    autoConfirm: Boolean(body.autoConfirm),
    inviteeEmails: invitees.emails,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const shareUrl = `${req.nextUrl.origin}/poll/${result.pollId}`;

  let invited = 0;
  let inviteFailures: string[] = [];
  if (invitees.emails.length > 0) {
    const blast = await sendPollInvites({
      pollTitle: body.title,
      eventTypeSlug: body.eventTypeSlug,
      candidateStartIsos,
      inviteeEmails: invitees.emails,
      pollUrl: shareUrl,
    });
    invited = blast.sent;
    inviteFailures = blast.failures;
  }

  return NextResponse.json({
    ok: true,
    pollId: result.pollId,
    shareUrl,
    candidates: result.candidates,
    invited,
    inviteFailures,
  });
}
