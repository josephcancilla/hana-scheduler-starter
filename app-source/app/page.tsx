import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { EVENT_TYPES } from "@/lib/booking/events";

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  const sp = await searchParams;
  const embed = sp?.embed === "1";

  return (
    <>
    {!embed && <SiteHeader />}
    <div className={`page${embed ? " embed" : ""}`}>
      {!embed && (
        // eslint-disable-next-line @next/next/no-img-element
        <div className="header">
          <img src="/logo-vertical.png" alt="Hana Events + Experiences" />
        </div>
      )}

      <div className="hub-headshot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/joseph-headshot.jpg" alt="Joseph Cancilla" />
      </div>

      <div className="hub-welcome">
        <span className="eyebrow">Schedule with Joseph</span>
        <p>
          Here&apos;s my scheduling link. Looking forward connecting with you. Are we training or are we creating
          together?
        </p>
      </div>

      <div className="card-list">
        {EVENT_TYPES.map((e) => (
          <Link key={e.slug} href={embed ? `/${e.slug}?embed=1` : `/${e.slug}`} className="card">
            <span className="card-meta">{e.duration} min</span>
            <div className="card-name">{e.name}</div>
            <p className="card-summary">{e.summary}</p>
          </Link>
        ))}
      </div>

    </div>
    {!embed && <SiteFooter />}
    </>
  );
}
