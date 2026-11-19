"use client";

import { useEffect, useState } from "react";

type Phase = "idle" | "working" | "done" | "error";

export default function ManageAction({
  token,
  action,
  when,
  bookAgainHref,
}: {
  token: string;
  action: "confirm" | "cancel";
  when: string;
  bookAgainHref: string;
}) {
  const [phase, setPhase] = useState<Phase>(action === "confirm" ? "working" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedWhen, setConfirmedWhen] = useState(when);

  async function fire() {
    setPhase("working");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/booking/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        setPhase("error");
        setErrorMessage(
          json.error === "not_found" || json.error === "invalid_token"
            ? "This meeting is no longer on the calendar."
            : "Something went wrong. Please try again, or email joseph@hana.events."
        );
        return;
      }

      if (action === "confirm" && json.when) setConfirmedWhen(json.when);
      setPhase("done");
    } catch {
      setPhase("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  // Email link scanners GET the manage-page URL but never run this effect
  // (it only fires client-side), so a scanner visiting /manage/<token>?a=confirm
  // can never confirm on the invitee's behalf. Only a real browser POSTs.
  useEffect(() => {
    if (action === "confirm") fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "error") {
    return <div className="error-banner">{errorMessage}</div>;
  }

  if (phase === "done" && action === "confirm") {
    return <p>You&apos;re confirmed, see you {confirmedWhen}.</p>;
  }

  if (phase === "done" && action === "cancel") {
    return (
      <p>
        Cancelled. Book again any time: <a href={bookAgainHref}>{bookAgainHref}</a>
      </p>
    );
  }

  if (action === "confirm") {
    return <p>Confirming your spot...</p>;
  }

  return (
    <button type="button" className="btn" disabled={phase === "working"} onClick={fire}>
      {phase === "working" ? "Cancelling..." : "Yes, cancel this meeting"}
    </button>
  );
}
