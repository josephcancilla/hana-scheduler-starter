import type { Metadata } from "next";
import { getEventType, type LocationKind } from "@/lib/booking/events";
import { sanitizeHtml } from "@/lib/booking/sanitize-html";
import BookingWidget from "@/components/BookingWidget";

// Unbound-branded standalone page for the one meeting type Unbound sells.
// Same engine, same description, same widget as /unbound-mind-ai — skinned
// with the unboundmind.ai palette and the white Unbound logo, embedded in a
// modal on unboundmind.ai/book (Joseph's Book-with-Joseph button).

const LOCATION_LABELS: Record<LocationKind, string> = {
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
};

export const metadata: Metadata = {
  title: "Unbound Mind AI Session | Unbound Mind",
  description: "Book an Unbound Mind AI Session with Joseph Cancilla.",
};

export default async function UnboundEventPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  const sp = await searchParams;
  const embed = sp?.embed === "1";

  const eventType = getEventType("unbound-mind-ai");
  if (!eventType) return null;

  return (
    <div className="theme-unbound">
      <style>{`html, body { background: #f4efe6; }`}</style>
      <div className={`unbound-band${embed ? " compact" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/unbound-logo-white.png" alt="Unbound Mind" />
      </div>
      <div className={`page event-page${embed ? " embed" : ""}`}>
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
              skin="unbound"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
