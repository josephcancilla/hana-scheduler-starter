// Meeting polls: Calendly meeting-poll parity, calendar-as-database.
//
// Joseph proposes 3-7 candidate times (each a "HOLD (poll)" placeholder
// event, transparent so it never blocks availability) -> a shareable link
// -> invitees vote with name + email -> Joseph confirms the winner (or
// auto-confirm fires once every expected voter has voted) -> the winner
// books through the same calendar-write primitives the normal booking path
// uses -> every voter is emailed the final time.
//
// No separate poll database exists. A poll's entire state lives on its
// candidate events' extendedProperties.private (read via
// google.ts:listPollEvents) until it is confirmed, at which point the real
// booking event inherits pollId/pollTitle so the poll's identity survives
// the candidates being deleted.

import crypto from "node:crypto";
import { getEventType, type LocationKind } from "./events.ts";
import {
  chunkValue,
  createBookingEvent,
  bookingSummary,
  createPollCandidateEvent,
  deleteCalendarEvent,
  findConfirmedPollBooking,
  getCalendarEvent,
  listBookingsByEmail,
  listPollEvents,
  patchEventPropsRaw,
  type GoogleBookingEvent,
} from "./google.ts";
import { zoomLandingFor, standingRoom } from "./zoom.ts";
import { sendEmail } from "./mail.ts";
import { EMAIL_RE, humanLocation } from "./perform.ts";
import { brandAssets, confirmationOperatorEmail, pollCompleteEmail, pollFinalTimeEmail, pollInviteEmail, pollVoteAlertEmail, type NotificationBooking } from "./templates.ts";
import { buildInviteIcs } from "./ics.ts";
import { zoomNotesBlock } from "./perform.ts";
import type { ZoomMeeting } from "./zoom.ts";
import {
  parseVotes,
  tallyCandidates,
  pickWinner,
  distinctVoterEmails,
  shouldAutoConfirm,
  type PollVote,
  type CandidateTally,
} from "./poll-logic.ts";

export {
  parseVotes,
  tallyCandidates,
  pickWinner,
  distinctVoterEmails,
  shouldAutoConfirm,
  type PollVote,
  type CandidateTally,
} from "./poll-logic.ts";

const MIN_CANDIDATES = 3;
const MAX_INVITEES = 20;
const MAX_CANDIDATES = 7;
const MAX_VOTE_RETRIES = 3;
const MAX_TITLE_LEN = 200;
const MAX_NAME_LEN = 200;
const MAX_EMAIL_LEN = 320;
const HISTORY_LOOKBACK_YEARS = 2;

// --- Admin secret gate ----------------------------------------------------

/** Poll create + confirm both require the CRON_SECRET, either as a Bearer header or a form field (Joseph is filling a web form, not curling). */
export function checkAdminSecret(authorizationHeader: string | null, bodySecret?: string): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (authorizationHeader === `Bearer ${expected}`) return true;
  if (bodySecret && bodySecret === expected) return true;
  return false;
}

// --- Types ------------------------------------------------------------
// PollVote, CandidateTally and the pure tally/winner/auto-confirm helpers
// live in ./poll-logic (see that file's header comment for why they're
// split out) and are re-exported above.

export interface PollCandidate {
  index: number;
  eventId: string;
  calendarId: string;
  etag: string;
  startIso: string;
  endIso: string;
  votes: PollVote[];
}

export type PollStatus = "open" | "confirmed" | "not_found";

export interface PollRecord {
  pollId: string;
  status: PollStatus;
  pollTitle: string;
  eventTypeSlug: string;
  expectedVoters: number;
  autoConfirm: boolean;
  /** Secret behind the one-click accept link in Joseph's completion email. */
  adminKey?: string;
  candidates: PollCandidate[];
  confirmed?: {
    startIso: string;
    eventId: string;
    joinUrl?: string;
  };
}

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= MAX_EMAIL_LEN;
}

// --- Assembly: raw calendar events -> PollRecord ---------------------------

function candidateFromEvent(ev: GoogleBookingEvent): PollCandidate {
  return {
    index: Number(ev.props.candidateIndex ?? "0"),
    eventId: ev.id,
    calendarId: ev.calendarId,
    etag: ev.etag,
    startIso: ev.start,
    endIso: ev.end,
    votes: parseVotes(ev.props.votes),
  };
}

export async function getPoll(pollId: string): Promise<PollRecord | null> {
  const events = await listPollEvents(pollId);
  if (events.length === 0) return null;

  const candidateEvents = events.filter((e) => e.props.pollCandidate === "1");
  const confirmedEvent = events.find((e) => e.props.hanaBooking === "1");

  const meta = candidateEvents[0] ?? confirmedEvent;
  if (!meta) return null;

  const candidates = candidateEvents.map(candidateFromEvent).sort((a, b) => a.index - b.index);

  const record: PollRecord = {
    pollId,
    status: confirmedEvent ? "confirmed" : "open",
    pollTitle: meta.props.pollTitle ?? "",
    // Candidate events carry eventTypeSlug directly; once every candidate
    // is deleted at confirm time, only the real booking event is left and
    // it carries the same slug under the engine's standard "eventSlug" key.
    eventTypeSlug: meta.props.eventTypeSlug ?? meta.props.eventSlug ?? "",
    expectedVoters: Number(meta.props.expectedVoters ?? "0"),
    autoConfirm: meta.props.autoConfirm === "1",
    adminKey: meta.props.adminKey || undefined,
    candidates,
  };

  if (confirmedEvent) {
    record.confirmed = {
      startIso: confirmedEvent.start,
      eventId: confirmedEvent.id,
      joinUrl: confirmedEvent.props.joinUrl || undefined,
    };
  }

  return record;
}

// --- Create -----------------------------------------------------------

export interface CreatePollInput {
  title: string;
  eventTypeSlug: string;
  candidateStartIsos: string[];
  expectedVoters: number;
  autoConfirm: boolean;
  /** Up to 20 guest emails; each gets the branded invitation with the vote link. */
  inviteeEmails?: string[];
}

/** Dedupe (case-insensitive), validate, cap at 20. */
export function normalizeInviteeEmails(raw: string[] | undefined): { ok: true; emails: string[] } | { ok: false; error: string } {
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const r of raw ?? []) {
    const e = (r ?? "").trim();
    if (!e) continue;
    if (!isValidEmail(e)) return { ok: false, error: `invalid_invitee_email: ${e}` };
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(e);
  }
  if (emails.length > MAX_INVITEES) return { ok: false, error: `too_many_invitees: max ${MAX_INVITEES}` };
  return { ok: true, emails };
}

/**
 * The invitation blast. Fires after createPoll succeeds; a single failed
 * send never kills the poll or the other invites — failures are returned
 * so the caller can surface them honestly.
 */
export async function sendPollInvites(input: {
  pollTitle: string;
  eventTypeSlug: string;
  candidateStartIsos: string[];
  inviteeEmails: string[];
  pollUrl: string;
}): Promise<{ sent: number; failures: string[] }> {
  const eventType = getEventType(input.eventTypeSlug);
  const email = pollInviteEmail({
    pollTitle: input.pollTitle,
    eventSlug: input.eventTypeSlug,
    eventName: eventType?.name ?? input.pollTitle,
    durationMin: eventType?.duration ?? 30,
    candidateStartIsos: [...input.candidateStartIsos].sort(),
    pollUrl: input.pollUrl,
  });
  let sent = 0;
  const failures: string[] = [];
  for (const to of input.inviteeEmails) {
    const inviteBrand = brandAssets({ eventSlug: input.eventTypeSlug, eventName: eventType?.name });
    const result = await sendEmail({ to, fromName: inviteBrand.fromName, fromEmail: inviteBrand.fromEmail, replyTo: inviteBrand.replyTo, subject: email.subject, text: email.text, html: email.html }).catch(
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })
    );
    if (result.ok) sent += 1;
    else failures.push(`${to}: ${"error" in result ? result.error : "send_failed"}`);
  }
  return { sent, failures };
}

export type CreatePollResult =
  | { ok: true; pollId: string; candidates: { index: number; startIso: string; endIso: string }[] }
  | { ok: false; status: number; error: string };

function validateCreatePoll(input: CreatePollInput): { ok: true } | { ok: false; error: string } {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "title_required" };
  if (title.length > MAX_TITLE_LEN) return { ok: false, error: "title_too_long" };

  if (!getEventType(input.eventTypeSlug)) return { ok: false, error: "unknown_event_type" };

  const times = input.candidateStartIsos ?? [];
  if (times.length < MIN_CANDIDATES || times.length > MAX_CANDIDATES) {
    return { ok: false, error: `candidate_count_out_of_range: need ${MIN_CANDIDATES}-${MAX_CANDIDATES}` };
  }
  const seen = new Set<string>();
  for (const t of times) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) return { ok: false, error: "invalid_candidate_time" };
    if (seen.has(t)) return { ok: false, error: "duplicate_candidate_time" };
    seen.add(t);
  }

  if (!Number.isInteger(input.expectedVoters) || input.expectedVoters < 1 || input.expectedVoters > 500) {
    return { ok: false, error: "invalid_expected_voters" };
  }

  return { ok: true };
}

export async function createPoll(input: CreatePollInput): Promise<CreatePollResult> {
  const validation = validateCreatePoll(input);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const eventType = getEventType(input.eventTypeSlug)!;
  const pollId = crypto.randomBytes(16).toString("hex");
  const adminKey = crypto.randomBytes(16).toString("hex");
  const title = input.title.trim();

  const candidates: { index: number; startIso: string; endIso: string }[] = [];
  for (let index = 0; index < input.candidateStartIsos.length; index++) {
    const startIso = input.candidateStartIsos[index];
    const endIso = new Date(Date.parse(startIso) + eventType.duration * 60 * 1000).toISOString();
    await createPollCandidateEvent({
      pollId,
      pollTitle: title,
      eventTypeSlug: eventType.slug,
      candidateIndex: index,
      startIso,
      endIso,
      expectedVoters: input.expectedVoters,
      autoConfirm: input.autoConfirm,
      adminKey,
    });
    candidates.push({ index, startIso, endIso });
  }

  return { ok: true, pollId, candidates };
}

// --- Vote ---------------------------------------------------------------

export interface CastVoteInput {
  pollId: string;
  candidateIndexes: number[];
  name: string;
  email: string;
  tz?: string;
}

export type CastVoteResult =
  | { ok: true; autoConfirmed: boolean; confirmedStartIso?: string; tally: CandidateTally[] }
  | { ok: false; status: number; error: string };

/** Re-reads the candidate, folds this voter's entry in (replacing any prior vote from the same email), and CAS-patches. Retries on 412 up to MAX_VOTE_RETRIES. */
async function addVoteToCandidate(
  calendarId: string,
  eventId: string,
  vote: PollVote
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < MAX_VOTE_RETRIES; attempt++) {
    const event = await getCalendarEvent(calendarId, eventId);
    if (!event) return { ok: false, error: "candidate_event_not_found" };

    const existingVotes = parseVotes(event.props.votes);
    const withoutMe = existingVotes.filter((v) => v.email.toLowerCase() !== vote.email.toLowerCase());
    const nextVotes = [...withoutMe, vote];
    const props = chunkValue("votes", JSON.stringify(nextVotes));

    const patch = await patchEventPropsRaw(calendarId, eventId, event.etag, props);
    if (patch.ok) return { ok: true };
    if (patch.status !== 412) return { ok: false, error: `patch_failed_${patch.status}` };
    // 412: someone else wrote this candidate between our read and our
    // write. Loop re-reads the fresh etag + vote list and re-applies.
  }
  return { ok: false, error: "vote_conflict_exhausted_retries" };
}

const PHX = "America/Phoenix";

function fmtPhx(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PHX,
  }).format(new Date(iso));
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://calendar.hana.events";
}

/** Operator emails for Joseph: one per ballot, plus the accept/adjust
 * decision email when the last expected ballot lands (auto-confirm off). */
async function sendVoteAlerts(
  poll: PollRecord,
  voter: { name: string; email: string; indexes: number[] }
): Promise<void> {
  const to = process.env.CONTACT_TO || "joseph@hana.events";
  const pollUrl = `${baseUrl()}/poll/${poll.pollId}`;
  const tally = tallyCandidates(poll.candidates);
  const byIndex = new Map(poll.candidates.map((c) => [c.index, c]));
  const labelFor = (index: number) => {
    const c = byIndex.get(index);
    return c ? fmtPhx(c.startIso) : `option ${index + 1}`;
  };
  const tallyRows: Array<[string, number]> = tally.map((t) => [labelFor(t.index), t.voteCount]);
  const votedCount = distinctVoterEmails(poll.candidates).size;

  const alertEventType = getEventType(poll.eventTypeSlug);
  const alert = pollVoteAlertEmail({
    pollTitle: poll.pollTitle,
    eventSlug: poll.eventTypeSlug,
    eventName: alertEventType?.name,
    voterName: voter.name,
    voterEmail: voter.email,
    chosenTimes: voter.indexes.map(labelFor),
    tally: tallyRows,
    votedCount,
    expectedVoters: poll.expectedVoters,
    pollUrl,
  });
  const alertBrand = brandAssets({ eventSlug: poll.eventTypeSlug, eventName: alertEventType?.name });
  await sendEmail({ to, fromName: alertBrand.fromName, fromEmail: alertBrand.fromEmail, subject: alert.subject, text: alert.text, html: alert.html }).catch((err) =>
    console.error("[booking] poll_vote_alert_send_error", err)
  );

  // The decision email. Auto-confirm polls skip it: confirmPoll fires itself
  // and Joseph gets the booked-time operator email instead.
  if (poll.autoConfirm) return;
  if (votedCount < poll.expectedVoters) return;

  const winner = pickWinner(poll.candidates);
  if (!winner) return;
  const winnerVotes = poll.candidates.find((c) => c.index === winner.index)?.votes.length ?? 0;
  const eventType = getEventType(poll.eventTypeSlug);
  const acceptUrl = `${baseUrl()}/api/poll/${poll.pollId}/confirm?key=${poll.adminKey ?? ""}`;
  const complete = pollCompleteEmail({
    pollTitle: poll.pollTitle,
    eventSlug: poll.eventTypeSlug,
    eventName: eventType?.name ?? poll.pollTitle,
    expectedVoters: poll.expectedVoters,
    winnerLabel: fmtPhx(winner.startIso),
    winnerVotes,
    tally: tallyRows,
    acceptUrl,
    adjustUrl: `${baseUrl()}/poll/new`,
    pollUrl,
  });
  const completeBrand = brandAssets({ eventSlug: poll.eventTypeSlug, eventName: eventType?.name });
  await sendEmail({ to, fromName: completeBrand.fromName, fromEmail: completeBrand.fromEmail, subject: complete.subject, text: complete.text, html: complete.html }).catch((err) =>
    console.error("[booking] poll_complete_email_send_error", err)
  );
}

export async function castVote(input: CastVoteInput): Promise<CastVoteResult> {
  const poll = await getPoll(input.pollId);
  if (!poll) return { ok: false, status: 404, error: "poll_not_found" };
  if (poll.status === "confirmed") return { ok: false, status: 409, error: "poll_already_confirmed" };

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "name_required" };
  if (name.length > MAX_NAME_LEN) return { ok: false, status: 400, error: "name_too_long" };

  const email = (input.email ?? "").trim();
  if (!isValidEmail(email)) return { ok: false, status: 400, error: "invalid_email" };

  const indexes = Array.from(new Set(input.candidateIndexes ?? []));
  if (indexes.length === 0) return { ok: false, status: 400, error: "no_candidates_selected" };

  const byIndex = new Map(poll.candidates.map((c) => [c.index, c]));
  for (const idx of indexes) {
    if (!byIndex.has(idx)) return { ok: false, status: 400, error: `unknown_candidate_index: ${idx}` };
  }

  const vote: PollVote = { name, email, at: new Date().toISOString(), tz: input.tz };

  for (const idx of indexes) {
    const candidate = byIndex.get(idx)!;
    const result = await addVoteToCandidate(candidate.calendarId, candidate.eventId, vote);
    if (!result.ok) return { ok: false, status: 502, error: result.error };
  }

  // Re-read so the tally and the auto-confirm threshold reflect what was
  // just written, not the pre-vote snapshot.
  const refreshed = await getPoll(input.pollId);
  if (!refreshed) return { ok: false, status: 404, error: "poll_not_found" };

  const tally = tallyCandidates(refreshed.candidates);
  const distinct = distinctVoterEmails(refreshed.candidates).size;

  // Joseph's spec 2026-08-29: an email lands on his desk for EVERY submitted
  // ballot, and a decision email the moment the last expected ballot is in.
  // Alert failures never fail the vote itself.
  await sendVoteAlerts(refreshed, { name, email, indexes }).catch((err) =>
    console.error("[booking] poll_vote_alert_error", err)
  );

  let autoConfirmed = false;
  let confirmedStartIso: string | undefined;
  if (shouldAutoConfirm(refreshed.autoConfirm, distinct, refreshed.expectedVoters)) {
    const confirmResult = await confirmPoll({ pollId: input.pollId });
    if (confirmResult.ok) {
      autoConfirmed = true;
      confirmedStartIso = confirmResult.startIso;
    }
    // A failed auto-confirm is not a vote failure — the vote landed either
    // way. Joseph can still confirm manually; the failure is swallowed here
    // and would surface in server logs from confirmPoll's own error paths.
  }

  return { ok: true, autoConfirmed, confirmedStartIso, tally };
}

// --- Confirm --------------------------------------------------------------

export interface ConfirmPollInput {
  pollId: string;
  /** Manual pick from the admin UI. Omitted on auto-confirm, which uses pickWinner(). */
  candidateIndex?: number;
}

export type ConfirmPollResult =
  | { ok: true; alreadyConfirmed: boolean; startIso: string; eventId: string; joinUrl?: string }
  | { ok: false; status: number; error: string };

export async function confirmPoll(input: ConfirmPollInput): Promise<ConfirmPollResult> {
  const poll = await getPoll(input.pollId);
  if (!poll) return { ok: false, status: 404, error: "poll_not_found" };

  // Idempotent no-op: a second confirm call (manual double-tap, or a race
  // between two auto-confirm triggers) finds the real booking already on
  // the calendar and returns it instead of writing again.
  const existing = await findConfirmedPollBooking(input.pollId);
  if (existing) {
    return {
      ok: true,
      alreadyConfirmed: true,
      startIso: existing.start,
      eventId: existing.id,
      joinUrl: existing.props.joinUrl || undefined,
    };
  }

  if (poll.candidates.length === 0) {
    return { ok: false, status: 409, error: "poll_has_no_open_candidates" };
  }

  const winner =
    input.candidateIndex !== undefined
      ? poll.candidates.find((c) => c.index === input.candidateIndex)
      : pickWinner(poll.candidates);
  if (!winner) return { ok: false, status: 400, error: "no_winning_candidate" };

  const winningCandidate = poll.candidates.find((c) => c.index === winner.index) ?? poll.candidates[0];

  const eventType = getEventType(poll.eventTypeSlug);
  if (!eventType) return { ok: false, status: 500, error: "event_type_missing" };

  // Every distinct voter on the poll (not just the winning candidate's
  // voters) is a calendar attendee and gets the final-time email — someone
  // who voted for a losing time still needs to know when it landed.
  const allVotes = poll.candidates.flatMap((c) => c.votes);
  if (allVotes.length === 0) return { ok: false, status: 409, error: "no_votes_cast" };

  const byEmail = new Map<string, PollVote>();
  for (const v of allVotes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (!byEmail.has(v.email.toLowerCase())) byEmail.set(v.email.toLowerCase(), v);
  }
  const distinctVoters = Array.from(byEmail.values());
  const primaryVoter = distinctVoters[0];
  const otherVoters = distinctVoters.slice(1);

  const startIso = winningCandidate.startIso;
  const endIso = winningCandidate.endIso;
  const location: LocationKind = eventType.locations[0];

  let joinUrl: string | undefined;
  let meeting: ZoomMeeting | null = null;
  if (location === "zoom") {
    // No per-booking Zoom meeting (Joseph order 2026-10-02): his standing room.
    meeting = standingRoom(eventType.slug);
    joinUrl = zoomLandingFor(eventType.slug);
  }

  const descriptionLines = [
    `Booked via meeting poll (calendar.hana.events) on ${eventType.name}.`,
    `Location: ${humanLocation(location)}`,
    `Poll: ${poll.pollTitle}`,
    "",
    "Voters:",
    ...distinctVoters.map((v) => `${v.name} <${v.email}>${v.tz ? ` (${v.tz})` : ""}`),
  ];
  if (location === "zoom" && !meeting) descriptionLines.push("", "Zoom unconfigured, send the join link manually.");
  if (meeting) descriptionLines.push("", ...zoomNotesBlock(meeting, zoomLandingFor(eventType.slug)));

  const created = await createBookingEvent({
    eventName: eventType.name,
    eventSlug: eventType.slug,
    startIso,
    endIso,
    inviteeName: primaryVoter.name,
    inviteeEmail: primaryVoter.email,
    location,
    locationText: descriptionLines.join("\n"),
    inviteeTz: primaryVoter.tz || "America/Phoenix",
    answersJson: "{}",
    joinUrl,
    additionalAttendees: otherVoters.map((v) => ({ name: v.name, email: v.email })),
    extraPrivateProps: { pollId: poll.pollId, pollTitle: poll.pollTitle },
  });

  // Delete the winning placeholder + every losing placeholder. The real
  // event above is now the durable record of this poll's outcome.
  for (const candidate of poll.candidates) {
    await deleteCalendarEvent(candidate.calendarId, candidate.eventId).catch((err) =>
      console.error("[booking] poll_candidate_delete_failed", candidate.eventId, err)
    );
  }

  // Operator notification, via the normal template + normal history lookup.
  let history: { eventName: string; startIso: string }[] = [];
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - HISTORY_LOOKBACK_YEARS);
    history = await listBookingsByEmail(primaryVoter.email, since.toISOString());
  } catch {
    history = [];
  }
  const notificationData: NotificationBooking = {
    inviteeName: `${primaryVoter.name}${otherVoters.length ? ` + ${otherVoters.length} more` : ""}`,
    inviteeEmail: primaryVoter.email,
    eventName: eventType.name,
    eventSlug: eventType.slug,
    startIso,
    durationMin: eventType.duration,
    inviteeTz: primaryVoter.tz || "America/Phoenix",
    location,
    joinUrl,
    answers: {},
    history,
  };
  const operatorEmail = confirmationOperatorEmail(notificationData);
  const pollBrand = brandAssets(notificationData);
  await sendEmail({
    to: process.env.CONTACT_TO || "joseph@hana.events",
    fromName: pollBrand.fromName,
    fromEmail: pollBrand.fromEmail,
    subject: operatorEmail.subject,
    text: operatorEmail.text,
    html: operatorEmail.html,
  }).catch((err) => console.error("[booking] poll_operator_email_send_error", err));

  // Every voter gets the minimal final-time email — the only voter-facing
  // poll email that exists (no "vote received" email).
  for (const voter of distinctVoters) {
    const email = pollFinalTimeEmail({
      voterName: voter.name,
      voterEmail: voter.email,
      voterTz: voter.tz || "America/Phoenix",
      eventName: eventType.name,
      eventSlug: eventType.slug,
      startIso,
      durationMin: eventType.duration,
      location,
      joinUrl,
    });
    const ics = buildInviteIcs({
      googleEventId: created.id,
      startIso,
      endIso,
      summary: bookingSummary(eventType.name, voter.name),
      description: descriptionLines.join("\n"),
      location: joinUrl || undefined,
      attendees: distinctVoters.map((v) => ({ name: v.name, email: v.email })),
    });
    await sendEmail({
      to: voter.email,
      fromName: pollBrand.fromName,
      fromEmail: pollBrand.fromEmail,
      replyTo: pollBrand.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ics,
    }).catch((err) => console.error("[booking] poll_voter_email_send_error", voter.email, err));
  }

  return { ok: true, alreadyConfirmed: false, startIso, eventId: created.id, joinUrl };
}
