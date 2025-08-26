# Daily Agenda – Cinnamon Desklet

This is a lightweight Cinnamon desklet that displays today’s calendar events from an `.ics` feed, provided by most popular calendar systems, (e.g. Proton Calendar, Google Calendar, etc.). You just need the calendar invite url.

## Requirements

Please note that this requires libsoup 3.0+. You should have it if your system is up to date, but on older systems, maybe not.

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

## Supported ICS Features

* `DTSTART` parsing with optional time and timezone support (UTC, local, or named zones via GLib)
* All-day events (dates without time)
* `RRULE` support for:

  * Frequencies: `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`
  * `INTERVAL` handling (e.g. every 2 days/weeks)
  * `COUNT` and `UNTIL` (limit total number of repeats or until a date)
  * `BYDAY` filtering (e.g. `MO,WE,FR`; ordinal prefixes like `1MO` are skipped)
* `EXDATE` exclusion support (with proper timezone handling)
* Recurrence overrides using `RECURRENCE-ID` (e.g. rescheduling or modifying a specific recurring instance)
* Events sorted chronologically
* Support for unfolding folded lines

## Not Supported or Limited

* `EXRULE` exclusions (deprecated in RFC5545, and rarely used)
* `RDATE` for additional recurrence dates
* Ordinal `BYDAY` prefixes (e.g. `1MO`, `-1SU`) – currently ignored
* Other RRULE components like `BYMONTHDAY`, `BYYEARDAY`, `BYWEEKNO`, `BYHOUR`, `BYMINUTE`, `BYSECOND`
* VTIMEZONE components and embedded timezone definitions (relies on system GLib timezones)
* Timezone transitions and daylight saving handling beyond what GLib supports
* Calendar subcomponents such as `VALARM` or non-VEVENT types

## ☕ Support
If you find this desklet useful, do please consider buying me a coffee to say thanks, it would mean a lot to me:
[Buy me a coffee](buymeacoffee.com/alexmakessoftware)

