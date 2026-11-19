// Shared date/time display formatting. Used by both server-side templates
// (lib/booking/templates.ts) and the client-side widget/confirmation pages.

/** "Thursday, September 4, 2026 at 9:00 AM MST" style, in the given IANA timeZone. */
export function formatInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
  return `${datePart} at ${timePart}`;
}

/** Short form for subjects/texts: "Sep 4, 9:00 AM MST". Still run through toAscii() before use in a subject line. */
export function formatShortInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
  return `${datePart}, ${timePart}`;
}

// Unicode code points Intl commonly emits that are not ASCII: curly quotes,
// en/em dash, non-breaking space (00A0), thin space (2009), narrow no-break
// space (202F, the one Node inserts before AM/PM).
const CURLY_SINGLE = /[‘’]/g;
const CURLY_DOUBLE = /[“”]/g;
const DASHES = /[–—]/g;
const NONSTANDARD_SPACES = /[   ]/g;

/**
 * Node's Intl formatter sometimes inserts non-ASCII characters (a narrow
 * no-break space before AM/PM, curly punctuation). Email subjects must be
 * ASCII-only, so anything built from Intl output for a subject line runs
 * through this first.
 */
export function toAscii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(DASHES, "-")
    .replace(NONSTANDARD_SPACES, " ")
    .replace(/[^\x00-\x7F]/g, "");
}
