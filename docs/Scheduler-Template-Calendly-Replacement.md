# Scheduler Template — self-hosted Calendly replacement

How to stand up a self-hosted booking system that replaces Calendly, written out of a working production build rather than from memory. Everything is in this one file: the spec, the event catalogue, and the environment variables.

The reference build is live at rosewildexperiences.com/book, with a second brand running on the same engine at unbound-booking.vercel.app.

**Two sections are not optional reading.** Section 3 explains why the availability math uses a fixed UTC offset and what has to change for a timezone that observes daylight saving. Skipping it produces a system that is an hour wrong for half the year. Section 12 says plainly which paths have been proven live and which have not, so nobody inherits a false sense of coverage.

---

# Self-Hosted Scheduler Template

A complete, generic build spec for a self-hosted booking system that replaces Calendly. Availability off a real calendar, payments, disclosures, confirmation emails, staggered text reminders, and multiple branded booking surfaces sharing one engine.

Everything here was pulled out of a working production system (rosewildexperiences.com/book, live since 2026-07-30, plus a second Unbound-branded surface riding the same engine). Identity is tokenized as `{{PLACEHOLDERS}}`. The architecture, the flows, the decisions, and the traps are the real thing, read out of the running code, not remembered.

Companion files in this folder are `templates/events.template.ts` (the one file a new instance edits) and `templates/env.template` (every environment variable the engine reads).

---

## 1. What it replaces, and what it does not

Feature parity with a single-user Calendly account was the bar, and the build cleared it: multiple event types with their own durations, descriptions, intake questions and prices; live availability computed against real calendar busy time; visitor-timezone display; payment collected before the slot is held; disclosure text that must be accepted; calendar invite with a Meet link; confirmation email both directions; day-before and hour-before reminders by email and text.

Four things Calendly does that this does not.

**Cancel and reschedule links.** The confirmation email says to reply to the email. Building the self-serve version means a signed token per booking, a cancel route that deletes the calendar event and refunds, and a reschedule route that re-runs slot selection against the existing event. This is the largest single gap and the first thing to build if a client asks.

**Round robin, team pages, and pooled availability.** The engine reads one write calendar and unions busy time across several read calendars. Two people sharing a rotating queue of bookings is a different data model and is not in here.

**Workflow builders, questionnaire logic, and CRM integrations.** Intake questions are a flat list of label plus required flag. There is no branching, no scoring, no push into a CRM. The Unbound surface added a client-type picker by passing extra structured answers through, which is the pattern to copy for anything conditional.

**Compliance surfaces.** No BAA, no HIPAA posture, no data-residency controls. A medical or legal client needs a different design and a different hosting story.

---

## 2. The shape of the thing

One Next.js app holds the engine and the primary brand's booking pages. Any additional brand gets its own tiny Next.js app on its own domain, which calls the engine cross-origin through a CORS allowlist. Visitors on the second brand never see the first brand's domain.

There is no database. Google Calendar is the datastore. Every booking is a calendar event, and everything the system needs to remember about that booking lives in the event's `extendedProperties.private`. Reminder state, invitee contact details, client type, and the marker that identifies our own bookings all live there. That decision is why the system has no migrations, no ORM, no backup story, and no drift between what the calendar says and what the system believes.

All third-party access is raw REST with `fetch`. Google, Stripe, Twilio, and Resend are four sets of HTTP calls, no SDKs, which keeps the dependency surface at zero and the failure modes readable.

### Engine files

| File | Lines | Responsibility |
|---|---|---|
| `lib/booking/events.ts` | 157 | Event-type catalogue. The only file a new instance rewrites. |
| `lib/booking/availability.ts` | 120 | Pure slot math. No I/O, fully unit-testable. |
| `lib/booking/google.ts` | 322 | OAuth refresh, freeBusy, event create, event list, property patch. |
| `lib/booking/perform.ts` | 270 | Validation, slot re-check, calendar write, both confirmation emails. |
| `lib/booking/stripe.ts` | 120 | Checkout session create, session retrieve, refund. |
| `lib/booking/sms.ts` | 49 | Twilio send and phone normalization. No-ops cleanly when unconfigured. |
| `lib/booking/cors.ts` | 38 | Exact-origin allowlist for satellite front ends. |

### Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/booking/slots` | GET | Open slots for one event type in one month. |
| `/api/booking/book` | POST | Validate, re-check, then either book directly or return a Checkout URL. |
| `/api/booking/confirm` | GET | Finalize a paid booking when the payer returns. Idempotent. |
| `/api/booking/stripe-webhook` | POST | Finalize a paid booking when the payer never returns. Idempotent. |
| `/api/booking/reminders` | GET | The reminder sweep. Bearer-authorized, idempotent, safe to call often. |

### Pages

`/book` is the hub listing every event type as a card. `/book/[slug]` is the event page carrying the description, price, disclosures, and the widget. `/book/[slug]/confirmed` finalizes the paid return trip. `components/BookingWidget.tsx` is the whole visitor experience as a four-step state machine (pick-date, pick-time, form, confirmed) with error and submitting states.

---

## 3. Availability

Weekly hours are a lookup keyed by day of week, each entry either an open and close hour in local time or null for a closed day. The reference build runs Monday through Thursday, 09:00 to 17:00. Slots step every 30 minutes regardless of event length, so a 60-minute event still offers 9:00, 9:30, 10:00 and takes an hour from whichever one is chosen. Bookings open 24 hours out and close 60 days out.

`computeMonthSlots(year, month, durationMin, busy, now)` returns every open day in a month with its open slot start times as UTC ISO strings. It takes `now` as an injectable argument, which is what makes the whole engine testable without mocking a clock. `isSlotBookable` re-runs the same computation for a single slot and is what the booking path calls to prove a slot is still real.

**The timezone shortcut, and the one place porting will bite.** The reference build runs on America/Phoenix, which has no daylight saving, so local time to UTC is a fixed offset of 7 hours and the math is exact year-round with no timezone library. Any instance in a DST timezone must replace `phoenixTimeToUtcMs` with a real conversion (`Intl.DateTimeFormat` with `timeZone` and offset extraction, or a small tz library). Skipping this produces slots that are correct for half the year and an hour wrong for the other half, which is the kind of bug that surfaces as a missed client call in November.

Visitor-side, the widget renders every slot with `Intl.DateTimeFormat` and no explicit timezone, so times display in the visitor's own zone. Confirmation surfaces show both the visitor's local time and the operator's local time labelled by name, because a booking confirmation that shows only one is a support ticket waiting to happen.

---

## 4. The free booking path

The widget posts event slug, start ISO, name, email, phone, chosen location, and the answers map to `/api/booking/book`. Validation caps every string, requires a name and a syntactically valid email, requires a phone when the chosen location is a phone call, and enforces required questions. Extra structured answers beyond the declared question list pass through capped at 12 keys, which is how a satellite front end adds its own fields without touching the engine.

The route then re-fetches busy time and re-checks the exact slot. This is the second check; the first was the slot list the visitor saw, which may be minutes stale. A slot lost in between returns 409, and the widget drops the visitor back to time selection with the message and a forced refresh of that month's cache rather than a dead end.

Passing that, `performBooking` writes the calendar event with the invitee as an attendee, `sendUpdates=all` so Google mails its own invitation, and `conferenceDataVersion=1` with a Meet create request when the location is a video call. Google occasionally returns the created event before the Meet room resolves, so the code re-reads the event once after 1.5 seconds and takes `hangoutLink` from the re-read. Then two emails go out through Resend, one to the invitee and one to the operator, each with the other party as reply-to.

The operator's email carries a history line. Before writing the event, `listBookingsByEmail` queries the calendar for past events stamped `rwBooking=1` with the same invitee email going back two years, and lists them. When the lookup fails it is swallowed, because client history is never worth failing a booking over.

---

## 5. The paid booking path

A priced event with Stripe connected does not book on submit. It re-checks the slot, then creates a Checkout session and returns the URL for the browser to follow.

The entire booking payload rides in the session's metadata. Stripe caps a metadata value at 500 characters, so the payload is chunked at 480 into `booking_0` through `booking_15` and reassembled on the way back. Sessions expire after 35 minutes, deliberately short, because a slot is effectively soft-held for the life of the session and a long expiry means a visitor can quietly block a time by opening checkout and walking away.

Two independent paths finalize the booking, and both are idempotent. The return trip through `/book/[slug]/confirmed` calls `/api/booking/confirm`, which retrieves the session and finalizes it. The webhook on `checkout.session.completed` does the same thing for the payer who closes the tab. Both begin by asking whether this exact booking already exists, matching on event summary and exact start time, and report success without writing anything when it does. That check is what makes a page reload harmless and what stops the webhook and the return trip from double-booking each other.

Both paths re-check availability after payment. When the slot went while the visitor was inside checkout, the payment is refunded in full, the conflict is logged loudly, and the visitor is told. This is the only genuinely unpleasant state in the system and the code that handles it has been reviewed but never fired in production.

The webhook verifies Stripe's signature itself, no SDK: split the `stripe-signature` header, HMAC-SHA256 the timestamp and raw body with the endpoint secret, compare with `timingSafeEqual`, and reject anything older than 600 seconds. A validation failure returns 200, not an error, so Stripe stops retrying a payload that will never succeed.

**Disclosures.** Any event type carrying `paymentTerms` renders that text verbatim above a required acceptance checkbox, and the API rejects a submission without `disclosuresAccepted`. The gate is enforced server-side as well as in the widget, which is what makes it worth having.

---

## 6. Notifications

Every notification pairs an email with a text, and the pairs are deliberately staggered so a client never gets both at the same moment. The email always lands first.

| Moment | Email | Text |
|---|---|---|
| Booking confirmed | Instant, from `performBooking` | 10 to 120 minutes later |
| Day before | 22 to 28 hours out (tight window) or 18 to 42 hours (daily backstop) | 17 to 23 hours out, and at least 45 minutes after its email went |
| Hour before | 55 to 85 minutes out | 25 to 50 minutes out |

Sent-state is a property on the calendar event: `reminder24h`, `reminder24hAt`, `reminder1hEmail`, `reminder1h`, `sms24h`, `confirmSms`. The sweep reads them, skips what is already marked, and patches the marker after each successful send. Nothing is queued anywhere, so a missed sweep catches up on the next one instead of dropping the message. The day-before text is gated on `reminder24hAt` rather than a fixed delay, which is what guarantees the stagger holds even when a sweep runs late.

Two triggers drive it. A LaunchAgent on an always-on machine pulses `GET /api/booking/reminders?window=tight` every 10 minutes, which is what makes the tight windows and the text legs possible. A daily platform cron at 9am local hits the same route with the wide window as an email-only backstop, so a machine that is asleep costs the texts but never the emails. Both send an `Authorization: Bearer` header matching `CRON_SECRET`; the route returns 401 without it.

Texts no-op cleanly when the three Twilio variables are absent, so the whole system runs email-only from day one and gains texts the moment a Twilio account exists. Every text is signed with the assistant's name so a client always knows who is writing.

---

## 7. A second brand on the same engine

The satellite is its own Next.js app with its own domain, its own brand tokens, and a single hardcoded event slug. It ships one component, a copy of the widget, pointed at `NEXT_PUBLIC_BOOKING_API`.

Three pieces make that safe. The engine's `BOOKING_CORS_ORIGINS` lists exact origins, never a wildcard, and the CORS helper echoes back only an exact match and always sets `Vary: Origin` so a shared cache cannot leak one origin's response to another. CORS headers are attached to the slots and book routes only; the reminder route stays Bearer-only and is never reachable cross-origin. The satellite sets a `Content-Security-Policy` with `frame-ancestors` naming only the parent site, so the booking page can be iframed by the site that owns it and nobody else.

A compact `?embed=1` mode drops the logo, description, and footer so the page sits inside a modal without looking like a page inside a page. Any link the confirmed panel offers uses `target="_top"` so it escapes the iframe instead of nesting.

**One trap worth naming.** Anchors with `target="_blank"` are silently swallowed by in-app browsers and webviews, which is where a large share of mobile bookings happen. Join links open in the same tab, and the raw URL is always shown as text next to the button so a client who cannot click still has something to copy.

---

## 8. Standing up a new instance

**Step 1. Capture the source of truth.** If the client is coming off Calendly, pull their public event types from Calendly's own lookup API before anything else and save the raw JSON. Descriptions, intake questions, prices, and payment terms all carry over verbatim, and having the capture on disk settles later arguments about what the old system actually said. The captures are historical the moment the new catalogue is edited; say so in the file header so nobody treats them as live.

**Step 2. Write the catalogue.** Copy `templates/events.template.ts` to `lib/booking/events.ts` and fill it. Slug, name, duration, description, locations, guest policy, questions, summary, optional price in cents, optional payment terms. This is the only file that carries client identity.

**Step 3. Set the availability rules.** Weekly hours, slot increment, minimum notice, and booking horizon in `availability.ts`. If the timezone observes DST, fix the conversion first (section 3).

**Step 4. Google.** An OAuth client with calendar scope, and a refresh token for the account that owns the calendar. `BOOKING_CALENDAR_ID` takes a comma-separated list; busy time unions every calendar in it, and bookings are written to the first. Find out which calendars the old system was checking before assuming it was one. The reference build discovered its Calendly had been reading three, and proved it by diffing slot lists against the live account day by day.

**Step 5. Email.** A Resend domain with SPF, DKIM, and DMARC on it, and a from-address on a mailbox the client actually reads. New sending domains get junked by consumer mail providers regardless of correct records; the fix is time, volume, and the client marking the first messages as not-spam. Every confirmation surface should tell the visitor to check spam.

**Step 6. Payments, if priced.** A Stripe secret key and a webhook endpoint on `checkout.session.completed` whose signing secret goes into the environment. Prefer a restricted key limited to Checkout and Refunds over a full secret key.

**Step 7. Texts, optional.** Twilio account, number, and A2P or toll-free verification. Carriers filter unverified traffic, so a working test to the operator's own phone does not prove a working message to a client.

**Step 8. Wire the credentials in one motion.** Write a script that reads credentials from wherever they already live, creates the webhook endpoint, pushes every variable to the host, and redeploys, without printing a single value to the terminal. One approved run instead of a dozen copy-pastes, and the created webhook endpoint doubles as durable proof the script ran.

**Step 9. Prove it end to end before anything is cancelled.** One real free booking and one real paid booking, on the deployed site, from a phone. Confirm the calendar event, the Meet link, both emails, the text, and the refund path if it can be exercised safely. Only then cancel the old subscription.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | yes | Calendar access. Absent, every route reports `configured: false` and the widget shows a fallback. |
| `BOOKING_CALENDAR_ID` | yes | Comma list. Union for busy, first for writes. Defaults to `primary`. |
| `RESEND_API_KEY` | yes | Confirmation and reminder email. |
| `BOOKING_FROM` / `CONTACT_FROM` / `CONTACT_TO` | yes | Sender identity and the operator's notification address. |
| `STRIPE_SECRET_KEY` | priced events | Checkout and refunds. |
| `STRIPE_WEBHOOK_SECRET` | priced events | Signature verification. Absent, the webhook refuses and only the return trip finalizes. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | texts | All three or none. |
| `CRON_SECRET` | yes | Bearer token on the reminder sweep. |
| `BOOKING_CORS_ORIGINS` | satellites | Exact origins, comma separated, no wildcard. |
| `NEXT_PUBLIC_BOOKING_API` | satellites | Set on the satellite app, points at the engine. |
| `BOOKING_MOCK=1` | dev only | No external calls, empty busy list, fake checkout. Never set in production. |

---

## 9. Decisions already made, so they do not get relitigated

**The calendar is the database.** No Postgres, no Redis, no queue. Booking state lives on the event it describes. The cost is that every read is an API call and complex queries are awkward. The benefit is that the operator's calendar and the system can never disagree, and deleting an event genuinely deletes the booking.

**Everything is idempotent.** The booking identity is event summary plus exact start time. Every finalize path checks existence before writing. Every reminder checks its own marker before sending. This is what makes it safe to pulse the sweep every 10 minutes forever and to let two payment paths race.

**Availability is checked three times.** When the month loads, when the form is submitted, and after payment. The third one is the one that costs money to get wrong.

**Email before text, always, with a gap.** Two channels firing together reads as a system malfunctioning. The gap is enforced by timestamp, not by hope.

**Unconfigured means quiet, not broken.** Missing Stripe means priced events book without payment. Missing Twilio means email-only. Missing Google means a visible fallback panel instead of a stack trace. Every capability degrades to a clean no-op so the system can go live before every account exists.

**Raw REST, no SDKs.** Four HTTP integrations, zero added dependencies, no version churn, and every failure is a status code in a log line.

---

## 10. Traps, in the order they will be hit

**All-day events marked busy block the entire day.** An OPAQUE all-day event, including birthdays synced from contacts, wipes out availability for that date. Calendly behaves identically, so this reads as parity rather than a bug, but it is worth telling the client so they mark all-day entries as free.

**Month-boundary slot cache.** The widget caches slots per month. Selecting a day, navigating to another month, and clicking back must read the selected day's month, not the displayed one. Getting this wrong shows "no times available" on days that are wide open. This bug shipped and was fixed in both widgets.

**Non-interactive environment writes to preview.** On the reference host, pushing an env var to production non-interactively works every time and pushing to the preview environment fails. Preview then runs with a partial config. Cosmetic, but it looks like a real outage when a preview deploy is tested.

**Minimum notice is a guess.** Calendly does not expose its configured value publicly. The reference build assumed 24 hours. Confirm the number with the client rather than inheriting the assumption.

**Deliverability on a fresh sending domain.** Correct SPF, DKIM, and DMARC do not stop consumer providers from junking a brand-new domain's first messages. Plan for it in the copy and in the client's expectations.

**Carrier filtering on unverified text traffic.** A trial number reaches the operator's own phone and gets filtered on the way to a stranger. Verification is not optional for client-facing texts.

**Credential scope.** The reference build gave the hosted app a full-scope calendar credential covering three calendars and an unrestricted live Stripe key with charge and refund capability. Both work. Both are broader than the job needs. A dedicated scoped Google credential and a restricted Stripe key are the hardening pass, and doing it at setup is far cheaper than retrofitting.

---

## 11. What this is worth

The subscription it replaces is small on its own, roughly the price of one paid tier per operator per month, and the reference build removed a $13 monthly line item. The real value is elsewhere. Bookings land inside the operator's own system with their own data, branded surfaces multiply for the cost of a small front-end rather than another seat, the intake questions and payment terms are code rather than a vendor's form builder, and the reminder behaviour is arbitrary rather than whatever the vendor allows.

For a productized offer, the honest scoping is that a new single-operator instance is mostly configuration once the engine exists, the DST conversion is the only real code change for most timezones, and the two things that reliably eat time are credentials and deliverability, neither of which is engineering.

---

## 12. State of the reference build

Proven live and repeatedly: free bookings, calendar writes, Meet links, attendees, both confirmation emails, texts through Twilio, the cross-origin satellite, the client-type flow, and the booking-history line.

Never run live: the paid path end to end. Stripe Checkout through to a real charge and a confirmed booking has only been verified in mock mode, and the refund-on-conflict path has been reviewed, not fired. Any client build should run one real paid booking before launch rather than inheriting that gap.


---

# Appendix A: events.template.ts

The event-type catalogue. The only engine file that carries client identity.

```ts
// Event-type catalogue. This is the only engine file that carries client identity.
//
// If migrating off Calendly: capture the live event types from Calendly's public
// lookup API first, save the raw JSON alongside this file, and copy descriptions,
// questions, prices and payment terms VERBATIM. Once this file is edited it is the
// source of truth and the captures are historical.

export type LocationKind = "google_meet" | "phone" | "in_person";

export interface BookingQuestion {
  label: string;
  required: boolean;
}

export interface BookingEventType {
  slug: string;
  name: string;
  /** minutes */
  duration: number;
  description: string;
  locations: LocationKind[];
  guestsAllowed: boolean;
  questions: BookingQuestion[];
  /** short card description for the /book hub */
  summary: string;
  /** optional website link shown under the description on the event page */
  website?: string;
  /** USD cents; absent = free */
  priceCents?: number;
  /** payment terms / disclosure shown before booking, verbatim from the client */
  paymentTerms?: string;
}

export const EVENT_TYPES: BookingEventType[] = [
  {
    slug: "{{EVENT_SLUG}}",
    name: "{{Event Name}}",
    duration: 30,
    description: "{{Full description shown on the event page. Line breaks with \\n.}}",
    locations: ["google_meet"],
    guestsAllowed: true,
    questions: [
      { label: "{{Question shown on the booking form}}", required: false },
    ],
    summary: "{{One or two sentences for the hub card.}}",
  },
  {
    slug: "{{PAID_EVENT_SLUG}}",
    name: "{{Paid Event Name}}",
    duration: 60,
    description: "{{Full description.}}",
    locations: ["phone", "google_meet"],
    guestsAllowed: true,
    questions: [
      { label: "{{Required question}}", required: true },
    ],
    // Any event with priceCents routes through Stripe Checkout before the
    // calendar write. Any event with paymentTerms renders that text verbatim
    // above a required acceptance checkbox, enforced server-side.
    priceCents: 5000,
    paymentTerms: "{{Terms the client wants accepted before payment.}}",
    summary: "{{Hub card text.}}",
  },
] as BookingEventType[];

export function getEventType(slug: string): BookingEventType | undefined {
  return EVENT_TYPES.find((e) => e.slug === slug);
}

export function priceLabel(e: BookingEventType): string | null {
  if (!e.priceCents) return null;
  const dollars = e.priceCents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

```

---

# Appendix B: env.template

Every environment variable the engine reads, annotated with what breaks without it.

```
# Every environment variable the scheduler engine reads.
# Set these on the host (encrypted env), never in the repo.
# A missing capability degrades to a clean no-op, it never crashes the site.

# GOOGLE CALENDAR (REQUIRED)
# OAuth client with calendar scope + a refresh token for the account that owns
# the calendar. Without these every route returns configured:false and the
# widget shows its fallback panel.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Comma-separated. Busy time is unioned across ALL of them; bookings are written
# to the FIRST. Find out how many calendars the old system was checking before
# assuming one. Defaults to "primary".
BOOKING_CALENDAR_ID=

# EMAIL (REQUIRED)
RESEND_API_KEY=
# Sender identity. BOOKING_FROM wins; CONTACT_FROM is the fallback for sites that
# already send contact-form mail from a different address.
BOOKING_FROM=
CONTACT_FROM=
# Where the operator's "new booking" notification goes. Also the invitee's reply-to.
CONTACT_TO=

# REMINDER SWEEP (REQUIRED)
# Bearer token. The sweep returns 401 without a matching Authorization header.
# Same value goes on the always-on machine that pulses the tight window, and on
# the platform's daily cron.
CRON_SECRET=

# STRIPE (REQUIRED ONLY FOR PRICED EVENTS)
# Prefer a RESTRICTED key limited to Checkout + Refunds over a full secret key.
STRIPE_SECRET_KEY=
# Signing secret of the checkout.session.completed endpoint. Absent, the webhook
# refuses and only the return-trip path finalizes paid bookings.
STRIPE_WEBHOOK_SECRET=

# TWILIO (OPTIONAL; ALL THREE OR NONE)
# Absent, the system runs email-only and every text send is a silent no-op.
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=

# SATELLITE BRAND SURFACES (OPTIONAL)
# On the ENGINE app: exact origins allowed to call /slots and /book cross-origin.
# Comma separated, scheme + host + optional port, no trailing slash, no wildcard.
BOOKING_CORS_ORIGINS=

# On the SATELLITE app: where the engine lives.
NEXT_PUBLIC_BOOKING_API=

# LOCAL DEVELOPMENT ONLY
# No external calls, empty busy list, fake checkout. Never set in production.
BOOKING_MOCK=1

```
