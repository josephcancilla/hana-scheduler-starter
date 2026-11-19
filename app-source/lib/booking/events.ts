// Event-type catalogue. The only engine file that carries client identity.
//
// Ported from Calendly's public lookup API captures at
// ~/.axis/reference/scheduler/calendly-capture/*.json (captured 2026-08-28).
// Descriptions are VERBATIM from Calendly (Joseph's order) — em-dashes,
// curly quotes and all — do not lint or clean them. `summary` lines are the
// only NEW copy in this file and follow Hana brand voice canon (no em-dash,
// "&" as connector, no banned vocabulary).
//
// Once this file is edited it is the source of truth; the captures above are
// historical from the moment of the edit.

export type LocationKind = "zoom" | "phone" | "in_person";

export interface BookingQuestion {
  label: string;
  required: boolean;
  /** Renders as a select/radio group instead of free text when present. */
  choices?: string[];
  /** Adds an "Other" option with a free-text field alongside `choices`. */
  includeOther?: boolean;
}

/**
 * Which business an event type belongs to. Joseph order 2026-09-06: an
 * Unbound Mind AI booking must look like Unbound end to end -- his operator
 * email AND the client's emails carry Unbound's logo, palette and signature,
 * never Hana's phoenix. He keeps the Unbound option on the Hana hub on
 * purpose; only the notifications change.
 */
export type BookingBrand = "hana" | "unbound";

export interface BookingEventType {
  slug: string;
  /** Business this booking belongs to. Defaults to "hana" when omitted. */
  brand?: BookingBrand;
  name: string;
  /** minutes */
  duration: number;
  /** Verbatim HTML from the Calendly capture. Sanitized at render time. */
  description: string;
  locations: LocationKind[];
  guestsAllowed: boolean;
  questions: BookingQuestion[];
  /** One-line card summary for the hub. New copy, brand-linted. */
  summary: string;
  /** How many days out this event type can be booked. */
  horizonDays: number;
  /**
   * Optional per-event window in 24h Phoenix time, intersected with the
   * global WEEKLY_HOURS (never widens them). Unbound Mind sessions are
   * 10am-4pm only (Joseph, 2026-09-01).
   */
  hours?: { open: number; close: number };
}

export const EVENT_TYPES: BookingEventType[] = [
  {
    slug: "event-discovery-call",
    name: "Event Discovery Call",
    duration: 30,
    description:
      "<p>This 30-minute discovery call is where we start to bring your vision to life. Whether you’re planning an immersive event or exploring custom entertainment options, we’ll co-create in real time—brainstorming ideas, discussing your needs, and getting aligned on the vibe you’re going for.</p><p><br></p><p>We can meet by phone or Zoom, depending on what works best for you (Zoom is great if we want to screen share).</p>",
    locations: ["zoom", "phone"],
    guestsAllowed: true,
    questions: [
      { label: "What's the date & time of your event?", required: true },
      {
        label: "What type of entertainment or event design are you looking for?",
        required: false,
        choices: [
          "Cirque Show",
          "Fire Circus Show",
          "Variety Fire Show",
          "Polynesian Luau",
          "Overall Event Design",
          "Immersive Experience",
        ],
        includeOther: true,
      },
      { label: "What city & state is your event in?", required: false },
    ],
    summary:
      "A 30-minute call to talk through your vision & get aligned on the direction for your event or entertainment.",
    horizonDays: 30,
  },
  {
    slug: "unbound-mind-ai",
    brand: "unbound",
    name: "Unbound Mind AI Session",
    duration: 60,
    description:
      '<p>Book this meeting with me to chat about everything AI. As a Board Member of the Arizona AI Syndicate, we bring deep experience in deploying AI inside the Entertainment &amp; Events industry — and a whole lot more. This session is your opportunity to explore how AI agents and automation can directly impact your business &amp; give you your life back.</p><p><br></p><p>We’ll use this time to:</p><ul>\n<li>Identify operational chokeholds that AI can remove</li>\n<li>Explore Unbound’s Done-For-You Agent Builds and coaching programs</li>\n<li>Share insights from the Syndicate and broader AI ecosystem so you get an edge now, not after it\'s too late.</li>\n</ul><p><br></p><p>Learn more about our work with the Arizona AI Syndicate here: <a href="http://www.azaisyndicate.com/" target="_blank">www.azaisyndicate.com</a></p>',
    locations: ["zoom"],
    guestsAllowed: true,
    questions: [
      {
        label: "Please share anything that will help prepare for our meeting... and how much do you use AI right now?",
        required: false,
      },
    ],
    summary: "An hour on where AI agents & automation could actually move your business forward.",
    horizonDays: 60,
    hours: { open: 10, close: 16 },
  },
  {
    slug: "consulting-or-training",
    name: "Consulting or Training",
    duration: 60,
    description:
      "<p>Whether you’re seeking strategic guidance or hands-on support, this 1:1 session is tailored to your goals. We can use this time for any of the following:</p><p><br></p><ul>\n<li><strong>Website Design &amp; Development</strong></li>\n<li><strong>CRM Setup, Automation &amp; Workflow Design</strong></li>\n<li><strong>Branding, Marketing, Social Media</strong></li>\n<li><strong>AI Implementation &amp; Prompt Training</strong></li>\n<li><strong>Systems Optimization &amp; Digital Strategy</strong></li>\n<li><strong>Creative Brainstorming or Performance Planning</strong></li>\n</ul><p><br></p><p>Bring your questions, roadblocks, or ideas — we’ll dive in together and get you moving forward with clarity, tools, and next steps.</p>",
    locations: ["zoom"],
    guestsAllowed: true,
    questions: [
      {
        label:
          "Please share anything that will help prepare for or guide the flow of our meeting. Help me get on track with where we're at.",
        required: false,
      },
    ],
    summary:
      "A 60-minute 1:1 for website, CRM, branding, AI or systems support, built around what you need most.",
    horizonDays: 30,
  },
  {
    slug: "fire-props-skills-training",
    name: "Fire Props Skills Training",
    duration: 90,
    description:
      "<p>This hands-on training is for anyone ready to step into the world of fire performance. Whether you’re just starting out or want to refine your technique, we’ll focus on safe, powerful movement with live flames using a variety of props, including:</p><p><br></p><p>• Samoan Fire-Knife</p><p>• Short Staff</p><p>• Fire Fans</p><p>• Fire Poi</p><p>• Fire Swords</p><p>• Fire Torches</p><p>• Explosive Lycopodium Props</p><p><br></p><p>You’re welcome to borrow one of my training props for your first few sessions, but you’ll need to order your own gear as soon as possible to begin practicing independently.</p><p><br></p><p>With our Hana Training program, we not only design your training track, we open our entire network to you of private instructors &amp; training studios. Feel free to ask more details about it when we chat!</p>",
    locations: ["in_person"],
    guestsAllowed: true,
    questions: [
      {
        label:
          "Please share anything that will help prepare for our meeting. What are you wanting to focus on most? Have you registered for our Hana Training program?",
        required: false,
      },
    ],
    summary:
      "A 90-minute in-person session covering safe technique with fire knife, staff, fans, poi, swords & torches.",
    horizonDays: 60,
  },
  {
    slug: "networking-1-to-1",
    name: "Networking 1 to 1",
    duration: 60,
    description:
      "<p>Whether we met at an event or in passing, we rarely get the chance to actually connect. This is an open, hour-long space to get to know each other on both a personal and professional level. We’ll explore possible alignment, crossovers, and ways we can support each other’s growth. Available in person or via Zoom — whatever works best for you.</p>",
    locations: ["zoom", "phone"],
    guestsAllowed: true,
    questions: [
      {
        label:
          "Please share anything that will help prepare for our meeting, including your website, Facebook, Instagram, LinkedIn or all of the above.",
        required: false,
      },
    ],
    summary: "An hour to actually connect, in person or on Zoom, and find where our work lines up.",
    horizonDays: 60,
  },
  {
    slug: "photo-video-planning",
    name: "Photo + Video Planning Call",
    duration: 30,
    description:
      "<p>Let’s get aligned on the vision. In this 20-30 minute call, we’ll walk through the goals, location, timing, and aesthetic for your shoot or video session—whether it’s a live event, portrait session, or brand content. I’ll answer any questions &amp; make sure we’re dialed in before it's go time. This can be on the phone, but if there are visuals we want to review, let's jump on Zoom!</p>",
    locations: ["zoom", "phone"],
    guestsAllowed: true,
    questions: [
      {
        label: "Please share anything that will help prepare for our meeting or the photo session.",
        required: false,
      },
    ],
    summary: "A 30-minute call to plan the goals, location, timing & look for your shoot before it's go time.",
    horizonDays: 30,
  },
  {
    slug: "talent-interview",
    name: "Talent or Vendor Interview",
    duration: 45,
    description:
      "<p>This is a 30–45 minute conversation to get to know you &amp; your background, and what lights you up! We’ll walk through how we work, what we look for with our talent and/or vendors, and answer any questions you have about joining the Hana team. This can be on Zoom or on the phone.</p>",
    locations: ["zoom", "phone"],
    guestsAllowed: true,
    questions: [
      {
        label: "Please share anything that will help prepare for our meeting or that you would like us to know about you.",
        required: false,
      },
      { label: "What city & state are you in?", required: false },
    ],
    summary: "A 30 to 45 minute conversation about your background & how you might fit with the Hana team.",
    horizonDays: 60,
  },
  {
    slug: "ut-fire-performer-licensing",
    name: "NFPA Fire Safety Training",
    duration: 60,
    description:
      "<p>This session is for fire performers looking to level up their fire safety skills. We’ll cover everything required by the State Fire Marshal to prepare you for pulling fire permits—including safe fueling, ignition, emergency response, and real-world fire performance protocols, including putting Joseph out while he is on fire.</p><p><br></p><p>What’s included in this training:</p><p>• State-approved Fire Safety class (can be done via Zoom)</p><p>• Hands-on discussion of safety gear, fuel types, and extinguishing techniques (in-person).</p><p>• Q&amp;A to prepare you for any state exam.</p><p>• Review of licensing requirements and best practices for UT &amp; NV.</p>",
    locations: ["zoom"],
    guestsAllowed: true,
    questions: [{ label: "Please share anything that will help prepare for our meeting.", required: false }],
    summary: "A fire safety training built around what UT & NV require to pull a performance permit.",
    horizonDays: 60,
  },
  {
    slug: "website-design-zoom",
    name: "Website Design on Zoom",
    duration: 60,
    description:
      "<p>The most effective way to design your website is side-by-side on Zoom. Real-time feedback helps me move faster and keeps your costs down. At the end of each session, I’ll give you clear homework so you know exactly what to prep before our next call so we can make the most of our time together.</p>",
    locations: ["zoom"],
    guestsAllowed: true,
    questions: [
      {
        label:
          "Please share any notes that will help prepare for our Zoom meeting. This could be what we're working on next, notes about what you've finished & have ready to go or content.",
        required: false,
      },
    ],
    summary: "A 60-minute side-by-side Zoom session building your website in real time.",
    horizonDays: 30,
  },
];

export function getEventType(slug: string): BookingEventType | undefined {
  return EVENT_TYPES.find((e) => e.slug === slug);
}

/**
 * Resolves which brand a notification should wear. Takes a slug when we have
 * one and falls back to the event NAME, because the self-service confirm /
 * cancel / reschedule notices carry only a name. Anything unrecognized is
 * Hana, so a new event type can never accidentally go out as Unbound.
 */
export function brandFor(input: { eventSlug?: string; eventName?: string }): BookingBrand {
  const bySlug = input.eventSlug ? getEventType(input.eventSlug) : undefined;
  if (bySlug) return bySlug.brand ?? "hana";
  if (input.eventName) {
    const byName = EVENT_TYPES.find((e) => e.name === input.eventName);
    if (byName) return byName.brand ?? "hana";
  }
  return "hana";
}
