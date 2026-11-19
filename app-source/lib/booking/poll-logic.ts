// Pure poll math: parsing, tallying, winner selection, auto-confirm
// threshold. No I/O, no imports, fully unit-testable in isolation — same
// shape as lib/booking/availability.ts, and split out from poll.ts for the
// same reason: Node's test runner resolves relative TS imports by exact
// specifier (no bundler-style extension inference), so a test importing
// poll.ts directly would drag in google.ts/zoom.ts/mail.ts/events.ts and
// their own extensionless imports, which only the Next.js bundler resolves.
// Keeping this file import-free lets `node --test` load it standalone.

export interface PollVote {
  name: string;
  email: string;
  at: string; // ISO
  tz?: string;
}

export function parseVotes(raw: string | undefined): PollVote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.email === "string") : [];
  } catch {
    return [];
  }
}

export interface CandidateTally {
  index: number;
  startIso: string;
  voteCount: number;
}

export function tallyCandidates(candidates: { index: number; startIso: string; votes: PollVote[] }[]): CandidateTally[] {
  return candidates.map((c) => ({ index: c.index, startIso: c.startIso, voteCount: c.votes.length }));
}

/** Most votes wins; ties break to the earliest candidate time. Null on an empty candidate list. */
export function pickWinner(
  candidates: { index: number; startIso: string; votes: PollVote[] }[]
): { index: number; startIso: string } | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    if (c.votes.length > best.votes.length) {
      best = c;
    } else if (c.votes.length === best.votes.length && Date.parse(c.startIso) < Date.parse(best.startIso)) {
      best = c;
    }
  }
  return { index: best.index, startIso: best.startIso };
}

/** Union of voters across every candidate (a person who votes for 3 times is one voter, not three). */
export function distinctVoterEmails(candidates: { votes: PollVote[] }[]): Set<string> {
  const set = new Set<string>();
  for (const c of candidates) for (const v of c.votes) set.add(v.email.toLowerCase());
  return set;
}

export function shouldAutoConfirm(autoConfirm: boolean, distinctVoterCount: number, expectedVoters: number): boolean {
  return autoConfirm && expectedVoters > 0 && distinctVoterCount >= expectedVoters;
}
