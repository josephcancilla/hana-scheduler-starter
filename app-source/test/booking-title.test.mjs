import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingSummary } from "../lib/booking/google.ts";

// Joseph's order 2026-09-24: calendar titles use full names by default,
// theirs first, then his. One rule for the calendar event and both .ics invites.

test("full names, invitee first, host second", () => {
  assert.equal(bookingSummary("Networking 1 to 1", "Nik Shehaj"), "Networking 1 to 1: Nik Shehaj + Joseph Cancilla");
});

test("keeps multi-part names and collapses stray spaces", () => {
  assert.equal(bookingSummary("Event Discovery Call", "  Mary  Ann   Lopez "), "Event Discovery Call: Mary Ann Lopez + Joseph Cancilla");
});

test("a one-word name still reads cleanly", () => {
  assert.equal(bookingSummary("Unbound Mind AI Session", "Cher"), "Unbound Mind AI Session: Cher + Joseph Cancilla");
});

test("poll groups keep the + N more tail", () => {
  assert.equal(bookingSummary("Networking 1 to 1", "Nik Shehaj", 2), "Networking 1 to 1: Nik Shehaj + Joseph Cancilla + 2 more");
});

test("never falls back to first-name-only", () => {
  assert.doesNotMatch(bookingSummary("Networking 1 to 1", "Zach Crown"), /- Joseph \+ Zach$/);
});

// Confirm / cancel / reschedule emails read the meeting type back off the
// stored calendar title when the slug is unknown. Both title formats, and a
// title the invitee already confirmed, must give back just the type.
import { eventNameFromTitle } from "../lib/booking/google.ts";

test("reads the type back from the new full-name title", () => {
  assert.equal(eventNameFromTitle("Networking 1 to 1: Nik Shehaj + Joseph Cancilla"), "Networking 1 to 1");
});

test("reads the type back from a confirmed title", () => {
  assert.equal(eventNameFromTitle("Unbound Mind AI Session: Nik Shehaj + Joseph Cancilla CONFIRMED"), "Unbound Mind AI Session");
});

test("still reads pre-change titles already on the calendar", () => {
  assert.equal(eventNameFromTitle("West USA Nov 14 Event - Joseph + Nicky CONFIRMED"), "West USA Nov 14 Event");
  assert.equal(eventNameFromTitle("Networking 1 to 1 - Joseph + Alex"), "Networking 1 to 1");
});

test("round-trips every title bookingSummary can produce", () => {
  for (const type of ["Networking 1 to 1", "Photo + Video Planning Call", "Talent or Vendor Interview"]) {
    assert.equal(eventNameFromTitle(bookingSummary(type, "Mary Ann Lopez", 2)), type);
  }
});

// Past-visit history lines in Joseph's "new booking" alert and every
// confirm/cancel/reschedule email use bookingTypeName: the slug's own name
// wins, the title is only a fallback.
import { bookingTypeName } from "../lib/booking/google.ts";

test("slug wins over whatever the title says", () => {
  assert.equal(bookingTypeName("Zoom: Nik Shehaj + Joseph Cancilla", "unbound-mind-ai"), "Unbound Mind AI Session");
});

test("unknown slug falls back to the title", () => {
  assert.equal(bookingTypeName("Networking 1 to 1 - Joseph + Alex CONFIRMED", "retired-slug"), "Networking 1 to 1");
  assert.equal(bookingTypeName("Event Discovery Call: Mary Ann Lopez + Joseph Cancilla", undefined), "Event Discovery Call");
});
