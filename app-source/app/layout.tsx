import type { Metadata } from "next";
import { Marcellus, Jost } from "next/font/google";
import "./globals.css";

const marcellus = Marcellus({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://calendar.hana.events"),
  title: "Book time with Joseph Cancilla | Hana Events + Experiences",
  description: "Schedule a call or session with Joseph Cancilla, Hana Events + Experiences.",
  openGraph: {
    title: "Schedule with Joseph",
    description: "Book time with Joseph Cancilla, Hana Events + Experiences.",
    url: "https://calendar.hana.events",
    siteName: "Hana Events + Experiences",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Schedule with Joseph" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Schedule with Joseph",
    description: "Book time with Joseph Cancilla, Hana Events + Experiences.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${marcellus.variable} ${jost.variable}`}>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'addEventListener("load",function(){setTimeout(function(){var s=document.createElement("script");s.src="/smoke.js";document.body.appendChild(s)},120)},{once:true});',
          }}
        />
      </body>
    </html>
  );
}
