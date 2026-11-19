// Zoom Server-to-Server OAuth, raw REST, no SDK. All three env vars or
// none — unconfigured means the booking still succeeds; the invitee email
// says the video link will follow by email, and the operator email flags
// "Zoom unconfigured" (see lib/booking/templates.ts locationLine()).

import { brandFor } from "./events.ts";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API = "https://api.zoom.us/v2";

// Zoom's own API (and its old vanity host idea8ion.zoom.us, retired but
// still live as a redirect) hands back join links on us06web.zoom.us or
// idea8ion.zoom.us. Both still work, but Joseph's order 2026-09-03: every
// link this app ever shows a human (email, text, calendar) must read
// hana-events.zoom.us. This is the single rewrite point every join URL
// this app produces or reads back runs through, at creation (below) and at
// every stored-event read-back (lib/booking/google.ts toBookingEvent /
// mockStoredToBookingEvent), so a booking made before this shipped also
// goes out canonical.
const HANA_ZOOM_HOST = "hana-events.zoom.us";
const ZOOM_HOST_RE = /^([a-z0-9-]+\.)?zoom\.us$/i;

/**
 * The one Zoom link clients get: Joseph's Hana landing page, which has the
 * Join Zoom button into his room. Hosted by us at zoom.hana.events (this app,
 * public/zoom-room.html) since 2026-10-02, because the same page at
 * hana-events.zoom.us bounces anyone signed into their own Zoom account to
 * zoom.com before it loads. Eve Whitaker lost a call to that on 2026-10-01.
 */
export const ZOOM_LANDING_URL = "https://zoom.hana.events";

/** Unbound Mind's twin of the landing page (public/zoom-unbound.html), same
 * room. Joseph order 2026-10-02: Unbound bookings look Unbound end to end. */
export const ZOOM_LANDING_URL_UNBOUND = "https://zoom.unboundmind.ai";

/** The landing page for a booking's brand. Anything unrecognized is Hana. */
export function zoomLandingFor(eventSlug?: string, eventName?: string): string {
  return brandFor({ eventSlug, eventName }) === "unbound" ? ZOOM_LANDING_URL_UNBOUND : ZOOM_LANDING_URL;
}

export function canonicalZoomJoinUrl(url: string | null | undefined): typeof url {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!ZOOM_HOST_RE.test(parsed.hostname)) return url;
  // A bare landing-page root (what bookings stored before 2026-10-02 carry)
  // goes to the page we host, so their reminders go out on the new link too.
  if (parsed.hostname.toLowerCase() === HANA_ZOOM_HOST && (parsed.pathname === "/" || parsed.pathname === "")) {
    return ZOOM_LANDING_URL;
  }
  if (!(parsed.pathname.startsWith("/j/") || parsed.pathname.startsWith("/my/"))) return url;
  parsed.hostname = HANA_ZOOM_HOST;
  return parsed.toString();
}

function isMock(): boolean {
  return process.env.BOOKING_MOCK === "1";
}

export function isZoomConfigured(): boolean {
  return Boolean(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getZoomToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const url = `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(
    process.env.ZOOM_ACCOUNT_ID!
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`zoom_token_failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

export interface CreateZoomMeetingInput {
  topic: string;
  startIso: string;
  durationMin: number;
}

export interface ZoomMeeting {
  joinUrl: string;
  meetingId: string;
  /** Human passcode ("801"), from Zoom's create response. The joinUrl already
   * embeds it for one-click join; this is for the written Zoom block. */
  passcode?: string;
}

/**
 * Joseph's standing room, in place of a per-booking Zoom meeting. Joseph order
 * 2026-10-02: stop creating a separate Zoom meeting for every booking -- every
 * client joins his personal room through the landing page, so the per-booking
 * meetings were never used and only cluttered his Zoom meeting list.
 * No Zoom API call.
 */
export function standingRoom(eventSlug?: string): ZoomMeeting {
  return { joinUrl: zoomLandingFor(eventSlug), meetingId: "0000000000" };
}

/** Creates the meeting at booking time. Returns null when unconfigured or on any failure — a booking never fails over a missing Zoom link. */
export async function createZoomMeeting(input: CreateZoomMeetingInput): Promise<ZoomMeeting | null> {
  if (isMock()) {
    const meetingId = `mock-${Date.now()}`;
    console.log("[BOOKING_MOCK] would create Zoom meeting", { topic: input.topic, start: input.startIso });
    return { joinUrl: canonicalZoomJoinUrl(`https://zoom.us/j/${meetingId}`)!, meetingId };
  }

  if (!isZoomConfigured()) return null;

  try {
    const token = await getZoomToken();
    const res = await fetch(`${ZOOM_API}/users/me/meetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        type: 2, // scheduled meeting
        start_time: input.startIso,
        duration: input.durationMin,
        timezone: "America/Phoenix",
        settings: {
          join_before_host: true,
          waiting_room: false,
        },
      }),
    });

    if (!res.ok) {
      console.error("[booking] zoom_create_meeting_failed", res.status, await res.text().catch(() => ""));
      return null;
    }

    const json = (await res.json()) as { join_url: string; id: number; password?: string };
    return { joinUrl: canonicalZoomJoinUrl(json.join_url) ?? json.join_url, meetingId: String(json.id), passcode: json.password };
  } catch (err) {
    console.error("[booking] zoom_create_meeting_error", err);
    return null;
  }
}
