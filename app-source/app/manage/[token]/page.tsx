import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ManageAction from "@/components/ManageAction";
import { loadManagedBooking } from "@/lib/booking/manage";
import { formatInZone } from "@/lib/booking/format";
import { humanLocation } from "@/lib/booking/perform";

// The invitee's self-service hub, reached from the three reminder-email
// buttons and the "Manage this meeting" line on the booking confirmation.
// No `embed` mode here on purpose -- these links are always opened directly
// from an email, never from inside the iframe'd widget.

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const action = sp?.a;

  const loaded = await loadManagedBooking(token);

  if (!loaded.ok) {
    return (
      <>
        <SiteHeader />
        <div className="page">
          <span className="eyebrow">Meeting</span>
          <h1>This meeting is no longer on the calendar</h1>
          <p>The link may be old, or the meeting may already be cancelled or moved.</p>
          <a href="/" className="btn btn-outline">
            Book a new time
          </a>
        </div>
        <SiteFooter />
      </>
    );
  }

  const { booking } = loaded.managed;
  const when = formatInZone(booking.startIso, booking.inviteeTz);
  const bookAgainHref = `/${booking.eventSlug}`;

  // Reschedule needs no confirm-style page of its own -- it hands off to
  // the normal booking widget on the same event type, which is where the
  // actual new-time picker lives (lib/booking/perform.ts does the rest on
  // submit).
  if (action === "reschedule") {
    redirect(`/${booking.eventSlug}?reschedule=${encodeURIComponent(token)}`);
  }

  if (action === "confirm" || action === "cancel") {
    return (
      <>
        <SiteHeader />
        <div className="page">
          <span className="eyebrow">{booking.eventName}</span>
          <h1>{action === "confirm" ? "Confirm your spot" : "Cancel this meeting"}</h1>
          <p>{when}</p>
          <ManageAction token={token} action={action} when={when} bookAgainHref={bookAgainHref} />
        </div>
        <SiteFooter />
      </>
    );
  }

  // Hub view: no action (or an action we don't recognize) -- the meeting +
  // all three buttons.
  return (
    <>
      <SiteHeader />
      <div className="page">
        <span className="eyebrow">{booking.eventName}</span>
        <h1>Manage your meeting</h1>
        <p>{when}</p>
        <p>
          {humanLocation(booking.location)}
          {booking.joinUrl ? `: ${booking.joinUrl}` : ""}
        </p>
        <div className="manage-actions">
          <a className="btn" href={`/manage/${token}?a=confirm`}>
            Confirm
          </a>
          <a className="btn btn-outline" href={`/manage/${token}?a=reschedule`}>
            Reschedule
          </a>
          <a className="btn btn-outline" href={`/manage/${token}?a=cancel`}>
            Cancel
          </a>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
