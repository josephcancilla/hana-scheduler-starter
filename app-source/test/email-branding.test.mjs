import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  confirmedByInviteeOperatorEmail,
  cancelledByInviteeOperatorEmail,
  rescheduledOperatorEmail,
  confirmationInviteeEmail,
  confirmationOperatorEmail,
  pollVoteAlertEmail,
  pollCompleteEmail,
  pollInviteEmail,
} from "../lib/booking/templates.ts";
import { EVENT_TYPES, brandFor } from "../lib/booking/events.ts";

// Regression lock for the 2026-09-08 bugs, both of which shipped silently and
// were only caught by a human looking at his own inbox:
//
//  1. The operator alerts (invitee confirmed / cancelled / rescheduled) built
//     a fully branded email and then sent a bare "<p>one line</p>" instead.
//  2. An Unbound booking could alert Joseph wearing Hana's dark chrome, and
//     the poll vote-alert hardcoded the Hana palette outright.
//  3. The shared shell was locked wider than a phone screen, so the card ran
//     off the side and long values could not wrap.
//
// Nothing in the old suite asserted email CONTENT, which is why all three
// passed 73 green tests. These assert on the rendered html itself.

const HANA_GROUND = "#0A0908";
const UNBOUND_GROUND = "#EBDCBF";

const UNBOUND = EVENT_TYPES.find((e) => e.brand === "unbound");
const HANA = EVENT_TYPES.find((e) => (e.brand ?? "hana") === "hana");

function booking(eventType, overrides = {}) {
  return {
    inviteeName: "Test Person",
    inviteeEmail: "test@example.com",
    eventName: eventType.name,
    eventSlug: eventType.slug,
    startIso: "2026-09-11T18:00:00.000Z",
    durationMin: 60,
    inviteeTz: "America/New_York",
    location: "zoom",
    joinUrl: "https://hana-events.zoom.us",
    answers: {},
    ...overrides,
  };
}

/** Every builder that can reach a human, with a booking-shaped input. */
const BOOKING_BUILDERS = [
  ["confirmedByInviteeOperatorEmail", confirmedByInviteeOperatorEmail],
  ["cancelledByInviteeOperatorEmail", cancelledByInviteeOperatorEmail],
  ["confirmationInviteeEmail", confirmationInviteeEmail],
  ["confirmationOperatorEmail", confirmationOperatorEmail],
];

describe("email branding", () => {
  test("fixture sanity: the roster still has both a Hana and an Unbound event type", () => {
    assert.ok(HANA, "no Hana event type found — the rest of this file proves nothing");
    assert.ok(UNBOUND, "no Unbound event type found — the rest of this file proves nothing");
    assert.equal(brandFor({ eventSlug: UNBOUND.slug }), "unbound");
    assert.equal(brandFor({ eventSlug: HANA.slug }), "hana");
  });

  test("unrecognized event types fall back to Hana, never to Unbound", () => {
    assert.equal(brandFor({ eventSlug: "no-such-slug" }), "hana");
    assert.equal(brandFor({}), "hana");
  });

  for (const [name, build] of BOOKING_BUILDERS) {
    test(`${name} renders a real branded email, not a bare paragraph`, () => {
      const out = build(booking(HANA));
      assert.ok(out.html.includes("<!DOCTYPE html>"), `${name}: html is not a full document`);
      assert.ok(out.html.includes(HANA_GROUND), `${name}: html carries no brand palette`);
      assert.ok(out.html.length > 800, `${name}: html is suspiciously short (${out.html.length} chars)`);
      assert.ok(out.text.trim().length > 0, `${name}: empty text part`);
    });

    test(`${name} wears Unbound on an Unbound booking and no Hana chrome`, () => {
      const out = build(booking(UNBOUND));
      assert.ok(out.html.includes(UNBOUND_GROUND), `${name}: Unbound booking is missing the Unbound palette`);
      assert.ok(!out.html.includes(HANA_GROUND), `${name}: Unbound booking leaked Hana chrome`);
    });
  }

  test("rescheduledOperatorEmail brands off the booking and states both times", () => {
    const unbound = rescheduledOperatorEmail({
      booking: booking(UNBOUND),
      oldStartIso: "2026-09-09T16:00:00.000Z",
    });
    assert.ok(unbound.html.includes(UNBOUND_GROUND));
    assert.ok(!unbound.html.includes(HANA_GROUND));
    // The old time must survive into the body, or he cannot see what moved.
    assert.ok(unbound.html.includes("Was"), "reschedule alert lost the previous time row");
  });

  test("poll emails brand off the poll's own event type", () => {
    const alert = (eventType) =>
      pollVoteAlertEmail({
        pollTitle: "Test poll",
        eventSlug: eventType.slug,
        eventName: eventType.name,
        voterName: "Test Person",
        voterEmail: "test@example.com",
        chosenTimes: ["Fri, Sep 11 at 11:00 AM"],
        tally: [["Fri, Sep 11 at 11:00 AM", 1]],
        votedCount: 1,
        expectedVoters: 2,
        pollUrl: "https://calendar.hana.events/poll/test",
      });
    assert.ok(alert(UNBOUND).html.includes(UNBOUND_GROUND), "poll vote alert ignored the Unbound brand");
    assert.ok(!alert(UNBOUND).html.includes(HANA_GROUND), "poll vote alert leaked Hana chrome");
    assert.ok(alert(HANA).html.includes(HANA_GROUND));

    const complete = pollCompleteEmail({
      pollTitle: "Test poll",
      eventSlug: UNBOUND.slug,
      eventName: UNBOUND.name,
      expectedVoters: 2,
      winnerLabel: "Fri, Sep 11 at 11:00 AM",
      winnerVotes: 2,
      tally: [["Fri, Sep 11 at 11:00 AM", 2]],
      acceptUrl: "https://calendar.hana.events/accept",
      adjustUrl: "https://calendar.hana.events/poll/new",
      pollUrl: "https://calendar.hana.events/poll/test",
    });
    assert.ok(complete.html.includes(UNBOUND_GROUND));

    const invite = pollInviteEmail({
      pollTitle: "Test poll",
      eventSlug: UNBOUND.slug,
      eventName: UNBOUND.name,
      durationMin: 60,
      candidateStartIsos: ["2026-09-11T18:00:00.000Z"],
      pollUrl: "https://calendar.hana.events/poll/test",
    });
    assert.ok(invite.html.includes(UNBOUND_GROUND));
  });

  test("the shell fits a phone: no fixed pixel width can beat the screen", () => {
    const html = confirmedByInviteeOperatorEmail(booking(HANA)).html;
    // The card container must not carry a hard 560px width attribute; that is
    // exactly what pushed the layout off the side of the phone.
    assert.ok(!html.includes('width="560"'), "container is pinned to 560px again");
    assert.ok(html.includes("max-width:560px"), "container lost its max-width cap");
    // The details table must be able to wrap its values.
    assert.ok(html.includes("word-break:break-word"), "detail values can no longer wrap");
    assert.ok(html.includes("max-width:100%"), "logo can overflow a narrow screen");
  });

  test("operator alerts carry the facts Joseph needs to act", () => {
    const out = confirmedByInviteeOperatorEmail(
      booking(HANA, { inviteePhone: "480-555-0134" })
    );
    for (const label of ["WHO", "CONTACT", "WHEN", "WHERE"]) {
      assert.ok(out.html.toUpperCase().includes(label), `alert is missing the ${label} row`);
    }
    assert.ok(out.html.includes("480-555-0134"), "alert dropped the phone number");
    assert.ok(out.text.includes("480-555-0134"), "text part dropped the phone number");
  });
});
