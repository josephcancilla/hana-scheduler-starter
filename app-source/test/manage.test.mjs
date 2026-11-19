import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signManageToken, verifyManageToken, manageUrlsForEvent } from "../lib/booking/manage-token.ts";
import { createBookingEvent, getCalendarEvent } from "../lib/booking/google.ts";
import { confirmBooking, cancelBooking, loadManagedBooking } from "../lib/booking/manage.ts";
import { performBooking } from "../lib/booking/perform.ts";
import { phoenixTimeToUtcMs } from "../lib/booking/availability.ts";

// The reschedule tests book real slots through performBooking, which refuses
// past times. They were pinned to Sept 14-18 2026 and started failing once that
// week passed, so they now book the week that starts on the Monday at least a
// week out (Phoenix time). Offsets keep the original Mon/Tue/Thu/Fri pattern.
function futureWeekday(dayOffset) {
  const phx = new Date(Date.now() - 7 * 3600 * 1000);
  const base = new Date(Date.UTC(phx.getUTCFullYear(), phx.getUTCMonth(), phx.getUTCDate() + 7));
  const toMonday = (8 - base.getUTCDay()) % 7;
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + toMonday + dayOffset));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}


// Everything in this file runs against the in-memory mock calendar
// (BOOKING_MOCK=1) — no real Google/Gmail credential exists in this build,
// and no test here may reach a live network endpoint. The webhook URL is
// pointed at an unreachable loopback port so lib/booking/podio-notify.ts's
// fetch (which fires whenever BOOKING_WEBHOOK_SECRET is set, independent of
// BOOKING_MOCK) fails instantly against a closed local socket instead of
// ever leaving the machine.
process.env.BOOKING_MOCK = "1";
process.env.BOOKING_WEBHOOK_SECRET = "test-secret-do-not-use-in-prod";
process.env.BOOKING_WEBHOOK_URL = "http://127.0.0.1:1/booking";
process.env.CONTACT_TO = "joseph@hana.events";

const DATE_ANSWER_LABEL = "What's the date & time of your event?";

function isoDate(iso) {
  return iso;
}

describe("manage-token sign/verify", () => {
  test("round-trips a normal event id", () => {
    const token = signManageToken("abc123event");
    assert.ok(token, "should produce a token when the secret is configured");
    assert.equal(verifyManageToken(token), "abc123event");
  });

  test("an eventId containing a literal dot still round-trips (split is on the LAST dot)", () => {
    const token = signManageToken("weird.event.id.with.dots");
    assert.equal(verifyManageToken(token), "weird.event.id.with.dots");
  });

  test("two different event ids never produce the same token", () => {
    const a = signManageToken("event-a");
    const b = signManageToken("event-b");
    assert.notEqual(a, b);
  });

  test("returns null (never throws) for garbage input", () => {
    assert.equal(verifyManageToken("not-a-real-token"), null);
    assert.equal(verifyManageToken(""), null);
    assert.equal(verifyManageToken(undefined), null);
    assert.equal(verifyManageToken(null), null);
    assert.equal(verifyManageToken("%%%not-base64%%%"), null);
  });

  test("a tampered signature is rejected", () => {
    const token = signManageToken("abc123event");
    const raw = Buffer.from(token, "base64url").toString("utf-8");
    const dot = raw.lastIndexOf(".");
    const tampered = `${raw.slice(0, dot + 1)}0000000000000000`;
    const tamperedToken = Buffer.from(tampered, "utf-8").toString("base64url");
    assert.equal(verifyManageToken(tamperedToken), null);
  });

  test("a forged eventId with the ORIGINAL signature is rejected (can't just swap the id)", () => {
    const token = signManageToken("real-event-id");
    const raw = Buffer.from(token, "base64url").toString("utf-8");
    const sig = raw.slice(raw.lastIndexOf(".") + 1);
    const forged = Buffer.from(`someone-elses-event-id.${sig}`, "utf-8").toString("base64url");
    assert.equal(verifyManageToken(forged), null);
  });

  test("sign and verify both return null with no BOOKING_WEBHOOK_SECRET configured", () => {
    const saved = process.env.BOOKING_WEBHOOK_SECRET;
    delete process.env.BOOKING_WEBHOOK_SECRET;
    try {
      assert.equal(signManageToken("abc123event"), null);
      assert.equal(verifyManageToken("anything"), null);
    } finally {
      process.env.BOOKING_WEBHOOK_SECRET = saved;
    }
  });

  test("manageUrlsForEvent builds all three action links off the same hub token, and null when unsigned", () => {
    const urls = manageUrlsForEvent("abc123event");
    assert.ok(urls);
    assert.equal(urls.confirm, `${urls.hub}?a=confirm`);
    assert.equal(urls.reschedule, `${urls.hub}?a=reschedule`);
    assert.equal(urls.cancel, `${urls.hub}?a=cancel`);
    assert.equal(verifyManageToken(urls.hub.split("/manage/")[1]), "abc123event");

    const saved = process.env.BOOKING_WEBHOOK_SECRET;
    delete process.env.BOOKING_WEBHOOK_SECRET;
    try {
      assert.equal(manageUrlsForEvent("abc123event"), null);
    } finally {
      process.env.BOOKING_WEBHOOK_SECRET = saved;
    }
  });
});

describe("confirm: title-append idempotency", () => {
  test("first confirm appends CONFIRMED once and sets the marker props; a second confirm never doubles it", async () => {
    const created = await createBookingEvent({
      eventName: "Event Discovery Call",
      eventSlug: "event-discovery-call",
      startIso: isoDate(new Date(phoenixTimeToUtcMs(2026, 9, 14, 10, 0)).toISOString()),
      endIso: isoDate(new Date(phoenixTimeToUtcMs(2026, 9, 14, 10, 30)).toISOString()),
      inviteeName: "Jane Doe",
      inviteeEmail: "jane.confirm-test@example.com",
      location: "zoom",
      locationText: "test event",
      inviteeTz: "America/Denver",
      answersJson: "{}",
      joinUrl: "https://zoom.example/abc",
    });

    const token = signManageToken(created.id);

    const first = await confirmBooking(token);
    assert.equal(first.ok, true);
    assert.equal(first.alreadyConfirmed, false);
    assert.ok(first.managed.event.summary.endsWith(" CONFIRMED"), `expected summary to end with " CONFIRMED", got: ${first.managed.event.summary}`);
    assert.equal(first.managed.event.props.confirmed, "1");
    assert.ok(first.managed.event.props.confirmedAt, "confirmedAt should be set");

    const second = await confirmBooking(token);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyConfirmed, true, "a repeat confirm should read as already-confirmed, not fire again");
    assert.equal(second.managed.event.summary, first.managed.event.summary, "summary must not gain a second CONFIRMED suffix");

    // Belt and suspenders: read the raw stored event and count occurrences.
    const stored = await getCalendarEvent("primary", created.id);
    const occurrences = stored.summary.split(" CONFIRMED").length - 1;
    assert.equal(occurrences, 1, `expected exactly one CONFIRMED suffix, summary was: ${stored.summary}`);
  });

  test("an invalid token never confirms anything", async () => {
    const result = await confirmBooking("garbage-token");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_token");
  });

  test("a well-formed token for an event that doesn't exist returns not_found", async () => {
    const token = signManageToken("event-that-was-never-created");
    const result = await confirmBooking(token);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
  });
});

describe("cancel", () => {
  test("cancel deletes the event; a second load reads as not_found", async () => {
    const created = await createBookingEvent({
      eventName: "Event Discovery Call",
      eventSlug: "event-discovery-call",
      startIso: isoDate(new Date(phoenixTimeToUtcMs(2026, 9, 16, 9, 0)).toISOString()),
      endIso: isoDate(new Date(phoenixTimeToUtcMs(2026, 9, 16, 9, 30)).toISOString()),
      inviteeName: "Cancel Tester",
      inviteeEmail: "cancel-test@example.com",
      location: "phone",
      inviteePhone: "8015551234",
      locationText: "test event",
      inviteeTz: "America/Denver",
      answersJson: "{}",
    });
    const token = signManageToken(created.id);

    const before = await loadManagedBooking(token);
    assert.equal(before.ok, true);

    const cancelled = await cancelBooking(token);
    assert.equal(cancelled.ok, true);

    const after = await getCalendarEvent("primary", created.id);
    assert.equal(after, null, "cancelled event should no longer exist");

    const reload = await loadManagedBooking(token);
    assert.equal(reload.ok, false);
    assert.equal(reload.reason, "not_found");
  });
});

describe("reschedule payload shaping (performBooking)", () => {
  test("creates the new event with rescheduledFrom/rescheduledFromStart, and retires the old event", async () => {
    const oldStart = new Date(phoenixTimeToUtcMs(...futureWeekday(0), 13, 0)).toISOString();
    const first = await performBooking({
      slug: "event-discovery-call",
      startIso: oldStart,
      name: "Reschedule Tester",
      email: "reschedule-test@example.com",
      location: "phone",
      phone: "8015559999",
      answers: { [DATE_ANSWER_LABEL]: "Sometime in October" },
      inviteeTz: "America/Denver",
    });
    assert.equal(first.ok, true, `first booking should succeed, got: ${JSON.stringify(first)}`);
    const oldEventId = first.eventId;

    const token = signManageToken(oldEventId);
    const newStart = new Date(phoenixTimeToUtcMs(...futureWeekday(1), 11, 0)).toISOString();

    const second = await performBooking({
      slug: "event-discovery-call",
      startIso: newStart,
      name: "Reschedule Tester",
      email: "reschedule-test@example.com",
      location: "phone",
      phone: "8015559999",
      answers: { [DATE_ANSWER_LABEL]: "Sometime in October" },
      inviteeTz: "America/Denver",
      rescheduleToken: token,
    });
    assert.equal(second.ok, true, `reschedule booking should succeed, got: ${JSON.stringify(second)}`);
    assert.notEqual(second.eventId, oldEventId, "reschedule must create a NEW event, never reuse the old id");

    const newEvent = await getCalendarEvent("primary", second.eventId);
    assert.ok(newEvent, "new event should exist");
    assert.equal(newEvent.props.rescheduledFrom, oldEventId);
    assert.equal(newEvent.props.rescheduledFromStart, oldStart);

    const oldEvent = await getCalendarEvent("primary", oldEventId);
    assert.equal(oldEvent, null, "the old event must be deleted once the new one exists");
  });

  test("a reschedule token for a different event type is ignored -- falls back to a plain new booking", async () => {
    const oldStart = new Date(phoenixTimeToUtcMs(...futureWeekday(3), 9, 0)).toISOString();
    const original = await performBooking({
      slug: "event-discovery-call",
      startIso: oldStart,
      name: "Cross Type Tester",
      email: "cross-type-test@example.com",
      location: "phone",
      phone: "8015550001",
      answers: { [DATE_ANSWER_LABEL]: "November" },
      inviteeTz: "America/Denver",
    });
    assert.equal(original.ok, true);
    const token = signManageToken(original.eventId);

    // networking-1-to-1 is a different event type than event-discovery-call.
    const result = await performBooking({
      slug: "networking-1-to-1",
      startIso: new Date(phoenixTimeToUtcMs(...futureWeekday(3), 11, 0)).toISOString(),
      name: "Cross Type Tester",
      email: "cross-type-test@example.com",
      location: "zoom",
      answers: {},
      inviteeTz: "America/Denver",
      rescheduleToken: token,
    });
    assert.equal(result.ok, true);

    const newEvent = await getCalendarEvent("primary", result.eventId);
    assert.equal(newEvent.props.rescheduledFrom, undefined, "cross-event-type token must not be honored as a reschedule source");

    // And the original event should be untouched since it was never a valid reschedule source.
    const stillThere = await getCalendarEvent("primary", original.eventId);
    assert.ok(stillThere, "original booking should be untouched when the reschedule token doesn't apply");
  });

  test("a garbage reschedule token is ignored -- still produces a normal successful booking", async () => {
    const result = await performBooking({
      slug: "event-discovery-call",
      startIso: new Date(phoenixTimeToUtcMs(...futureWeekday(4), 9, 0)).toISOString(),
      name: "Garbage Token Tester",
      email: "garbage-token-test@example.com",
      location: "phone",
      phone: "8015550002",
      answers: { [DATE_ANSWER_LABEL]: "December" },
      inviteeTz: "America/Denver",
      rescheduleToken: "not-a-real-token",
    });
    assert.equal(result.ok, true);
    const event = await getCalendarEvent("primary", result.eventId);
    assert.equal(event.props.rescheduledFrom, undefined);
  });
});
