# Daily Agenda – Cinnamon Desklet

This is a lightweight Cinnamon desklet that displays today’s calendar events from an `.ics` feed, provided by most popular calendar systems, (e.g. Proton Calendar, Google Calendar, etc.). You just need the calendar invite url.

## Requirements

Please note that this requires libsoup 3.0+. You should have it if your system is up to date, but on older systems, maybe not.

## Features

- Shows events for **today only**
- Automatically hides past events as the day progresses
- Auto-refreshes at a configurable interval
- Supports both **local `.ics` files** and **calendar share URLs**
- Customisable display
- Support most of the common calendar features.

## Configuration

Right-click the desklet and choose **Configure** to set:

- **Calendar source**:
  - `From URL`: Paste a public `.ics` calendar URL (e.g. Proton Calendar sharing link)
  - `From local file`: Use a `.ics` file stored on your system
- **Refresh interval**: How often to check for updates (in minutes)
- **Widget dimensions**: Width and height in pixels
- **Font settings**: Font family and size

> **Note**: Only the calendar source you select will be used. The other one will be ignored.

If you're unsure what to use, URL or File: Most people will just want to use a URL. Copy the *'share my calendar'* link on your calendar system and paste it in. Make sure the system is set to use 'url' source and you're done. Proton users, read: https://proton.me/support/share-calendar-via-link#how-to-share-a-calendar-with-anyone. 

The 'File' option is just for if you're hosting entirely locally or downloading an ics file from somewhere. 


## Supported ICS features

* Parsing DTSTART with optional time and timezone (UTC, local, or named zones via GLib).
* Handling all-day events (dates without time).
* Recurrence rules (RRULE) for DAILY, WEEKLY, MONTHLY, YEARLY frequencies.
* Repeat count (COUNT) and expiration by UNTIL date.
* Basic BYDAY filtering for weekly recurrences (matching weekdays).
* Sorting events by time.
* Unfolding folded ICS lines.

## Not supported or limited

* VTIMEZONE components and embedded timezone definitions.
* Complex BYDAY patterns with ordinal prefixes (e.g., 1MO, -1SU).
* Other RRULE parts like BYMONTHDAY, BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND.
* EXDATE and EXRULE for exclusions.
* RDATE for additional recurrence dates.
* Recurrence exceptions or modifications.
* Timezone transitions and daylight saving time changes beyond GLib timezones.
* Support for multiple calendar components beyond VEVENT.
* Parsing and handling VALARM or other calendar subcomponents.


## ☕ Support
If you find this desklet useful, do please consider buying me a coffee to say thanks, it would mean a lot to me:
[Buy me a coffee](buymeacoffee.com/alexmakessoftware)

