import {
  FaFacebookF,
  FaInstagram,
  FaLinkedinIn,
  FaTiktok,
  FaYoutube,
} from "react-icons/fa6";

const HANA = "https://hana.events";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <h3 className="site-footer-tagline">
        <span className="dim">EVENT DESIGN CONNECTING PEOPLE BACK TO</span>{" "}
        <strong>PRESENCE</strong> <span className="dim">+</span> <strong>PURPOSE</strong>
      </h3>

      <div className="site-footer-cols">
        <div className="site-footer-col logo-col">
          <a href={HANA}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/footer-mark.webp" alt="Hana Events + Experiences" />
          </a>
        </div>

        <div className="site-footer-col">
          <a href={`${HANA}/event-strategy-design-planning`}>EVENT STRATEGY + DESIGN</a>
          <a href={`${HANA}/entertainment-experiences`}>CUSTOM ENTERTAINMENT</a>
          <a href={`${HANA}/lighting---decorf0adf3f8`}>LIGHTING + DECOR</a>
          <a href={`${HANA}/av-production`}>AV + PRODUCTION + AI</a>
          <a href={`${HANA}/journey-of-hana`}>ABOUT</a>
          <a href={`${HANA}/connect`}>CONNECT</a>
          <a href={`${HANA}/blog`}>HANA BLOG</a>
        </div>

        <div className="site-footer-col">
          <span className="site-footer-label">CONNECT WITH US</span>
          <a href="tel:555-0100">555-0100</a>
          <a href="mailto:hello@hana.events" className="underline">
            hello@hana.events
          </a>
          <span className="site-footer-label">RESOURCES</span>
          <a href={`${HANA}/join-our-roster`} className="underline">
            Join Our Roster
          </a>
          <a href={`${HANA}/hana-timesheet`} className="underline">
            Hana Timesheet
          </a>
          <a href={`${HANA}/terms-conditions`} className="underline">
            Terms + Conditions
          </a>
          <a href={`${HANA}/privacy-policy`} className="underline">
            Privacy Policy
          </a>
        </div>

        <div className="site-footer-col">
          <span className="site-footer-label">PHOENIX | VEGAS | SLC | GLOBAL</span>
          <span className="site-footer-cities">
            San Diego, Denver, Dallas, Houston, Miami, Jacksonville, Toronto, Ontario
          </span>
          <a href="https://www.visitphoenix.com" target="_blank" rel="noopener" className="badge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/badge-visit-phoenix.webp" alt="Visit Phoenix proud member" />
          </a>
          <div className="site-footer-social">
            <a href="https://www.facebook.com/HanaAroundTheWorld" target="_blank" rel="noopener" aria-label="Facebook">
              <FaFacebookF />
            </a>
            <a href="https://instagram.com/hana_around_the_world" target="_blank" rel="noopener" aria-label="Instagram">
              <FaInstagram />
            </a>
            <a href="https://www.linkedin.com/company/hanaentertainment/" target="_blank" rel="noopener" aria-label="LinkedIn">
              <FaLinkedinIn />
            </a>
            <a href="https://www.tiktok.com/@joseph_cancilla" target="_blank" rel="noopener" aria-label="TikTok">
              <FaTiktok />
            </a>
            <a href="https://www.youtube.com/@hana_around_the_world" target="_blank" rel="noopener" aria-label="YouTube">
              <FaYoutube />
            </a>
          </div>
        </div>
      </div>

      <div className="site-footer-bottom">
        <a href="https://www.marines.mil" target="_blank" rel="noopener" className="badge veteran">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/badge-veteran-owned.webp" alt="Veteran Owned and Operated" />
        </a>
        <p>&copy; 2026 by HANA EVENTS + EXPERIENCES</p>
      </div>
    </footer>
  );
}
