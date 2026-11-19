import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseVotes,
  tallyCandidates,
  pickWinner,
  distinctVoterEmails,
  shouldAutoConfirm,
} from "../lib/booking/poll-logic.ts";
import { chunkValue, reassembleProps } from "../lib/booking/google.ts";

function vote(email, name = "Test Voter", at = "2026-08-28T00:00:00.000Z") {
  return { name, email, at };
}

describe("parseVotes", () => {
  test("empty/undefined input is an empty array", () => {
    assert.deepEqual(parseVotes(undefined), []);
    assert.deepEqual(parseVotes(""), []);
  });

  test("malformed JSON is an empty array, never a throw", () => {
    assert.deepEqual(parseVotes("{not json"), []);
  });

  test("a JSON object (not array) is an empty array", () => {
    assert.deepEqual(parseVotes(JSON.stringify({ email: "a@b.com" })), []);
  });

  test("drops entries with no email field", () => {
    const raw = JSON.stringify([{ name: "A", email: "a@b.com", at: "x" }, { name: "B" }]);
    const parsed = parseVotes(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].email, "a@b.com");
  });

  test("round-trips a normal vote list", () => {
    const votes = [vote("a@b.com", "A"), vote("c@d.com", "C")];
    const parsed = parseVotes(JSON.stringify(votes));
    assert.deepEqual(parsed, votes);
  });
});

describe("vote chunk round-trip (google.ts chunkValue/reassembleProps)", () => {
  test("a short votes list survives a single chunk", () => {
    const votes = [vote("a@b.com"), vote("c@d.com")];
    const json = JSON.stringify(votes);
    const chunked = chunkValue("votes", json);
    assert.equal(Object.keys(chunked).length, 1, "short JSON fits in one chunk");
    const reassembled = reassembleProps(chunked);
    assert.equal(reassembled.votes, json);
    assert.deepEqual(JSON.parse(reassembled.votes), votes);
  });

  test("a long votes list (50 voters) spans multiple 1000-char chunks and reassembles exactly", () => {
    const votes = Array.from({ length: 50 }, (_, i) =>
      vote(`voter${i}@example-with-a-longer-domain-name.com`, `Voter Number ${i} With A Longer Name`, "2026-08-28T00:00:00.000Z")
    );
    const json = JSON.stringify(votes);
    assert.ok(json.length > 1000, "fixture should actually exceed one chunk to be a meaningful test");

    const chunked = chunkValue("votes", json);
    assert.ok(Object.keys(chunked).length > 1, "long JSON should span multiple votes_N keys");

    // Reassembly must not depend on insertion order of the raw keys (PATCH
    // merges are not guaranteed to come back in order from a real API).
    const shuffledEntries = Object.entries(chunked).sort(() => Math.random() - 0.5);
    const shuffledRaw = Object.fromEntries(shuffledEntries);

    const reassembled = reassembleProps(shuffledRaw);
    assert.equal(reassembled.votes, json);
    assert.deepEqual(JSON.parse(reassembled.votes), votes);
  });

  test("chunking is transparent alongside other unchunked poll props", () => {
    const votes = [vote("a@b.com")];
    const raw = {
      ...chunkValue("votes", JSON.stringify(votes)),
      pollId: "abc123",
      candidateIndex: "2",
    };
    const reassembled = reassembleProps(raw);
    assert.deepEqual(JSON.parse(reassembled.votes), votes);
    assert.equal(reassembled.pollId, "abc123");
    assert.equal(reassembled.candidateIndex, "2");
  });
});

describe("tallyCandidates", () => {
  test("counts votes per candidate", () => {
    const candidates = [
      { index: 0, startIso: "2026-09-01T00:00:00.000Z", votes: [vote("a@b.com"), vote("c@d.com")] },
      { index: 1, startIso: "2026-09-02T00:00:00.000Z", votes: [] },
    ];
    const tally = tallyCandidates(candidates);
    assert.deepEqual(tally, [
      { index: 0, startIso: "2026-09-01T00:00:00.000Z", voteCount: 2 },
      { index: 1, startIso: "2026-09-02T00:00:00.000Z", voteCount: 0 },
    ]);
  });
});

describe("pickWinner", () => {
  test("returns null for an empty candidate list", () => {
    assert.equal(pickWinner([]), null);
  });

  test("most votes wins outright", () => {
    const candidates = [
      { index: 0, startIso: "2026-09-03T00:00:00.000Z", votes: [vote("a@b.com")] },
      { index: 1, startIso: "2026-09-01T00:00:00.000Z", votes: [vote("a@b.com"), vote("c@d.com")] },
    ];
    assert.deepEqual(pickWinner(candidates), { index: 1, startIso: "2026-09-01T00:00:00.000Z" });
  });

  test("a tie breaks to the earliest candidate time", () => {
    const candidates = [
      { index: 0, startIso: "2026-09-05T00:00:00.000Z", votes: [vote("a@b.com")] },
      { index: 1, startIso: "2026-09-01T00:00:00.000Z", votes: [vote("c@d.com")] },
      { index: 2, startIso: "2026-09-03T00:00:00.000Z", votes: [vote("e@f.com")] },
    ];
    assert.deepEqual(pickWinner(candidates), { index: 1, startIso: "2026-09-01T00:00:00.000Z" });
  });

  test("a three-way tie still breaks to the single earliest time", () => {
    const candidates = [
      { index: 0, startIso: "2026-09-10T09:00:00.000Z", votes: [vote("a@b.com")] },
      { index: 1, startIso: "2026-09-08T09:00:00.000Z", votes: [vote("c@d.com")] },
      { index: 2, startIso: "2026-09-09T09:00:00.000Z", votes: [vote("e@f.com")] },
    ];
    assert.deepEqual(pickWinner(candidates), { index: 1, startIso: "2026-09-08T09:00:00.000Z" });
  });

  test("zero-vote candidates lose to any candidate with a vote", () => {
    const candidates = [
      { index: 0, startIso: "2026-09-01T00:00:00.000Z", votes: [] },
      { index: 1, startIso: "2026-09-05T00:00:00.000Z", votes: [vote("a@b.com")] },
    ];
    assert.deepEqual(pickWinner(candidates), { index: 1, startIso: "2026-09-05T00:00:00.000Z" });
  });
});

describe("distinctVoterEmails", () => {
  test("a voter who picks multiple candidates counts once", () => {
    const candidates = [
      { votes: [vote("a@b.com"), vote("c@d.com")] },
      { votes: [vote("a@b.com")] },
    ];
    const distinct = distinctVoterEmails(candidates);
    assert.equal(distinct.size, 2);
  });

  test("email comparison is case-insensitive", () => {
    const candidates = [{ votes: [vote("A@B.com"), vote("a@b.com")] }];
    assert.equal(distinctVoterEmails(candidates).size, 1);
  });

  test("empty candidates produce an empty set", () => {
    assert.equal(distinctVoterEmails([]).size, 0);
  });
});

describe("shouldAutoConfirm", () => {
  test("never fires when autoConfirm is off, no matter the vote count", () => {
    assert.equal(shouldAutoConfirm(false, 100, 1), false);
  });

  test("fires the instant distinct voters reach expectedVoters", () => {
    assert.equal(shouldAutoConfirm(true, 3, 3), true);
  });

  test("does not fire below the threshold", () => {
    assert.equal(shouldAutoConfirm(true, 2, 3), false);
  });

  test("fires past the threshold too (a straggler after enough have already voted)", () => {
    assert.equal(shouldAutoConfirm(true, 5, 3), true);
  });

  test("an expectedVoters of 0 never fires (guards a malformed poll, not a real zero-voter poll)", () => {
    assert.equal(shouldAutoConfirm(true, 0, 0), false);
  });
});
