# Big Calendar

A large, configurable month-view calendar for the Cinnamon desktop, with events
from the calendars already connected in Online Accounts.

Everything about it is configurable — size, colours, layout, which events are
shown and how. It reads the calendars your system already knows about, so there
is nothing to log into and no password to give it.

## What it does

- **Month view** with the day numbers, week numbers (ISO 8601 or North
  American), and weekends tinted in their own colour.
- **Your events**, from every calendar in Online Accounts: Google, Nextcloud,
  Microsoft, CalDAV, or a local one. Shown as coloured dots, coloured bars, or
  the event titles themselves — whichever fits your desktop.
- **Hover tooltips** headed by the date, listing that day's events with their
  start times, each row filled with its own calendar's colour.
- **Paging** through months with the arrows or the scroll wheel, and the month
  you were on is remembered for next time. Whenever you are looking at some
  other month, a **Today** button appears in the header to bring you back.
- **Everything scales** from one setting: text size drives the whole calendar,
  from a 466×329 corner widget at 100 % up to 1754×995 at 400 %, which is
  nearly the full width of a 1920-wide screen. The default, 200 %, gives
  893×555.
- Light and dark themes both work — it starts from the Mint-Y palette and every
  colour is a setting.

## Requirements

- Cinnamon 6.0 or newer.
- For events: at least one account added in **System Settings → Online
  Accounts**. The desklet needs `gir1.2-ecal-2.0`, `gir1.2-edataserver-1.2` and
  `gir1.2-ical-3.0`, which Cinnamon depends on already.

Without a connected account the calendar still works; it just has no events to
show.

## Privacy

**The desklet has no account, no password and no network code of its own.** It
asks your own system what your events are, and draws the answer. Nothing about
you leaves the machine because of this desklet.

- **It stores no credentials.** There is no OAuth client ID, no token, no
  password, and no calendar URL anywhere in it. Google sign-in is handled
  entirely by Online Accounts, which keeps the token in your system keyring
  under your distribution's control — the same token the Calendar application
  uses. Deleting the account in Online Accounts removes the desklet's access
  with it.
- **It talks to no server.** The only thing it contacts is
  `evolution-data-server`, over the session D-Bus on your own machine. That
  service is what actually talks to Google, refreshing tokens and caching
  results for offline use — exactly as it already does for the Calendar
  application and for GNOME's clock. Every call it makes is asynchronous, so
  nothing it asks for can freeze the desktop while it waits.
- **It has no analytics, telemetry, update check or crash reporting.** There is
  nothing to opt out of, because there is nothing there.
- **It is plain, readable source.** No bundled libraries, no minified files, no
  compiled blobs.

## Settings

All of these are in the desklet's **Configure** dialog, sorted into four pages.

### Appearance

**Size and spacing**

| Setting | Key | Default |
|---|---|---|
| Text size | `font-scale` | 200 % (50–400) |
| Inner padding | `padding` | 16 px (0–80) |
| Corner roundness of day highlights | `cell-radius` | 8 px (0–40) |

**Background**

| Setting | Key | Default |
|---|---|---|
| Background colour | `bg-color` | `#303036` |
| Background opacity | `bg-opacity` | 85 % (0–100) |
| Corner radius of the calendar | `corner-radius` | 14 px (0–60) |
| Border thickness | `border-width` | 0 px (0–10) |
| Border colour | `border-color` | `#3c3c44` |
| Draw grid lines between days | `show-grid-lines` | off |
| Grid line colour | `grid-line-color` | `#3c3c44` |

**Text colours**

| Setting | Key | Default |
|---|---|---|
| Day numbers | `text-color` | `#e1e1e1` |
| Month and year | `header-color` | `#ffffff` |
| Weekday headings | `weekday-color` | `#9a9a9a` |
| Weekend days | `weekend-color` | `#1f9ede` |
| Days outside this month | `other-month-color` | `#6a6a72` |
| Fade days from other months | `dim-other-months` | on |
| Fade amount | `other-month-opacity` | 35 % (0–100) |

**Today**

| Setting | Key | Default |
|---|---|---|
| Highlight today with | `today-style` | Filled background |
| Highlight colour | `today-bg-color` | `#1f9ede` |
| Today's number colour | `today-text-color` | `#ffffff` |

**Weekends**

| Setting | Key | Default |
|---|---|---|
| Tint weekend days | `tint-weekends` | on |
| Weekend tint strength | `weekend-tint-strength` | 10 % (0–60) |

### Layout

**Week**

| Setting | Key | Default |
|---|---|---|
| Week starts on | `week-start` | Match my system |
| Week numbering | `week-numbering` | ISO 8601 |
| Show week numbers | `show-week-numbers` | off |
| Week number colour | `week-number-color` | `#6a6a72` |

**Month grid**

| Setting | Key | Default |
|---|---|---|
| Rows | `rows` | Always six (fixed height) |
| Header format | `month-format` | September 2026 |

**Header**

| Setting | Key | Default |
|---|---|---|
| Show month navigation arrows | `show-navigation` | on |
| Arrow colour | `nav-color` | `#c3c3c3` |

### Events

**Calendars**

| Setting | Key | Default |
|---|---|---|
| Show events from my calendars | `show-events` | on |

**Appearance**

| Setting | Key | Default |
|---|---|---|
| Show each day's events as | `event-style` | Coloured dots |
| Most indicators per day | `event-max` | 3 (1–8) |
| Clock | `event-time-format` | Match my system |
| List a day's events on hover | `show-event-tooltips` | on |

**Refresh**

| Setting | Key | Default |
|---|---|---|
| Re-check for changes every | `event-refresh` | 20 min (5–240) |

### Behaviour

| Setting | Key | Default |
|---|---|---|
| Open on the current month | `start-on-today` | on |
| Change month with the scroll wheel | `mouse-wheel-navigation` | on |

## Known limitations

- **All calendars are shown, with no per-calendar filter.** There is no way yet
  to hide, say, a birthday calendar while keeping your work one. The
  `show-events` setting is all-or-nothing.
- **A day shows fewer dots than `event-max` when they will not fit.** The dots
  are drawn to a fixed pixel size and the cell is only so wide, so the desklet
  caps the row at what actually fits and counts the rest into the `+N` label.
  The count is always in the tooltip.

## Licence

GPL-3.0-or-later. See `files/bigCalendar@adis/LICENSE`.
