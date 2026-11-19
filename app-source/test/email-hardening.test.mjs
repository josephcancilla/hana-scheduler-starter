import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmationInviteeEmail,
  confirmationOperatorEmail,
  reminder3dEmail,
  reminder1dEmail,
  confirmedByInviteeOperatorEmail,
  cancelledByInviteeOperatorEmail,
  rescheduledOperatorEmail,
  pollFinalTimeEmail,
  pollInviteEmail,
  pollVoteAlertEmail,
  pollCompleteEmail,
  morningText,
} from "../lib/booking/templates.ts";
import { EVENT_TYPES, brandFor } from "../lib/booking/events.ts";

// Anti-drift suite for the whole email system.
//
// Written 2026-09-08 after three bugs shipped under a fully green suite:
// operator alerts sent as bare plain text, an Unbound booking wearing Hana
// chrome, and a shell pinned wider than a phone. The common thread is that
// every one of them produced a WRONG-LOOKING email without throwing, and
// nothing here was checking what a human would actually see.
//
// So this file asserts on rendered output across the FULL matrix (every
// builder against every event type in the roster) rather than on one happy
// path, and it includes a structural guard that reads the source so a NEW
// send site added later cannot quietly forget the brand.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const LIB = path.join(ROOT, "lib", "booking");

const PALETTES = {
  hana: "#0A0908",
  unbound: "#EBDCBF",
};

const UNBOUND = EVENT_TYPES.find((e) => e.brand === "unbound");
const HANA = EVENT_TYPES.find((e) => (e.brand ?? "hana") === "hana");

function bookingFor(eventType, overrides = {}) {
  return {
    inviteeName: "Test Person",
    inviteeEmail: "test@example.com",
    eventName: eventType.name,
    eventSlug: eventType.slug,
    startIso: "2026-09-11T18:00:00.000Z",
    durationMin: eventType.duration ?? 60,
    inviteeTz: "America/New_York",
    location: "zoom",
    joinUrl: "https://hana-events.zoom.us",
    answers: {},
    ...overrides,
  };
}

/**
 * Every builder that renders a full HTML email, wrapped so each takes one
 * event type. Keeping them in one list is the point: a new builder added
 * without a row here is the drift this file exists to stop, and the
 * "every builder is covered" test below fails when that happens.
 */
const HTML_BUILDERS = {
  confirmationInviteeEmail: (et) => confirmationInviteeEmail(bookingFor(et)),
  confirmationOperatorEmail: (et) => confirmationOperatorEmail(bookingFor(et)),
  reminder3dEmail: (et) => reminder3dEmail(bookingFor(et)),
  reminder1dEmail: (et) => reminder1dEmail(bookingFor(et)),
  confirmedByInviteeOperatorEmail: (et) => confirmedByInviteeOperatorEmail(bookingFor(et)),
  cancelledByInviteeOperatorEmail: (et) => cancelledByInviteeOperatorEmail(bookingFor(et)),
  rescheduledOperatorEmail: (et) =>
    rescheduledOperatorEmail({ booking: bookingFor(et), oldStartIso: "2026-09-09T16:00:00.000Z" }),
  pollFinalTimeEmail: (et) =>
    pollFinalTimeEmail({
      voterName: "Test Person",
      voterEmail: "test@example.com",
      voterTz: "America/New_York",
      eventName: et.name,
      eventSlug: et.slug,
      startIso: "2026-09-11T18:00:00.000Z",
      durationMin: et.duration ?? 60,
      location: "zoom",
      joinUrl: "https://hana-events.zoom.us",
    }),
  pollInviteEmail: (et) =>
    pollInviteEmail({
      pollTitle: "Test poll",
      eventSlug: et.slug,
      eventName: et.name,
      durationMin: et.duration ?? 60,
      candidateStartIsos: ["2026-09-11T18:00:00.000Z", "2026-09-14T16:00:00.000Z"],
      pollUrl: "https://calendar.hana.events/poll/test",
    }),
  pollVoteAlertEmail: (et) =>
    pollVoteAlertEmail({
      pollTitle: "Test poll",
      eventSlug: et.slug,
      eventName: et.name,
      voterName: "Test Person",
      voterEmail: "test@example.com",
      chosenTimes: ["Fri, Sep 11 at 11:00 AM"],
      tally: [["Fri, Sep 11 at 11:00 AM", 1]],
      votedCount: 1,
      expectedVoters: 2,
      pollUrl: "https://calendar.hana.events/poll/test",
    }),
  pollCompleteEmail: (et) =>
    pollCompleteEmail({
      pollTitle: "Test poll",
      eventSlug: et.slug,
      eventName: et.name,
      expectedVoters: 2,
      winnerLabel: "Fri, Sep 11 at 11:00 AM",
      winnerVotes: 2,
      tally: [["Fri, Sep 11 at 11:00 AM", 2]],
      acceptUrl: "https://calendar.hana.events/accept",
      adjustUrl: "https://calendar.hana.events/poll/new",
      pollUrl: "https://calendar.hana.events/poll/test",
    }),
};

/** Builders whose copy a CLIENT reads. Joseph's voice canon binds these. */
const CLIENT_FACING = new Set([
  "confirmationInviteeEmail",
  "reminder3dEmail",
  "reminder1dEmail",
  "pollFinalTimeEmail",
  "pollInviteEmail",
]);

/** Strings that mean a value went missing and rendered as itself. */
const LEAKED_VALUES = ["undefined", "null", "NaN", "[object Object]", "${", "Invalid Date"];

describe("scheduler email hardening", () => {
  describe("the roster itself", () => {
    test("every event type resolves to a brand we actually have a palette for", () => {
      assert.ok(EVENT_TYPES.length > 0, "event roster is empty");
      for (const et of EVENT_TYPES) {
        const brand = brandFor({ eventSlug: et.slug });
        assert.ok(
          Object.hasOwn(PALETTES, brand),
          `event type "${et.slug}" resolves to brand "${brand}", which has no palette here`
        );
      }
    });

    test("the roster still covers both brands, so this whole file means something", () => {
      assert.ok(HANA, "no Hana event type in the roster");
      assert.ok(UNBOUND, "no Unbound event type in the roster");
    });

    test("a typo'd or missing slug falls back to Hana, never to Unbound", () => {
      // Safe direction matters: a new Hana event type that nobody registered
      // should look like Hana, not accidentally speak as Unbound.
      assert.equal(brandFor({ eventSlug: "typo-does-not-exist" }), "hana");
      assert.equal(brandFor({ eventName: "Nothing By This Name" }), "hana");
      assert.equal(brandFor({}), "hana");
    });

    test("every logo an email points at exists in the public folder", () => {
      const src = readFileSync(path.join(LIB, "templates.ts"), "utf8");
      const urls = [...src.matchAll(/logoUrl:\s*"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(urls.length >= 2, "expected a logo per brand");
      for (const url of urls) {
        const file = url.split("/").pop();
        assert.ok(
          existsSync(path.join(ROOT, "public", file)),
          `email points at "${url}" but public/${file} does not exist, so it renders as a broken image`
        );
      }
    });
  });

  describe("full matrix: every builder against every event type", () => {
    test("every HTML builder in templates.ts is covered by this file", () => {
      const src = readFileSync(path.join(LIB, "templates.ts"), "utf8");
      const exported = [...src.matchAll(/^export function (\w+Email)\s*\(/gm)].map((m) => m[1]);
      const covered = new Set(Object.keys(HTML_BUILDERS));
      const missing = exported.filter((name) => !covered.has(name));
      assert.deepEqual(
        missing,
        [],
        `these email builders have no coverage here — add them to HTML_BUILDERS: ${missing.join(", ")}`
      );
    });

    for (const [name, build] of Object.entries(HTML_BUILDERS)) {
      for (const et of EVENT_TYPES) {
        const expected = brandFor({ eventSlug: et.slug });
        const wrong = expected === "hana" ? "unbound" : "hana";

        test(`${name} / ${et.slug}: wears ${expected} and nothing from the other brand`, () => {
          const out = build(et);
          assert.ok(
            out.html.includes(PALETTES[expected]),
            `${name} on "${et.slug}" is missing the ${expected} palette`
          );
          assert.ok(
            !out.html.includes(PALETTES[wrong]),
            `${name} on "${et.slug}" leaked ${wrong} chrome into a ${expected} email`
          );
        });

        test(`${name} / ${et.slug}: is a real email, not a stub`, () => {
          const out = build(et);
          assert.ok(out.html.startsWith("<!DOCTYPE html>"), `${name}: not a full HTML document`);
          assert.ok(out.html.length > 800, `${name}: html is only ${out.html.length} chars`);
          assert.ok(out.text.trim().length > 20, `${name}: text part is empty or near-empty`);
          assert.ok(out.subject.trim().length > 0, `${name}: empty subject`);
        });

        test(`${name} / ${et.slug}: no missing value rendered as text`, () => {
          const out = build(et);
          for (const bad of LEAKED_VALUES) {
            assert.ok(!out.html.includes(bad), `${name} on "${et.slug}" rendered "${bad}" into the html`);
            assert.ok(!out.subject.includes(bad), `${name} on "${et.slug}" rendered "${bad}" into the subject`);
            assert.ok(!out.text.includes(bad), `${name} on "${et.slug}" rendered "${bad}" into the text part`);
          }
        });

        test(`${name} / ${et.slug}: subject is plain ASCII`, () => {
          const { subject } = build(et);
          // Smart quotes and dashes mangle in some inbox previews, which is why
          // every subject goes through toAscii. This catches one that skipped it.
          // eslint-disable-next-line no-control-regex
          assert.ok(/^[\x20-\x7E]*$/.test(subject), `${name}: non-ASCII subject "${subject}"`);
        });
      }
    }
  });

  describe("Joseph's voice canon on client-facing copy", () => {
    const BANNED_WORDS = ["spectacle", "dazzling", "otherworldly", "cleanly", "aloha"];

    for (const name of CLIENT_FACING) {
      test(`${name}: no em-dash in copy a client reads`, () => {
        for (const et of EVENT_TYPES) {
          const out = HTML_BUILDERS[name](et);
          assert.ok(!out.text.includes("—"), `${name} on "${et.slug}": em-dash in the client's copy`);
          assert.ok(!out.subject.includes("—"), `${name} on "${et.slug}": em-dash in the subject`);
        }
      });

      test(`${name}: none of Joseph's banned words`, () => {
        for (const et of EVENT_TYPES) {
          const out = HTML_BUILDERS[name](et);
          const haystack = `${out.subject}\n${out.text}`.toLowerCase();
          for (const word of BANNED_WORDS) {
            assert.ok(
              !new RegExp(`\\b${word}\\b`).test(haystack),
              `${name} on "${et.slug}": banned word "${word}"`
            );
          }
        }
      });
    }
  });

  describe("the morning text", () => {
    test("renders for every event type with no missing values", () => {
      for (const et of EVENT_TYPES) {
        const txt = morningText(bookingFor(et));
        assert.ok(txt.trim().length > 10, `morningText is empty for "${et.slug}"`);
        for (const bad of LEAKED_VALUES) {
          assert.ok(!txt.includes(bad), `morningText on "${et.slug}" rendered "${bad}"`);
        }
      }
    });

    test("a phone booking leads with the call and offers video second", () => {
      const txt = morningText({ ...bookingFor(HANA), location: "phone", inviteePhone: "520-316-4621" });
      assert.ok(txt.includes("I'll call you at 520-316-4621"), "phone text never says Joseph will call");
      assert.ok(!/Join here:/.test(txt), "phone text still reads like a Zoom meeting");
      assert.ok(/If you'd rather meet on video:\nhttps:\/\/zoom\.hana\.events/.test(txt), "phone text lost the video backup link");
    });

    test("a Zoom booking keeps the Join here link", () => {
      const txt = morningText({ ...bookingFor(HANA), location: "zoom" });
      assert.ok(/Join here:\nhttps:\/\//.test(txt), "zoom text lost its join link");
      assert.ok(!txt.includes("I'll call you"), "zoom text claims a phone call");
    });

    test("is never signed, per Joseph's standing rule on texts", () => {
      const txt = morningText(bookingFor(HANA));
      assert.ok(!/Bringin' the heat/i.test(txt), "morning text carries an email signature block");
    });
  });

  describe("the shell survives a phone", () => {
    test("no builder pins a hard pixel width that beats a narrow screen", () => {
      for (const [name, build] of Object.entries(HTML_BUILDERS)) {
        const html = build(HANA).html;
        assert.ok(!html.includes('width="560"'), `${name}: container pinned to 560px again`);
        assert.ok(html.includes("max-width:560px"), `${name}: container lost its max-width cap`);
        assert.ok(html.includes("max-width:100%"), `${name}: an image can overflow a narrow screen`);
      }
    });

    test("detail values can wrap instead of running off the side", () => {
      const html = confirmedByInviteeOperatorEmail(
        bookingFor(HANA, { inviteeEmail: "a-very-long-address-that-must-wrap@averylongdomainname.example.com" })
      ).html;
      assert.ok(html.includes("word-break:break-word"), "detail values can no longer wrap");
    });
  });

  describe("structural guard: no send site can forget the brand", () => {
    // This is the guard that actually stops the next drift. The bugs above
    // were all "a caller forgot something and the default was silently Hana."
    // fromName/fromEmail are optional on the send input by design (mock and
    // test paths), so the compiler cannot enforce this. Reading the source can.
    function sendEmailCallSites() {
      const sites = [];
      for (const file of readdirSync(LIB).filter((f) => f.endsWith(".ts"))) {
        const src = readFileSync(path.join(LIB, file), "utf8");
        let i = 0;
        while ((i = src.indexOf("sendEmail({", i)) !== -1) {
          // Walk braces so a nested object never truncates the call.
          let depth = 0;
          let j = src.indexOf("{", i);
          const start = j;
          for (; j < src.length; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") {
              depth--;
              if (depth === 0) break;
            }
          }
          const body = src.slice(start, j + 1);
          const line = src.slice(0, i).split("\n").length;
          sites.push({ file, line, body });
          i = j;
        }
      }
      return sites;
    }

    test("there are send sites to check (the scanner itself works)", () => {
      const sites = sendEmailCallSites();
      assert.ok(sites.length >= 5, `scanner found only ${sites.length} send sites, it is probably broken`);
    });

    test("every send site passes real branded html", () => {
      for (const { file, line, body } of sendEmailCallSites()) {
        assert.ok(
          /\bhtml:\s*[A-Za-z_$]/.test(body),
          `${file}:${line} does not pass a real html value. A hand-built or missing html is the exact bug that sent Joseph plain text.`
        );
        assert.ok(
          !/html:\s*[`"']\s*<p>/.test(body),
          `${file}:${line} hand-builds its html instead of using a branded template`
        );
      }
    });

    test("every send site sets a brand-aware sender", () => {
      for (const { file, line, body } of sendEmailCallSites()) {
        assert.ok(
          /\bfromName:/.test(body) && /\bfromEmail:/.test(body),
          `${file}:${line} omits fromName/fromEmail, so it silently sends as Hana even for an Unbound booking`
        );
        assert.ok(
          !/fromEmail:\s*["'][^"']*hana\.events["']/.test(body),
          `${file}:${line} hardcodes a Hana from address instead of reading the booking's brand`
        );
      }
    });

    test("no builder hardcodes a brand instead of resolving it", () => {
      const src = readFileSync(path.join(LIB, "templates.ts"), "utf8");
      const hardcoded = [...src.matchAll(/renderKit\(\s*["'](\w+)["']\s*\)/g)];
      assert.deepEqual(
        hardcoded.map((m) => m[1]),
        [],
        "a template hardcodes its brand again; every renderKit call must resolve through brandFor"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// The runtime canary in mail.ts. Tests guard the code we have; this guards the
// paths nobody wrote a test for, by making bad mail loud in production logs.
// ---------------------------------------------------------------------------
describe("runtime canary", () => {
  test("shouts when a send is unbranded, and still sends it", async () => {
    process.env.BOOKING_MOCK = "1";
    const { sendEmail } = await import("../lib/booking/mail.ts");

    const shouted = [];
    const realError = console.error;
    console.error = (...args) => shouted.push(args);
    let result;
    try {
      result = await sendEmail({
        to: "test@example.com",
        subject: "Plain one-liner",
        text: "one line",
        html: "<p>one line</p>",
      });
    } finally {
      console.error = realError;
    }

    const hit = shouted.find(([tag]) => tag === "[booking] UNBRANDED_EMAIL");
    assert.ok(hit, "an unbranded send passed the canary in silence");
    assert.ok(hit[1].problems.length >= 3, `canary under-reported: ${JSON.stringify(hit[1].problems)}`);
    // Fail-open is the whole posture: a client's confirmation still goes.
    assert.equal(result.ok, true, "the canary blocked a send; it must never do that");
  });

  test("stays quiet on a real branded email", async () => {
    process.env.BOOKING_MOCK = "1";
    const { sendEmail } = await import("../lib/booking/mail.ts");
    const email = confirmationInviteeEmail(bookingFor(HANA));

    const shouted = [];
    const realError = console.error;
    console.error = (...args) => shouted.push(args);
    try {
      await sendEmail({
        to: "test@example.com",
        fromName: "Hana Events + Experiences",
        fromEmail: "joseph@hana.events",
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } finally {
      console.error = realError;
    }

    assert.deepEqual(
      shouted.filter(([tag]) => tag === "[booking] UNBRANDED_EMAIL"),
      [],
      "the canary cried wolf on a perfectly good email"
    );
  });
});

describe("only the new Zoom link ever goes out (Joseph order 2026-10-02)", () => {
  // Fixtures above store the OLD bare hana-events.zoom.us link on purpose:
  // bookings made before the switch still carry it, and it must never leak.
  const OLD = /hana-events\.zoom\.us(?!\/j\/)/;
  const STORED = ["https://hana-events.zoom.us", "https://hana-events.zoom.us/j/89012345678?pwd=abc", undefined];

  for (const et of EVENT_TYPES) {
    for (const [name, build] of Object.entries(HTML_BUILDERS)) {
      test(`${et.slug} / ${name}: no old landing link anywhere`, () => {
        const out = build(et);
        const all = `${out.html}\n${out.text ?? ""}\n${out.subject ?? ""}`;
        assert.ok(!OLD.test(all), `${name} still carries the old hana-events.zoom.us link`);
      });
    }
  }

  for (const stored of STORED) {
    for (const location of ["zoom", "phone"]) {
      test(`every client touch uses zoom.hana.events (location=${location}, stored=${stored ?? "none"})`, () => {
        const b = bookingFor(HANA, { location, inviteePhone: "520-316-4621", joinUrl: stored });
        for (const out of [confirmationInviteeEmail(b), reminder3dEmail(b), reminder1dEmail(b)]) {
          const all = `${out.html}\n${out.text ?? ""}`;
          assert.ok(all.includes("https://zoom.hana.events"), "client email lost the Zoom link");
          assert.ok(!all.includes("hana-events.zoom.us"), "client email carries an old Zoom link");
        }
        const txt = morningText(b);
        assert.ok(txt.includes("https://zoom.hana.events"), "morning text lost the Zoom link");
        assert.ok(!txt.includes("hana-events.zoom.us"), "morning text carries an old Zoom link");
      });
    }
  }

  test("an in-person booking gets no Zoom link at all", () => {
    const txt = morningText(bookingFor(HANA, { location: "in_person" }));
    assert.ok(!txt.includes("zoom.hana.events"));
  });
});

describe("Unbound bookings get the Unbound Zoom page (Joseph order 2026-10-02)", () => {
  for (const location of ["zoom", "phone"]) {
    test(`Unbound ${location} booking: zoom.unboundmind.ai on every touch, never the Hana page`, () => {
      const b = bookingFor(UNBOUND, { location, inviteePhone: "520-316-4621" });
      for (const out of [confirmationInviteeEmail(b), reminder3dEmail(b), reminder1dEmail(b), confirmationOperatorEmail(b)]) {
        const all = `${out.html}\n${out.text ?? ""}`;
        assert.ok(all.includes("https://zoom.unboundmind.ai"), "Unbound email lost its Zoom link");
        assert.ok(!all.includes("zoom.hana.events"), "Unbound email carries the Hana Zoom page");
      }
      const txt = morningText(b);
      assert.ok(txt.includes("https://zoom.unboundmind.ai") && !txt.includes("zoom.hana.events"));
    });
  }
  test("Hana bookings never get the Unbound page", () => {
    const all = confirmationInviteeEmail(bookingFor(HANA)).html + morningText(bookingFor(HANA));
    assert.ok(!all.includes("unboundmind.ai/") && !all.includes("zoom.unboundmind.ai"));
  });
});
