"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LocationKind, BookingQuestion } from "@/lib/booking/events";

interface WidgetEventType {
  slug: string;
  name: string;
  duration: number;
  locations: LocationKind[];
  questions: BookingQuestion[];
  horizonDays: number;
}

interface DaySlots {
  date: string; // YYYY-MM-DD
  slots: string[]; // UTC ISO
}

interface SlotsResponse {
  configured: boolean;
  days: DaySlots[];
  year: number;
  month: number;
  error?: string;
}

type Step = "pick-date" | "pick-time" | "form" | "confirmed";

const LOCATION_LABELS: Record<LocationKind, string> = {
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
};

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function todayYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function BookingWidget({
  eventType,
  embed,
  rescheduleToken,
  rescheduleOldWhen,
  skin,
}: {
  eventType: WidgetEventType;
  embed: boolean;
  /** Set only by the Unbound-website page, so its confirmation keeps the Unbound look. */
  skin?: "unbound";
  /** Present when this page was reached via /manage/<token>?a=reschedule -> redirect. Carried through to the book API on submit so perform.ts can retire the old event. */
  rescheduleToken?: string;
  /** The old meeting's time, in ITS invitee's original timezone, for the one-line banner. */
  rescheduleOldWhen?: string;
}) {
  const router = useRouter();
  const { year: startYear, month: startMonth } = todayYearMonth();

  const [step, setStep] = useState<Step>("pick-date");
  const [viewYear, setViewYear] = useState(startYear);
  const [viewMonth, setViewMonth] = useState(startMonth);
  // Cache keyed by "YYYY-MM". Always looked up by the SELECTED DAY's own
  // month string, never by whatever month happens to be displayed at the
  // time — that mismatch is the month-boundary cache trap.
  const [monthCache, setMonthCache] = useState<Record<string, DaySlots[]>>({});
  const [configured, setConfigured] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null); // YYYY-MM-DD
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null); // UTC ISO

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState<LocationKind | null>(eventType.locations.length === 1 ? eventType.locations[0] : null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [choiceSelections, setChoiceSelections] = useState<Record<string, string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inviteeTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix";
    } catch {
      return "America/Phoenix";
    }
  }, []);

  async function fetchMonth(year: number, month: number) {
    setLoadingMonth(true);
    try {
      const res = await fetch(`/api/booking/slots?slug=${eventType.slug}&year=${year}&month=${month}`);
      const json: SlotsResponse = await res.json();
      if (res.ok) {
        setMonthCache((prev) => ({ ...prev, [monthKey(year, month)]: json.days }));
        setConfigured(json.configured);
      }
    } catch {
      setErrorMessage("Couldn't load availability. Try again in a moment.");
    } finally {
      setLoadingMonth(false);
    }
  }

  useEffect(() => {
    const key = monthKey(viewYear, viewMonth);
    if (!monthCache[key]) {
      fetchMonth(viewYear, viewMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth]);

  function goToMonth(delta: number) {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    setViewYear(y);
    setViewMonth(m);
  }

  const displayedDays = monthCache[monthKey(viewYear, viewMonth)] ?? [];
  const dayLookup = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const d of displayedDays) map[d.date] = d.slots;
    return map;
  }, [displayedDays]);

  function firstOfMonthOffset(year: number, month: number): number {
    return new Date(year, month - 1, 1).getDay();
  }
  function daysInViewMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  function selectDay(dateStr: string) {
    setSelectedDate(dateStr);
    setErrorMessage(null);
    setStep("pick-time");
  }

  // Looked up by the selected day's own month, derived from the date
  // string itself, so it is correct even if the user has since navigated
  // the visible calendar to a different month.
  const selectedDaySlots = selectedDate ? monthCache[selectedDate.slice(0, 7)]?.find((d) => d.date === selectedDate)?.slots ?? [] : [];

  function selectSlot(iso: string) {
    setSelectedSlot(iso);
    setErrorMessage(null);
    setStep("form");
  }

  function setAnswer(label: string, value: string) {
    setAnswers((prev) => ({ ...prev, [label]: value }));
  }

  function toggleChoice(question: BookingQuestion, choice: string) {
    setChoiceSelections((prev) => {
      const current = prev[question.label] ?? [];
      const next = current.includes(choice) ? current.filter((c) => c !== choice) : [...current, choice];
      return { ...prev, [question.label]: next };
    });
  }

  function composeChoiceAnswer(question: BookingQuestion): string {
    const selections = choiceSelections[question.label] ?? [];
    const other = otherText[question.label]?.trim();
    const parts = [...selections];
    if (question.includeOther && other) parts.push(`Other: ${other}`);
    return parts.join(", ");
  }

  async function submitBooking() {
    if (!selectedSlot) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const finalAnswers: Record<string, string> = {};
    for (const q of eventType.questions) {
      if (q.choices) {
        finalAnswers[q.label] = composeChoiceAnswer(q);
      } else {
        finalAnswers[q.label] = answers[q.label] ?? "";
      }
    }

    const missingRequired = eventType.questions.find((q) => q.required && !finalAnswers[q.label]?.trim());
    if (missingRequired) {
      setErrorMessage(`Please answer: ${missingRequired.label}`);
      setIsSubmitting(false);
      return;
    }
    if (!name.trim()) {
      setErrorMessage("Please enter your name.");
      setIsSubmitting(false);
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage("Please enter a valid email.");
      setIsSubmitting(false);
      return;
    }
    if (location === "phone" && !phone.trim()) {
      setErrorMessage("Please enter a phone number.");
      setIsSubmitting(false);
      return;
    }

    try {
      const body = JSON.stringify({
        slug: eventType.slug,
        startIso: selectedSlot,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        location,
        answers: finalAnswers,
        inviteeTz,
        rescheduleToken: rescheduleToken || undefined,
      });

      // The server is idempotent (a repeated identical booking returns the
      // existing one), so one automatic retry on a network-shaped failure
      // (dropped connection, gateway timeout) is safe and beats surfacing
      // an error to the visitor. Surfaced by a real failed booking 2026-08-28.
      let res: Response;
      try {
        res = await fetch("/api/booking/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.status >= 502 && res.status <= 504) throw new Error("gateway");
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
        res = await fetch("/api/booking/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      }

      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // Slot lost between page load and submit. Drop back to time
        // selection and force a refresh of that day's month cache rather
        // than leaving a dead end.
        const key = (selectedDate ?? "").slice(0, 7);
        setMonthCache((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        if (selectedDate) {
          const [y, m] = selectedDate.split("-").map(Number);
          await fetchMonth(y, m);
        }
        setErrorMessage("That time was just taken. Pick another time below.");
        setStep("pick-time");
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        // Surface the specific validation error from the server when it's a
        // 4xx (user-fixable). Found 2026-10-01 after a real visitor hit this
        // five times in a row and saw only the generic "our end" message, so
        // they had no way to self-correct. Server errors (5xx) still read as
        // "our end" because that is what they really are.
        const rawError: string = typeof json?.error === "string" ? json.error : "";
        const friendly = rawError.startsWith("missing_required_answer:")
          ? `Please answer: ${rawError.slice("missing_required_answer:".length).trim()}`
          : ({
              invalid_json: "Something didn't go through. Please refresh and try again.",
              missing_fields: "Please pick a time and fill in your name & email.",
              unknown_event_type: "This booking type isn't recognized. Please refresh the page.",
              name_required: "Please enter your name.",
              name_too_long: "Please shorten your name and try again.",
              invalid_email: "Please enter a valid email.",
              email_too_long: "That email looks too long. Please shorten it.",
              invalid_location: "Please pick a meeting location (Zoom, phone, or in person).",
              phone_required: "Please enter a phone number.",
              phone_too_long: "That phone number looks too long.",
              answer_too_long: "One of your answers is too long. Please shorten it.",
              too_many_extra_fields: "Please refresh the page and try again.",
              invalid_timezone: "Your browser didn't share a timezone. Please refresh and try again.",
              invalid_start: "That time slot is invalid. Please pick a different time.",
              slot_no_longer_available: "That time was just taken. Please pick another time.",
            } as Record<string, string>)[rawError];
        if (friendly && res.status >= 400 && res.status < 500) {
          setErrorMessage(friendly);
        } else {
          setErrorMessage("Something went wrong on our end. Please try again, or email joseph@hana.events.");
        }
        setIsSubmitting(false);
        return;
      }

      setStep("confirmed");
      const params = new URLSearchParams({
        start: selectedSlot,
        tz: inviteeTz,
        loc: location ?? "",
      });
      if (json.joinUrl) params.set("join", json.joinUrl);
      if (embed) params.set("embed", "1");
      if (skin) params.set("skin", skin);
      router.push(`/${eventType.slug}/confirmed?${params.toString()}`);
    } catch {
      setErrorMessage("Couldn't reach the booking server. Check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  if (step === "confirmed") {
    return <p>Booking confirmed. Taking you to your confirmation...</p>;
  }

  return (
    <div className="widget">
      {rescheduleToken && (
        <div className="reschedule-banner">
          Rescheduling your {eventType.name}
          {rescheduleOldWhen ? ` from ${rescheduleOldWhen}` : ""}. Pick a new time below, we&apos;ll move it.
        </div>
      )}
      {errorMessage && <div className="error-banner">{errorMessage}</div>}
      {!configured && (
        <div className="error-banner">
          Live booking isn't fully wired up yet. Reach out directly at joseph@hana.events to grab time.
        </div>
      )}

      {step === "pick-date" && (
        <div>
          <span className="field-label">Pick a date</span>
          <div className="month-nav">
            <button type="button" onClick={() => goToMonth(-1)} aria-label="Previous month">
              &larr;
            </button>
            <span className="month-label">
              {new Date(viewYear, viewMonth - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })}
            </span>
            <button type="button" onClick={() => goToMonth(1)} aria-label="Next month">
              &rarr;
            </button>
          </div>

          <div className="day-grid">
            {WEEKDAY_HEADERS.map((d, i) => (
              <div key={`h-${i}`} className="day-cell empty" aria-hidden>
                {d}
              </div>
            ))}
            {Array.from({ length: firstOfMonthOffset(viewYear, viewMonth) }).map((_, i) => (
              <div key={`pad-${i}`} className="day-cell empty" />
            ))}
            {Array.from({ length: daysInViewMonth(viewYear, viewMonth) }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hasSlots = (dayLookup[dateStr]?.length ?? 0) > 0;
              return (
                <button
                  key={dateStr}
                  type="button"
                  className="day-cell"
                  disabled={!hasSlots}
                  aria-pressed={selectedDate === dateStr}
                  onClick={() => hasSlots && selectDay(dateStr)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          {loadingMonth && <p>Loading availability...</p>}
          {!loadingMonth && displayedDays.length === 0 && <p>No open times this month.</p>}
        </div>
      )}

      {step === "pick-time" && selectedDate && (
        <div>
          <button type="button" className="btn-back" onClick={() => setStep("pick-date")}>
            &larr; Choose a different date
          </button>
          <span className="field-label">
            {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <div className="time-grid">
            {selectedDaySlots.map((iso) => (
              <button key={iso} type="button" className="time-option" onClick={() => selectSlot(iso)}>
                {new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </button>
            ))}
            {selectedDaySlots.length === 0 && <p>That time is no longer available. Pick another date.</p>}
          </div>
        </div>
      )}

      {step === "form" && selectedSlot && (
        <div>
          <button type="button" className="btn-back" onClick={() => setStep("pick-time")}>
            &larr; Choose a different time
          </button>

          <span className="field-label">
            {new Date(selectedSlot).toLocaleString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>

          {eventType.locations.length > 1 && (
            <div>
              <span className="field-label">How should we meet?</span>
              <div className="location-toggle">
                {eventType.locations.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    className="location-option"
                    aria-pressed={location === loc}
                    onClick={() => setLocation(loc)}
                  >
                    {LOCATION_LABELS[loc]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <span className="field-label">
            Name <span className="field-required">*</span>
          </span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />

          <span className="field-label">
            Email <span className="field-required">*</span>
          </span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />

          {location === "phone" && (
            <>
              <span className="field-label">
                Phone <span className="field-required">*</span>
              </span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
            </>
          )}

          {eventType.questions.map((q) => (
            <div key={q.label}>
              <span className="field-label">
                {q.label} {q.required && <span className="field-required">*</span>}
              </span>
              {q.choices ? (
                <div className="choice-group">
                  {q.choices.map((choice) => (
                    <label key={choice} className="choice-option">
                      <input
                        type="checkbox"
                        checked={(choiceSelections[q.label] ?? []).includes(choice)}
                        onChange={() => toggleChoice(q, choice)}
                      />
                      {choice}
                    </label>
                  ))}
                  {q.includeOther && (
                    <input
                      type="text"
                      placeholder="Other"
                      value={otherText[q.label] ?? ""}
                      onChange={(e) => setOtherText((prev) => ({ ...prev, [q.label]: e.target.value }))}
                      maxLength={2000}
                    />
                  )}
                </div>
              ) : (
                <textarea
                  rows={3}
                  value={answers[q.label] ?? ""}
                  onChange={(e) => setAnswer(q.label, e.target.value)}
                  maxLength={2000}
                />
              )}
            </div>
          ))}

          <button type="button" className="btn" disabled={isSubmitting} onClick={submitBooking}>
            {isSubmitting ? "Booking..." : "Confirm booking"}
          </button>
        </div>
      )}
    </div>
  );
}
