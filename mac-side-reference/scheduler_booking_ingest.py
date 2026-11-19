#!/usr/bin/env python3
"""
scheduler_booking_ingest.py — calendar.hana.events booking → Podio + vault.

Joseph order 2026-09-01: every booking on the in-house scheduler must reach
Podio on its own. Check Hana Networking AND the Unbound Contacts app; if the
person is in neither, create them in the lane the meeting belongs to; leave a
plain-English comment; keep a paper trail; write their contact note into the
Obsidian vault, born linked (Rule 26).

Replaces the Calendly webhook pipe (calendly_webhook_ingest.py), whose Podio
helpers are reused here so the two can never drift while both exist.

Reads one JSON payload on stdin (posted by ~/.axis/bin/podio-webhook-receiver.js
on /booking after signature check). Prints one JSON result line. LLM-free.
Dry run: SCHEDULER_INGEST_DRY_RUN=1.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

AXIS = Path.home() / ".axis"
sys.path.insert(0, str(AXIS / "lib"))

import calendly_webhook_ingest as cw  # noqa: E402  shared Podio helpers
from axis_factlock import FactClaim, verify_facts  # noqa: E402  (Rule 15 retrofit, 2026-09-22)

LOG = AXIS / "logs" / "scheduler-booking" / "ingest.log"
LEDGER = AXIS / "state" / "scheduler-booking" / "processed.jsonl"
VAULT = AXIS / "vault"

# Rule 15 Fact-Lock — every write this file makes onto an EXISTING Podio item
# (a comment post or a field update) funnels through podio_write() below.
# This file had ZERO fact-lock coverage before this retrofit: every comment
# and every status/field PUT went straight to cw.podio_api / cw.podio_add_comment
# with no re-check that the record found earlier in the run is still the same
# person the booking email belongs to. A new item CREATE is not gated here —
# there is no prior canonical record to diff a freshly-created item against,
# so an identity claim on a create would be circular (Rule 15's claim must
# resolve from a canonical source, never from the text being written).
FACTLOCK_AGENT_NAME = "scheduler-booking-ingest"
FACTLOCK_HALT_LOG = AXIS / "audit" / f"{FACTLOCK_AGENT_NAME}_factlock_halts.log"

# Email field external_id differs by app: Hana Networking and Hana Contacts
# both use e-mail-2; Unbound Contacts uses a plain "email" field (see
# find_unbound_contact's filter below).
_LANE_EMAIL_FIELD = {"hana": "e-mail-2", "hana-contact": "e-mail-2", "unbound": "email"}


def _escalate_held_write(item_id: int, context: str, failed: list, *, test: bool = False) -> None:
    """A held write must never sit invisible: one digest entry per hold so
    Joseph sees it in the daily rollup (Rule 33 — a task/log entry is not a
    ping). Fail-soft: digest problems must never break the ingest run.

    test: threaded straight from the _factlock_gate() call that triggered
    this escalation (2026-09-22 fix). A test-tagged halt must never reach
    Joseph's real digest/morning report -- see defer_to_digest()'s own
    docstring for the incident this closes. Default False keeps every real
    halt reaching the real queue exactly as before."""
    try:
        from axis_joseph_ping_gate import defer_to_digest
        defer_to_digest(
            FACTLOCK_AGENT_NAME, "held_scheduler_write",
            f"A scheduler-booking write on Podio item {item_id} ({context}) "
            f"was held by fact-lock: {', '.join(str(f) for f in failed)[:160]}. "
            f"The booking is safe in the ingest log; it needs a human look.",
            test=test,
        )
    except Exception as e:  # noqa: BLE001
        _log(f"held_write_digest_failed item_id={item_id} context={context}: {e}")


def _factlock_gate(item_id: int, expected_email: str, lane: str, context: str, *, test: bool = False) -> bool:
    """Rule 15 gate, run right before every raw Podio comment POST or field
    PUT in this file. Re-verifies the item we are about to write onto still
    belongs to the same email this booking is for -- that can drift between
    when the record was looked up earlier in this run (podio_find_networking_by_email
    / find_hana_contact / find_unbound_contact) and the moment of the actual
    write, several network calls later in the same function: a merged
    duplicate, a hand-corrected email, a reassigned record. Same claim shape
    nurture-reply-watcher and axis-nurture-podio-write already use for their
    own writes (comment_target_email_matches_thread /
    comment_target_email_matches_sent_to) -- reused the established pattern
    rather than inventing a new one.

    Returns True to proceed with the write, False to halt (write NOT
    performed). Every call writes a manifest to ~/.axis/ledger/factlock/
    regardless of outcome; a halt additionally appends one line to
    FACTLOCK_HALT_LOG so it reads distinctly from an ordinary API error in
    the ingest log.
    """
    source_field = _LANE_EMAIL_FIELD.get(lane, "e-mail-2")
    claims = [
        FactClaim(
            key="write_target_email_matches_expected",
            expected=expected_email,
            source_type="podio_item",
            source_id=item_id,
            source_field=source_field,
            match_mode="normalized",
            critical=True,
            note="the Podio record we are about to write onto (comment or "
                 "field update) must still be the same person this booking's "
                 "email belongs to",
        )
    ]
    result = verify_facts(claims, agent_name=FACTLOCK_AGENT_NAME, action_type=context, test=test)
    if result.halt_recommended:
        FACTLOCK_HALT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with FACTLOCK_HALT_LOG.open("a") as fh:
            fh.write(
                f"{datetime.now(ZoneInfo('America/Phoenix')).isoformat()} | scheduler-booking-ingest | "
                f"{context} | item_id={item_id} | lane={lane} | expected_email={expected_email} | "
                f"{result.failed} | manifest={result.manifest_path}\n"
            )
        _log(f"write_held_factlock item_id={item_id} lane={lane} context={context} failed={result.failed}")
        _escalate_held_write(item_id, context, result.failed, test=test)
        return False
    return True



HANA_NETWORKING_APP = cw.NETWORKING_APP_ID          # 29381061
UNBOUND_CONTACTS_APP = 30756057                      # Unbound Mind AI → Contacts
HANA_CONTACTS_APP = 18163453                         # Hana → Contacts (clients). A client
                                                     # who books a call must never be re-created
                                                     # as a Networking connection (Rule 27).
UNBOUND_SLUGS = {"unbound-mind-ai"}

STATUS_ZOOM_SCHEDULED = cw.NETWORKING_STATUS_ZOOM    # 3  Zoom 1-2-1 Scheduled
STATUS_INPERSON_SCHEDULED = 2                        # In-Person 1-2-1 Scheduled
NETWORKING_SOURCE_HANA_WEBSITE = 24                  # existing Source option; Calendly (33) is retired
SIGN = "\n\n— Nurture"


def _log(msg: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(ZoneInfo("America/Phoenix")).strftime("%Y-%m-%d %H:%M:%S")
        with LOG.open("a") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def _result(**kw) -> None:
    print(json.dumps(kw))
    sys.exit(0)


def _seen(key: str) -> bool:
    try:
        if not LEDGER.exists():
            return False
        for line in LEDGER.read_text().splitlines():
            if line.strip() and json.loads(line).get("key") == key:
                return True
    except Exception:
        pass
    return False


def _ledger(key: str, **row) -> None:
    try:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        row.update(key=key, at=datetime.now(ZoneInfo("America/Phoenix")).isoformat(timespec="seconds"))
        with LEDGER.open("a") as f:
            f.write(json.dumps(row) + "\n")
    except Exception as e:
        _log(f"ledger write failed: {e}")


def _friendly(start_iso: str, tz: str) -> str:
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).astimezone(ZoneInfo(tz or "America/Phoenix"))
        return dt.strftime("%A, %B %-d at %-I:%M %p").replace(" 0", " ") + f" ({dt.tzname()})"
    except Exception:
        return start_iso


def _split_name(full: str) -> tuple[str, str]:
    parts = (full or "").strip().split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def _where(location: str, join_url: str | None) -> str:
    if location == "zoom":
        return "on Zoom" + (f"\n\nJoin link:\n{join_url}" if join_url else "")
    if location == "phone":
        return "by phone"
    return "in person"


# ── Podio lookups / writes ──────────────────────────────────────────────────

def _item_link(item: dict) -> str:
    link = item.get("link") or ""
    if link:
        return link
    try:
        from axis_podio_link import safe_item_link  # Rule 35: never hand-build
        return safe_item_link(item.get("item_id"))
    except Exception:
        return ""


def find_hana_contact(token: str, email: str) -> dict | None:
    res = cw.podio_api(token, f"/item/app/{HANA_CONTACTS_APP}/filter/", method="POST",
                       body={"filters": {"e-mail-2": [email]}, "limit": 5})
    items = res.get("items") or []
    return items[0] if items else None


def find_unbound_contact(token: str, email: str) -> dict | None:
    res = cw.podio_api(token, f"/item/app/{UNBOUND_CONTACTS_APP}/filter/", method="POST",
                       body={"filters": {"email": [email]}, "limit": 5})
    items = res.get("items") or []
    return items[0] if items else None


def create_unbound_contact(token: str, *, name: str, email: str, phone: str, note: str) -> dict:
    fields: dict = {"name": name or email, "email": [{"type": "work", "value": email}], "notes": note}
    if phone:
        fields["phone"] = [{"type": "work", "value": phone}]
    return cw.podio_api(token, f"/item/app/{UNBOUND_CONTACTS_APP}/", method="POST", body={"fields": fields})


def create_hana_networking(token: str, *, first: str, last: str, email: str, phone: str,
                           start_iso: str, status: int) -> dict:
    fields: dict = {"status": status, "source": NETWORKING_SOURCE_HANA_WEBSITE}
    if first:
        fields["client-name"] = first
    if last:
        fields["last-name"] = last
    fields["e-mail-2"] = [{"type": "work", "value": email}]
    if phone:
        fields["phone-2"] = [{"type": "work", "value": phone}]
    follow = cw._podio_dt(start_iso)
    if follow:
        fields["next-follow-up"] = follow
    return cw.podio_api(token, f"/item/app/{HANA_NETWORKING_APP}/", method="POST", body={"fields": fields})


def advance_hana_networking(token: str, item_id: int, start_iso: str, status: int) -> dict:
    fields: dict = {"status": status}
    follow = cw._podio_dt(start_iso)
    if follow:
        fields["next-follow-up"] = follow
    return cw.podio_api(token, f"/item/{item_id}/", method="PUT", body={"fields": fields})


# ── Vault note (born linked) ────────────────────────────────────────────────
# Reuses the fleet's person-profile writer so a scheduler contact looks exactly
# like every other person folder: <brain>/People/<Name>/_profile.md with the
# standard sections, one dated bullet under Relationship history per booking,
# and the person's index linked into <brain>/People/_INDEX.md (Rule 26).

def write_vault_note(*, brain: str, name: str, email: str, phone: str, item_id, podio_url: str,
                     event_name: str, when: str, location: str, join_url: str | None) -> str:
    import axis_meeting_vault as mv
    import axis_vault_index as vi
    canonical = (name or email).strip()
    profile = mv.ensure_profile(VAULT, brain, canonical)
    text = f"Booked {event_name} for {when}, {_where(location, None)} via calendar.hana.events."
    if podio_url:
        text += f"\nPodio: {podio_url}"
    if email:
        text += f"\nEmail: {email}" + (f" | Phone: {phone}" if phone else "")
    today = datetime.now(ZoneInfo("America/Phoenix")).strftime("%Y-%m-%d")  # Phoenix date, never UTC's tomorrow
    mv.append_profile_history(profile, {"text": text, "date": today, "meeting_id": f"booking:{email}:{when}"}, vault_root=VAULT)
    safe = profile.parent.name
    # person index → profile, and People hub → person index (both idempotent)
    vi.append_index_link(str(profile.parent / "_INDEX.md"), f"[[{brain}/People/{safe}/_profile|profile]]", "## Auto-linked notes", title=f"{safe} — Index")
    vi.append_index_link(str(VAULT / brain / "People" / "_INDEX.md"), f"[[{brain}/People/{safe}/_INDEX|{safe} — Index]]", "## Auto-linked notes", title="People — Index")
    return str(profile)


# ── main ────────────────────────────────────────────────────────────────────

STATUS_FOLLOW_UP_NEEDED = 4  # Networking "Follow Up Needed": a cancelled 1-to-1 needs rebooking


def _handle_note_only(p: dict, *, kind: str, email: str, name: str, start_iso: str, text: str, dry: bool, test: bool = False) -> None:
    """Confirmed / rescheduled: a note on every record the person has plus a
    vault line. No status change (a reschedule's NEW booking sets status via
    its own booking.created; a confirmation keeps Scheduled). Once per booking."""
    key = f"booking.{kind}|{email}|{start_iso}"
    if _seen(key):
        _result(ok=True, action="skipped_duplicate", email=email)
    if dry:
        _result(ok=True, dry_run=True, action=kind, email=email)
    try:
        token = cw.podio_auth()
    except Exception as e:
        _result(ok=False, reason="podio_auth_failed", detail=str(e)[:200])
    recs = []
    for finder, lane, brain in ((cw.podio_find_networking_by_email, "hana", "Hana Brain"),
                                (find_hana_contact, "hana-contact", "Hana Brain"),
                                (find_unbound_contact, "unbound", "Unbound Brain")):
        try:
            r = finder(token, email)
            if r:
                recs.append((r, lane, brain))
        except Exception as e:
            _log(f"{lane} lookup failed: {e}")
    if any(l == "hana" for _, l, _ in recs):
        recs = [x for x in recs if x[1] != "hana-contact"]
    touched: list[dict] = []
    for rec, lane, brain in recs:
        iid = rec["item_id"]
        held = not _factlock_gate(iid, email, lane, "podio_comment", test=test)
        if not held:
            try:
                cw.podio_add_comment(token, iid, text + SIGN)
            except Exception as e:
                _log(f"{lane} {kind} comment failed: {e}")  # ordinary API error -- still counts as touched below
        else:
            continue  # fact-lock held this write; already logged + escalated inside _factlock_gate
        touched.append({"lane": lane, "item_id": iid, "url": _item_link(rec), "brain": brain, "name": rec.get("title") or name})
    notes = []
    for t in touched:
        try:
            import axis_meeting_vault as mv
            profile = mv.ensure_profile(VAULT, t["brain"], (t.get("name") or name or email).strip())
            today = datetime.now(ZoneInfo("America/Phoenix")).strftime("%Y-%m-%d")
            mv.append_profile_history(profile, {"text": text, "date": today, "meeting_id": f"booking-{kind}:{email}:{start_iso}"}, vault_root=VAULT)
            notes.append(str(profile))
        except Exception as e:
            _log(f"vault {kind} note failed: {e}")
    action = f"{kind}_noted" if touched else f"{kind}_unknown_person"
    _ledger(key, email=email, name=name, slug=p.get("slug") or "", action=action, touched=touched, vault=notes)
    _log(f"{action} email={email} touched={[t['item_id'] for t in touched]}")
    _result(ok=True, action=action, email=email, touched=touched, vault=notes)


def _handle_cancelled(p: dict, *, email: str, name: str, start_iso: str, event_name: str, when: str, dry: bool, test: bool = False) -> None:
    """A scheduler booking was cancelled (calendar event status=cancelled).
    Roll a Networking record we advanced back to Follow Up Needed, comment on
    every record the person has, note it in the vault. Never touches a status
    a human set by hand, never creates anything."""
    key = f"booking.cancelled|{email}|{start_iso}"
    if _seen(key):
        _result(ok=True, action="skipped_duplicate", email=email)
    if dry:
        _result(ok=True, dry_run=True, action="cancelled", email=email, when=when)
    try:
        token = cw.podio_auth()
    except Exception as e:
        _result(ok=False, reason="podio_auth_failed", detail=str(e)[:200])
    hana = unbound = contact = None
    try:
        hana = cw.podio_find_networking_by_email(token, email)
    except Exception as e:
        _log(f"hana lookup failed: {e}")
    try:
        contact = find_hana_contact(token, email)
    except Exception as e:
        _log(f"hana contacts lookup failed: {e}")
    try:
        unbound = find_unbound_contact(token, email)
    except Exception as e:
        _log(f"unbound lookup failed: {e}")
    body = f"{name or email} cancelled the {event_name} that was set for {when}."
    touched: list[dict] = []
    action = "cancelled_noted" if (hana or unbound or contact) else "cancelled_unknown_person"
    if hana:
        iid = hana["item_id"]
        if _factlock_gate(iid, email, "hana", "podio_status_update_or_comment", test=test):
            try:
                if cw.get_networking_status(hana) in (STATUS_ZOOM_SCHEDULED, STATUS_INPERSON_SCHEDULED):
                    cw.podio_api(token, f"/item/{iid}/", method="PUT",
                                 body={"fields": {"status": STATUS_FOLLOW_UP_NEEDED, "next-follow-up": cw._podio_dt(datetime.now(timezone.utc).isoformat())}})
                    cw.podio_add_comment(token, iid, body + " Moved them to Follow Up Needed so they get rebooked." + SIGN)
                    action = "cancelled_reverted"
                else:
                    cw.podio_add_comment(token, iid, body + " Left their status as-is since it was set by hand." + SIGN)
            except Exception as e:
                _log(f"hana cancel update failed: {e}")
            touched.append({"lane": "hana", "item_id": iid, "url": _item_link(hana), "brain": "Hana Brain", "name": hana.get("title") or name})
        # else: held by fact-lock, already logged + escalated inside _factlock_gate.
        # Never falls through to the PUT/comment above, and this record is
        # deliberately left out of touched[] so a stale-identity match never
        # feeds the vault note below.
    for rec, lane, brain in ((contact, "hana-contact", "Hana Brain"), (unbound, "unbound", "Unbound Brain")):
        if rec and not (lane == "hana-contact" and hana):
            iid = rec["item_id"]
            if _factlock_gate(iid, email, lane, "podio_comment", test=test):
                try:
                    cw.podio_add_comment(token, iid, body + SIGN)
                except Exception as e:
                    _log(f"{lane} cancel comment failed: {e}")
                touched.append({"lane": lane, "item_id": iid, "url": _item_link(rec), "brain": brain, "name": rec.get("title") or name})
    notes = []
    for t in touched:
        try:
            import axis_meeting_vault as mv
            profile = mv.ensure_profile(VAULT, t["brain"], (t.get("name") or name or email).strip())
            today = datetime.now(ZoneInfo("America/Phoenix")).strftime("%Y-%m-%d")
            mv.append_profile_history(profile, {"text": f"Cancelled the {event_name} that was set for {when}.", "date": today,
                                                "meeting_id": f"booking-cancelled:{email}:{when}"}, vault_root=VAULT)
            notes.append(str(profile))
        except Exception as e:
            _log(f"vault cancel note failed: {e}")
    _ledger(key, email=email, name=name, slug=p.get("slug") or "", action=action, touched=touched, vault=notes)
    _log(f"{action} email={email} touched={[t['item_id'] for t in touched]}")
    _result(ok=True, action=action, email=email, touched=touched, vault=notes)


def main() -> None:
    dry = os.environ.get("SCHEDULER_INGEST_DRY_RUN") == "1"
    # Rule 15: any manual/harness verification call MUST tag its fact-lock
    # manifests test=True so Sentinel's fail-rate math never counts a
    # deliberate "prove the gate catches bad data" run as a real production
    # failure (fleet-wide rule after blinq-intake/nurture/matchmaker/steward
    # were each falsely demoted this exact way). This webhook has no CLI, so
    # the harness sets this env var instead of a flag.
    test = os.environ.get("SCHEDULER_INGEST_FACTLOCK_TEST") == "1"
    raw = sys.stdin.read()
    try:
        p = json.loads(raw)
    except Exception:
        _log("bad json")
        _result(ok=False, reason="bad_json")

    event = p.get("event") or ""
    email = (p.get("inviteeEmail") or "").strip().lower()
    name = (p.get("inviteeName") or "").strip()
    phone = (p.get("inviteePhone") or "").strip()
    slug = p.get("slug") or ""
    event_name = p.get("eventName") or slug or "a meeting"
    start_iso = p.get("startIso") or ""
    tz = p.get("inviteeTz") or "America/Phoenix"
    location = p.get("location") or "zoom"
    join_url = p.get("joinUrl") or None
    when = _friendly(start_iso, tz)

    if event == "booking.confirmed" and email and start_iso:
        _handle_note_only(p, kind="confirmed", email=email, name=name, start_iso=start_iso,
                          text=f"{name or email} confirmed the {event_name} for {when}.", dry=dry, test=test)
        return

    if event == "booking.cancelled" and email and start_iso:
        if (p.get("reason") or "") == "rescheduled":
            new_when = _friendly(p.get("newStartIso") or "", tz) if p.get("newStartIso") else "a new time"
            _handle_note_only(p, kind="rescheduled", email=email, name=name, start_iso=start_iso,
                              text=f"{name or email} rescheduled the {event_name} from {when} to {new_when}. The new booking is filed separately.", dry=dry, test=test)
            return
        _handle_cancelled(p, email=email, name=name, start_iso=start_iso, event_name=event_name, when=when, dry=dry, test=test)
        return

    if event != "booking.created" or not email or not start_iso:
        _log(f"ignored event={event} email={'y' if email else 'n'} start={'y' if start_iso else 'n'}")
        _result(ok=False, reason="unsupported_or_incomplete", event=event)

    key = f"{event}|{email}|{start_iso}"
    if _seen(key):
        _result(ok=True, action="skipped_duplicate", email=email)

    lane = "unbound" if slug in UNBOUND_SLUGS else "hana"
    sched_status = STATUS_INPERSON_SCHEDULED if location == "in_person" else STATUS_ZOOM_SCHEDULED

    if dry:
        _result(ok=True, dry_run=True, lane=lane, email=email, name=name, event_name=event_name, when=when)

    try:
        token = cw.podio_auth()
    except Exception as e:
        _log(f"podio auth failed: {e}")
        _result(ok=False, reason="podio_auth_failed", detail=str(e)[:200])

    # Look in BOTH workspaces regardless of lane (Joseph: "at all").
    hana = unbound = contact = None
    try:
        hana = cw.podio_find_networking_by_email(token, email)
    except Exception as e:
        _log(f"hana lookup failed: {e}")
    try:
        contact = find_hana_contact(token, email)
    except Exception as e:
        _log(f"hana contacts lookup failed: {e}")
    try:
        unbound = find_unbound_contact(token, email)
    except Exception as e:
        _log(f"unbound lookup failed: {e}")

    body = (f"{name or email} booked a {event_name} for {when}, {_where(location, join_url)}. "
            f"Came in through calendar.hana.events.")
    touched: list[dict] = []
    action = ""

    if hana or unbound or contact:
        action = "commented_existing"
        if contact and not hana:
            iid = contact["item_id"]
            if _factlock_gate(iid, email, "hana-contact", "podio_comment", test=test):
                try:
                    cw.podio_add_comment(token, iid, body + " They are already a Hana client, so this stays on their Contacts record." + SIGN)
                except Exception as e:
                    _log(f"hana contact comment failed: {e}")
                touched.append({"lane": "hana-contact", "item_id": iid, "url": _item_link(contact), "brain": "Hana Brain", "name": contact.get("title") or name})
        if hana:
            iid = hana["item_id"]
            if _factlock_gate(iid, email, "hana", "podio_status_update_or_comment", test=test):
                try:
                    if cw.get_networking_status(hana) in cw.GATE_STATUSES:
                        advance_hana_networking(token, iid, start_iso, sched_status)
                        cw.podio_add_comment(token, iid, body + " Moved them to the scheduled status and set the follow-up to the meeting time." + SIGN)
                        action = "advanced_existing"
                    else:
                        cw.podio_add_comment(token, iid, body + " Left their status as-is since it was set by hand." + SIGN)
                except Exception as e:
                    _log(f"hana comment failed: {e}")
                touched.append({"lane": "hana", "item_id": iid, "url": _item_link(hana), "brain": "Hana Brain", "name": hana.get("title") or name})
        if unbound:
            iid = unbound["item_id"]
            if _factlock_gate(iid, email, "unbound", "podio_comment", test=test):
                try:
                    cw.podio_add_comment(token, iid, body + SIGN)
                except Exception as e:
                    _log(f"unbound comment failed: {e}")
                touched.append({"lane": "unbound", "item_id": iid, "url": _item_link(unbound), "brain": "Unbound Brain", "name": unbound.get("title") or name})
    else:
        # A brand-new item: no prior canonical record to diff an identity
        # claim against (Rule 15's claim must resolve from a canonical
        # source, never from the text being written) -- the comment below
        # lands on the item we just created in this same call with this
        # exact email, so there is nothing that could have drifted yet.
        # Not gated on purpose; see module-level note at the top of this file.
        action = "created"
        try:
            if lane == "unbound":
                created = create_unbound_contact(token, name=name, email=email, phone=phone,
                                                 note=f"Booked {event_name} for {when} via calendar.hana.events.")
                brain = "Unbound Brain"
            else:
                first, last = _split_name(name)
                created = create_hana_networking(token, first=first, last=last, email=email, phone=phone,
                                                 start_iso=start_iso, status=sched_status)
                brain = "Hana Brain"
            iid = created.get("item_id")
            if iid:
                cw.podio_add_comment(token, iid, body + " Added them here since they weren't in Hana Networking or Unbound Contacts yet." + SIGN)
            touched.append({"lane": lane, "item_id": iid, "url": _item_link(created), "brain": brain})
        except Exception as e:
            _log(f"create failed: {e}")
            _result(ok=False, reason="create_failed", detail=str(e)[:200])

    notes = []
    for t in touched:
        try:
            # Vault folder follows the Podio record's name when one exists, so a
            # booker who types a different spelling never gets a second profile.
            notes.append(write_vault_note(brain=t["brain"], name=t.get("name") or name, email=email, phone=phone,
                                          item_id=t["item_id"], podio_url=t["url"], event_name=event_name,
                                          when=when, location=location, join_url=join_url))
        except Exception as e:
            _log(f"vault note failed: {e}")

    _ledger(key, email=email, name=name, slug=slug, action=action, touched=touched, vault=notes)
    _log(f"{action} email={email} lane={lane} touched={[t['item_id'] for t in touched]}")
    _result(ok=True, action=action, email=email, touched=touched, vault=notes)


if __name__ == "__main__":
    main()
