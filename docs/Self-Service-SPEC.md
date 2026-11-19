# Scheduler self-service: confirm / reschedule / cancel
*Joseph order 2026-09-03. App: `~/.axis/projects/hana-calendar` (Next.js, Google Calendar is the store, events carry private extendedProperties, chunked via chunkValue/reassembleProps). Mac-side ingest: `~/.axis/lib/scheduler_booking_ingest.py` via the signed webhook `https://webhook.hana.events/booking`.*

## Joseph's words
"A canceled booking needs to be removed from my calendar with a note on their Podio item & status rolled back... when they receive their 3 days before & 1 day before e-mails, there should be a button for them to 1 click confirm their appointment, which should send me an e-mail showing they confirmed... or next to that button, a 1 click RESCHEDULE that takes them through to the same calendar meeting type, so they can pick a new time on my calendar, which would then cancel the meeting they are rescheduling... I don't want to be the bottleneck... If they confirm, I want the Event title updated at the end to say CONFIRMED without resending them the meeting invite."

## Done-bar
1. Every 3-day and 1-day reminder email carries three buttons: **Confirm**, **Reschedule**, **Cancel**. Links are signed (HMAC over the calendar event id using `BOOKING_WEBHOOK_SECRET` with prefix `manage:`; base64url token = `<eventId>.<sig16>`), never guessable, never expire before the meeting.
2. **Confirm** = one human click. Link opens `/manage/<token>?a=confirm`; the page immediately POSTs to `/api/booking/manage` via JS (so email link scanners that GET the URL cannot confirm on the invitee's behalf) and shows "You're confirmed, see you <when>". Server: patch the calendar event `summary` to `<existing title> CONFIRMED` (idempotent, never double), set private prop `confirmed=1`, use `sendUpdates=none` so the invitee gets NO new invite; send Joseph (`joseph@hana.events`) a short email "<Name> confirmed <event> for <when>"; fire webhook `booking.confirmed` (payload below). If Google's patch would resend invites regardless, say so in the report — Joseph accepts that as a fallback.
3. **Reschedule** = link to `/manage/<token>?a=reschedule` → redirect to `/<slug>?reschedule=<token>` (same event type). The booking widget, when a valid reschedule token is present, shows a one-line banner ("Rescheduling your <event> from <old when>") and on submit posts `rescheduleToken` to `/api/booking/book`. `performBooking`: validate token → create the NEW event exactly as today → then delete the OLD event with `sendUpdates=all` (invitee gets Google's cancellation for the old time) → fire `booking.cancelled` with `reason:"rescheduled"` + `newStartIso` for the old, and `booking.created` with `rescheduledFromEventId`/`rescheduledFromStartIso` for the new → email Joseph "<Name> rescheduled <event> from <old> to <new>" → existing invitee confirmation email for the new time goes out as today. If the new booking fails, the old event is untouched.
4. **Cancel** = link to `/manage/<token>?a=cancel` → page shows the meeting and one button "Yes, cancel this meeting" (POST). Server: delete the calendar event with `sendUpdates=all`, fire `booking.cancelled` with `reason:"invitee_cancelled"`, email Joseph "<Name> cancelled <event> for <when>", show "Cancelled. Book again any time: <link to /slug>".
5. `/manage/<token>` with no action shows the meeting (name, when in invitee tz, location/join link) and the three buttons, so the same page is the invitee's self-service hub. Also add a "Manage this meeting" line with that link to the booking confirmation email.
6. Expired/invalid token, or event already gone → friendly page "This meeting is no longer on the calendar" + link to book again. Never a stack trace.
7. Reminder sweep must skip events already confirmed for nothing (still send reminders as today; confirmed=1 just changes the title) and must never crash on deleted events.
8. Owner emails to Joseph: plain, short, one line of facts + the Podio link is NOT needed (Podio side is handled by the webhook). No em dashes in any client-facing copy. Hana signature stays as today.
9. Tests: extend `test/*.test.mjs` (node --test) for token sign/verify, title-append idempotency, reschedule payload shaping. `npm run build` passes. Do NOT deploy. Do NOT send any email or create any real calendar event during the build (mock Google/Resend in tests; the perform path already has fakes if any — reuse).

## Webhook payloads (Mac side consumes these; shape is binding)
Same signature header `hana-booking-signature: t=<unix>,v1=<hmac sha256 of "<t>.<rawBody>">` as today. Fields:
- `booking.created` (existing) + optional `rescheduledFromEventId`, `rescheduledFromStartIso`.
- `booking.confirmed`: `{event, slug, eventName, inviteeName, inviteeEmail, startIso, endIso, inviteeTz, location, joinUrl, calendarEventId}`
- `booking.cancelled`: `{event, slug, eventName, inviteeName, inviteeEmail, startIso, endIso, inviteeTz, location, calendarEventId, reason: "invitee_cancelled" | "rescheduled", newStartIso?}`
Fail-soft like today: a webhook failure never blocks the invitee's action; log `podio_notify_failed`.

## Calendar private props to set
- confirm: `confirmed=1`, `confirmedAt=<iso>`
- reschedule: on the NEW event `rescheduledFrom=<oldEventId>`, `rescheduledFromStart=<oldStartIso>`; on the OLD event before deletion: `rescheduledTo=<newEventId>` (so the Mac sweep can tell a reschedule from a cancel if the webhook was missed).
- cancel: `cancelledBy=invitee`, `cancelledAt=<iso>` (patch before delete so showDeleted listing carries it).

## Hard safety rules (builder)
- Zero live sends, zero real calendar writes during build. Tests only.
- Never touch `~/.axis/policy/`, `~/.axis/CLAUDE.md`.
- No deploy. Report the exact deploy command: `cd ~/.axis/projects/hana-calendar && npx vercel --prod`.
- Back up nothing (git is the backup); commit on a branch? No: commit directly to main in that repo with a plain-English message, no push.
