import { getPoll } from "@/lib/booking/poll";
import { getEventType } from "@/lib/booking/events";
import { formatInZone } from "@/lib/booking/format";
import PollVoteWidget from "@/components/PollVoteWidget";
import { zoomLandingFor } from "@/lib/booking/zoom";

export default async function PollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const poll = await getPoll(id);

  if (!poll) {
    return (
      <div className="page">
        <div className="header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white-horizontal.png" alt="Hana Events + Experiences" />
        </div>
        <span className="eyebrow">Meeting poll</span>
        <h1>We can&apos;t find that poll</h1>
        <p>This link may be old, or the poll may have been removed. Reach out at joseph@hana.events if you think that&apos;s wrong.</p>
      </div>
    );
  }

  const eventType = getEventType(poll.eventTypeSlug);
  const eventName = eventType?.name ?? poll.pollTitle;
  const durationMin = eventType?.duration ?? 30;

  if (poll.status === "confirmed" && poll.confirmed) {
    const phoenixTime = formatInZone(poll.confirmed.startIso, "America/Phoenix");
    return (
      <div className="page">
        <div className="header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white-horizontal.png" alt="Hana Events + Experiences" />
        </div>
        <span className="eyebrow">Meeting poll, confirmed</span>
        <h1>{poll.pollTitle}</h1>
        <div className="confirmed-panel">
          <p>The time is locked in for {eventName}.</p>
          <div className="confirmed-time">
            <div className="confirmed-time-row">
              <span className="confirmed-time-label">Phoenix time</span>
              <span>{phoenixTime}</span>
            </div>
          </div>
          {poll.confirmed.joinUrl && (
            <p>
              Zoom link:
              <br />
              <a href={zoomLandingFor(poll.eventTypeSlug)} className="join-url-text">
                {zoomLandingFor(poll.eventTypeSlug)}
              </a>
            </p>
          )}
          <p className="spam-note">Everyone who voted was emailed the final time.</p>
        </div>
        <div className="footer">
          <a href="https://hana.events">hana.events</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white-horizontal.png" alt="Hana Events + Experiences" />
      </div>
      <span className="eyebrow">
        {eventName} &middot; {durationMin} minutes
      </span>
      <h1>{poll.pollTitle}</h1>
      <p>Pick every time below that works for you, then add your name & email so we can confirm you.</p>

      <hr className="hairline" />

      <PollVoteWidget
        pollId={poll.pollId}
        eventName={eventName}
        candidates={poll.candidates.map((c) => ({ index: c.index, startIso: c.startIso, voteCount: c.votes.length }))}
      />

      <div className="footer">
        <a href="https://hana.events">hana.events</a>
      </div>
    </div>
  );
}
