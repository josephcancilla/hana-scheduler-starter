// Google Calendar access: OAuth refresh, freeBusy, event create/list/patch.
// Raw REST with fetch, no SDK. BOOKING_MOCK=1 short-circuits every call so
// the app builds and runs with zero external calls and zero credentials.
//
// Google Calendar is the datastore. Everything the system remembers about a
// booking lives in the event's extendedProperties.private. A value over
// 1000 chars is chunked into key_0..key_n (Google's per-property length
// cap) and reassembled on read.

import { zoomLandingFor } from "./zoom.ts";
import { getEventType } from "./events.ts";
import { BUFFER_MIN } from "./availability.ts";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHUNK_SIZE = 1000;

export interface BusyBlock {
  start: string;
  end: string;
}

export interface GoogleBookingEvent {
  id: string;
  etag: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  calendarId: string;
  props: Record<string, string>;
}

function isMock(): boolean {
  return process.env.BOOKING_MOCK === "1";
}

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.ATLAS_GOOGLE_CLIENT_ID &&
      process.env.ATLAS_GOOGLE_CLIENT_SECRET &&
      process.env.ATLAS_GOOGLE_REFRESH_TOKEN
  );
}

/** Comma list. Busy time unions all of them; bookings write to the first. Defaults to "primary". */
export function bookingCalendarIds(): string[] {
  const raw = process.env.BOOKING_CALENDAR_ID ?? "primary";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeCalendarId(): string {
  return bookingCalendarIds()[0] ?? "primary";
}

// --- OAuth -------------------------------------------------------------

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Exported so lib/booking/mail.ts can send Gmail through the same OAuth
 * client + refresh token (the credential needs both calendar and
 * gmail.send scopes — that is a provisioning detail, not this file's job).
 */
export async function getAccessToken(): Promise<string> {
  if (isMock()) return "mock-access-token";
  if (!isGoogleConfigured()) {
    throw new Error("google_not_configured");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ATLAS_GOOGLE_CLIENT_ID!,
      client_secret: process.env.ATLAS_GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.ATLAS_GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_token_refresh_failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function googleFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${CALENDAR_API}${path}`, { ...init, headers });
}

// --- Mock in-process store ----------------------------------------------
// BOOKING_MOCK=1 has no external calendar to write to, so every mock-mode
// create/patch/delete below reads and writes this Map instead. It is the
// same shape the real Calendar API returns (reassembled props, an etag that
// increments on every write for CAS testing) so a mock-mode run and a real
// run exercise identical call sites. Scoped to one Node process — correct
// for a single `next dev`/`next start` instance, which is what every test
// in this build runs against.

interface MockStoredEvent {
  id: string;
  etag: number;
  summary: string;
  start: string;
  end: string;
  transparency: "opaque" | "transparent";
  calendarId: string;
  props: Record<string, string>;
}

// Attached to globalThis, not a plain module-scope variable: Next.js dev
// mode compiles each route handler into its own on-demand webpack module
// instance, so a module-scope Map here would NOT be shared between e.g.
// /api/poll/create and /api/poll/[id] even though both run in the same
// Node process — a poll created by one route would 404 from the other.
// globalThis survives across those separate module instantiations, the
// same trick Next.js itself recommends for dev-mode singletons (Prisma
// clients, connection pools).

interface MockGlobalState {
  eventStore: Map<string, MockStoredEvent>;
  eventCounter: number;
  pollEventCounter: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __hanaBookingMock: MockGlobalState | undefined;
}

function mockState(): MockGlobalState {
  if (!globalThis.__hanaBookingMock) {
    globalThis.__hanaBookingMock = { eventStore: new Map(), eventCounter: 0, pollEventCounter: 0 };
  }
  return globalThis.__hanaBookingMock;
}

// `stored.props` holds RAW (possibly chunked) keys, exactly like the real
// API's extendedProperties.private — reassembleProps below reconstructs
// votes_0..votes_n into a single `votes` key, same as a real fetch.
function mockStoredToBookingEvent(stored: MockStoredEvent): GoogleBookingEvent {
  return {
    id: stored.id,
    etag: `"mock-etag-${stored.etag}"`,
    summary: stored.summary,
    start: stored.start,
    end: stored.end,
    htmlLink: `https://calendar.google.com/mock/${stored.id}`,
    calendarId: stored.calendarId,
    props: reassembleProps(stored.props),
  };
}

// --- extendedProperties chunking ---------------------------------------

export function chunkValue(key: string, value: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (value.length === 0) return out;
  for (let i = 0, idx = 0; i < value.length; i += CHUNK_SIZE, idx++) {
    out[`${key}_${idx}`] = value.slice(i, i + CHUNK_SIZE);
  }
  return out;
}

export function reassembleProps(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw) return {};
  const keys = new Set<string>();
  for (const k of Object.keys(raw)) {
    const m = k.match(/^(.*)_(\d+)$/);
    if (m) keys.add(m[1]);
  }
  const result: Record<string, string> = {};
  for (const key of keys) {
    let idx = 0;
    const parts: string[] = [];
    while (`${key}_${idx}` in raw) {
      parts.push(raw[`${key}_${idx}`]);
      idx++;
    }
    result[key] = parts.join("");
  }
  // Also carry through any unchunked keys (markers like reminder3d="1") untouched.
  for (const [k, v] of Object.entries(raw)) {
    if (!/_(\d+)$/.test(k)) result[k] = v;
  }
  // Single read-back choke point: every stored booking's Zoom link -- even
  // one saved before hana-events.zoom.us existed (us06web.zoom.us,
  // idea8ion.zoom.us) -- comes out canonical here, so every consumer of a
  // GoogleBookingEvent (reminders, poll, manage, reschedule lookups) gets
  // the right host without touching a stored value in Google Calendar.
  // Joseph order 2026-10-02: clients only ever see his landing page at
  // zoom.hana.events, never a stored per-meeting or old-host link.
  if (result.joinUrl) result.joinUrl = zoomLandingFor(result.eventSlug);
  return result;
}

// --- Busy time -----------------------------------------------------------

export async function getBusyTimes(startIso: string, endIso: string): Promise<BusyBlock[]> {
  if (isMock()) return [];
  if (!isGoogleConfigured()) return [];

  const calendarIds = bookingCalendarIds();
  const res = await googleFetch("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      // Widen the window by the buffer so a meeting that ends right where
      // this range starts (or starts right where it ends) is still seen and
      // padded. Without this the booking-time re-check would miss it.
      timeMin: new Date(Date.parse(startIso) - BUFFER_MIN * 60 * 1000).toISOString(),
      timeMax: new Date(Date.parse(endIso) + BUFFER_MIN * 60 * 1000).toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_freebusy_failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    calendars: Record<string, { busy: { start: string; end: string }[] }>;
  };

  const busy: BusyBlock[] = [];
  for (const cal of Object.values(json.calendars ?? {})) {
    for (const b of cal.busy ?? []) {
      busy.push({ start: b.start, end: b.end });
    }
  }
  return busy;
}

// --- Booking existence (idempotency) -------------------------------------

/**
 * Looks for an existing booking on the write calendar matching invitee
 * email + event slug + exact start time. Calendar-as-database idempotency:
 * a retried submit or a double-click never creates a second event.
 */
export async function findExistingBooking(
  inviteeEmail: string,
  eventSlug: string,
  startIso: string
): Promise<GoogleBookingEvent | null> {
  if (isMock()) {
    const startMs = Date.parse(startIso);
    const match = Array.from(mockState().eventStore.values()).find((s) => {
      if (s.props.hanaBooking !== "1") return false;
      const assembled = reassembleProps(s.props);
      if (assembled.eventSlug !== eventSlug) return false;
      if (assembled.inviteeEmail !== inviteeEmail) return false;
      return Math.abs(Date.parse(s.start) - startMs) <= 60_000;
    });
    return match ? mockStoredToBookingEvent(match) : null;
  }
  if (!isGoogleConfigured()) return null;

  const calendarId = writeCalendarId();
  const startMs = Date.parse(startIso);
  const params = new URLSearchParams({
    timeMin: new Date(startMs - 60_000).toISOString(),
    timeMax: new Date(startMs + 60_000).toISOString(),
    singleEvents: "true",
    privateExtendedProperty: "hanaBooking=1",
  });
  // Repeat the param for the second AND'd filter.
  const url = `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}&privateExtendedProperty=${encodeURIComponent(
    `eventSlug_0=${eventSlug}`
  )}`;

  const res = await googleFetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as { items?: RawGoogleEvent[] };
  const match = (json.items ?? []).find((ev) => {
    const props = reassembleProps(ev.extendedProperties?.private);
    return props.inviteeEmail === inviteeEmail;
  });
  if (!match) return null;

  return toBookingEvent(match, calendarId);
}

// --- Create ---------------------------------------------------------------

export interface CreateBookingInput {
  eventName: string;
  eventSlug: string;
  startIso: string;
  endIso: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteePhone?: string;
  location: string;
  locationText: string;
  inviteeTz: string;
  answersJson: string;
  joinUrl?: string;
  /** Extra calendar attendees beyond the primary invitee (poll confirm: every other voter). */
  additionalAttendees?: { name: string; email: string }[];
  /** Extra unchunked extendedProperties.private entries (poll confirm: pollId, pollTitle). */
  extraPrivateProps?: Record<string, string>;
}

/** "Networking 1 to 1: Nik Shehaj + Joseph Cancilla" (+ " + 2 more" for poll groups).
 * Joseph's spec 2026-09-24: meeting type, then their FULL name, then his.
 * Replaced the 2026-08-29 first-names-only format. The one title rule for the
 * calendar event and both invite emails (.ics), so they can never drift. */
export const HOST_FULL_NAME = "Joseph Cancilla";

export function bookingSummary(eventName: string, inviteeName: string, additionalCount = 0): string {
  const invitee = inviteeName.trim().replace(/\s+/g, " ");
  const extra = additionalCount > 0 ? ` + ${additionalCount} more` : "";
  return `${eventName}: ${invitee} + ${HOST_FULL_NAME}${extra}`;
}

/** The meeting type ("Networking 1 to 1") read back off a stored title.
 * Handles the current "<Type>: <Invitee> + Joseph Cancilla" format, the old
 * "<Type> - Joseph + <First>" format still on calendars from before
 * 2026-09-24, and a trailing " CONFIRMED". Only a fallback: the event type's
 * own name (looked up by slug) always wins when the slug is known. */
export function eventNameFromTitle(summary: string): string {
  const title = (summary || "").replace(/\s+CONFIRMED\s*$/, "").trim();
  const cut = [": ", " - "].map((sep) => title.indexOf(sep)).filter((i) => i > 0);
  return cut.length ? title.slice(0, Math.min(...cut)) : title;
}

/** The clean meeting type for any stored booking: the event type's own name
 * when the slug is known, otherwise read off the title. Every place that shows
 * a past or upcoming booking to a person goes through this. */
export function bookingTypeName(summary: string | undefined, eventSlug?: string): string {
  return getEventType(eventSlug || "")?.name || eventNameFromTitle(summary ?? "") || (summary ?? "");
}

export async function createBookingEvent(input: CreateBookingInput): Promise<GoogleBookingEvent> {
  const privateProps: Record<string, string> = {
    hanaBooking: "1",
    inviteeName: input.inviteeName,
    inviteeEmail: input.inviteeEmail,
    inviteePhone: input.inviteePhone ?? "",
    location: input.location,
    inviteeTz: input.inviteeTz,
    joinUrl: input.joinUrl ?? "",
    ...chunkValue("eventSlug", input.eventSlug),
    ...chunkValue("answers", input.answersJson),
    ...(input.extraPrivateProps ?? {}),
  };

  if (isMock()) {
    const state = mockState();
    state.eventCounter += 1;
    const id = `mock-event-${Date.now()}-${state.eventCounter}`;
    console.log("[BOOKING_MOCK] would create calendar event", {
      id,
      summary: bookingSummary(input.eventName, input.inviteeName, (input.additionalAttendees ?? []).length),
      start: input.startIso,
      end: input.endIso,
      attendee: input.inviteeEmail,
      additionalAttendees: (input.additionalAttendees ?? []).map((a) => a.email),
    });
    const calendarId = writeCalendarId();
    const stored: MockStoredEvent = {
      id,
      etag: 1,
      summary: bookingSummary(input.eventName, input.inviteeName, (input.additionalAttendees ?? []).length),
      start: input.startIso,
      end: input.endIso,
      transparency: "opaque",
      calendarId,
      props: privateProps,
    };
    state.eventStore.set(id, stored);
    return mockStoredToBookingEvent(stored);
  }

  if (!isGoogleConfigured()) {
    throw new Error("google_not_configured");
  }

  const calendarId = writeCalendarId();
  const attendees = [
    { email: input.inviteeEmail, displayName: input.inviteeName },
    ...(input.additionalAttendees ?? []).map((a) => ({ email: a.email, displayName: a.name })),
  ];
  const body: Record<string, unknown> = {
    summary: bookingSummary(input.eventName, input.inviteeName, (input.additionalAttendees ?? []).length),
    description: input.locationText,
    location: input.joinUrl || input.inviteePhone || "",
    start: { dateTime: input.startIso, timeZone: "America/Phoenix" },
    end: { dateTime: input.endIso, timeZone: "America/Phoenix" },
    attendees,
    extendedProperties: { private: privateProps },
  };

  const res = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    { method: "POST", body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`google_create_event_failed: ${res.status} ${errBody}`);
  }

  const created = (await res.json()) as RawGoogleEvent;
  return toBookingEvent(created, calendarId);
}

// --- Reminder sweep support -------------------------------------------

/** Every hanaBooking=1 event starting within [windowStartIso, windowEndIso]. */
export async function listUpcomingBookings(windowStartIso: string, windowEndIso: string): Promise<GoogleBookingEvent[]> {
  if (isMock()) {
    const lo = Date.parse(windowStartIso);
    const hi = Date.parse(windowEndIso);
    return Array.from(mockState().eventStore.values())
      .filter((s) => s.props.hanaBooking === "1" && Date.parse(s.end) > lo && Date.parse(s.start) < hi)
      .map(mockStoredToBookingEvent);
  }
  if (!isGoogleConfigured()) return [];

  const calendarId = writeCalendarId();
  const params = new URLSearchParams({
    timeMin: windowStartIso,
    timeMax: windowEndIso,
    singleEvents: "true",
    privateExtendedProperty: "hanaBooking=1",
    maxResults: "250",
  });

  const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_list_upcoming_failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { items?: RawGoogleEvent[] };
  return (json.items ?? []).map((ev) => toBookingEvent(ev, calendarId));
}

/** Past bookings by this email, up to 2 years back. Failure is swallowed by the caller — history is never worth failing a booking over. */
export async function listBookingsByEmail(
  email: string,
  sinceIso: string
): Promise<{ eventName: string; startIso: string }[]> {
  if (isMock()) return [];
  if (!isGoogleConfigured()) return [];

  const calendarId = writeCalendarId();
  const params = new URLSearchParams({
    timeMin: sinceIso,
    timeMax: new Date().toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    privateExtendedProperty: "hanaBooking=1",
    maxResults: "50",
  });

  const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
  if (!res.ok) throw new Error(`google_list_history_failed: ${res.status}`);

  const json = (await res.json()) as { items?: RawGoogleEvent[] };
  return (json.items ?? [])
    .map((ev) => ({ ev, props: reassembleProps(ev.extendedProperties?.private) }))
    .filter(({ props }) => props.inviteeEmail === email)
    .map(({ ev, props }) => ({
      eventName: bookingTypeName(ev.summary, props.eventSlug),
      startIso: ev.start?.dateTime ?? ev.start?.date ?? "",
    }))
    .reverse();
}

/**
 * Patches marker properties onto an event's extendedProperties.private
 * (e.g. reminder3d="1"). Uses If-Match with the caller's etag; on a 412
 * (someone else wrote the event in between) it refetches and retries once
 * with the fresh etag rather than clobbering the concurrent write.
 */
export async function patchBookingMarkers(
  calendarId: string,
  eventId: string,
  etag: string,
  markers: Record<string, string>
): Promise<void> {
  if (isMock()) {
    console.log("[BOOKING_MOCK] would patch markers", { eventId, markers });
    return;
  }
  if (!isGoogleConfigured()) return;

  const attempt = async (useEtag: string): Promise<Response> =>
    googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { "If-Match": useEtag },
      body: JSON.stringify({ extendedProperties: { private: markers } }),
    });

  let res = await attempt(etag);
  if (res.status === 412) {
    const fresh = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (fresh.ok) {
      const freshJson = (await fresh.json()) as RawGoogleEvent;
      res = await attempt(freshJson.etag);
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_patch_markers_failed: ${res.status} ${body}`);
  }
}

// --- Poll support ---------------------------------------------------------
// A poll candidate is a placeholder event on the write calendar:
// transparency "transparent" (FREE, never blocks availability), summary
// "HOLD (poll): <title>", carrying pollId/pollTitle/eventTypeSlug/
// candidateIndex/expectedVoters/autoConfirm/createdAt plus chunked
// votes_0..votes_n in extendedProperties.private. Reading, voting and
// confirming all reuse the same primitives the rest of the engine uses:
// privateExtendedProperty list filters, chunkValue/reassembleProps, and
// etag-based CAS patches.

export interface CreatePollCandidateInput {
  pollId: string;
  pollTitle: string;
  eventTypeSlug: string;
  candidateIndex: number;
  startIso: string;
  endIso: string;
  expectedVoters: number;
  autoConfirm: boolean;
  /** Per-poll secret for the one-click accept link in Joseph's completion email. */
  adminKey?: string;
}

export async function createPollCandidateEvent(input: CreatePollCandidateInput): Promise<GoogleBookingEvent> {
  const summary = `HOLD (poll): ${input.pollTitle}`;
  const privateProps: Record<string, string> = {
    pollCandidate: "1",
    pollId: input.pollId,
    pollTitle: input.pollTitle,
    eventTypeSlug: input.eventTypeSlug,
    candidateIndex: String(input.candidateIndex),
    expectedVoters: String(input.expectedVoters),
    autoConfirm: input.autoConfirm ? "1" : "0",
    adminKey: input.adminKey ?? "",
    createdAt: new Date().toISOString(),
  };

  if (isMock()) {
    const state = mockState();
    state.pollEventCounter += 1;
    const id = `mock-poll-event-${Date.now()}-${state.pollEventCounter}`;
    console.log("[BOOKING_MOCK] would create poll candidate event", { id, summary, start: input.startIso });
    const calendarId = writeCalendarId();
    const stored: MockStoredEvent = {
      id,
      etag: 1,
      summary,
      start: input.startIso,
      end: input.endIso,
      transparency: "transparent",
      calendarId,
      props: privateProps,
    };
    state.eventStore.set(id, stored);
    return mockStoredToBookingEvent(stored);
  }

  if (!isGoogleConfigured()) throw new Error("google_not_configured");

  const calendarId = writeCalendarId();
  const body: Record<string, unknown> = {
    summary,
    transparency: "transparent",
    start: { dateTime: input.startIso, timeZone: "America/Phoenix" },
    end: { dateTime: input.endIso, timeZone: "America/Phoenix" },
    extendedProperties: { private: privateProps },
  };

  const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`google_create_poll_event_failed: ${res.status} ${errBody}`);
  }

  const created = (await res.json()) as RawGoogleEvent;
  return toBookingEvent(created, calendarId);
}

/** Every event (candidate placeholders AND, once confirmed, the real booking) tagged with this pollId. Native filtered list, no index. */
export async function listPollEvents(pollId: string): Promise<GoogleBookingEvent[]> {
  if (isMock()) {
    return Array.from(mockState().eventStore.values())
      .filter((s) => s.props.pollId === pollId)
      .map(mockStoredToBookingEvent);
  }
  if (!isGoogleConfigured()) return [];

  const calendarId = writeCalendarId();
  const params = new URLSearchParams({ singleEvents: "true", maxResults: "50" });
  const url = `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}&privateExtendedProperty=${encodeURIComponent(
    `pollId=${pollId}`
  )}`;

  const res = await googleFetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_list_poll_events_failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { items?: RawGoogleEvent[] };
  return (json.items ?? []).map((ev) => toBookingEvent(ev, calendarId));
}

/** A real (hanaBooking=1) event already tagged with this pollId — the confirm idempotency check. */
export async function findConfirmedPollBooking(pollId: string): Promise<GoogleBookingEvent | null> {
  if (isMock()) {
    const match = Array.from(mockState().eventStore.values()).find(
      (s) => s.props.pollId === pollId && s.props.hanaBooking === "1"
    );
    return match ? mockStoredToBookingEvent(match) : null;
  }
  if (!isGoogleConfigured()) return null;

  const calendarId = writeCalendarId();
  const params = new URLSearchParams({ singleEvents: "true", privateExtendedProperty: "hanaBooking=1" });
  const url = `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}&privateExtendedProperty=${encodeURIComponent(
    `pollId=${pollId}`
  )}`;

  const res = await googleFetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as { items?: RawGoogleEvent[] };
  const first = (json.items ?? [])[0];
  return first ? toBookingEvent(first, calendarId) : null;
}

/** Single-event fetch by id, used to re-read the latest etag + votes before a CAS retry. */
export async function getCalendarEvent(calendarId: string, eventId: string): Promise<GoogleBookingEvent | null> {
  if (isMock()) {
    const stored = mockState().eventStore.get(eventId);
    return stored && stored.calendarId === calendarId ? mockStoredToBookingEvent(stored) : null;
  }
  if (!isGoogleConfigured()) return null;

  const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  if (!res.ok) return null;

  const json = (await res.json()) as RawGoogleEvent;
  return toBookingEvent(json, calendarId);
}

export interface PatchEventPropsResult {
  ok: boolean;
  /** HTTP-style status: 200 on success, 412 on etag conflict, 404 not found, 502/503 on failure. */
  status: number;
  event?: GoogleBookingEvent;
}

/**
 * Raw CAS patch on extendedProperties.private — no built-in retry. Vote
 * writes need custom re-apply-on-conflict semantics (re-read the vote list,
 * fold the new vote back in, patch again) that a blind merge-retry like
 * patchBookingMarkers can't provide, so callers own the retry loop.
 */
export async function patchEventPropsRaw(
  calendarId: string,
  eventId: string,
  etag: string,
  props: Record<string, string>
): Promise<PatchEventPropsResult> {
  if (isMock()) {
    const state = mockState();
    const stored = state.eventStore.get(eventId);
    if (!stored || stored.calendarId !== calendarId) return { ok: false, status: 404 };
    if (`"mock-etag-${stored.etag}"` !== etag) return { ok: false, status: 412 };
    stored.props = { ...stored.props, ...props };
    stored.etag += 1;
    state.eventStore.set(eventId, stored);
    return { ok: true, status: 200, event: mockStoredToBookingEvent(stored) };
  }
  if (!isGoogleConfigured()) return { ok: false, status: 503 };

  const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "If-Match": etag },
    body: JSON.stringify({ extendedProperties: { private: props } }),
  });

  if (res.status === 412) return { ok: false, status: 412 };
  if (!res.ok) return { ok: false, status: res.status };

  const json = (await res.json()) as RawGoogleEvent;
  return { ok: true, status: 200, event: toBookingEvent(json, calendarId) };
}

/**
 * Deletes a candidate placeholder (or any event) outright. Best-effort —
 * callers log failures, never block on them. `sendUpdates` defaults to
 * "none" (poll candidates have no real attendees, so it never mattered
 * before this param existed); the invitee-facing cancel/reschedule paths in
 * lib/booking/manage.ts and lib/booking/perform.ts pass "all" explicitly so
 * the person on the calendar actually gets Google's cancellation email.
 */
export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
  sendUpdates: "all" | "none" = "none"
): Promise<void> {
  if (isMock()) {
    console.log("[BOOKING_MOCK] would delete calendar event", { eventId, sendUpdates });
    mockState().eventStore.delete(eventId);
    return;
  }
  if (!isGoogleConfigured()) return;

  const res = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_delete_event_failed: ${res.status} ${body}`);
  }
}

/**
 * Like patchEventPropsRaw, but can also rewrite the event's `summary` in
 * the same PATCH — the confirm flow needs both the title suffix and the
 * confirmed/confirmedAt private props to land atomically under one etag.
 * `sendUpdates` defaults to "none": confirm's whole point is updating the
 * title without re-emailing the invitee a fresh invite (Joseph's spec).
 */
export async function patchEventSummaryAndProps(
  calendarId: string,
  eventId: string,
  etag: string,
  patch: { summary?: string; props?: Record<string, string> },
  sendUpdates: "all" | "none" = "none"
): Promise<PatchEventPropsResult> {
  if (isMock()) {
    const state = mockState();
    const stored = state.eventStore.get(eventId);
    if (!stored || stored.calendarId !== calendarId) return { ok: false, status: 404 };
    if (`"mock-etag-${stored.etag}"` !== etag) return { ok: false, status: 412 };
    if (patch.summary !== undefined) stored.summary = patch.summary;
    if (patch.props) stored.props = { ...stored.props, ...patch.props };
    stored.etag += 1;
    state.eventStore.set(eventId, stored);
    return { ok: true, status: 200, event: mockStoredToBookingEvent(stored) };
  }
  if (!isGoogleConfigured()) return { ok: false, status: 503 };

  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.props) body.extendedProperties = { private: patch.props };

  const res = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`,
    {
      method: "PATCH",
      headers: { "If-Match": etag },
      body: JSON.stringify(body),
    }
  );

  if (res.status === 412) return { ok: false, status: 412 };
  if (!res.ok) return { ok: false, status: res.status };

  const json = (await res.json()) as RawGoogleEvent;
  return { ok: true, status: 200, event: toBookingEvent(json, calendarId) };
}

// --- Dormant Google Meet path (behind a flag, default off) -------------
// Zoom is the video platform for this build. This exists only so a future
// instance that wants Meet instead of Zoom has the blueprint's approach
// ready without re-deriving it.

export function googleMeetEnabled(): boolean {
  return process.env.BOOKING_GOOGLE_MEET_ENABLED === "1";
}

export function buildConferenceDataRequest(requestId: string) {
  return {
    createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
  };
}

// --- shared -------------------------------------------------------------

interface RawGoogleEvent {
  id: string;
  etag: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function toBookingEvent(ev: RawGoogleEvent, calendarId: string): GoogleBookingEvent {
  return {
    id: ev.id,
    etag: ev.etag,
    summary: ev.summary ?? "",
    start: ev.start?.dateTime ?? ev.start?.date ?? "",
    end: ev.end?.dateTime ?? ev.end?.date ?? "",
    htmlLink: ev.htmlLink ?? "",
    calendarId,
    props: reassembleProps(ev.extendedProperties?.private),
  };
}
