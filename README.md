# Hana Scheduler (starter)

This is the booking system behind calendar.hana.events. It replaced Calendly. It is a small Next.js site that reads a real Google Calendar, shows open times, books the meeting, makes the Zoom link, sends the emails and texts, and tells a CRM about the booking.

Shared as a template. Swap in your own brand, hours, copy and contact details before you go live.

## What is in here

- `app-source/` : the full site code. Start with `lib/booking/` (the engine), then `app/` (pages and routes).
- `app-source/env.example` : every setting the engine reads. All values are blank. Fill in your own.
- `app-source/test/` : the test suite. Run `npm install`, then `npm test`.
- `docs/Scheduler-Template-Calendly-Replacement.md` : the generic build guide. Read sections 3 and 12 first (timezone trap, and what was and was not proven live).
- `docs/Self-Service-SPEC.md` and `Self-Service-BUILD_REPORT.md` : how the confirm / reschedule / cancel links work.
- `mac-side-reference/` : three scripts that run on Joseph's Mac, not on the site. They show how bookings reach the CRM (Podio) and how reminders get kicked. They point at Joseph's own Podio apps, so copy the pattern, not the IDs.

## How it works, short version

1. A visitor opens an event page (`app/[slug]`) and picks a time. Open times come from `/api/booking/slots`, which reads busy time from every calendar you list and applies the weekday hours and the 15 minute buffer (`lib/booking/availability.ts`).
2. `/api/booking/book` writes the event to the first calendar, creates the Zoom meeting, and emails both sides.
3. A daily job hits `/api/booking/reminders` for the 3-day and 1-day emails and the morning-of text. Those emails carry Confirm / Reschedule / Cancel buttons (signed links, `app/manage`).
4. Every booking, confirm and cancel is posted to a webhook, signed with a shared secret, so a CRM can file it (`lib/booking/podio-notify.ts`). Set `BOOKING_WEBHOOK_URL` to your own receiver.
5. Group polls ("which time works for everyone") live under `app/poll`.

The event list lives in `app-source/lib/booking/events.ts`. That is the one file to edit to add or change meeting types.

## What you need to set up

- A Google OAuth client and refresh token with Calendar and Gmail send.
- A Zoom Server-to-Server app (optional; without it bookings still work and the email says the link follows).
- Resend or Gmail for email. Twilio for texts (optional).
- A Vercel project. Put the settings from `env.example` in Vercel's encrypted env, never in the repo.

## What was taken out

Media files (videos, photos, logos), the original git history, and all keys. Phone numbers, a Zoom room passcode, private calendar IDs and the CRM webhook address were replaced with placeholders.

Rules baked in for Hana that you will want to change: no Saturday or Sunday, weekdays 9 to 5 Phoenix time, a 15 minute buffer around everything on the calendar.
