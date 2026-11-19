import { test } from "node:test";
import assert from "node:assert/strict";

// Mock calendar + mail only. Nothing here reaches a live service.
process.env.BOOKING_MOCK = "1";

const { createBookingEvent } = await import("../lib/booking/google.ts");
const { runReminderSweep } = await import("../lib/booking/reminders.ts");

// Joseph order 2026-10-17: a guest on a booking gets the same reminder emails
// and morning-of text as the invitee.
test("guests get reminder emails and the morning text", async () => {
  const start = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  start.setUTCHours(17, 0, 0, 0); // 10am Phoenix
  const ev = await createBookingEvent({
    eventName: "Planning Call", eventSlug: "event-discovery-call",
    startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800000).toISOString(),
    inviteeName: "Dani Test", inviteeEmail: "dani@example.com", inviteePhone: "6025550100",
    location: "zoom", locationText: "Zoom", inviteeTz: "America/Phoenix", answersJson: "{}",
    joinUrl: "https://zoom.hana.events",
    extraPrivateProps: { guests: JSON.stringify([
      { name: "Kendall Test", email: "kendall@example.com", phone: "6025550101" },
      { name: "Dup", email: "DANI@example.com" },
    ]) },
  });
  assert.ok(ev.id);

  const day1 = new Date(start.getTime() - 24 * 3600 * 1000);
  const r1 = await runReminderSweep(day1, "tight", "list");
  assert.equal(r1.reminder1dSent, 2, JSON.stringify(r1));

  const day3 = new Date(start.getTime() - 72 * 3600 * 1000);
  const r3 = await runReminderSweep(day3, "tight", "list");
  assert.equal(r3.reminder3dSent, 2, JSON.stringify(r3));

  const morning = new Date(start.getTime() - 2 * 3600 * 1000); // 8am Phoenix
  const rm = await runReminderSweep(morning, "tight", "list");
  const mine = rm.smsDue.filter((d) => d.eventId === ev.id);
  assert.deepEqual(mine.map((d) => d.phone).sort(), ["6025550100", "6025550101"]);
  assert.match(mine.find((d) => d.phone === "6025550101").body, /^Hey Kendall!/);
  assert.match(mine.find((d) => d.phone === "6025550100").body, /zoom\.hana\.events/);
});

test("no guests prop behaves exactly as before", async () => {
  const start = new Date(Date.now() + 40 * 24 * 3600 * 1000);
  start.setUTCHours(18, 0, 0, 0);
  const ev = await createBookingEvent({
    eventName: "Call", eventSlug: "event-discovery-call",
    startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800000).toISOString(),
    inviteeName: "Solo Test", inviteeEmail: "solo@example.com", inviteePhone: "6025550102",
    location: "zoom", locationText: "Zoom", inviteeTz: "America/Phoenix", answersJson: "{}",
    joinUrl: "https://zoom.hana.events",
  });
  const rm = await runReminderSweep(new Date(start.getTime() - 2 * 3600 * 1000), "tight", "list");
  assert.equal(rm.smsDue.filter((d) => d.eventId === ev.id).length, 1);
});
