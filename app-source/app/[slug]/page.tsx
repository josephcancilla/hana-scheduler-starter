import { notFound } from "next/navigation";
import { getEventType, type LocationKind } from "@/lib/booking/events";
import { sanitizeHtml } from "@/lib/booking/sanitize-html";
import { loadManagedBooking } from "@/lib/booking/manage";
import { formatInZone } from "@/lib/booking/format";
import BookingWidget from "@/components/BookingWidget";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const LOCATION_LABELS: Record<LocationKind, string> = {
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
};

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string; reschedule?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const embed = sp?.embed === "1";

  const eventType = getEventType(slug);
  if (!eventType) notFound();

  // A reschedule token that's invalid, for a different event type, or
  // whose old event is already gone just falls back to a plain booking
  // page -- no error, no banner, per lib/booking/perform.ts's same
  // fail-soft posture on the actual submit.
  let rescheduleToken: string | undefined;
  let rescheduleOldWhen: string | undefined;
  if (sp?.reschedule) {
    const loaded = await loadManagedBooking(sp.reschedule);
    if (loaded.ok && loaded.managed.booking.eventSlug === slug) {
      rescheduleToken = sp.reschedule;
      rescheduleOldWhen = formatInZone(loaded.managed.booking.startIso, loaded.managed.booking.inviteeTz);
    }
  }

  return (
    <>
    {!embed && <SiteHeader />}
    <div className={`page event-page${embed ? " embed" : ""}`}>
      {!embed && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="header">
            <img src="/logo-vertical.png" alt="Hana Events + Experiences" />
          </div>
          <a href="/" className="btn-back">
            &larr; All event types
          </a>
        </>
      )}

      <div className="event-layout">
        <div className="event-info">
          <div className="event-headshot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/joseph-headshot.jpg" alt="Joseph Cancilla" />
          </div>

          <span className="eyebrow">{eventType.duration} minutes</span>
          <h1>{eventType.name}</h1>

          <div className="event-meta-row">
            <span>{eventType.locations.map((l) => LOCATION_LABELS[l]).join(" or ")}</span>
          </div>

          <div
            className="event-description"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(eventType.description) }}
          />
        </div>

        <div className="event-booking">
          <hr className="hairline" />
          <BookingWidget
            eventType={{
              slug: eventType.slug,
              name: eventType.name,
              duration: eventType.duration,
              locations: eventType.locations,
              questions: eventType.questions,
              horizonDays: eventType.horizonDays,
            }}
            embed={embed}
            rescheduleToken={rescheduleToken}
            rescheduleOldWhen={rescheduleOldWhen}
          />
        </div>
      </div>

    </div>
    {!embed && <SiteFooter />}
    </>
  );
}
