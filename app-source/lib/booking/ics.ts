// iCalendar invite builder. Attached as a text/calendar part to the
// confirmation emails so every mail client (Apple Mail, Gmail, Outlook)
// shows its NATIVE add-to-calendar UI deterministically. Siri's text
// detection is a heuristic and fired on one test email but not another
// (Joseph, 2026-08-28) — a real METHOD:REQUEST part is the guarantee.
//
// The UID is `${googleEventId}@google.com` on purpose: the invitee ALSO
// receives Google Calendar's own invite (they are an attendee on the event,
// sendUpdates=all). Matching Google's UID convention makes clients treat
// our attachment and Google's invite as the same event, so accepting one
// never creates a duplicate.

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface InviteIcsInput {
  /** Google Calendar event id; becomes UID `${id}@google.com`. */
  googleEventId: string;
  startIso: string;
  endIso: string;
  summary: string;
  description: string;
  /** Join URL (or venue) for the LOCATION line. */
  location?: string;
  attendees: { name: string; email: string }[];
}

const ORGANIZER_EMAIL = "joseph@hana.events";
const ORGANIZER_NAME = "Joseph Cancilla";

export function buildInviteIcs(input: InviteIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Hana Events + Experiences//calendar.hana.events//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${input.googleEventId}@google.com`,
    `DTSTAMP:${icsUtc(new Date().toISOString())}`,
    `DTSTART:${icsUtc(input.startIso)}`,
    `DTEND:${icsUtc(input.endIso)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    input.location ? `LOCATION:${icsEscape(input.location)}` : null,
    `ORGANIZER;CN=${icsEscape(ORGANIZER_NAME)}:mailto:${ORGANIZER_EMAIL}`,
    ...input.attendees.map(
      (a) =>
        `ATTENDEE;CN=${icsEscape(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`
    ),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => Boolean(l));
  return lines.join("\r\n");
}
