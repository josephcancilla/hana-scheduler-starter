# Scheduler self-service: confirm / reschedule / cancel — build report
*2026-09-03, builder sub-agent, headless run. Repo: `~/.axis/projects/hana-calendar`.*

## Files changed / created

New:
- `lib/booking/manage-token.ts` — HMAC sign/verify for manage tokens, `manageUrlsForEvent()`
- `lib/booking/manage.ts` — `loadManagedBooking`, `confirmBooking`, `cancelBooking`
- `app/api/booking/manage/route.ts` — `POST {token, action}`
- `app/manage/[token]/page.tsx` — server component: hub / confirm / cancel / reschedule-redirect
- `components/ManageAction.tsx` — client component: auto-POST confirm, click-to-cancel
- `test/manage.test.mjs` — 15 new tests (token sign/verify, confirm idempotency, reschedule shaping)

Modified:
- `lib/booking/google.ts` — `deleteCalendarEvent` gained a `sendUpdates` param (default `"none"`, unchanged behavior for existing callers); added `patchEventSummaryAndProps` (title + props in one CAS-patched write)
- `lib/booking/perform.ts` — reschedule source resolution, reschedule cleanup (patch+delete old event, `booking.cancelled` webhook), reschedule-worded operator email, "Manage this meeting" link on invitee email, `rescheduleToken` on `BookingRequestPayload`
- `lib/booking/podio-notify.ts` — widened `BookingNotifyPayload` to a union: `BookingCreatedPayload` (+ optional `rescheduledFromEventId`/`rescheduledFromStartIso`), `BookingConfirmedPayload`, `BookingCancelledPayload`. Signature scheme (HMAC over `JSON.stringify(payload)`) untouched.
- `lib/booking/reminders.ts` — exported `bookingFromEvent`; reminder3d/1d now build manage links per event and pass them to the templates
- `lib/booking/templates.ts` — `confirmationInviteeEmail` takes optional `manageUrls`; `reminder3dEmail`/`reminder1dEmail` take optional `manageUrls` and render 3 buttons (HTML) / 3 lines (text); new `confirmedByInviteeOperatorEmail`, `cancelledByInviteeOperatorEmail`, `rescheduledOperatorEmail`
- `components/BookingWidget.tsx` — `rescheduleToken`/`rescheduleOldWhen` props, one-line banner, `rescheduleToken` posted to `/api/booking/book`
- `app/[slug]/page.tsx` — resolves `?reschedule=<token>` server-side (via `loadManagedBooking`, checked against the page's own slug), passes to the widget
- `app/globals.css` — `.reschedule-banner`, `.manage-actions`
- `env.example` — documented `BOOKING_WEBHOOK_SECRET` (now dual-purpose: Podio hand-off + manage-link signing), `BOOKING_WEBHOOK_URL`, `NEXT_PUBLIC_BASE_URL`
- `tsconfig.json` — added `allowImportingTsExtensions: true` (see "Unplanned fix" below)
- **All relative imports across `lib/booking/*.ts`** now carry an explicit `.ts` extension (mechanical, e.g. `"./google"` -> `"./google.ts"`) — required by the fix below, zero behavior change (Next's bundler resolves either form identically)

## Unplanned fix (discovered during Step 8, testing)

Node's native ESM loader cannot resolve extensionless relative imports between `.ts` files (this is a base Node ESM constraint, not TS-specific — Next's webpack resolver hides it, `node --test` does not). Every existing test file only ever imported *leaf* modules with zero relative imports (`poll-logic.ts`, `availability.ts`, `google.ts` itself), so this never surfaced before. My new tests are the first to load `manage.ts`/`perform.ts`, which pull in the whole `lib/booking` dependency graph. Fix: explicit `.ts` extensions on every relative import in `lib/booking/*.ts`, plus `allowImportingTsExtensions: true` in `tsconfig.json` (valid alongside `noEmit: true`, which this config already has). Confirmed safe: `tsc --noEmit`, `npm test`, and `npm run build` all pass clean after the change; this also fixed `poll.ts`/`poll-suggest.ts` for any future test that touches them.

## Done-bar, item by item

1. **Three buttons on every 3-day/1-day reminder, signed links.** `lib/booking/manage-token.ts:signManageToken`/`verifyManageToken` — HMAC-SHA256 over `"manage:<eventId>"` with `BOOKING_WEBHOOK_SECRET`, base64url(`<eventId>.<sig16>`), no timestamp so it never expires before the meeting (stays valid exactly as long as the calendar event exists). `manageUrlsForEvent()` builds all three. Wired into `reminder3dEmail`/`reminder1dEmail` at `lib/booking/templates.ts:432-447` (buttons) and `lib/booking/reminders.ts:174` (per-event URL build in the sweep loop).
2. **Confirm.** `app/manage/[token]/page.tsx` renders the confirm view; `components/ManageAction.tsx` auto-fires a `useEffect`-driven POST (never a GET side effect — a scanner that only GETs the page never triggers the effect). Server: `lib/booking/manage.ts:confirmBooking` — idempotent (`event.props.confirmed === "1"` short-circuits, verified by test), appends `" CONFIRMED"` once via `google.ts:patchEventSummaryAndProps(..., "none")`, sets `confirmed=1`/`confirmedAt`, emails Joseph via `confirmedByInviteeOperatorEmail`, fires `booking.confirmed` webhook.
3. **Reschedule.** `app/manage/[token]/page.tsx` redirects `?a=reschedule` to `/<slug>?reschedule=<token>`. `app/[slug]/page.tsx:29-40` resolves the token server-side and only honors it when `booking.eventSlug === slug` (same event type). `components/BookingWidget.tsx` shows the banner and posts `rescheduleToken`. `lib/booking/perform.ts:performBooking` (lines ~161-176 resolve the source, ~207-210 stamp `rescheduledFrom`/`rescheduledFromStart` via the existing `extraPrivateProps` mechanism on the NEW event, ~248-274 patch+delete the OLD event with `sendUpdates="all"` and fire `booking.cancelled` reason `"rescheduled"` + `newStartIso`, ~355-364 send `rescheduledOperatorEmail` instead of the standard new-booking alert). New-booking failure never touches the old event (old-event cleanup code only runs after `createBookingEvent` has already returned successfully).
4. **Cancel.** `app/manage/[token]/page.tsx` confirm-view button -> `ManageAction` POST. `lib/booking/manage.ts:cancelBooking` patches `cancelledBy`/`cancelledAt` before deleting, deletes with `sendUpdates="all"`, emails Joseph, fires `booking.cancelled` reason `"invitee_cancelled"`.
5. **Hub page + "Manage this meeting" link.** `app/manage/[token]/page.tsx` default view (no `?a=`). `confirmationInviteeEmail` at `lib/booking/templates.ts:243` takes an optional `manageUrls` and appends the line when present; wired in `perform.ts:319-321`.
6. **Invalid/expired/deleted token.** `loadManagedBooking` never throws (catches the Google fetch, returns `not_found`); `verifyManageToken` never throws on garbage input (try/catch around the base64url decode, tested with 5 garbage-input cases). The manage page renders a plain "This meeting is no longer on the calendar" panel with a book-again link, no stack trace path exists.
7. **Reminder sweep: confirmed doesn't suppress, never crashes on deleted events.** `confirmed=1` is never read by the sweep's send-gate (only `reminder3d`/`reminder1d` markers gate sends) — comment added at `reminders.ts:170-173` documenting this explicitly. Deleted-event safety was already structurally true (the sweep loop's marker-patch call was already wrapped in try/catch) and is unchanged.
8. **Owner emails.** Plain one-line facts, no em dash, existing Joseph-signature-less operator format (`operatorFooterHtml()` returns empty, matching the standing "no signature on internal alerts" rule) — `confirmedByInviteeOperatorEmail`, `cancelledByInviteeOperatorEmail`, `rescheduledOperatorEmail` in `templates.ts`.
9. **Tests + build.** `test/manage.test.mjs`: 15 tests across token sign/verify (8), confirm title-append idempotency (3), cancel (1), reschedule payload shaping (3). Full suite: 56/56 pass (41 pre-existing + 15 new). `npm run build` passes clean (type-check + lint + all routes compile, including `/manage/[token]` and `/api/booking/manage`). Zero live network calls: `BOOKING_MOCK=1` short-circuits Google/Gmail; `BOOKING_WEBHOOK_URL` is pointed at an unreachable loopback port (`http://127.0.0.1:1/booking`) for the test run specifically so `notifyPodio`'s fetch (which fires whenever `BOOKING_WEBHOOK_SECRET` is set, independent of `BOOKING_MOCK`) fails instantly against a closed local socket instead of ever reaching a real endpoint.

## Confidence statement: `sendUpdates=none` on the confirm title patch

High confidence. Google Calendar API v3's `sendUpdates` parameter on `events.patch` (and `insert`/`delete`) governs attendee notification for that write as a whole — `"none"` is documented to suppress every attendee notification for the write, regardless of which fields changed (summary included). This is the same parameter this codebase already uses correctly elsewhere (`createBookingEvent` uses `sendUpdates=all` on insert; the new cancel/reschedule-delete paths use `sendUpdates=all` deliberately, for the opposite effect). I did not have live credentials to test this against a real Calendar account in this build (Hard Safety Rules forbid it), so this is documented-behavior confidence, not empirically re-verified in this session — flagging per the spec's request to state confidence rather than assert certainty.

## Known limitations / things surfaced rather than smoothed over

- **Reschedule retry gap:** if `createBookingEvent` succeeds but the subsequent old-event delete fails, and the client retries the identical submit, `findExistingBooking` returns the already-created new event early and the old-event cleanup is not retried. Old event would then need a manual look. Logged via `console.error`, never silent.
- **Reschedule onto the exact same slot:** the old event is still `transparency: "opaque"` (busy) until it's deleted mid-flow, so the booking widget's own slot list will show the old event's own time as unavailable during a reschedule. Not a real-world problem (rescheduling always means picking a *different* time) but noting it since it wasn't explicitly tested.
- **`/unbound` page** (a separate branded skin of the same `unbound-mind-ai` event type) was not wired for reschedule-banner display — spec named `BookingWidget.tsx` + `app/[slug]/page.tsx` only. A reschedule link for that event type still works end to end through `/unbound-mind-ai?reschedule=<token>` if that route exists; the `/unbound` vanity page itself just won't show the banner. Flagging as out of the given scope, not a gap in the done-bar.
- `env.example` additions for `BOOKING_WEBHOOK_SECRET`/`BOOKING_WEBHOOK_URL`/`NEXT_PUBLIC_BASE_URL` covered a pre-existing documentation gap (these vars were already read by `podio-notify.ts`/`poll.ts` before this build, just never documented) — added since this build made them load-bearing for a second feature.

## Deploy

Not run (hard safety rule: no deploy). Exact command when Joseph is ready:

```
cd ~/.axis/projects/hana-calendar && npx vercel --prod
```

Also needs `BOOKING_WEBHOOK_SECRET` and `CRON_SECRET` confirmed present in the live Vercel env (both already required by the existing reminder sweep / Podio hand-off, unchanged here) before the buttons and manage links go live for real invitees.

## Commit

Committed to `main` (no push): see `git log -1` in the repo. Message: "Self-service scheduler: confirm, reschedule, cancel buttons on reminder emails."
