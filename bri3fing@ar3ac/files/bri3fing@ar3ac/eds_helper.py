#!/usr/bin/env python3
"""
Bri3fing EDS Helper Backend
Interacts with Evolution Data Server (EDS) to query and create calendar events.
Output is formatted in JSON for consumption by Cinnamon Desklet (GJS).
"""

import sys
import os
import re
import json
import argparse
import datetime
import time
import uuid

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

try:
    import gi
    gi.require_version('EDataServer', '1.2')
    gi.require_version('ECal', '2.0')
    gi.require_version('ICalGLib', '3.0')
    from gi.repository import EDataServer, ECal, ICalGLib
except (ValueError, ImportError) as e:
    err_payload = {
        "status": "error",
        "message": (
            "Required Evolution Data Server libraries not found.\n"
            "Install them via:\n"
            "  • Ubuntu / Debian / Mint: sudo apt install gir1.2-ecal-2.0 gir1.2-edataserver-1.2\n"
            "  • Fedora: sudo dnf install evolution-data-server\n"
            "  • Arch Linux: sudo pacman -S evolution-data-server"
        )
    }
    print(json.dumps(err_payload, indent=2))
    sys.exit(1)


def get_source_registry():
    """Initializes and returns the EDataServer SourceRegistry."""
    return EDataServer.SourceRegistry.new_sync(None)


def is_source_online(registry, source):
    """Determines whether a calendar source originates from an online account (e.g., Google, Nextcloud, CalDAV)."""
    try:
        parent_uid = source.get_parent()
        if not parent_uid:
            return False
        parent = registry.ref_source(parent_uid)
        if not parent:
            return False

        if parent.has_extension(EDataServer.SOURCE_EXTENSION_GOA):
            return True
        if parent.has_extension(EDataServer.SOURCE_EXTENSION_COLLECTION):
            return True
        if parent.has_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION):
            return True

        parent_uid_lower = parent_uid.lower()
        if any(key in parent_uid_lower for key in ['goa', 'google', 'caldav', 'webdav', 'exchange', 'office365']):
            return True

        return False
    except Exception:
        return False


HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def validate_hex_color(color, default="#4285F4"):
    """Validates a CSS hex color string and falls back to default if malformed."""
    if isinstance(color, str):
        cleaned = color.strip()
        if HEX_COLOR_RE.match(cleaned):
            return cleaned
    return default


def get_calendar_color(source):
    """Extracts and validates the hex color code for a calendar source."""
    try:
        cal_ext = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
        if cal_ext and hasattr(cal_ext, 'get_color'):
            return validate_hex_color(cal_ext.get_color())
    except Exception:
        pass
    return "#4285F4"


def is_client_writable(client=None, source=None):
    """Determines real calendar writability via ECal.Client.is_readonly()."""
    if client is not None:
        try:
            return not client.is_readonly()
        except Exception:
            pass
    if source is not None:
        try:
            return bool(source.get_writable())
        except Exception:
            pass
    return True


def list_calendars(registry=None):
    """Returns a list of all calendar sources configured in EDS."""
    if registry is None:
        registry = get_source_registry()

    sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
    calendars = []

    for source in sources:
        enabled = source.get_enabled()
        writable = is_client_writable(source=source)
        if enabled:
            try:
                client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
                writable = is_client_writable(client=client, source=source)
            except Exception:
                pass
        is_online = is_source_online(registry, source)

        calendars.append({
            "uid": source.get_uid(),
            "name": source.get_display_name(),
            "color": get_calendar_color(source),
            "enabled": enabled,
            "writable": writable,
            "is_online": is_online
        })

    return calendars


def _resolve_ical_timezone(tzid, client=None):
    """Resolves a timezone identifier (IANA, libical TZID, UTC, or cached VTIMEZONE) to an ICalGLib.Timezone."""
    if not tzid:
        return None

    clean_tzid = tzid.strip()
    if clean_tzid.startswith(":"):
        clean_tzid = clean_tzid[1:].strip()
    if not clean_tzid:
        return None

    if clean_tzid.upper() in ("UTC", "ETC/UTC", "GMT", "ETC/GMT", "Z"):
        return ICalGLib.Timezone.get_utc_timezone()

    if client is not None:
        try:
            ok, tz = client.get_timezone_sync(clean_tzid, None)
            if ok and tz is not None:
                return tz
        except Exception:
            pass

    for lookup in (
        lambda name: ICalGLib.Timezone.get_builtin_timezone(name),
        lambda name: ICalGLib.Timezone.get_builtin_timezone_from_tzid(name),
    ):
        try:
            tz = lookup(clean_tzid)
            if tz is not None:
                return tz
        except Exception:
            pass

    try:
        matched = ECal.match_tzid(clean_tzid)
        if matched:
            tz = ICalGLib.Timezone.get_builtin_timezone_from_tzid(matched)
            if tz is not None:
                return tz
    except Exception:
        pass

    return None


def get_local_ical_timezone():
    """
    Returns the effective local ICalGLib.Timezone, honoring POSIX TZ overrides
    first, then Evolution Data Server's system timezone and /etc/localtime.
    """
    tz_env = os.environ.get("TZ", "").strip()
    if tz_env:
        tz = _resolve_ical_timezone(tz_env)
        if tz is not None:
            return tz

    try:
        tz = ECal.util_get_system_timezone()
        if tz is not None:
            return tz
    except Exception:
        pass

    try:
        loc = ECal.util_get_system_timezone_location()
        if loc:
            tz = _resolve_ical_timezone(loc)
            if tz is not None:
                return tz
    except Exception:
        pass

    try:
        localtime_path = os.path.realpath("/etc/localtime")
        marker = "/zoneinfo/"
        if marker in localtime_path:
            tz_name = localtime_path.split(marker, 1)[1]
            tz = _resolve_ical_timezone(tz_name)
            if tz is not None:
                return tz
    except Exception:
        pass

    return None


def _get_property_tzid(comp, prop_kind):
    """Extracts the TZID parameter string from an iCal component property, if present."""
    try:
        prop = comp.get_first_property(prop_kind)
        if prop is not None:
            param = prop.get_first_parameter(ICalGLib.ParameterKind.TZID_PARAMETER)
            if param is not None:
                return param.get_tzid()
    except Exception:
        pass
    return None


def ical_time_to_timestamp(ical_time, local_zone=None, fallback_tzid=None, client=None):
    """
    Converts a timed ICalGLib.Time instance to a UTC Unix timestamp while
    preserving its timezone across all global timezones and DST rules:
    - UTC ('Z') timestamps
    - Explicit TZID / VTIMEZONE (IANA, Exchange/Outlook, fractional offsets)
    - Fallback TZID resolution via EDS cache, libical, or Python zoneinfo
    - RFC 5545 floating times interpreted in the effective local OS timezone
    """
    if ical_time.is_utc():
        return ical_time.as_timet_with_zone(ICalGLib.Timezone.get_utc_timezone())

    tz = ical_time.get_timezone()
    if tz is not None:
        return ical_time.as_timet_with_zone(tz)

    if fallback_tzid:
        resolved_tz = _resolve_ical_timezone(fallback_tzid, client=client)
        if resolved_tz is not None:
            return ical_time.as_timet_with_zone(resolved_tz)

        if ZoneInfo is not None:
            try:
                zi = ZoneInfo(fallback_tzid.strip())
                aware_dt = datetime.datetime(
                    ical_time.get_year(),
                    ical_time.get_month(),
                    ical_time.get_day(),
                    ical_time.get_hour(),
                    ical_time.get_minute(),
                    ical_time.get_second(),
                    tzinfo=zi
                )
                return int(aware_dt.timestamp())
            except Exception:
                pass

    # RFC 5545 floating time: interpret directly in the effective local OS timezone
    # so it always matches datetime.fromtimestamp() (including custom POSIX TZ rules).
    try:
        local_dt = datetime.datetime(
            ical_time.get_year(),
            ical_time.get_month(),
            ical_time.get_day(),
            ical_time.get_hour(),
            ical_time.get_minute(),
            ical_time.get_second()
        )
        return int(local_dt.timestamp())
    except Exception:
        if local_zone is not None:
            return ical_time.as_timet_with_zone(local_zone)
        return ical_time.as_timet_with_zone(ICalGLib.Timezone.get_utc_timezone())


def get_events(days_ahead=7, include_past_today=False, target_calendar_uids=None):
    """
    Queries events across enabled calendars for the specified day range.
    Expands recurring instances and formats output into clean JSON.
    """
    registry = get_source_registry()
    sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
    local_zone = get_local_ical_timezone()

    now_dt = datetime.datetime.now()
    today_date = now_dt.date()
    current_ts = int(now_dt.timestamp())

    # Range: from start of today (00:00:00) to end of (today + days_ahead) (23:59:59)
    start_dt = datetime.datetime.combine(today_date, datetime.time.min)
    end_dt = datetime.datetime.combine(today_date + datetime.timedelta(days=days_ahead), datetime.time.max)

    range_start_ts = int(start_dt.timestamp())
    range_end_ts = int(end_dt.timestamp())

    events = []
    calendars_info = []
    has_online_accounts = False

    for source in sources:
        uid = source.get_uid()
        display_name = source.get_display_name()
        enabled = source.get_enabled()
        color = get_calendar_color(source)
        is_online = is_source_online(registry, source)

        if is_online:
            has_online_accounts = True

        cal_entry = {
            "uid": uid,
            "name": display_name,
            "color": color,
            "enabled": enabled,
            "writable": is_client_writable(source=source),
            "is_online": is_online
        }
        calendars_info.append(cal_entry)

        if not enabled:
            continue

        if target_calendar_uids and uid not in target_calendar_uids:
            continue

        try:
            client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
            if local_zone is not None:
                client.set_default_timezone(local_zone)
            cal_entry["writable"] = is_client_writable(client=client, source=source)
        except Exception:
            continue

        def on_instance(comp, start_time, end_time, *args):
            try:
                is_all_day = start_time.is_date()
                ev_uid = comp.get_uid() or ""
                summary = comp.get_summary() or "(Untitled event)"
                location = comp.get_location() or ""
                description = comp.get_description() or ""
                has_rrule = comp.get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY) is not None
                has_rdate = comp.get_first_property(ICalGLib.PropertyKind.RDATE_PROPERTY) is not None
                has_recid = comp.get_first_property(ICalGLib.PropertyKind.RECURRENCEID_PROPERTY) is not None
                is_recurring = has_rrule or has_rdate or has_recid

                if is_all_day:
                    ev_start_date = datetime.date(start_time.get_year(), start_time.get_month(), start_time.get_day())
                    ev_end_date = datetime.date(end_time.get_year(), end_time.get_month(), end_time.get_day())

                    # Non-inclusive DTEND handling
                    if ev_end_date > ev_start_date:
                        display_end_date = ev_end_date - datetime.timedelta(days=1)
                    else:
                        display_end_date = ev_start_date

                    ev_start_dt = datetime.datetime.combine(ev_start_date, datetime.time.min)
                    ev_end_dt = datetime.datetime.combine(display_end_date, datetime.time.max)

                    ev_start_ts = int(ev_start_dt.timestamp())
                    ev_end_ts = int(ev_end_dt.timestamp())

                    start_time_str = ""
                    end_time_str = ""
                    start_date_str = ev_start_date.isoformat()
                    end_date_str = display_end_date.isoformat()
                    date_str = start_date_str
                    event_date = ev_start_date
                    is_multi_day = (display_end_date > ev_start_date)
                else:
                    start_tzid = _get_property_tzid(comp, ICalGLib.PropertyKind.DTSTART_PROPERTY)
                    end_tzid = _get_property_tzid(comp, ICalGLib.PropertyKind.DTEND_PROPERTY) or start_tzid

                    ev_start_ts = ical_time_to_timestamp(start_time, local_zone, fallback_tzid=start_tzid, client=client)
                    ev_end_ts = ical_time_to_timestamp(end_time, local_zone, fallback_tzid=end_tzid, client=client)

                    start_local_dt = datetime.datetime.fromtimestamp(ev_start_ts)
                    end_local_dt = datetime.datetime.fromtimestamp(ev_end_ts)

                    start_time_str = start_local_dt.strftime("%H:%M")
                    end_time_str = end_local_dt.strftime("%H:%M")
                    start_date_str = start_local_dt.date().isoformat()
                    event_date = start_local_dt.date()
                    if end_local_dt > start_local_dt and end_local_dt.time() == datetime.time.min:
                        display_end_date = (end_local_dt - datetime.timedelta(seconds=1)).date()
                    else:
                        display_end_date = end_local_dt.date()
                    end_date_str = display_end_date.isoformat()
                    date_str = start_date_str
                    is_multi_day = (display_end_date > event_date)

                # Exclude events that already finished strictly before today's start (00:00 local)
                if ev_end_ts < range_start_ts or (ev_end_ts == range_start_ts and ev_start_ts < range_start_ts):
                    return True

                # Filter past events if requested
                if not include_past_today and ev_end_ts < current_ts:
                    return True

                # Recurrence ID string for safe single-occurrence edit/delete
                recurrence_id = ""
                if is_recurring:
                    try:
                        if has_recid:
                            rec_time = comp.get_recurrenceid()
                            if rec_time and not rec_time.is_null_time():
                                recurrence_id = rec_time.as_ical_string() or ""
                        if not recurrence_id:
                            if is_all_day:
                                recurrence_id = f"{ev_start_date.year:04d}{ev_start_date.month:02d}{ev_start_date.day:02d}"
                            else:
                                utc_t = ICalGLib.Time.new_from_timet_with_zone(
                                    ev_start_ts, 0, ICalGLib.Timezone.get_utc_timezone()
                                )
                                recurrence_id = utc_t.as_ical_string() or ""
                    except Exception:
                        recurrence_id = ""

                # Status flags
                is_ongoing = (ev_start_ts <= current_ts <= ev_end_ts)
                is_imminent = (not is_ongoing and 0 < (ev_start_ts - current_ts) <= 1800)

                # Day classification with support for active multi-day events
                if is_ongoing:
                    day_category = "today"
                elif is_all_day and (ev_start_date <= today_date <= display_end_date):
                    day_category = "today"
                elif event_date == today_date:
                    day_category = "today"
                elif event_date == today_date + datetime.timedelta(days=1):
                    day_category = "tomorrow"
                elif event_date < today_date:
                    day_category = "past"
                else:
                    day_category = "upcoming"

                # Group active multi-day events that started earlier under today's date
                # so the UI never renders duplicate "TODAY" sections.
                if day_category == "today" and event_date < today_date:
                    date_str = today_date.isoformat()

                events.append({
                    "uid": ev_uid,
                    "summary": summary,
                    "location": location,
                    "description": description,
                    "all_day": is_all_day,
                    "multi_day": is_multi_day,
                    "is_recurring": is_recurring,
                    "recurrence_id": recurrence_id,
                    "start_ts": ev_start_ts,
                    "end_ts": ev_end_ts,
                    "date_str": date_str,
                    "start_date_str": start_date_str,
                    "end_date_str": end_date_str,
                    "start_time_str": start_time_str,
                    "end_time_str": end_time_str,
                    "day_category": day_category,
                    "calendar_uid": uid,
                    "calendar_name": display_name,
                    "calendar_color": color,
                    "calendar_writable": cal_entry["writable"],
                    "is_ongoing": is_ongoing,
                    "is_imminent": is_imminent
                })
            except Exception:
                pass
            return True

        try:
            client.generate_instances_sync(range_start_ts, range_end_ts, None, on_instance, None)
        except Exception:
            pass

    # Sort chronologically by start timestamp, then all_day first, then summary
    events.sort(key=lambda x: (x["start_ts"], not x["all_day"], x["summary"]))

    return {
        "status": "success",
        "events": events,
        "calendars": calendars_info,
        "has_online_accounts": has_online_accounts,
        "total_events": len(events),
        "today_str": today_date.isoformat()
    }


def _parse_hhmm(time_str, field_name="time"):
    """Parses and validates an HH:MM time string into (hour, minute)."""
    cleaned = time_str.strip()
    parts = cleaned.split(":")
    if len(parts) > 2 or not parts[0].strip().isdigit():
        raise ValueError(f"Invalid {field_name} '{time_str}' (expected HH:MM)")
    hour = int(parts[0].strip())
    if len(parts) == 2:
        if not parts[1].strip().isdigit():
            raise ValueError(f"Invalid {field_name} '{time_str}' (expected HH:MM)")
        minute = int(parts[1].strip())
    else:
        minute = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Invalid {field_name} '{time_str}' (hour must be 00-23 and minute 00-59)")
    return hour, minute


def _remove_all_properties(ical_comp, prop_kind):
    """Removes all properties of a given kind from an ICalComponent."""
    prop = ical_comp.get_first_property(prop_kind)
    while prop is not None:
        ical_comp.remove_property(prop)
        prop = ical_comp.get_first_property(prop_kind)


def _apply_event_times_and_dates(ical_comp, date_str=None, start_time_str=None, end_time_str=None, all_day=False, preserve_zone=None):
    """Configures DTSTART and DTEND on an iCal component for all-day or timed events."""
    if not date_str or not date_str.strip():
        target_date = datetime.date.today()
    else:
        try:
            target_date = datetime.date.fromisoformat(date_str.strip())
        except ValueError:
            raise ValueError(f"Invalid date '{date_str}' (expected YYYY-MM-DD)")

    if all_day:
        t_start = ICalGLib.Time.new_null_time()
        t_start.set_date(target_date.year, target_date.month, target_date.day)
        t_start.set_is_date(True)

        next_date = target_date + datetime.timedelta(days=1)
        t_end = ICalGLib.Time.new_null_time()
        t_end.set_date(next_date.year, next_date.month, next_date.day)
        t_end.set_is_date(True)

        ical_comp.set_dtstart(t_start)
        ical_comp.set_dtend(t_end)
    else:
        now_dt = datetime.datetime.now()
        if not start_time_str or not start_time_str.strip():
            default_start = (now_dt + datetime.timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            start_hour, start_minute = default_start.hour, default_start.minute
        else:
            start_hour, start_minute = _parse_hhmm(start_time_str, "start time")

        if not end_time_str or not end_time_str.strip():
            end_hour = (start_hour + 1) % 24
            end_minute = start_minute
            end_date = target_date + datetime.timedelta(days=1 if start_hour == 23 else 0)
        else:
            end_hour, end_minute = _parse_hhmm(end_time_str, "end time")
            if end_hour < start_hour or (end_hour == start_hour and end_minute < start_minute):
                end_date = target_date + datetime.timedelta(days=1)
            else:
                end_date = target_date

        start_dt = datetime.datetime(target_date.year, target_date.month, target_date.day, start_hour, start_minute)
        end_dt = datetime.datetime(end_date.year, end_date.month, end_date.day, end_hour, end_minute)

        tzid_name = None
        if preserve_zone is not None:
            tz_loc = preserve_zone.get_location() or preserve_zone.get_tzid() or ""
            if tz_loc and tz_loc.upper() not in ("UTC", "ETC/UTC", "GMT", "Z"):
                tzid_name = tz_loc

        if tzid_name:
            t_start = ICalGLib.Time.new_null_time()
            t_start.set_date(target_date.year, target_date.month, target_date.day)
            t_start.set_time(start_hour, start_minute, 0)
            t_start.set_timezone(preserve_zone)

            t_end = ICalGLib.Time.new_null_time()
            t_end.set_date(end_date.year, end_date.month, end_date.day)
            t_end.set_time(end_hour, end_minute, 0)
            t_end.set_timezone(preserve_zone)

            _remove_all_properties(ical_comp, ICalGLib.PropertyKind.DTSTART_PROPERTY)
            _remove_all_properties(ical_comp, ICalGLib.PropertyKind.DTEND_PROPERTY)

            prop_s = ICalGLib.Property.new_dtstart(t_start)
            prop_s.set_parameter(ICalGLib.Parameter.new_tzid(tzid_name))
            ical_comp.add_property(prop_s)

            prop_e = ICalGLib.Property.new_dtend(t_end)
            prop_e.set_parameter(ICalGLib.Parameter.new_tzid(tzid_name))
            ical_comp.add_property(prop_e)
        else:
            start_ts = int(start_dt.timestamp())
            end_ts = int(end_dt.timestamp())

            utc_zone = ICalGLib.Timezone.get_utc_timezone()
            t_start = ICalGLib.Time.new_from_timet_with_zone(start_ts, 0, utc_zone)
            t_end = ICalGLib.Time.new_from_timet_with_zone(end_ts, 0, utc_zone)

            ical_comp.set_dtstart(t_start)
            ical_comp.set_dtend(t_end)


def add_event(calendar_uid, summary, date_str=None, start_time_str=None, end_time_str=None, all_day=False, location=None, description=None):
    """
    Creates a new VEVENT component and inserts it into the specified calendar source.
    EDS will automatically push this new event to the remote account (e.g., Google Calendar).
    """
    registry = get_source_registry()

    source = None
    if calendar_uid:
        source = registry.ref_source(calendar_uid)

    client = None
    if not source:
        sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
        # Prioritize enabled writable online calendars, then any enabled writable calendar
        candidates = [s for s in sources if s.get_enabled() and is_source_online(registry, s)]
        candidates += [s for s in sources if s.get_enabled() and s not in candidates]
        for s in candidates:
            try:
                c = ECal.Client.connect_sync(s, ECal.ClientSourceType.EVENTS, 5, None)
                if not c.is_readonly():
                    source = s
                    client = c
                    break
            except Exception:
                continue

    if not source:
        return {"status": "error", "message": "No writable active calendar source available"}

    if client is None:
        try:
            client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
            if client.is_readonly():
                return {"status": "error", "message": f"Calendar '{source.get_display_name()}' is read-only"}
        except Exception as e:
            return {"status": "error", "message": f"Failed to connect to calendar: {str(e)}"}

    ical_comp = ICalGLib.Component.new(ICalGLib.ComponentKind.VEVENT_COMPONENT)
    event_uid = str(uuid.uuid4())
    ical_comp.set_uid(event_uid)
    ical_comp.set_summary(summary or "New Event")

    if location:
        ical_comp.set_location(location.strip())
    if description:
        ical_comp.set_description(description.strip())

    try:
        _apply_event_times_and_dates(ical_comp, date_str, start_time_str, end_time_str, all_day)
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    comp = ECal.Component.new_from_icalcomponent(ical_comp)
    try:
        success, created_uid = client.create_object_sync(comp.get_icalcomponent(), ECal.OperationFlags.NONE, None)
        return {
            "status": "success",
            "uid": created_uid,
            "calendar_uid": source.get_uid(),
            "calendar_name": source.get_display_name(),
            "message": "Event created successfully"
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to save event: {str(e)}"}


def edit_event(calendar_uid, event_uid, new_calendar_uid=None, summary=None, date_str=None, start_time_str=None, end_time_str=None, all_day=None, location=None, description=None, recurrence_id=None, mod_type="all"):
    """
    Modifies an existing VEVENT component in EDS.
    Supports preserving omitted CLI fields, single-occurrence recurring edits
    (mod_type='this' with recurrence_id), and moving events between calendars.
    """
    registry = get_source_registry()
    source = registry.ref_source(calendar_uid)
    if not source:
        return {"status": "error", "message": f"Calendar {calendar_uid} not found"}

    local_zone = get_local_ical_timezone()
    use_this_occurrence = (mod_type == "this" and bool(recurrence_id))

    try:
        client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
        if local_zone is not None:
            client.set_default_timezone(local_zone)
        if client.is_readonly():
            return {"status": "error", "message": f"Calendar '{source.get_display_name()}' is read-only"}

        ical_comp = None
        if use_this_occurrence:
            try:
                success, ical_comp = client.get_object_sync(event_uid, recurrence_id, None)
                if not success:
                    ical_comp = None
            except Exception:
                ical_comp = None

        if ical_comp is None:
            success, ical_comp = client.get_object_sync(event_uid, None, None)
            if not success or not ical_comp:
                return {"status": "error", "message": f"Event {event_uid} not found"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to retrieve event: {str(e)}"}

    # Capture existing timing defaults when CLI omits date/time flags
    existing_start = ical_comp.get_dtstart()
    existing_end = ical_comp.get_dtend()
    existing_all_day = bool(existing_start and existing_start.is_date())
    effective_all_day = existing_all_day if all_day is None else bool(all_day)

    if not effective_all_day and (date_str is None or start_time_str is None or end_time_str is None):
        if existing_start and not existing_start.is_null_time() and not existing_start.is_date():
            s_tzid = _get_property_tzid(ical_comp, ICalGLib.PropertyKind.DTSTART_PROPERTY)
            e_tzid = _get_property_tzid(ical_comp, ICalGLib.PropertyKind.DTEND_PROPERTY) or s_tzid
            cur_s_dt = datetime.datetime.fromtimestamp(
                ical_time_to_timestamp(existing_start, local_zone, fallback_tzid=s_tzid, client=client)
            )
            if date_str is None:
                date_str = cur_s_dt.date().isoformat()
            if start_time_str is None:
                start_time_str = cur_s_dt.strftime("%H:%M")
            if end_time_str is None and existing_end and not existing_end.is_null_time() and not existing_end.is_date():
                cur_e_dt = datetime.datetime.fromtimestamp(
                    ical_time_to_timestamp(existing_end, local_zone, fallback_tzid=e_tzid, client=client)
                )
                end_time_str = cur_e_dt.strftime("%H:%M")
    elif effective_all_day and date_str is None and existing_start and not existing_start.is_null_time():
        date_str = f"{existing_start.get_year():04d}-{existing_start.get_month():02d}-{existing_start.get_day():02d}"

    is_recurring_series = (
        ical_comp.get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY) is not None
        or ical_comp.get_first_property(ICalGLib.PropertyKind.RDATE_PROPERTY) is not None
    )

    if summary is not None:
        ical_comp.set_summary(summary.strip() or "Untitled Event")
    if location is not None:
        loc_clean = location.strip()
        if loc_clean:
            ical_comp.set_location(loc_clean)
        else:
            _remove_all_properties(ical_comp, ICalGLib.PropertyKind.LOCATION_PROPERTY)
    if description is not None:
        desc_clean = description.strip()
        if desc_clean:
            ical_comp.set_description(desc_clean)
        else:
            _remove_all_properties(ical_comp, ICalGLib.PropertyKind.DESCRIPTION_PROPERTY)

    # Preserve timezone on recurring series so DST transitions keep local wall-clock time
    preserve_zone = local_zone if (is_recurring_series and not use_this_occurrence) else None

    try:
        _apply_event_times_and_dates(
            ical_comp, date_str, start_time_str, end_time_str, effective_all_day, preserve_zone=preserve_zone
        )
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    if use_this_occurrence:
        _remove_all_properties(ical_comp, ICalGLib.PropertyKind.RRULE_PROPERTY)
        _remove_all_properties(ical_comp, ICalGLib.PropertyKind.RDATE_PROPERTY)
        _remove_all_properties(ical_comp, ICalGLib.PropertyKind.EXDATE_PROPERTY)
        rec_time = ICalGLib.Time.new_from_string(recurrence_id)
        if rec_time and not rec_time.is_null_time():
            ical_comp.set_recurrenceid(rec_time)

    try:
        seq = ical_comp.get_sequence()
        ical_comp.set_sequence(seq + 1)
    except Exception:
        pass

    # Moving to a different calendar if requested
    if new_calendar_uid and new_calendar_uid != calendar_uid:
        new_source = registry.ref_source(new_calendar_uid)
        if not new_source:
            return {"status": "error", "message": f"Target calendar {new_calendar_uid} not found"}
        try:
            new_client = ECal.Client.connect_sync(new_source, ECal.ClientSourceType.EVENTS, 5, None)
            if new_client.is_readonly():
                return {"status": "error", "message": f"Target calendar '{new_source.get_display_name()}' is read-only"}
            new_uid = str(uuid.uuid4())
            ical_comp.set_uid(new_uid)
            _remove_all_properties(ical_comp, ICalGLib.PropertyKind.RECURRENCEID_PROPERTY)
            _, created_uid = new_client.create_object_sync(ical_comp, ECal.OperationFlags.NONE, None)
            if use_this_occurrence:
                client.remove_object_sync(event_uid, recurrence_id, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)
            else:
                client.remove_object_sync(event_uid, None, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, None)
            return {
                "status": "success",
                "uid": created_uid or new_uid,
                "calendar_uid": new_calendar_uid,
                "message": "Event moved and updated successfully"
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to move event: {str(e)}"}
    else:
        try:
            obj_mod = ECal.ObjModType.THIS if use_this_occurrence else ECal.ObjModType.ALL
            client.modify_object_sync(ical_comp, obj_mod, ECal.OperationFlags.NONE, None)
            return {
                "status": "success",
                "uid": event_uid,
                "calendar_uid": calendar_uid,
                "message": "Event updated successfully"
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to update event: {str(e)}"}


def delete_event(calendar_uid, event_uid, recurrence_id=None, mod_type="all"):
    """Deletes an event (or a single recurring occurrence when mod_type='this') from the specified calendar."""
    registry = get_source_registry()
    source = registry.ref_source(calendar_uid)
    if not source:
        return {"status": "error", "message": f"Calendar {calendar_uid} not found"}

    try:
        client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
        if client.is_readonly():
            return {"status": "error", "message": f"Calendar '{source.get_display_name()}' is read-only"}
        if mod_type == "this" and recurrence_id:
            client.remove_object_sync(event_uid, recurrence_id, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)
        else:
            client.remove_object_sync(event_uid, None, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, None)
        return {"status": "success", "message": "Event deleted successfully"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to delete event: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Bri3fing EDS Calendar Helper")
    subparsers = parser.add_subparsers(dest="command")

    # Command: calendars
    subparsers.add_parser("calendars", help="List all available calendar sources")

    # Command: events
    events_parser = subparsers.add_parser("events", help="Retrieve schedule briefing events")
    events_parser.add_argument("--days", type=int, default=7, help="Number of days ahead to look (default 7)")
    events_parser.add_argument("--include-past", action="store_true", help="Include past events for today")
    events_parser.add_argument("--calendar", action="append", dest="calendars", help="Filter by calendar UID")

    # Command: add
    add_parser = subparsers.add_parser("add", help="Create a new calendar event")
    add_parser.add_argument("--calendar", type=str, default="", help="Calendar source UID")
    add_parser.add_argument("--summary", type=str, required=True, help="Event title/summary")
    add_parser.add_argument("--date", type=str, default="", help="Event date (YYYY-MM-DD)")
    add_parser.add_argument("--start", type=str, default="", help="Start time (HH:MM)")
    add_parser.add_argument("--end", type=str, default="", help="End time (HH:MM)")
    add_parser.add_argument("--all-day", action="store_true", help="Mark event as all day")
    add_parser.add_argument("--location", type=str, default="", help="Event location")
    add_parser.add_argument("--description", type=str, default="", help="Event description")

    # Command: edit
    edit_parser = subparsers.add_parser("edit", help="Edit an existing calendar event")
    edit_parser.add_argument("--calendar", type=str, required=True, help="Current calendar source UID")
    edit_parser.add_argument("--uid", type=str, required=True, help="Event UID to edit")
    edit_parser.add_argument("--new-calendar", type=str, default="", help="Target calendar UID if moving")
    edit_parser.add_argument("--summary", type=str, default=None, help="Event title/summary")
    edit_parser.add_argument("--date", type=str, default=None, help="Event date (YYYY-MM-DD)")
    edit_parser.add_argument("--start", type=str, default=None, help="Start time (HH:MM)")
    edit_parser.add_argument("--end", type=str, default=None, help="End time (HH:MM)")
    edit_parser.add_argument("--all-day", action="store_true", default=None, help="Mark event as all day")
    edit_parser.add_argument("--timed", action="store_false", dest="all_day", help="Mark event as timed (not all day)")
    edit_parser.add_argument("--location", type=str, default=None, help="Event location")
    edit_parser.add_argument("--description", type=str, default=None, help="Event description")
    edit_parser.add_argument("--rid", type=str, default=None, help="Recurrence ID for recurring events")
    edit_parser.add_argument("--mod-type", type=str, choices=["this", "all"], default="all", help="Modification scope for recurring events")

    # Command: delete
    del_parser = subparsers.add_parser("delete", help="Delete a calendar event")
    del_parser.add_argument("--calendar", type=str, required=True, help="Calendar source UID")
    del_parser.add_argument("--uid", type=str, required=True, help="Event UID to delete")
    del_parser.add_argument("--rid", type=str, default=None, help="Recurrence ID if applicable")
    del_parser.add_argument("--mod-type", type=str, choices=["this", "all"], default="all", help="Deletion scope for recurring events")

    args = parser.parse_args()

    result = None
    if args.command == "calendars":
        calendars = list_calendars()
        result = {"status": "success", "calendars": calendars}

    elif args.command == "events":
        result = get_events(
            days_ahead=args.days,
            include_past_today=args.include_past,
            target_calendar_uids=args.calendars
        )

    elif args.command == "add":
        result = add_event(
            calendar_uid=args.calendar,
            summary=args.summary,
            date_str=args.date,
            start_time_str=args.start,
            end_time_str=args.end,
            all_day=args.all_day,
            location=args.location,
            description=args.description
        )

    elif args.command == "edit":
        result = edit_event(
            calendar_uid=args.calendar,
            event_uid=args.uid,
            new_calendar_uid=args.new_calendar,
            summary=args.summary,
            date_str=args.date,
            start_time_str=args.start,
            end_time_str=args.end,
            all_day=args.all_day,
            location=args.location,
            description=args.description,
            recurrence_id=args.rid,
            mod_type=args.mod_type
        )

    elif args.command == "delete":
        result = delete_event(
            calendar_uid=args.calendar,
            event_uid=args.uid,
            recurrence_id=args.rid,
            mod_type=args.mod_type
        )

    else:
        parser.print_help()
        return

    print(json.dumps(result, indent=2))
    if isinstance(result, dict) and result.get("status") == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()

