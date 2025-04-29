# Daily Agenda – Cinnamon Desklet

This is a lightweight Cinnamon desklet that displays today’s calendar events from either an `.ics` file — either loaded from a local file or downloaded directly from a URL (e.g. Proton Calendar, Google Calendar, etc.).

## Features

- Shows events for **today only**
- Automatically hides past events as the day progresses
- Auto-refreshes at a configurable interval
- Supports both **local `.ics` files** and **calendar share URLs**
- Customisable display

## Configuration

Right-click the desklet and choose **Configure** to set:

- **Calendar source**:
  - `From URL`: Paste a public `.ics` calendar URL (e.g. Proton Calendar sharing link)
  - `From local file`: Use a `.ics` file stored on your system
- **Refresh interval**: How often to check for updates (in minutes)
- **Widget dimensions**: Width and height in pixels
- **Font settings**: Font family and size

> **Note**: Only the calendar source you select will be used. The other one will be ignored.

## FAQ:
Which should I use, URL or File?
If you're hosting entirely locally or downloading an ics file from some system, using say... a cron job then use 'file', in all other cases you want to check with your calendar provider on how to get a public calendar link to show your events, as an ICS file, for proton users, read: https://proton.me/support/share-calendar-via-link#how-to-share-a-calendar-with-anyone.

## ☕ Support
If you find this desklet useful, do please consider buying me a coffee to say thanks, it would mean a lot to me:
[Buy me a coffee](buymeacoffee.com/alexmakessoftware)

