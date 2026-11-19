"use client";

import { useState } from "react";
import { phoenixTimeToUtcMs } from "@/lib/booking/availability";

const MIN_CANDIDATES = 3;
const MAX_CANDIDATES = 7;
const MAX_INVITEES = 20;

interface EventTypeOption {
  slug: string;
  name: string;
  duration: number;
}

/** "YYYY-MM-DDTHH:MM" (a datetime-local input's value, read as Phoenix wall-clock time) -> UTC ISO. */
function phoenixLocalToUtcIso(local: string): string | null {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const ms = phoenixTimeToUtcMs(Number(y), Number(mo), Number(d), Number(h), Number(mi));
  return new Date(ms).toISOString();
}

/** Textarea -> deduped email list. Accepts one per line, commas, or spaces. */
function parseGuests(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n,;\s]+/)) {
    const e = piece.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export default function PollCreateForm({ eventTypes }: { eventTypes: EventTypeOption[] }) {
  const [title, setTitle] = useState("");
  const [eventTypeSlug, setEventTypeSlug] = useState(eventTypes[0]?.slug ?? "");
  const [autoTimes, setAutoTimes] = useState(true);
  const [candidateLocals, setCandidateLocals] = useState<string[]>(["", "", ""]);
  const [guestsRaw, setGuestsRaw] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [secret, setSecret] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<{ shareUrl: string; invited: number; inviteFailures: string[] } | null>(null);

  const guests = parseGuests(guestsRaw);

  function updateCandidate(i: number, value: string) {
    setCandidateLocals((prev) => prev.map((c, idx) => (idx === i ? value : c)));
  }

  function addCandidate() {
    if (candidateLocals.length >= MAX_CANDIDATES) return;
    setCandidateLocals((prev) => [...prev, ""]);
  }

  function removeCandidate(i: number) {
    if (candidateLocals.length <= MIN_CANDIDATES) return;
    setCandidateLocals((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage("Give the poll a title.");
      return;
    }
    if (!secret.trim()) {
      setErrorMessage("Enter the admin secret.");
      return;
    }
    if (guests.length > MAX_INVITEES) {
      setErrorMessage(`Up to ${MAX_INVITEES} guest emails. You have ${guests.length}.`);
      return;
    }

    const isoCandidates: string[] = [];
    if (!autoTimes) {
      for (const local of candidateLocals) {
        if (!local) {
          setErrorMessage("Fill in every candidate time, or remove the empty ones.");
          return;
        }
        const iso = phoenixLocalToUtcIso(local);
        if (!iso) {
          setErrorMessage("One of the candidate times isn't valid.");
          return;
        }
        isoCandidates.push(iso);
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/poll/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          eventTypeSlug,
          autoTimes,
          candidateStartIsos: autoTimes ? undefined : isoCandidates,
          inviteeEmails: guests,
          expectedVoters: guests.length || 1,
          autoConfirm,
          secret: secret.trim(),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setErrorMessage("That admin secret isn't right.");
        } else {
          setErrorMessage(json.error ? `Couldn't create the poll: ${json.error}` : "Couldn't create the poll.");
        }
        setIsSubmitting(false);
        return;
      }

      setCreated({ shareUrl: json.shareUrl, invited: json.invited ?? 0, inviteFailures: json.inviteFailures ?? [] });
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="widget">
        <span className="field-label">Poll created</span>
        {created.invited > 0 && (
          <p>
            The invitation email just went out to {created.invited} guest{created.invited === 1 ? "" : "s"}. They vote,
            you confirm the winner, everyone gets the calendar invite.
          </p>
        )}
        {created.inviteFailures.length > 0 && (
          <div className="error-banner">
            Couldn&apos;t reach: {created.inviteFailures.join(", ")}
          </div>
        )}
        <p>Voting link (share it with anyone else you want in):</p>
        <p className="join-url-text">
          <a href={created.shareUrl}>{created.shareUrl}</a>
        </p>
        <button type="button" className="btn btn-outline" onClick={() => setCreated(null)}>
          Create another poll
        </button>
      </div>
    );
  }

  return (
    <div className="widget">
      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <span className="field-label">
        Title <span className="field-required">*</span>
      </span>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Q4 planning with the team" />

      <span className="field-label">Event type</span>
      <select value={eventTypeSlug} onChange={(e) => setEventTypeSlug(e.target.value)}>
        {eventTypes.map((e) => (
          <option key={e.slug} value={e.slug}>
            {e.name} ({e.duration} min)
          </option>
        ))}
      </select>

      <span className="field-label">Guest emails (up to {MAX_INVITEES}, one per line or commas)</span>
      <textarea
        rows={5}
        value={guestsRaw}
        onChange={(e) => setGuestsRaw(e.target.value)}
        placeholder={"alex@example.com\nsam@example.com"}
      />
      {guests.length > 0 && (
        <p className="muted-note">
          {guests.length} guest{guests.length === 1 ? "" : "s"} will get the branded invitation the moment you create
          this poll.
        </p>
      )}

      <label className="choice-option">
        <input type="checkbox" checked={autoTimes} onChange={(e) => setAutoTimes(e.target.checked)} />
        Auto-pick 5 open times across the next 2 weeks, evenly spread
      </label>

      {!autoTimes && (
        <>
          <span className="field-label">
            Candidate times (Phoenix time, {MIN_CANDIDATES} to {MAX_CANDIDATES})
          </span>
          <div className="choice-group">
            {candidateLocals.map((value, i) => (
              <div key={i} className="poll-candidate-row">
                <input type="datetime-local" value={value} onChange={(e) => updateCandidate(i, e.target.value)} />
                {candidateLocals.length > MIN_CANDIDATES && (
                  <button type="button" className="btn-back" onClick={() => removeCandidate(i)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            {candidateLocals.length < MAX_CANDIDATES && (
              <button type="button" className="btn-outline btn" onClick={addCandidate}>
                Add another time
              </button>
            )}
          </div>
        </>
      )}

      <label className="choice-option">
        <input type="checkbox" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
        Confirm automatically once every guest has voted
      </label>

      <span className="field-label">
        Admin secret <span className="field-required">*</span>
      </span>
      <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />

      <button type="button" className="btn" disabled={isSubmitting} onClick={submit}>
        {isSubmitting ? "Creating..." : "Create poll & send invites"}
      </button>
    </div>
  );
}
