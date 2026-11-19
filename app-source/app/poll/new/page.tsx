import { EVENT_TYPES } from "@/lib/booking/events";
import PollCreateForm from "@/components/PollCreateForm";

export default function NewPollPage() {
  return (
    <div className="page">
      <div className="header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white-horizontal.png" alt="Hana Events + Experiences" />
      </div>
      <span className="eyebrow">Admin</span>
      <h1>New meeting poll</h1>
      <p>
        Drop in up to 20 guest emails. The engine picks 5 open times across the next 2 weeks, sends everyone the
        branded invitation, they vote, you confirm the winner & the calendar invite goes to every voter.
      </p>

      <hr className="hairline" />

      <PollCreateForm
        eventTypes={EVENT_TYPES.map((e) => ({ slug: e.slug, name: e.name, duration: e.duration }))}
      />
    </div>
  );
}
