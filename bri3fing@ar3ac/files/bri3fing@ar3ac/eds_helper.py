#!/usr/bin/env python3
"""
Bri3fing EDS Helper Backend
Interacts with Evolution Data Server (EDS) to query and create calendar events.
Output is formatted in JSON for consumption by Cinnamon Desklet (GJS).
"""

import sys
import os
import json
import argparse
import datetime
import time
import uuid

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


def get_calendar_color(source):
    """Extracts the hex color code for a calendar source, defaulting to standard blue if not set."""
    try:
        cal_ext = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
        if cal_ext and hasattr(cal_ext, 'get_color'):
            color = cal_ext.get_color()
            if color and color.startswith('#'):
                return color
    except Exception:
        pass
    return "#4285F4"


def list_calendars(registry=None):
    """Returns a list of all calendar sources configured in EDS."""
    if registry is None:
        registry = get_source_registry()

    sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
    calendars = []

    for source in sources:
        cal_ext = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
        writable = cal_ext.get_writable() if hasattr(cal_ext, 'get_writable') else True
        is_online = is_source_online(registry, source)

        calendars.append({
            "uid": source.get_uid(),
            "name": source.get_display_name(),
            "color": get_calendar_color(source),
            "enabled": source.get_enabled(),
            "writable": writable,
            "is_online": is_online
        })

    return calendars


def get_events(days_ahead=7, include_past_today=False, target_calendar_uids=None):
    """
    Queries events across enabled calendars for the specified day range.
    Expands recurring instances and formats output into clean JSON.
    """
    registry = get_source_registry()
    sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)

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

        calendars_info.append({
            "uid": uid,
            "name": display_name,
            "color": color,
            "enabled": enabled,
            "is_online": is_online
        })

        if not enabled:
            continue

        if target_calendar_uids and uid not in target_calendar_uids:
            continue

        try:
            client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
        except Exception:
            continue

        def on_instance(comp, start_time, end_time, *args):
            try:
                is_all_day = start_time.is_date()
                ev_uid = comp.get_uid() or ""
                summary = comp.get_summary() or "(Untitled event)"
                location = comp.get_location() or ""
                description = comp.get_description() or ""

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
                    date_str = ev_start_date.isoformat()
                    event_date = ev_start_date
                    is_multi_day = (display_end_date > ev_start_date)
                else:
                    utc_zone = ICalGLib.Timezone.get_utc_timezone()
                    ev_start_ts = start_time.as_timet_with_zone(utc_zone)
                    ev_end_ts = end_time.as_timet_with_zone(utc_zone)

                    start_local_dt = datetime.datetime.fromtimestamp(ev_start_ts)
                    end_local_dt = datetime.datetime.fromtimestamp(ev_end_ts)

                    start_time_str = start_local_dt.strftime("%H:%M")
                    end_time_str = end_local_dt.strftime("%H:%M")
                    date_str = start_local_dt.date().isoformat()
                    event_date = start_local_dt.date()
                    display_end_date = end_local_dt.date()
                    is_multi_day = (display_end_date > event_date)

                # Filter past events if requested
                if not include_past_today and ev_end_ts < current_ts:
                    return True

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

                events.append({
                    "uid": ev_uid,
                    "summary": summary,
                    "location": location,
                    "description": description,
                    "all_day": is_all_day,
                    "multi_day": is_multi_day,
                    "start_ts": ev_start_ts,
                    "end_ts": ev_end_ts,
                    "date_str": date_str,
                    "start_time_str": start_time_str,
                    "end_time_str": end_time_str,
                    "day_category": day_category,
                    "calendar_uid": uid,
                    "calendar_name": display_name,
                    "calendar_color": color,
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


def _apply_event_times_and_dates(ical_comp, date_str=None, start_time_str=None, end_time_str=None, all_day=False):
    """Configures DTSTART and DTEND on an iCal component for all-day or timed events."""
    if not date_str:
        target_date = datetime.date.today()
    else:
        try:
            target_date = datetime.date.fromisoformat(date_str.strip())
        except Exception:
            target_date = datetime.date.today()

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
            parts = start_time_str.strip().split(":")
            start_hour = int(parts[0].strip())
            start_minute = int(parts[1].strip()) if len(parts) > 1 else 0

        if not end_time_str or not end_time_str.strip():
            end_hour = (start_hour + 1) % 24
            end_minute = start_minute
            end_date = target_date + datetime.timedelta(days=1 if start_hour == 23 else 0)
        else:
            parts = end_time_str.strip().split(":")
            end_hour = int(parts[0].strip())
            end_minute = int(parts[1].strip()) if len(parts) > 1 else 0
            if end_hour < start_hour or (end_hour == start_hour and end_minute < start_minute):
                end_date = target_date + datetime.timedelta(days=1)
            else:
                end_date = target_date

        start_dt = datetime.datetime(target_date.year, target_date.month, target_date.day, start_hour, start_minute)
        end_dt = datetime.datetime(end_date.year, end_date.month, end_date.day, end_hour, end_minute)

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

    if not source:
        sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
        # Prioritize enabled online calendars, then any enabled calendar
        for s in sources:
            if s.get_enabled() and is_source_online(registry, s):
                source = s
                break
        if not source:
            for s in sources:
                if s.get_enabled():
                    source = s
                    break

    if not source:
        return {"status": "error", "message": "No active calendar source available"}

    try:
        client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
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

    _apply_event_times_and_dates(ical_comp, date_str, start_time_str, end_time_str, all_day)

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


def edit_event(calendar_uid, event_uid, new_calendar_uid=None, summary=None, date_str=None, start_time_str=None, end_time_str=None, all_day=False, location=None, description=None):
    """
    Modifies an existing VEVENT component in EDS.
    If new_calendar_uid is specified and differs from calendar_uid, the event is moved.
    """
    registry = get_source_registry()
    source = registry.ref_source(calendar_uid)
    if not source:
        return {"status": "error", "message": f"Calendar {calendar_uid} not found"}

    try:
        client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
        success, ical_comp = client.get_object_sync(event_uid, None, None)
        if not success or not ical_comp:
            return {"status": "error", "message": f"Event {event_uid} not found"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to retrieve event: {str(e)}"}

    if summary is not None:
        ical_comp.set_summary(summary.strip() or "Untitled Event")
    if location is not None:
        ical_comp.set_location(location.strip())
    if description is not None:
        ical_comp.set_description(description.strip())

    _apply_event_times_and_dates(ical_comp, date_str, start_time_str, end_time_str, all_day)

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
            new_client.create_object_sync(ical_comp, ECal.OperationFlags.NONE, None)
            client.remove_object_sync(event_uid, None, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, None)
            return {
                "status": "success",
                "uid": event_uid,
                "calendar_uid": new_calendar_uid,
                "message": "Event moved and updated successfully"
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to move event: {str(e)}"}
    else:
        try:
            client.modify_object_sync(ical_comp, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, None)
            return {
                "status": "success",
                "uid": event_uid,
                "calendar_uid": calendar_uid,
                "message": "Event updated successfully"
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to update event: {str(e)}"}


def delete_event(calendar_uid, event_uid, recurrence_id=None):
    """Deletes an event from the specified calendar source."""
    registry = get_source_registry()
    source = registry.ref_source(calendar_uid)
    if not source:
        return {"status": "error", "message": f"Calendar {calendar_uid} not found"}

    try:
        client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 5, None)
        client.remove_object_sync(event_uid, recurrence_id, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, None)
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
    edit_parser.add_argument("--summary", type=str, required=True, help="Event title/summary")
    edit_parser.add_argument("--date", type=str, default="", help="Event date (YYYY-MM-DD)")
    edit_parser.add_argument("--start", type=str, default="", help="Start time (HH:MM)")
    edit_parser.add_argument("--end", type=str, default="", help="End time (HH:MM)")
    edit_parser.add_argument("--all-day", action="store_true", help="Mark event as all day")
    edit_parser.add_argument("--location", type=str, default="", help="Event location")
    edit_parser.add_argument("--description", type=str, default="", help="Event description")

    # Command: delete
    del_parser = subparsers.add_parser("delete", help="Delete a calendar event")
    del_parser.add_argument("--calendar", type=str, required=True, help="Calendar source UID")
    del_parser.add_argument("--uid", type=str, required=True, help="Event UID to delete")
    del_parser.add_argument("--rid", type=str, default=None, help="Recurrence ID if applicable")

    args = parser.parse_args()

    if args.command == "calendars":
        calendars = list_calendars()
        print(json.dumps({"status": "success", "calendars": calendars}, indent=2))

    elif args.command == "events":
        result = get_events(
            days_ahead=args.days,
            include_past_today=args.include_past,
            target_calendar_uids=args.calendars
        )
        print(json.dumps(result, indent=2))

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
        print(json.dumps(result, indent=2))

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
            description=args.description
        )
        print(json.dumps(result, indent=2))

    elif args.command == "delete":
        result = delete_event(
            calendar_uid=args.calendar,
            event_uid=args.uid,
            recurrence_id=args.rid
        )
        print(json.dumps(result, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()

