"use client";

import { useState } from "react";
import {
  FaFacebookF,
  FaInstagram,
  FaLinkedinIn,
  FaTiktok,
  FaYoutube,
} from "react-icons/fa6";

const HANA = "https://hana.events";

const EXPERTISE = [
  ["EVENT STRATEGY + DESIGN", "/event-strategy-design-planning"],
  ["DESTINATION EVENTS", "/destination-events"],
  ["CUSTOM ENTERTAINMENT", "/entertainment-experiences"],
  ["HANA CIRQUE", "/hana-cirque"],
  ["HANA HEAT", "/hana-heat"],
  ["HANA LUAUS", "/hana-luaus"],
  ["HANA LIGHTS", "/hana-lights"],
  ["LIGHTING + DECOR", "/lighting---decorf0adf3f8"],
  ["AV + PRODUCTION + AI", "/av-production"],
  ["PHOTO + VIDEO + DRONE", "/photo-video-drone"],
  ["DJ + MUSIC + EMCEE", "/dj-music-emcee"],
  ["HOSPITALITY • FOOD + BEVERAGE", "/hospitality-food-beverage"],
  ["HOLISTIC + WELLNESS", "/holistic-wellness"],
] as const;

const HIGHLIGHTS = [
  ["LUXURY DISCO BIRTHDAY", "/disco-birthday"],
  ["CIGAR FIRE CIRCUS", "/cigar-fire-circus"],
  ["SUNTRIA CORPORATE PARTY", "/suntria-corporate-event---pg"],
  ["FIRE CIRCUS at USU", "/hana-cirque-at-usu"],
  ["AMERICAN FORK CONCERT LUAU", "/american-fork-concert-luau-pg"],
  ["THE GUARDIANS FIRE CIRCUS", "/the_guardians"],
  ["TREY'S CIRCUS FUNDRAISER", "/treys-circus-fundraiser-pg"],
  ["FERGUSON LUXURY SHOWROOM", "/ferguson-luxury-showroom"],
  ["UNTD SOLAR FIRE CIRCUS", "/untd-fire-circus-pg13"],
  ["SUPER CAR SPLASH 2023", "/super-car-splash-2023"],
  ["HAUNTED HANA CIRCUS", "/haunted-hana-circus"],
  ["YEAR OF THE DRAGON", "/year-of-the-dragon"],
] as const;

const ABOUT = [
  ["HANA LEADERSHIP", "/hana-leadership"],
  ["PODCAST INTERVIEWS", "/podcast-interviews"],
  ["PHOENIX CREW", "/phoenix-crew"],
  ["LAS VEGAS CREW", "/las-vegas-crew"],
  ["SALT LAKE CITY CREW", "/salt-lake-city-crew"],
] as const;

const CONNECT = [
  ["JOIN OUR ROSTER", "/join-our-roster"],
  ["HANA TIMESHEET", "/hana-timesheet"],
] as const;

const SOCIALS = [
  ["Facebook", "https://www.facebook.com/HanaAroundTheWorld", FaFacebookF],
  ["Instagram", "https://instagram.com/hana_around_the_world", FaInstagram],
  ["LinkedIn", "https://www.linkedin.com/company/hanaentertainment/", FaLinkedinIn],
  ["TikTok", "https://www.tiktok.com/@joseph_cancilla", FaTiktok],
  ["YouTube", "https://www.youtube.com/@hana_around_the_world", FaYoutube],
] as const;

export default function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <a href={HANA} className="site-header-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-silver-horizontal.png" alt="Hana Events + Experiences" />
        </a>

        <nav className="site-nav" aria-label="Hana Events">
          <ul>
            <li>
              <a href={HANA}>Home</a>
            </li>
            <li className="has-sub">
              <span className="site-nav-parent">
                Expertise <span aria-hidden>&#9662;</span>
              </span>
              <ul className="site-subnav">
                {EXPERTISE.map(([label, path]) => (
                  <li key={path}>
                    <a href={HANA + path}>{label}</a>
                  </li>
                ))}
              </ul>
            </li>
            <li className="has-sub">
              <span className="site-nav-parent">
                Highlights <span aria-hidden>&#9662;</span>
              </span>
              <ul className="site-subnav">
                {HIGHLIGHTS.map(([label, path]) => (
                  <li key={path}>
                    <a href={HANA + path}>{label}</a>
                  </li>
                ))}
              </ul>
            </li>
            <li className="has-sub">
              <a href={`${HANA}/journey-of-hana`}>
                About <span aria-hidden>&#9662;</span>
              </a>
              <ul className="site-subnav">
                {ABOUT.map(([label, path]) => (
                  <li key={path}>
                    <a href={HANA + path}>{label}</a>
                  </li>
                ))}
              </ul>
            </li>
            <li className="has-sub">
              <a href={`${HANA}/connect`}>
                Connect <span aria-hidden>&#9662;</span>
              </a>
              <ul className="site-subnav">
                {CONNECT.map(([label, path]) => (
                  <li key={path}>
                    <a href={HANA + path}>{label}</a>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <a href={`${HANA}/blog`}>Hana Blog</a>
            </li>
          </ul>
        </nav>

        <a href={`${HANA}/connect`} className="site-cta">
          Let&apos;s Talk
        </a>

        <button
          className="site-hamburger"
          aria-label="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div className={`site-drawer${open ? " open" : ""}`}>
        <nav aria-label="Hana Events mobile">
          <a href={HANA}>Home</a>
          <a href={`${HANA}/entertainment-experiences`}>Expertise</a>
          <a href={`${HANA}/journey-of-hana`}>About</a>
          <a href={`${HANA}/connect`}>Connect</a>
          <a href={`${HANA}/blog`}>Hana Blog</a>
        </nav>
        <a href={`${HANA}/connect`} className="site-cta drawer-cta">
          Let&apos;s Talk
        </a>
        <div className="site-drawer-social">
          {SOCIALS.map(([label, url, Icon]) => (
            <a key={label} href={url} target="_blank" rel="noopener" aria-label={label}>
              <Icon />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
