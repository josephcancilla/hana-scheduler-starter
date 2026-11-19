import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getEventType } from "@/lib/booking/events";
import { formatInZone } from "@/lib/booking/format";

export default async function ConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ start?: string; tz?: string; join?: string; embed?: string; skin?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const eventType = getEventType(slug);
  if (!eventType) notFound();

  const embed = sp?.embed === "1";
  const startIso = sp?.start;
  const inviteeTz = sp?.tz || "America/Phoenix";
  const joinUrl = sp?.join;

  const visitorTime = startIso ? formatInZone(startIso, inviteeTz) : null;
  const phoenixTime = startIso ? formatInZone(startIso, "America/Phoenix") : null;
  // Only the Unbound-website booking page sets this; the Hana scheduler always stays Hana.
  const isUnbound = sp?.skin === "unbound";

  const panel = (
    <div className="confirmed-panel">
      <span className="eyebrow">Confirmed</span>
      <h1>You&apos;re on the calendar</h1>
      <p>
        {eventType.name} is booked. A calendar invite &amp; confirmation email are on their way to you.
      </p>

      {startIso && visitorTime && phoenixTime && (
        <div className="confirmed-time">
          <div className="confirmed-time-row">
            <span className="confirmed-time-label">Your time</span>
            <span>{visitorTime}</span>
          </div>
          <div className="confirmed-time-row">
            <span className="confirmed-time-label">Phoenix time</span>
            <span>{phoenixTime}</span>
          </div>
        </div>
      )}

      {joinUrl && (
        <p>
          Zoom link:
          <br />
          <a href={joinUrl} target="_top" className="join-url-text">
            {joinUrl}
          </a>
        </p>
      )}

      <p className="spam-note">
        Check your spam folder if the confirmation email doesn&apos;t show up in the next few minutes.
      </p>

      {!embed && !isUnbound && (
        <a href="/" className="btn btn-outline" target="_top">
          Back to all event types
        </a>
      )}
    </div>
  );

  if (isUnbound) {
    return (
      <div className="theme-unbound">
        <style>{`html, body { background: #f4efe6; }`}</style>
        <div className={`unbound-band${embed ? " compact" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/unbound-logo-white.png" alt="Unbound Mind" />
        </div>
        <div className={`page${embed ? " embed" : ""}`}>{panel}</div>
      </div>
    );
  }

  return (
    <>
      {!embed && <SiteHeader />}
      <div className={`page${embed ? " embed" : ""}`}>{panel}</div>
      {!embed && <SiteFooter />}
    </>
  );
}
