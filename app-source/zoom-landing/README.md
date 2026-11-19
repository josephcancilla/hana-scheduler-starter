# hana-events.zoom.us landing page

The Zoom vanity landing page is custom HTML pasted into Zoom's branding editor
(zoom.us > Account Management > Account Profile > Branding > Landing Page > Landing Page Html).
`hana-events.zoom.us.html` is the exact HTML that is live (2026-09-03, overlay 78%; Joseph stepped it 66 → 70 → 76 → 84 → 78: 84 was too dark once the slower loops landed). Assets are served from this app's `public/`
(hero loop, poster, vertical logo, smoke loop) because hana.events' bot challenge blocks hotlinks.

Zoom editor rules learned the hard way:
- Zoom's CSP blocks every custom script on the page, so no WebGL. The red smoke is a pre-rendered mp4
  (`public/hana-smoke-loop-v3.mp4`, rendered at intensity 1.0 and SPEED=0.7 (30% slower, 48s seamless), made by hana-website `tools/render-smoke-loop.mjs`) layered with `mix-blend-mode: screen`.
- The editor rejects `<a href>`, `<form>`, `<script>`, `<iframe>`, `playsinline`, and `data:` image sources.
- Buttons are HTML image maps: a styled `<span>` with an invisible `<img usemap>` on top and a `<map><area href>`.
  Zoom's server validates the HTML itself (it rejected `playsinline`, so it is a real allowlist) and accepts image maps.
  The editor's client-side pre-check misreports usemap images as "img: src"; saving through the Save button's own click
  handler (element.click()) posts to /account/branding/save, which returned status true and persisted. Verify by a FULL reload of the editor, then curl the live page.
- Saves only register after a real keystroke in the textarea. Set the value, type a space, backspace, then Save.
- Phones: Zoom's SERVER rejects `playsinline` (save fails with errorCode 3501, discardedAttributes video:playsinline), so
  no video can autoplay inline on iPhone there. Touch devices (`hover: none` + `pointer: coarse`) get animated WebP images
  instead: `public/hana-hero-mobile-v2.webp` (14s seamless loop cut from the slowed hero, 2s crossfade, portrait crop, 405x720, 12fps, ~2.3 MB) and
  `public/hana-smoke-mobile-v2.webp` (20s seamless loop from the SPEED=0.7 render, 3s crossfade, 270x480, 10fps, lossless ~3.2 MB — lossy WebP, Pillow AND img2webp, merges the near-identical dark frames down to ~60 and kills the motion).
  Rebuild: frames from the desktop renders → portrait crop → `build_webp.py` pattern (blend the first X seconds with the frames past the loop end so it seams). Desktop hero is `public/hana-hero-loop-slow.mp4`: the original 62s loop slowed 30% with ffmpeg minterpolate (mci) at 24fps, 720p, crf 26, ~15 MB. Joseph: not smooth on phone + wanted 30% slower everywhere (2026-09-03).
  Buttons stack vertically under 640px (Join Zoom, Hana Website, Schedule with Joseph).
- JOIN ZOOM = Joseph's Personal Meeting ID link with the passcode embedded (one click, no prompt).

## 2026-10-02: clients now get zoom.hana.events

The copy clients receive is `public/zoom-room.html` in this app, served at https://zoom.hana.events (and calendar.hana.events/zoom) with real links. This Zoom-hosted page stays up as a backup only: Zoom bounces anyone signed into their own Zoom account from hana-events.zoom.us to zoom.com. Change both copies together.
