"use client";

import { useMemo, useState } from "react";
import { formatInZone } from "@/lib/booking/format";

interface CandidateInfo {
  index: number;
  startIso: string;
  voteCount: number;
}

type Step = "vote" | "submitted" | "confirmed";

export default function PollVoteWidget({
  pollId,
  eventName,
  candidates,
}: {
  pollId: string;
  eventName: string;
  candidates: CandidateInfo[];
}) {
  const [step, setStep] = useState<Step>("vote");
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tally, setTally] = useState<{ index: number; startIso: string; voteCount: number }[]>(candidates);
  const [confirmedStartIso, setConfirmedStartIso] = useState<string | null>(null);

  const visitorTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix";
    } catch {
      return "America/Phoenix";
    }
  }, []);

  function toggle(index: number) {
    setSelected((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  }

  async function submitVote() {
    setErrorMessage(null);

    if (selected.length === 0) {
      setErrorMessage("Pick at least one time that works for you.");
      return;
    }
    if (!name.trim()) {
      setErrorMessage("Please enter your name.");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage("Please enter a valid email.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/poll/${pollId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          tz: visitorTz,
          candidateIndexes: selected,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setErrorMessage("This poll is already confirmed. Check your email for the final time.");
        } else {
          setErrorMessage("Something went wrong on our end. Please try again, or email joseph@hana.events.");
        }
        setIsSubmitting(false);
        return;
      }

      if (json.autoConfirmed && json.confirmedStartIso) {
        setConfirmedStartIso(json.confirmedStartIso);
        setStep("confirmed");
      } else {
        setTally(json.tally ?? tally);
        setStep("submitted");
      }
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "confirmed" && confirmedStartIso) {
    return (
      <div className="widget">
        <span className="field-label">Confirmed</span>
        <p>
          Your vote locked in the final time. {eventName} is set for {formatInZone(confirmedStartIso, visitorTz)}.
        </p>
        <p className="spam-note">Check your email for the details.</p>
      </div>
    );
  }

  if (step === "submitted") {
    return (
      <div className="widget">
        <span className="field-label">Thanks, your vote is in</span>
        <p>We&apos;ll email you once the time is locked in.</p>
        <div className="time-grid">
          {tally
            .slice()
            .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
            .map((c) => (
              <div key={c.index} className="time-option poll-tally-row">
                <span>{formatInZone(c.startIso, visitorTz)}</span>
                <span className="poll-tally-count">
                  {c.voteCount} {c.voteCount === 1 ? "vote" : "votes"}
                </span>
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="widget">
      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <span className="field-label">Pick every time that works ({visitorTz})</span>
      <div className="choice-group">
        {candidates
          .slice()
          .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
          .map((c) => (
            <label key={c.index} className="choice-option">
              <input type="checkbox" checked={selected.includes(c.index)} onChange={() => toggle(c.index)} />
              {formatInZone(c.startIso, visitorTz)}
            </label>
          ))}
      </div>

      <span className="field-label">
        Name <span className="field-required">*</span>
      </span>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />

      <span className="field-label">
        Email <span className="field-required">*</span>
      </span>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />

      <button type="button" className="btn" disabled={isSubmitting} onClick={submitVote}>
        {isSubmitting ? "Submitting..." : "Submit my vote"}
      </button>
    </div>
  );
}
