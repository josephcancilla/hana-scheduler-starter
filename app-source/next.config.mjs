/** @type {import('next').NextConfig} */
const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://hana.events https://www.hana.events https://unboundmind.ai https://www.unboundmind.ai https://josephcancilla.com https://www.josephcancilla.com";

const nextConfig = {
  async redirects() {
    return [
      {
        // Typo alias: calendEr.hana.events forwards to the real spelling.
        source: "/:path*",
        has: [{ type: "host", value: "calender.hana.events" }],
        destination: "https://calendar.hana.events/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      // beforeFiles so it wins over the scheduler's own home page.
      beforeFiles: [
        {
          // zoom.hana.events: Joseph's Zoom landing page, hosted by us because
          // hana-events.zoom.us bounces anyone signed into their own Zoom to
          // zoom.com (Eve Whitaker, 2026-10-01). Joseph order 2026-10-02.
          source: "/",
          has: [{ type: "host", value: "zoom.hana.events" }],
          destination: "/zoom-room.html",
        },
        // Same page on the scheduler's own address, as a fallback.
        { source: "/zoom", destination: "/zoom-room.html" },
        {
          // zoom.unboundmind.ai: the Unbound twin, same room (Joseph 2026-10-02).
          source: "/",
          has: [{ type: "host", value: "zoom.unboundmind.ai" }],
          destination: "/zoom-unbound.html",
        },
        { source: "/zoom-unbound", destination: "/zoom-unbound.html" },
      ],
    };
  },
  async headers() {
    return [
      {
        // Applies to every page in this app. The whole subdomain is the
        // scheduler, so every page is a legitimate iframe target for the
        // parent site and nowhere else.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: FRAME_ANCESTORS,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
