# Notification copy — for Joseph's review before credentials go live

Every string below is generated straight from `lib/booking/templates.ts` — the
one file the app itself reads from. This doc is not a separate draft; if the
code changes, re-run the generator and this file changes to match. Nothing
here can actually send yet: no Google, Zoom, or Twilio credentials exist for
this instance (`BOOKING_MOCK=1` is the only mode that has ever run). Joseph
approves this copy, then credentials get provisioned, then it goes live.

Sample booking used for every example below: Alex Rivera books a 30-minute
Event Discovery Call on Zoom for Thu Sep 10, 2026, 11:00 AM in his own
timezone (America/Denver, which is 10:00 AM Phoenix time). A second version
of the confirmation email is shown for a phone-call booking, since the
location line changes.

Brand voice canon this copy is held to: no em-dash, "&" as a connector (never
a comma right before it), ASCII-only subject lines, "Hey [First Name]!"
greeting, and the exact signature block on every email. Texts are never
signed — that's on purpose, texts read as a person, not a system.

---

## 1. Confirmation email to the invitee (Zoom booking)

Fires the instant a booking succeeds, from `performBooking()` in
`lib/booking/perform.ts`.

**Subject:** Confirmed: Event Discovery Call, Sep 10, 11:00 AM MDT

```
Hey Alex!

You're booked for Event Discovery Call, Thursday, September 10, 2026 at 11:00 AM MDT.

We'll meet on Zoom. Join link (same link works from any browser, no app required): https://zoom.us/j/1234567890

If anything comes up, just reply to this email & we'll get it moved.

Check your spam folder if a calendar invite doesn't show up in the next few minutes.

Bringin' the heat,

Joseph Cancilla
Executive Director
HANA Events + Experiences

Office: 555-0100 • Cell: 555-0101
joseph@hana.events • www.hana.events
IG: @the_joseph_cancilla • Hana IG: @hana_around_the_world

Event design that brings people
back to PRESENCE + PURPOSE.

Latest Masterpiece on YouTube: Freedom in the Fire
https://www.youtube.com/watch?v=E3qTY76X1J4&t=4s
```

## 1b. Same email, but a phone-call booking instead of Zoom

Only the location line changes (`lib/booking/templates.ts`'s `locationLine()`).

```
Hey Alex!

You're booked for Event Discovery Call, Thursday, September 10, 2026 at 11:00 AM MDT.

I'll call you at 555-123-4567.

If anything comes up, just reply to this email & we'll get it moved.

Check your spam folder if a calendar invite doesn't show up in the next few minutes.

[... same signature block as above ...]
```

If Zoom is unconfigured at booking time, this line becomes: "We'll meet on
Zoom. The join link will follow in a separate email once it's set up."

---

## 2. Notification email to Joseph (the operator)

Also fires from `performBooking()`, right after the invitee email. Carries
both timezones, the client's answers, and a booking-history line when this
email has booked before (2-year lookback; a failed history lookup is
swallowed rather than blocking the booking).

**Subject:** New booking: Event Discovery Call with Alex Rivera, Sep 10, 10:00 AM Phoenix

```
New booking on Event Discovery Call.

Alex Rivera (alex@example.com, 555-123-4567)

Their time: Thursday, September 10, 2026 at 11:00 AM MDT (America/Denver)
Phoenix time: Thursday, September 10, 2026 at 10:00 AM MST

Zoom join link: https://zoom.us/j/1234567890

What they told us:
What's the date & time of your event?: Nov 14th, evening

Booking history with this email:
Networking 1 to 1, Thursday, April 2, 2026 at 11:00 AM Phoenix

[... same signature block ...]
```

If Zoom is unconfigured, this line replaces the join-link line: "Zoom
unconfigured. No join link went out yet, follow up with one before the
call."

---

## 3. Reminder email, 3 days out

Sent by the sweep (`lib/booking/reminders.ts`) once, gated by the
`reminder3d` marker on the calendar event so a re-run of the sweep never
double-sends it. Fires in a 68-76 hour window on the tight pulse, or a
60-84 hour window on the once-daily backstop cron.

**Subject:** In 3 days: Event Discovery Call

```
Hey Alex!

Quick reminder, we're set for Event Discovery Call on Thursday, September 10, 2026 at 11:00 AM MDT.

We'll meet on Zoom. Join link (same link works from any browser, no app required): https://zoom.us/j/1234567890

Looking forward to it, see you Sep 10, 11:00 AM MDT.

[... same signature block ...]
```

---

## 4. Reminder email, 1 day out

Same idempotent pattern, `reminder1d` marker, 22-28 hour tight window or
18-42 hour daily backstop window.

**Subject:** Tomorrow: Event Discovery Call

```
Hey Alex!

This is your reminder for Event Discovery Call tomorrow, Thursday, September 10 at 11:00 AM MDT.

We'll meet on Zoom. Join link (same link works from any browser, no app required): https://zoom.us/j/1234567890

Talk soon!

[... same signature block ...]
```

---

## 5. Morning-of text

The only SMS this system sends. Silent no-op while Twilio is unconfigured
(true today — launch is email-only). No greeting formality, no sign-off, no
name at the end — texts read like a person, not a notification system.
Timed for the invitee's own local morning: 7 AM local through 60 minutes
before the call, or the evening before (17-20 hours out) if the call itself
starts before about 8 AM their time.

```
Hey Alex! Looking forward to our call at 11:00 AM today.
```

---

## 6. Meeting poll: final-time email to every voter

Fires once from `confirmPoll()` in `lib/booking/poll.ts`, sent to every
distinct voter on a poll (whichever time they picked) once Joseph confirms
the winner or auto-confirm fires. This is the ONLY voter-facing poll email —
there is no separate "vote received" email, on purpose, so voting stays
lightweight.

Sample: Casey Nguyen voted (among others) in a poll for a 60-minute
Consulting or Training session. The poll landed on Thu Sep 10, 2026, 12:00
PM in Casey's own timezone (America/New_York).

**Subject:** Confirmed: Consulting or Training, Sep 10, 2:00 PM EDT

```
Hey Casey!

The time's set. Consulting or Training is confirmed for Thursday, September 10, 2026 at 2:00 PM EDT.

We'll meet on Zoom. Join link (same link works from any browser, no app required): https://zoom.us/j/1234567890

Bringin' the heat,

Joseph Cancilla
Executive Director
HANA Events + Experiences

Office: 555-0100 • Cell: 555-0101
joseph@hana.events • www.hana.events
IG: @the_joseph_cancilla • Hana IG: @hana_around_the_world

Event design that brings people
back to PRESENCE + PURPOSE.

Latest Masterpiece on YouTube: Freedom in the Fire
https://www.youtube.com/watch?v=E3qTY76X1J4&t=4s
```

Joseph also still gets the normal operator "New booking" email (#2 above),
with the invitee name reading `<primary voter> + N more` when a poll landed
on more than one voter.

---

## Generating this file again

This file is hand-copied from a run of `lib/booking/templates.ts`'s exported
functions against a sample booking — there is no build step wired to
regenerate it automatically yet. To refresh it after a template change, run
each exported function (`confirmationInviteeEmail`, `confirmationOperatorEmail`,
`reminder3dEmail`, `reminder1dEmail`, `morningText`, `pollFinalTimeEmail`)
against a sample `NotificationBooking` (or `PollFinalTimeInput`) object and
paste the output back in here. The code is the source of truth; this file is
a snapshot of it for review.
