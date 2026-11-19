import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalZoomJoinUrl } from "../lib/booking/zoom.ts";
import { reassembleProps } from "../lib/booking/google.ts";

// Joseph's order 2026-09-03: every Zoom join link this app ever shows a
// human must read hana-events.zoom.us, even for bookings stored before
// this shipped (whose stored links may still carry us06web.zoom.us or the
// old idea8ion.zoom.us vanity host). canonicalZoomJoinUrl is the single
// rewrite point; reassembleProps (lib/booking/google.ts) is the read-back
// choke point every stored booking's joinUrl passes through.

describe("canonicalZoomJoinUrl", () => {
  test("rewrites a us06web.zoom.us join link", () => {
    assert.equal(
      canonicalZoomJoinUrl("https://us06web.zoom.us/j/89012345678?pwd=abcXYZ123"),
      "https://hana-events.zoom.us/j/89012345678?pwd=abcXYZ123"
    );
  });

  test("rewrites the retired idea8ion.zoom.us vanity host", () => {
    assert.equal(
      canonicalZoomJoinUrl("https://idea8ion.zoom.us/j/0000000000"),
      "https://hana-events.zoom.us/j/0000000000"
    );
  });

  test("rewrites a bare zoom.us join link", () => {
    assert.equal(canonicalZoomJoinUrl("https://zoom.us/j/1234567890"), "https://hana-events.zoom.us/j/1234567890");
  });

  test("an already-canonical hana-events.zoom.us link is unchanged", () => {
    const url = "https://hana-events.zoom.us/j/0000000000?pwd=xyz";
    assert.equal(canonicalZoomJoinUrl(url), url);
  });

  test("a non-zoom URL is left untouched", () => {
    const url = "https://calendar.hana.events/manage/abc123";
    assert.equal(canonicalZoomJoinUrl(url), url);
  });

  test("a personal /my/ link is rewritten the same way as /j/", () => {
    assert.equal(
      canonicalZoomJoinUrl("https://us06web.zoom.us/my/josephcancilla"),
      "https://hana-events.zoom.us/my/josephcancilla"
    );
  });

  test("null passes through unchanged", () => {
    assert.equal(canonicalZoomJoinUrl(null), null);
  });

  test("undefined passes through unchanged", () => {
    assert.equal(canonicalZoomJoinUrl(undefined), undefined);
  });

  test("empty string passes through unchanged", () => {
    assert.equal(canonicalZoomJoinUrl(""), "");
  });

  test("an unparsable string is returned as-is rather than throwing", () => {
    assert.equal(canonicalZoomJoinUrl("not a url at all"), "not a url at all");
  });

  test("a zoom.us host with a path that is not /j/ or /my/ is left untouched", () => {
    const url = "https://zoom.us/webinar/register/abc123";
    assert.equal(canonicalZoomJoinUrl(url), url);
  });

  test("query string with pwd survives the host rewrite exactly", () => {
    const rewritten = canonicalZoomJoinUrl("https://us06web.zoom.us/j/0000000000?pwd=Ab12Cd34Ef&foo=bar");
    assert.equal(rewritten, "https://hana-events.zoom.us/j/0000000000?pwd=Ab12Cd34Ef&foo=bar");
  });
});

describe("reassembleProps — stored joinUrl comes back canonical", () => {
  test("a props blob written before hana-events.zoom.us existed reads back canonical", () => {
    const raw = {
      hanaBooking: "1",
      inviteeName: "Test Invitee",
      joinUrl: "https://us06web.zoom.us/j/89012345678?pwd=abcXYZ123",
    };
    const props = reassembleProps(raw);
    assert.equal(props.joinUrl, "https://zoom.hana.events");
  });

  test("the old idea8ion.zoom.us vanity host also reads back canonical", () => {
    const props = reassembleProps({ joinUrl: "https://idea8ion.zoom.us/j/0000000000" });
    assert.equal(props.joinUrl, "https://zoom.hana.events");
  });

  test("props with no joinUrl key at all pass through with no joinUrl added", () => {
    const props = reassembleProps({ hanaBooking: "1", inviteeName: "No Zoom" });
    assert.equal(props.joinUrl, undefined);
  });

  test("an empty-string joinUrl (unconfigured-Zoom booking) stays empty, not crashed on", () => {
    const props = reassembleProps({ hanaBooking: "1", joinUrl: "" });
    assert.equal(props.joinUrl, "");
  });

  test("non-joinUrl props are untouched by the rewrite", () => {
    const props = reassembleProps({ inviteeEmail: "test@example.com", joinUrl: "https://us06web.zoom.us/j/111" });
    assert.equal(props.inviteeEmail, "test@example.com");
    assert.equal(props.joinUrl, "https://zoom.hana.events");
  });
});

describe("bare landing-page links read back as zoom.hana.events (2026-10-02)", () => {
  test("the old bare hana-events.zoom.us root becomes zoom.hana.events", () => {
    assert.equal(canonicalZoomJoinUrl("https://hana-events.zoom.us"), "https://zoom.hana.events");
    assert.equal(canonicalZoomJoinUrl("https://hana-events.zoom.us/"), "https://zoom.hana.events");
    assert.equal(canonicalZoomJoinUrl("http://hana-events.zoom.us"), "https://zoom.hana.events");
  });
  test("a stored props blob with the bare root reads back as the new page", () => {
    assert.equal(reassembleProps({ joinUrl: "https://hana-events.zoom.us" }).joinUrl, "https://zoom.hana.events");
  });
});

describe("stored links read back per brand (2026-10-02)", () => {
  test("an Unbound booking reads back as zoom.unboundmind.ai", () => {
    assert.equal(reassembleProps({ eventSlug: "unbound-mind-ai", joinUrl: "https://hana-events.zoom.us" }).joinUrl, "https://zoom.unboundmind.ai");
  });
  test("a Hana booking reads back as zoom.hana.events", () => {
    assert.equal(reassembleProps({ eventSlug: "networking-1-to-1", joinUrl: "https://hana-events.zoom.us" }).joinUrl, "https://zoom.hana.events");
  });
});

describe("no per-booking Zoom meetings (Joseph order 2026-10-02)", async () => {
  const { readFileSync } = await import("node:fs");
  const { standingRoom } = await import("../lib/booking/zoom.ts");
  test("booking and poll code never call the Zoom meeting API", () => {
    for (const f of ["lib/booking/perform.ts", "lib/booking/poll.ts"]) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      assert.ok(!/createZoomMeeting\s*\(/.test(src), `${f} still creates a Zoom meeting`);
    }
  });
  test("the standing room is his personal room, linked by brand", () => {
    assert.equal(standingRoom("networking-1-to-1").joinUrl, "https://zoom.hana.events");
    assert.equal(standingRoom("unbound-mind-ai").joinUrl, "https://zoom.unboundmind.ai");
    assert.equal(standingRoom("networking-1-to-1").meetingId, "0000000000");
  });
});
