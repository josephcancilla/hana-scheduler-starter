// Single source of truth for every outbound string the scheduler sends.
// templates/notifications.md is generated FROM these functions (see the
// generator note at the bottom of that file) so the copy Joseph reviews is
// exactly the copy that ships. Nothing here can actually send until real
// Google/Zoom/Twilio credentials exist — see env.example.
//
// Brand voice canon (Hana_Brand_Style_Guide.md / Joseph_Voice.md /
// EMAIL_STANDARDS.md): no em-dash, "&" as connector, never a comma directly
// before "&", ASCII-only subjects, "Hey [First Name]!" greeting, the exact
// signature block below on every client email. Texts are never signed.
//
// HTML design (2026-08-28, Joseph: "nice branded e-mails... based on our
// Hana brand style guide"): Onyx #0A0908 ground, Charcoal #1A1817 card,
// Bone #F1ECE2 type, crimson kept to a hairline accent, silver horizontal
// logo served from this app's own domain. Fonts degrade gracefully in email
// clients: Marcellus -> Georgia serif for display, Jost -> Helvetica for
// body. Layout is table-based with inline styles so Gmail/Apple Mail/Outlook
// all render it. Operator emails to Joseph carry NO signature by his order
// ("I don't want my signature in any incoming e-mails from the scheduler").

import type { LocationKind, BookingBrand } from "./events.ts";
import { brandFor } from "./events.ts";
import { formatInZone, formatShortInZone, toAscii } from "./format.ts";
import type { ManageUrls } from "./manage-token.ts";
import { ZOOM_LANDING_URL, zoomLandingFor } from "./zoom.ts";

export interface NotificationBooking {
  inviteeName: string;
  inviteeEmail: string;
  inviteePhone?: string;
  eventName: string;
  eventSlug: string;
  startIso: string;
  durationMin: number;
  inviteeTz: string;
  location: LocationKind;
  /** Zoom join URL, when Zoom is configured and the location is "zoom". */
  joinUrl?: string;
  answers: Record<string, string>;
  /** Past bookings by this email, most recent first, for the operator email. */
  history?: { eventName: string; startIso: string }[];
}

export const SIGNATURE_BLOCK = `Bringin' the heat,

Joseph Cancilla
HANA Events + Experiences
Executive Director

Office: 555-0100 • Cell: 555-0101
joseph@hana.events • www.hana.events
IG: @the_joseph_cancilla • Hana IG: @hana_around_the_world

Event design that brings people
back to PRESENCE + PURPOSE.

Latest Masterpiece on YouTube: Freedom in the Fire
https://www.youtube.com/watch?v=E3qTY76X1J4&t=4s`;

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

/**
 * Joseph's Zoom link on every touch (3-day email, 1-day email, morning-of
 * text) unless the meeting is in person (Joseph order 2026-09-06). It is his
 * Hana landing page with the Join Zoom button into his room, hosted by us at
 * zoom.hana.events (Joseph order 2026-10-02) -- the old hana-events.zoom.us
 * address bounced visitors signed into their own Zoom to zoom.com.
 */
export const HANA_ZOOM_ROOM = ZOOM_LANDING_URL;

/**
 * The join link for a booking: the per-booking Zoom link when Zoom minted one,
 * otherwise Joseph's standing room. Null ONLY for in-person, where a Zoom link
 * would be wrong. Single source of truth so the three touches cannot drift.
 */
function joinLink(b: NotificationBooking): string | null {
  if (b.location === "in_person") return null;
  // Always the landing page, never whatever link a booking happened to store
  // (older bookings carry hana-events.zoom.us or a per-meeting link). Joseph
  // order 2026-10-02: "I don't want to see anyone get the old one at all."
  // Unbound bookings get the Unbound twin of the page (Joseph 2026-10-02).
  return zoomLandingFor(b.eventSlug, b.eventName);
}

function locationLine(b: NotificationBooking, audience: "invitee" | "operator"): string {
  const link = joinLink(b);
  if (b.location === "zoom") {
    return audience === "invitee"
      ? `We'll meet on Zoom. Join link (same link works from any browser, no app required): ${link}`
      : `Zoom join link: ${link}`;
  }
  if (b.location === "phone") {
    return audience === "invitee"
      ? `I'll call you at ${b.inviteePhone || "the number you gave us"}. If you'd rather meet on video, join here: ${link}`
      : `Phone call. Call ${b.inviteeName} at ${b.inviteePhone || "(no number on file)"}. Zoom backup: ${link}`;
  }
  return audience === "invitee"
    ? "We'll meet in person. I'll follow up with the exact spot."
    : "In-person meeting. Confirm a location with them if one isn't set yet.";
}

function answersBlock(answers: Record<string, string>): string[] {
  const entries = Object.entries(answers).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return [];
  return ["What they told us:", ...entries.map(([k, v]) => `${k.replace(/[?:\s]+$/, "")}: ${v}`)];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Branded HTML shell (shared by every email)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-brand palettes. Joseph order 2026-09-06: an Unbound Mind AI booking must
 * look like Unbound end to end, his operator copy included, never Hana's dark
 * phoenix shell. He keeps the Unbound option on the Hana hub on purpose, so
 * only the notifications change, not the booking flow.
 *
 * Hana is a DARK brand and Unbound is a LIGHT one, which is why the old
 * shared shell read so wrong on an Unbound booking. Every Unbound hex below
 * is a real token pulled from unboundmind.ai's own stylesheet, not a guess.
 */
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export interface Palette {
  /** Page background behind the card. */
  ground: string;
  /** Card background. */
  card: string;
  /** Inner details-panel background. */
  panel: string;
  /** Borders and rules. */
  hairline: string;
  /** Primary type. */
  text: string;
  /** Secondary type. */
  textMuted: string;
  /** Hairline rule across the top of the card. */
  accent: string;
  /** Call-to-action button background & its label color. */
  buttonBg: string;
  buttonText: string;
}

const HANA_PALETTE: Palette = {
  ground: "#0A0908",
  card: "#1A1817",
  panel: "#211E1C",
  hairline: "#332F2B",
  text: "#F1ECE2",
  textMuted: "#B9B1A2",
  accent: "#D63027",
  buttonBg: "#F1ECE2",
  buttonText: "#0A0908",
};

const UNBOUND_PALETTE: Palette = {
  ground: "#EBDCBF",
  card: "#FAF3E4",
  panel: "#EBDCBF",
  hairline: "#CBB694",
  text: "#1F2421",
  textMuted: "#625B50",
  accent: "#C29A52",
  buttonBg: "#2F6F6A",
  buttonText: "#FBF7EF",
};

interface BrandAssets {
  palette: Palette;
  logoUrl: string;
  logoAlt: string;
  /** Rendered width in px. The Unbound mark is a wide wordmark, Hana's is tall. */
  logoWidth: number;
  /** Display name on the From header. */
  fromName: string;
  /** From address. Must be a verified Gmail send-as address on the sending account. */
  fromEmail: string;
  /** Where replies to a client email should land. */
  replyTo: string;
  signatureText: string;
  signatureHtml: string;
}

function hanaSignatureHtml(P: Palette): string {
  return `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${P.text};">Bringin' the heat,</p>
<p style="margin:0 0 2px 0;font-family:${SERIF};font-size:17px;letter-spacing:1px;color:${P.text};">Joseph Cancilla</p>
<p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${P.text};">HANA Events + Experiences</p>
<p style="margin:0 0 12px 0;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${P.textMuted};">Executive Director</p>
<p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${P.textMuted};">Office: 555-0100 &nbsp;&bull;&nbsp; Cell: 555-0101</p>
<p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${P.textMuted};"><a href="mailto:joseph@hana.events" style="color:${P.text};text-decoration:underline;">joseph@hana.events</a> &nbsp;&bull;&nbsp; <a href="https://www.hana.events" style="color:${P.text};text-decoration:underline;">www.hana.events</a></p>
<p style="margin:0 0 14px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${P.textMuted};">IG: <a href="https://www.instagram.com/the_joseph_cancilla/" style="color:${P.text};text-decoration:underline;">@the_joseph_cancilla</a> &nbsp;&bull;&nbsp; Hana IG: <a href="https://www.instagram.com/hana_around_the_world/" style="color:${P.text};text-decoration:underline;">@hana_around_the_world</a></p>
<p style="margin:0 0 14px 0;font-family:${SERIF};font-size:14px;line-height:1.6;letter-spacing:1px;color:${P.textMuted};">Event design that brings people<br />back to <span style="color:${P.text};">PRESENCE + PURPOSE</span>.</p>
<p style="margin:0;font-family:${SANS};font-size:12px;color:${P.textMuted};">Latest Masterpiece: <a href="https://www.youtube.com/watch?v=E3qTY76X1J4&amp;t=4s" style="color:${P.text};text-decoration:underline;">Freedom in the Fire</a></p>`;
}

function unboundSignatureHtml(P: Palette): string {
  return `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${P.text};">Cheers to Freedom,</p>
<p style="margin:0 0 2px 0;font-family:${SERIF};font-size:17px;letter-spacing:1px;color:${P.text};">Joseph Cancilla</p>
<p style="margin:0 0 12px 0;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${P.text};">Unbound Mind AI</p>
<p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${P.textMuted};">O: 555-0100 &nbsp;&bull;&nbsp; C: 555-0101</p>
<p style="margin:0 0 14px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${P.textMuted};"><a href="mailto:joseph@unboundmind.ai" style="color:${P.text};text-decoration:underline;">joseph@unboundmind.ai</a> &nbsp;&bull;&nbsp; <a href="https://www.unboundmind.ai" style="color:${P.text};text-decoration:underline;">www.unboundmind.ai</a></p>
<p style="margin:0;font-family:${SERIF};font-size:14px;line-height:1.6;letter-spacing:1px;color:${P.textMuted};">Know what needs to happen next.</p>`;
}

/** Hana's client signature, verbatim, for the plain-text part. */
export const SIGNATURE_BLOCK_UNBOUND = `Cheers to Freedom,

Joseph Cancilla
Unbound Mind AI

O: 555-0100 • C: 555-0101
joseph@unboundmind.ai • www.unboundmind.ai

Know what needs to happen next.`;

const BRANDS: Record<BookingBrand, BrandAssets> = {
  hana: {
    palette: HANA_PALETTE,
    logoUrl: "https://calendar.hana.events/logo-silver-vertical.png",
    logoAlt: "Hana Events + Experiences",
    logoWidth: 150,
    fromName: "Joseph Cancilla",
    fromEmail: "joseph@hana.events",
    replyTo: "joseph@hana.events",
    signatureText: SIGNATURE_BLOCK,
    signatureHtml: hanaSignatureHtml(HANA_PALETTE),
  },
  unbound: {
    palette: UNBOUND_PALETTE,
    // The horizontal wordmark, teal on transparent, which is the one that
    // reads on Unbound's ivory ground. The white mark in this same folder is
    // white-on-transparent and would be invisible here.
    logoUrl: "https://calendar.hana.events/unbound-mind-horizontal.png",
    logoAlt: "Unbound Mind AI",
    logoWidth: 200,
    fromName: "Joseph Cancilla",
    fromEmail: "hello@unboundmind.ai",
    replyTo: "hello@unboundmind.ai",
    signatureText: SIGNATURE_BLOCK_UNBOUND,
    signatureHtml: unboundSignatureHtml(UNBOUND_PALETTE),
  },
};

/** Everything a caller needs to dress an email in the right brand. */
export function brandAssets(input: { eventSlug?: string; eventName?: string }): BrandAssets {
  return BRANDS[brandFor(input)];
}


interface ShellInput {
  /** Hidden preview line shown next to the subject in inboxes. */
  preheader: string;
  /** Small uppercase label above the heading, e.g. "Booking confirmed". */
  eyebrow: string;
  /** Big serif heading, usually the event name. */
  heading: string;
  /** Pre-built inner HTML blocks (paragraphs, panels, buttons). */
  bodyHtml: string;
  /** Footer HTML: the brand signature for clients, nothing for Joseph. */
  footerHtml: string;
}

/**
 * Every HTML builder is bound to one brand's palette up front, so a template
 * physically cannot mix Hana chrome into an Unbound email. Call sites keep the
 * same helper names by destructuring this kit.
 */
function renderKit(brand: BookingBrand) {
  const A = BRANDS[brand];
  const P = A.palette;

  function para(text: string): string {
    return `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${P.text};">${escapeHtml(text)}</p>`;
  }

  function paraMuted(text: string): string {
    return `<p style="margin:0 0 6px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${P.textMuted};">${escapeHtml(text)}</p>`;
  }

  function detailsPanel(rows: Array<[string, string]>): string {
    const body = rows
      .map(
        ([label, value]) => `<tr>
<td style="padding:6px 14px 6px 0;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${P.textMuted};vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
<td style="padding:6px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${P.text};word-break:break-word;">${escapeHtml(value)}</td>
</tr>`
      )
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${P.panel};border:1px solid ${P.hairline};margin:0 0 20px 0;">
<tr><td style="padding:18px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${body}</table>
</td></tr></table>`;
  }

  function ctaButton(url: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr>
<td style="background-color:${P.buttonBg};">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${P.buttonText};text-decoration:none;">${escapeHtml(label)}</a>
</td>
</tr></table>`;
  }

  /**
   * Location rendering for the HTML body: Zoom gets a join button instead of a
   * bare URL. A phone booking gets one too (Joseph order 2026-09-06), with the
   * copy leading on the call the client actually chose.
   */
  function locationHtml(b: NotificationBooking): string {
    const link = joinLink(b);
    if (b.location === "zoom" && link) {
      return (
        para("We'll meet on Zoom. The same link works from any browser, no app required.") +
        ctaButton(link, "Join the Zoom")
      );
    }
    if (b.location === "phone" && link) {
      return (
        para(`I'll call you at ${b.inviteePhone || "the number you gave us"}. If you'd rather meet on video, use this:`) +
        ctaButton(link, "Join the Zoom")
      );
    }
    return para(locationLine(b, "invitee"));
  }

  function brandedShell(input: ShellInput): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="${brand === "unbound" ? "light" : "dark"}" />
<style>
@media only screen and (max-width:480px) {
  .card { padding:26px 20px 24px 20px !important; }
  .h1 { font-size:22px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${P.ground};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${P.ground};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td align="center" style="padding:8px 0 24px 0;">
      <img src="${A.logoUrl}" alt="${escapeHtml(A.logoAlt)}" width="${A.logoWidth}" style="display:block;width:${A.logoWidth}px;max-width:100%;height:auto;border:0;" />
    </td></tr>
    <tr><td class="card" style="background-color:${P.card};border:1px solid ${P.hairline};border-top:2px solid ${P.accent};padding:36px 36px 32px 36px;">
      <p style="margin:0 0 10px 0;font-family:${SANS};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${P.textMuted};">${escapeHtml(input.eyebrow)}</p>
      <h1 class="h1" style="margin:0 0 22px 0;font-family:${SERIF};font-weight:normal;font-size:26px;line-height:1.3;letter-spacing:1px;color:${P.text};">${escapeHtml(input.heading)}</h1>
      ${input.bodyHtml}
    </td></tr>
    <tr><td style="padding:26px 36px 24px 36px;">
      ${input.footerHtml}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  }

  return {
    para,
    paraMuted,
    detailsPanel,
    ctaButton,
    locationHtml,
    brandedShell,
    signatureHtml: A.signatureHtml,
    signatureText: A.signatureText,
  };
}

/** Operator emails carry no signature and no footer line at all (Joseph's orders, 2026-08-28). */
function operatorFooterHtml(): string {
  return "";
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Shared when/where rows for client emails. */
function inviteeDetailRows(b: NotificationBooking, when: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["When", when],
    ["Length", `${b.durationMin} minutes`],
  ];
  if (b.location === "zoom") rows.push(["Where", "Zoom"]);
  else if (b.location === "phone") rows.push(["Where", `Phone, I'll call ${b.inviteePhone || "you"}`]);
  else rows.push(["Where", "In person"]);
  return rows;
}

/** Confirmation email to the person who booked. Their own timezone only. */
export function confirmationInviteeEmail(b: NotificationBooking, manageUrls?: ManageUrls): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(b));
  const when = formatInZone(b.startIso, b.inviteeTz);
  const shortWhen = toAscii(formatShortInZone(b.startIso, b.inviteeTz));
  const subject = toAscii(`Confirmed: ${b.eventName}, ${shortWhen}`);

  const lines = [
    `Hey ${firstName(b.inviteeName)}!`,
    "",
    `You're booked for ${b.eventName}, ${when}.`,
    "",
    locationLine(b, "invitee"),
    "",
    "If anything comes up, just reply to this email & we'll get it moved.",
    "",
    "Check your spam folder if a calendar invite doesn't show up in the next few minutes.",
  ];
  if (manageUrls) lines.push("", `Need to confirm, reschedule or cancel? Manage this meeting: ${manageUrls.hub}`);
  const text = [...lines, "", signatureText].join("\n");

  const bodyHtml =
    para(`Hey ${firstName(b.inviteeName)}! You're locked in.`) +
    detailsPanel(inviteeDetailRows(b, when)) +
    locationHtml(b) +
    para("If anything comes up, just reply to this email & we'll get it moved.") +
    paraMuted("A calendar invite is on its way. Check your spam folder if it doesn't show up in the next few minutes.") +
    (manageUrls
      ? paraMuted(`Need to confirm, reschedule or cancel? Manage this meeting: ${manageUrls.hub}`)
      : "");

  const html = brandedShell({
    preheader: `You're booked: ${b.eventName}, ${when}.`,
    eyebrow: "Booking confirmed",
    heading: b.eventName,
    bodyHtml,
    footerHtml: signatureHtml,
  });
  return { subject, text, html };
}

/**
 * Notification email to Joseph. Carries both timezones + the booking history
 * line. No signature: Joseph's order, this is an internal alert he receives.
 */
export function confirmationOperatorEmail(b: NotificationBooking): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(b));
  const whenInvitee = formatInZone(b.startIso, b.inviteeTz);
  const whenPhoenix = formatInZone(b.startIso, "America/Phoenix");
  const bookingDate = new Date(b.startIso);
  const shortDatePhoenix = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Phoenix",
  }).format(bookingDate);
  const shortTimePhoenix = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
  }).format(bookingDate);
  const shortWhen = toAscii(`${shortDatePhoenix}, ${shortTimePhoenix}`);
  const subject = toAscii(`New booking: ${b.eventName} with ${b.inviteeName}, ${shortWhen} Phoenix`);

  const lines = [
    `New booking on ${b.eventName}.`,
    "",
    `${b.inviteeName} (${b.inviteeEmail}${b.inviteePhone ? `, ${b.inviteePhone}` : ""})`,
    "",
    `Their time: ${whenInvitee} (${b.inviteeTz})`,
    `Phoenix time: ${whenPhoenix}`,
    "",
    locationLine(b, "operator"),
    ...(answersBlock(b.answers).length ? ["", ...answersBlock(b.answers)] : []),
  ];

  const historyLines: string[] = [];
  if (b.history && b.history.length > 0) {
    historyLines.push("Booking history with this email:");
    for (const h of b.history.slice(0, 5)) {
      const hDate = new Date(h.startIso);
      const hDatePart = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "America/Phoenix",
      }).format(hDate);
      const hTimePart = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Phoenix",
      }).format(hDate);
      historyLines.push(`${h.eventName}, ${hDatePart} at ${hTimePart} Phoenix`);
    }
    lines.push("", ...historyLines);
  }

  // Internal alert: NO signature on the text or the HTML.
  const text = lines.join("\n");

  const rows: Array<[string, string]> = [
    ["Who", `${b.inviteeName} (${b.inviteeEmail}${b.inviteePhone ? `, ${b.inviteePhone}` : ""})`],
    ["Their time", `${whenInvitee} (${b.inviteeTz})`],
    ["Phoenix", whenPhoenix],
    ["Length", `${b.durationMin} minutes`],
  ];

  let bodyHtml = detailsPanel(rows);
  if (b.location === "zoom") {
    bodyHtml += ctaButton(joinLink(b) ?? HANA_ZOOM_ROOM, "Join the Zoom");
  } else {
    bodyHtml += para(locationLine(b, "operator"));
  }
  const answers = answersBlock(b.answers);
  if (answers.length) {
    bodyHtml += para(answers[0]);
    for (const a of answers.slice(1)) bodyHtml += paraMuted(a);
  }
  if (historyLines.length) {
    bodyHtml += `<div style="margin-top:8px;">` + para(historyLines[0]);
    for (const h of historyLines.slice(1)) bodyHtml += paraMuted(h);
    bodyHtml += `</div>`;
  }

  const html = brandedShell({
    preheader: `${b.inviteeName}, ${shortWhen} Phoenix.`,
    eyebrow: "New booking",
    heading: `${b.eventName} with ${b.inviteeName}`,
    bodyHtml,
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text, html };
}

/** Plain-text lines for the three self-service links. Omitted entirely when manageUrls is undefined (BOOKING_WEBHOOK_SECRET unset — clean no-op per env.example). */
function manageLinksTextBlock(manageUrls: ManageUrls | undefined): string[] {
  if (!manageUrls) return [];
  return [
    "",
    `Confirm you're still good: ${manageUrls.confirm}`,
    `Need a different time? Reschedule: ${manageUrls.reschedule}`,
    `Can't make it? Cancel: ${manageUrls.cancel}`,
  ];
}

/** Three stacked buttons in the branded shell. Same ctaButton treatment used everywhere else, just three in a row. */
function manageButtonsHtml(
  manageUrls: ManageUrls | undefined,
  ctaButton: (url: string, label: string) => string
): string {
  if (!manageUrls) return "";
  return ctaButton(manageUrls.confirm, "Confirm") + ctaButton(manageUrls.reschedule, "Reschedule") + ctaButton(manageUrls.cancel, "Cancel");
}

export function reminder3dEmail(b: NotificationBooking, manageUrls?: ManageUrls): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(b));
  const when = formatInZone(b.startIso, b.inviteeTz);
  const shortWhen = toAscii(formatShortInZone(b.startIso, b.inviteeTz));
  const subject = toAscii(`In 3 days: ${b.eventName}`);

  const lines = [
    `Hey ${firstName(b.inviteeName)}!`,
    "",
    `Quick reminder, we're set for ${b.eventName} on ${when}.`,
    "",
    locationLine(b, "invitee"),
    "",
    `Looking forward to it, see you ${shortWhen}.`,
    ...manageLinksTextBlock(manageUrls),
  ];
  const text = [...lines, "", signatureText].join("\n");

  const bodyHtml =
    para(`Hey ${firstName(b.inviteeName)}! Quick reminder, we're set for:`) +
    detailsPanel(inviteeDetailRows(b, when)) +
    locationHtml(b) +
    para(`Looking forward to it, see you ${shortWhen}.`) +
    manageButtonsHtml(manageUrls, ctaButton);

  const html = brandedShell({
    preheader: `We're set for ${b.eventName} on ${when}.`,
    eyebrow: "In 3 days",
    heading: b.eventName,
    bodyHtml,
    footerHtml: signatureHtml,
  });
  return { subject, text, html };
}

export function reminder1dEmail(b: NotificationBooking, manageUrls?: ManageUrls): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(b));
  const startDate = new Date(b.startIso);
  const tomorrowDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: b.inviteeTz,
  }).format(startDate);
  const tomorrowTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: b.inviteeTz,
  }).format(startDate);
  const subject = toAscii(`Tomorrow: ${b.eventName}`);

  const lines = [
    `Hey ${firstName(b.inviteeName)}!`,
    "",
    `This is your reminder for ${b.eventName} tomorrow, ${tomorrowDate} at ${tomorrowTime}.`,
    "",
    locationLine(b, "invitee"),
    "",
    "Talk soon!",
    ...manageLinksTextBlock(manageUrls),
  ];
  const text = [...lines, "", signatureText].join("\n");

  const bodyHtml =
    para(`Hey ${firstName(b.inviteeName)}! We're on for tomorrow:`) +
    detailsPanel([
      ["When", `${tomorrowDate} at ${tomorrowTime}`],
      ["Length", `${b.durationMin} minutes`],
    ]) +
    locationHtml(b) +
    para("Talk soon!") +
    manageButtonsHtml(manageUrls, ctaButton);

  const html = brandedShell({
    preheader: `Tomorrow: ${b.eventName}, ${tomorrowDate} at ${tomorrowTime}.`,
    eyebrow: "Tomorrow",
    heading: b.eventName,
    bodyHtml,
    footerHtml: signatureHtml,
  });
  return { subject, text, html };
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-service operator alerts: short, factual, no signature (same rule as
// confirmationOperatorEmail — this is an internal alert Joseph receives,
// not client-facing copy).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Joseph's self-service alerts carry the WHOLE booking, not four loose fields.
 * Two reasons, both learned the hard way (2026-09-08): the brand is resolved
 * from eventSlug, which a trimmed notice did not carry, so an Unbound booking
 * could silently fall back to Hana chrome; and a one-line alert gave him
 * nothing to act on without opening the calendar.
 */
export type ManageEventNotice = NotificationBooking;

/**
 * The operator panel. Joseph reads these on his phone, so the order is the
 * order he needs it in: who, how to reach them, when in HIS timezone, then
 * their timezone only when it actually differs.
 */
function operatorDetailRows(b: NotificationBooking): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Who", b.inviteeName]];
  if (b.inviteeEmail) {
    rows.push(["Contact", b.inviteePhone ? `${b.inviteeEmail}, ${b.inviteePhone}` : b.inviteeEmail]);
  }
  rows.push(["When", `${formatInZone(b.startIso, "America/Phoenix")} Phoenix`]);
  if (b.inviteeTz && b.inviteeTz !== "America/Phoenix") {
    // The formatted string already ends in a real abbreviation (EDT, PST), so
    // the raw IANA id would only add "America/New_York" noise to a line Joseph
    // reads on his phone.
    rows.push(["Their time", formatInZone(b.startIso, b.inviteeTz)]);
  }
  if (b.durationMin) rows.push(["Length", `${b.durationMin} minutes`]);
  // Just the venue word here. The join link rides on the button underneath, so
  // printing the raw URL in the panel is the same link twice.
  rows.push([
    "Where",
    b.location === "zoom" ? "Zoom" : b.location === "phone" ? `Phone, you call ${b.inviteePhone || "them"}` : "In person",
  ]);
  return rows;
}

/** Plain-text twin of the panel, for the multipart fallback part. */
function operatorDetailText(b: NotificationBooking): string {
  return operatorDetailRows(b)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/** Joseph's alert when an invitee clicks Confirm on a reminder email. */
export function confirmedByInviteeOperatorEmail(b: ManageEventNotice): EmailContent {
  const { para, detailsPanel, locationHtml, brandedShell } = renderKit(brandFor(b));
  const whenPhoenix = formatInZone(b.startIso, "America/Phoenix");
  const shortWhen = toAscii(formatShortInZone(b.startIso, "America/Phoenix"));
  const subject = toAscii(`${b.inviteeName} confirmed: ${b.eventName}, ${shortWhen} Phoenix`);
  const line = `${b.inviteeName} confirmed ${b.eventName} for ${whenPhoenix} Phoenix.`;

  const html = brandedShell({
    preheader: line,
    eyebrow: "Confirmed by invitee",
    heading: `${b.eventName} with ${b.inviteeName}`,
    bodyHtml:
      para(`${firstName(b.inviteeName)} confirmed. This one is locked in.`) +
      detailsPanel(operatorDetailRows(b)) +
      locationHtml(b),
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text: [line, "", operatorDetailText(b)].join("\n"), html };
}

/** Joseph's alert when an invitee clicks Cancel from the manage page. */
export function cancelledByInviteeOperatorEmail(b: ManageEventNotice): EmailContent {
  const { para, detailsPanel, brandedShell } = renderKit(brandFor(b));
  const whenPhoenix = formatInZone(b.startIso, "America/Phoenix");
  const shortWhen = toAscii(formatShortInZone(b.startIso, "America/Phoenix"));
  const subject = toAscii(`${b.inviteeName} cancelled: ${b.eventName}, ${shortWhen} Phoenix`);
  const line = `${b.inviteeName} cancelled ${b.eventName} for ${whenPhoenix} Phoenix. It's off the calendar.`;

  const html = brandedShell({
    preheader: line,
    eyebrow: "Cancelled by invitee",
    heading: `${b.eventName} with ${b.inviteeName}`,
    bodyHtml:
      para(`${firstName(b.inviteeName)} cancelled. The time is already off your calendar, nothing to clean up.`) +
      detailsPanel(operatorDetailRows(b)),
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text: [line, "", operatorDetailText(b)].join("\n"), html };
}

export interface RescheduledNotice {
  /** The booking at its NEW time. Carries the slug, so the brand is exact. */
  booking: NotificationBooking;
  oldStartIso: string;
}

/** Joseph's alert for a self-service reschedule — replaces the standard "new booking" alert for this one booking so he isn't told about the same meeting twice. */
export function rescheduledOperatorEmail(n: RescheduledNotice): EmailContent {
  const b = n.booking;
  const { para, detailsPanel, locationHtml, brandedShell } = renderKit(brandFor(b));
  const oldWhen = formatInZone(n.oldStartIso, "America/Phoenix");
  const newWhen = formatInZone(b.startIso, "America/Phoenix");
  const shortNewWhen = toAscii(formatShortInZone(b.startIso, "America/Phoenix"));
  const subject = toAscii(`${b.inviteeName} rescheduled: ${b.eventName}, now ${shortNewWhen} Phoenix`);
  const line = `${b.inviteeName} rescheduled ${b.eventName} from ${oldWhen} Phoenix to ${newWhen} Phoenix.`;

  // The old time is stated first and struck through in the panel order so the
  // new time is the one his eye lands on.
  const rows: Array<[string, string]> = [["Was", `${oldWhen} Phoenix`], ...operatorDetailRows(b)];

  const html = brandedShell({
    preheader: line,
    eyebrow: "Rescheduled by invitee",
    heading: `${b.eventName} with ${b.inviteeName}`,
    bodyHtml:
      para(`${firstName(b.inviteeName)} moved this one. The calendar is already updated.`) +
      detailsPanel(rows) +
      locationHtml(b),
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text: [line, "", operatorDetailText(b)].join("\n"), html };
}

export interface PollFinalTimeInput {
  voterName: string;
  voterEmail: string;
  voterTz: string;
  eventName: string;
  eventSlug: string;
  startIso: string;
  durationMin: number;
  location: LocationKind;
  joinUrl?: string;
}

/** Sent to every poll voter once Joseph (or auto-confirm) locks the winning time. The only voter-facing poll email — no "vote received" email exists. */
export function pollFinalTimeEmail(b: PollFinalTimeInput): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(b));
  const when = formatInZone(b.startIso, b.voterTz);
  const shortWhen = toAscii(formatShortInZone(b.startIso, b.voterTz));
  const subject = toAscii(`Confirmed: ${b.eventName}, ${shortWhen}`);

  const booking: NotificationBooking = {
    inviteeName: b.voterName,
    inviteeEmail: b.voterEmail,
    eventName: b.eventName,
    eventSlug: b.eventSlug,
    startIso: b.startIso,
    durationMin: b.durationMin,
    inviteeTz: b.voterTz,
    location: b.location,
    joinUrl: b.joinUrl,
    answers: {},
  };

  const lines = [
    `Hey ${firstName(b.voterName)}!`,
    "",
    `The time's set. ${b.eventName} is confirmed for ${when}.`,
    "",
    locationLine(booking, "invitee"),
  ];
  const text = [...lines, "", signatureText].join("\n");

  const bodyHtml =
    para(`Hey ${firstName(b.voterName)}! The time's set.`) +
    detailsPanel(inviteeDetailRows(booking, when)) +
    locationHtml(booking);

  const html = brandedShell({
    preheader: `${b.eventName} is confirmed for ${when}.`,
    eyebrow: "Time confirmed",
    heading: b.eventName,
    bodyHtml,
    footerHtml: signatureHtml,
  });
  return { subject, text, html };
}

export interface PollInviteInput {
  /** Preferred brand source; eventName is the fallback. */
  eventSlug?: string;
  pollTitle: string;
  eventName: string;
  durationMin: number;
  candidateStartIsos: string[];
  pollUrl: string;
}

/**
 * The invitation blast sent to every guest email when a poll is created
 * (2026-08-28, Joseph's spec: written invitation in his voice, Hana
 * branding, simple instructions on what to do next). Times shown in
 * Arizona time; the voting page renders them in the viewer's own timezone.
 */
export function pollInviteEmail(p: PollInviteInput): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(p));
  const subject = toAscii(`Pick your times: ${p.pollTitle}`);
  const az = "America/Phoenix";
  const times = p.candidateStartIsos.map((iso) => formatInZone(iso, az));

  const lines = [
    "Hey!",
    "",
    `I'm pulling a group of us together for ${p.pollTitle} & I want a time that works for everyone.`,
    "",
    "Here's what to do. It takes about 30 seconds:",
    "",
    "1. Open the voting page below.",
    "2. Check every time you can make. More checks = better odds.",
    "3. Hit submit. That's it.",
    "",
    `Once the votes are in, I'll lock the day that lines up best & a calendar invite will land in your inbox.`,
    "",
    "The times on the table (shown in Arizona time; the voting page shows them in yours):",
    ...times.map((t) => `  - ${t}`),
    "",
    `Vote here: ${p.pollUrl}`,
  ];
  const text = [...lines, "", signatureText].join("\n");

  const bodyHtml =
    para(`Hey! I'm pulling a group of us together for ${escapeHtml(p.pollTitle)} & I want a time that works for everyone.`) +
    para("Tap the button, check every time you can make & hit submit. It takes about 30 seconds.") +
    detailsPanel(times.map((t, i) => [`Option ${i + 1}`, t] as [string, string])) +
    paraMuted("Times shown in Arizona time. The voting page shows them in your own timezone.") +
    ctaButton(p.pollUrl, "Pick Your Times") +
    para("Once the votes are in, I'll lock the day that lines up best & a calendar invite will land in your inbox.");

  const html = brandedShell({
    preheader: `Vote on a time for ${p.pollTitle}. Takes 30 seconds.`,
    eyebrow: "You're invited",
    heading: p.pollTitle,
    bodyHtml,
    footerHtml: signatureHtml,
  });
  return { subject, text, html };
}

export interface PollVoteAlertInput {
  pollTitle: string;
  /** Brand source. A poll on an Unbound event type alerts Joseph in Unbound chrome. */
  eventSlug?: string;
  eventName?: string;
  voterName: string;
  voterEmail: string;
  /** The times this voter checked, Phoenix time, already formatted. */
  chosenTimes: string[];
  /** Full running tally: [time label, votes] for every candidate. */
  tally: Array<[string, number]>;
  votedCount: number;
  expectedVoters: number;
  pollUrl: string;
}

/** Operator alert to Joseph on EVERY submitted ballot (his spec 2026-08-29). No signature. */
export function pollVoteAlertEmail(p: PollVoteAlertInput): EmailContent {
  // Brands off the poll's own event type. The old comment here claimed a vote
  // notice "carries no event identity to brand from" — the caller had the slug
  // the whole time, so an Unbound poll was alerting Joseph in Hana chrome
  // (found by the 2026-09-08 verification pass, not by the original build).
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(p));
  const subject = toAscii(`Poll vote: ${p.voterName} on ${p.pollTitle} (${p.votedCount} of ${p.expectedVoters} in)`);

  const lines = [
    `${p.voterName} (${p.voterEmail}) just voted on ${p.pollTitle}.`,
    "",
    "They can make:",
    ...p.chosenTimes.map((t) => `  - ${t}`),
    "",
    `Ballots in: ${p.votedCount} of ${p.expectedVoters}`,
    "",
    "Running tally:",
    ...p.tally.map(([t, n]) => `  ${n} vote${n === 1 ? "" : "s"} - ${t}`),
    "",
    `Poll: ${p.pollUrl}`,
  ];

  const bodyHtml =
    para(`${p.voterName} (${p.voterEmail}) just voted.`) +
    detailsPanel(p.chosenTimes.map((t, i) => [i === 0 ? "They can make" : "", t] as [string, string])) +
    para(`Ballots in: ${p.votedCount} of ${p.expectedVoters}.`) +
    detailsPanel(p.tally.map(([t, n]) => [`${n} vote${n === 1 ? "" : "s"}`, t] as [string, string])) +
    ctaButton(p.pollUrl, "Open the Poll");

  const html = brandedShell({
    preheader: `${p.voterName} voted. ${p.votedCount} of ${p.expectedVoters} in.`,
    eyebrow: "Poll vote received",
    heading: p.pollTitle,
    bodyHtml,
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text: lines.join("\n"), html };
}

export interface PollCompleteInput {
  pollTitle: string;
  eventName: string;
  /** Preferred brand source; eventName is the fallback. */
  eventSlug?: string;
  expectedVoters: number;
  /** Winning time, Phoenix, formatted. */
  winnerLabel: string;
  winnerVotes: number;
  tally: Array<[string, number]>;
  /** One-click GET link that confirms the winner + sends every invite. */
  acceptUrl: string;
  /** Where Joseph builds a replacement poll. */
  adjustUrl: string;
  pollUrl: string;
}

/** Operator email to Joseph the moment the LAST expected ballot lands (his
 * spec 2026-08-29): the common time + one-tap accept, or adjust & resend. */
export function pollCompleteEmail(p: PollCompleteInput): EmailContent {
  const { para, paraMuted, detailsPanel, ctaButton, locationHtml, brandedShell, signatureHtml, signatureText } = renderKit(brandFor(p));
  const subject = toAscii(`Everyone voted: ${p.pollTitle}. Best time: ${p.winnerLabel}`);

  const lines = [
    `All ${p.expectedVoters} ballots are in on ${p.pollTitle}.`,
    "",
    `Best time for the group: ${p.winnerLabel} (${p.winnerVotes} of ${p.expectedVoters} can make it).`,
    "",
    "Full tally:",
    ...p.tally.map(([t, n]) => `  ${n} vote${n === 1 ? "" : "s"} - ${t}`),
    "",
    `ACCEPT & SCHEDULE (books it + sends every calendar invite): ${p.acceptUrl}`,
    "",
    `ADJUST & RESEND (build a replacement poll): ${p.adjustUrl}`,
    "",
    `Poll: ${p.pollUrl}`,
  ];

  const bodyHtml =
    para(`All ${p.expectedVoters} ballots are in.`) +
    detailsPanel([
      ["Best time", p.winnerLabel],
      ["Can make it", `${p.winnerVotes} of ${p.expectedVoters}`],
    ]) +
    para("Accepting books the winning time on your calendar & sends every voter their calendar invite.") +
    ctaButton(p.acceptUrl, "Accept & Schedule") +
    detailsPanel(p.tally.map(([t, n]) => [`${n} vote${n === 1 ? "" : "s"}`, t] as [string, string])) +
    paraMuted("Not the right day? Adjust below builds a fresh poll & this one stays open until you confirm or replace it.") +
    ctaButton(p.adjustUrl, "Adjust & Resend");

  const html = brandedShell({
    preheader: `Best time: ${p.winnerLabel}. One tap to schedule.`,
    eyebrow: "Poll complete",
    heading: p.pollTitle,
    bodyHtml,
    footerHtml: operatorFooterHtml(),
  });
  return { subject, text: lines.join("\n"), html };
}

/** Morning-of text. Never signed, no name at the end, texts are informal. */
export function morningText(b: NotificationBooking): string {
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: b.inviteeTz,
  }).format(new Date(b.startIso));
  const lead = `Hey ${firstName(b.inviteeName)}! Looking forward to our call at ${timePart} today.`;
  // Joseph order 2026-09-01: the morning text always carries the one-click Zoom
  // link. Link sits on its own line at the bottom, never inline in the body.
  const link = joinLink(b);
  // A phone booking leads with the call the client chose and offers video
  // second, same as the emails (locationLine). Found 2026-09-29: Britney
  // Gillies booked a phone call and got a bare "Join here" Zoom link with no
  // mention of the call, so she could not tell which one to show up on.
  if (b.location === "phone") {
    const call = `${lead} I'll call you at ${b.inviteePhone || "the number you gave us"}.`;
    return link ? `${call}\n\nIf you'd rather meet on video:\n${link}` : call;
  }
  if (link) {
    return `${lead}\n\nJoin here:\n${link}`;
  }
  return lead;
}
