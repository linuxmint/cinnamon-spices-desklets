# Bri3fing (`bri3fing@ar3ac`)

[![Cinnamon Desklet](https://img.shields.io/badge/Cinnamon-5.4+-darkcyan?logo=linuxmint&logoColor=white)](https://cinnamon-spices.linuxmint.com/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-Support-29abe0?logo=ko-fi&logoColor=white)](https://ko-fi.com/ar3ac)

A sleek, native desktop agenda widget and event manager for the **Cinnamon Desktop Environment** (Linux Mint), seamlessly synchronized with **Google Calendar** (as well as Nextcloud, Microsoft 365, and generic CalDAV accounts).

Designed with a stealth, minimalist dark glass aesthetic that blends seamlessly into any desktop setup.

<p align="center">
  <img src="docs/screenshots/screenshot.png" alt="Bri3fing Desklet Preview" width="380" />
</p>

---

## Key Highlights

- **Zero-Friction OS-Native Integration:** No Google Cloud Console setup, no client secret JSON files, and no 7-day token expiration hurdles. Bri3fing taps directly into Linux Mint's native **Online Accounts** (GNOME Online Accounts + Evolution Data Server).
- **Guided First-Launch Onboarding:** When launched for the first time without an online account configured, Bri3fing displays a guided onboarding card with a direct `[ Connect Account… ]` action, automatically monitoring and refreshing your agenda the moment Google or CalDAV login is completed.
- **Chronus-Style Day-by-Day Agenda:** Continuous timeline organized day-by-day (e.g. *Today*, *Tomorrow*, *Tuesday, Oct 27*, *Monday, Nov 2*), skipping empty days for maximum clarity across a 2-week (or custom) horizon.
- **Live Next-Up Briefing & Minute-Accurate Alerts:** Lightweight 60-second in-memory ticker updates the header countdown (*"In 25 min: Team Sync"* / *"Now: Standup"*), refreshes **NOW** / **SOON** badges on the exact minute, handles midnight rollover automatically, and triggers native desktop notifications precisely on schedule without extra backend polling.
- **One-Click Video Meeting Join & Maps:** Auto-detects Google Meet, Zoom, Microsoft Teams, Webex, and Jitsi links (`[ 📹 Join ]`) and adds an `[ 🗺 Open in Maps ]` (OpenStreetMap) button for physical event locations.
- **Header Calendar Launcher:** Clicking the header date title instantly opens GNOME Calendar or the system default calendar.
- **Real-Time Inline Search:** Expandable search bar (`[ 🔍 ]`) to filter your agenda on the fly by event title, location, description, or calendar source.
- **Calendar Visibility Filtering & Read-Only Awareness:** Quickly hide or show individual calendars from the right-click context menu (*Visible Calendars*) or settings, while automatically filtering read-only calendars (e.g. Holidays, Birthdays) out of event creation/editing selectors.
- **Visual Status Badges & Smooth Scroll:** Calendar color indicator strips, start/end time ranges, recurring event indicators (`↻`), location tags, real-time badges (**NOW** / **SOON**), smooth edge fade (`vfade`), and a sleek 5px glass scrollbar.
- **Quick Event Creation, Presets & Safe Recurring Editing:** Add new appointments (`[+]`) with one-click date/duration presets (`Today`, `Tomorrow`, `+1 week`, `30m`, `1h`, `2h`) and inline validation, or click any existing event to inspect details, edit/delete a **single occurrence** or **entire recurring series**, and sync changes in the background to Google Calendar.
- **Worldwide Timezone & DST Accuracy:** Preserves explicit `TZID` / `VTIMEZONE`, UTC (`Z`), RFC 5545 floating times, fractional offsets, and POSIX `TZ` overrides across every timezone on Earth.
- **Offline First:** Cached locally in the system's Evolution Data Server database, ensuring your schedule is always visible even without internet connectivity.
- **Complete Native Internationalization (i18n):** 100% translated UI and Cinnamon settings catalogs out of the box in English (`en`) and Italian (`it`), plus a complete `.pot` template for community translators.
- **Fully Customizable:** Flexible Cinnamon settings for desklet width, stable default height, background opacity, font scaling, briefing range, and custom field color pickers.

---

## Visual Showcase

| Agenda & Schedule Briefing | First-Launch Onboarding | In-Place Event Creation & Editing |
| :---: | :---: | :---: |
| <img src="docs/screenshots/screenshot.png" width="280" /> | <img src="docs/screenshots/onboarding.png" width="280" /> | <img src="docs/screenshots/event_dialog.png" width="280" /> |
| *Chronus timeline with video call buttons* | *Zero-friction account setup* | *Clean dropdown calendar selector* |

---

## Prerequisites & Account Setup

To connect your Google Calendar:

1. Open your Cinnamon Application Menu and launch **Online Accounts** (or navigate to *System Settings -> Online Accounts*).
2. Select **Google** and log in with your account credentials.
3. Ensure the **Calendar** toggle is turned **ON**.

Once enabled, Bri3fing automatically discovers your calendars and populates your agenda without requiring manual API credentials or local tokens.

---

## Installation

### Automated Setup

Run the installation script to symlink the desklet bundle and compile translations:

```bash
git clone https://github.com/ar3ac/bri3fing.git ~/projects/bri3fing
cd ~/projects/bri3fing
./scripts/install.sh
```

### Manual Setup

Alternatively, create the symlink and compile translations manually:

```bash
mkdir -p ~/.local/share/cinnamon/desklets
ln -snf ~/projects/bri3fing/desklet/bri3fing@ar3ac ~/.local/share/cinnamon/desklets/bri3fing@ar3ac
```

Compile and install translation catalogs:

```bash
mkdir -p ~/.local/share/locale/it/LC_MESSAGES ~/.local/share/locale/en/LC_MESSAGES
msgfmt ~/projects/bri3fing/desklet/bri3fing@ar3ac/po/it.po -o ~/.local/share/locale/it/LC_MESSAGES/bri3fing@ar3ac.mo
msgfmt ~/projects/bri3fing/desklet/bri3fing@ar3ac/po/en.po -o ~/.local/share/locale/en/LC_MESSAGES/bri3fing@ar3ac.mo
```

Then enable the desklet in Cinnamon:
1. Open **System Settings -> Desklets**.
2. Locate **Bri3fing** and click the **+** (Add) button to place it on your desktop.

### Uninstallation

To remove the desklet and its localization catalogs cleanly:

```bash
./scripts/uninstall.sh
```

---

## CLI Backend Helper (`eds_helper.py`)

Bri3fing includes a standalone, timezone-aware backend helper interfacing directly with `Evolution Data Server` via Python GObject introspection (`gir1.2-ecal-2.0` and `gir1.2-edataserver-1.2`). It accurately converts events across explicit `TZID` timezones, UTC timestamps (`Z`), RFC 5545 floating times, and daylight saving time transitions into the local system timezone:

```bash
# List all configured calendar sources
./desklet/bri3fing@ar3ac/eds_helper.py calendars

# Retrieve briefing events for the next 7 days
./desklet/bri3fing@ar3ac/eds_helper.py events --days 7

# Include past events from earlier today
./desklet/bri3fing@ar3ac/eds_helper.py events --days 7 --include-past

# Quickly add a new event
./desklet/bri3fing@ar3ac/eds_helper.py add \
    --summary "Sprint Retrospective" \
    --date 2026-10-25 \
    --start 15:00 \
    --end 16:00 \
    --location "Google Meet"

# Add an all-day event
./desklet/bri3fing@ar3ac/eds_helper.py add \
    --summary "Public Holiday" \
    --date 2026-10-26 \
    --all-day

# Edit an existing event (omitted fields like --date/--location are preserved)
./desklet/bri3fing@ar3ac/eds_helper.py edit \
    --calendar system-calendar \
    --uid <event-uid> \
    --summary "Updated Sprint Retrospective" \
    --start 15:30 \
    --end 16:30

# Edit or delete only a single occurrence of a recurring event
./desklet/bri3fing@ar3ac/eds_helper.py delete \
    --calendar system-calendar \
    --uid <event-uid> \
    --rid 20261204T150000Z \
    --mod-type this

# Delete an event (or entire recurring series)
./desklet/bri3fing@ar3ac/eds_helper.py delete --calendar system-calendar --uid <event-uid>
```

### Running Tests

```bash
python3 -m unittest discover -s tests -v
```

---

## Configuration Settings

Configure Bri3fing directly through Cinnamon Desklet Settings (*Right-click widget -> Configure...*):

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **Days ahead** | Spinbutton | `14` | Number of days ahead to include in briefing (1–60) |
| **Show past events** | Switch | `false` | Display today's events that have already ended |
| **Show event location** | Switch | `true` | Display event location when available |
| **24-hour time format** | Switch | `true` | Use 24-hour format (`14:30`) vs 12-hour AM/PM |
| **Refresh interval** | Spinbutton | `10` | Automatic refresh frequency in minutes |
| **Hidden calendars** | Entry | `""` | Comma-separated hidden calendar UIDs (or toggle via right-click) |
| **Desktop notifications** | Switch | `true` | Show native desktop alerts for upcoming events |
| **Notification lead time** | Spinbutton | `10` | Minutes before event start time to notify (1–60) |
| **Transparent background**| Switch | `false` | Enable completely transparent desklet canvas |
| **Desklet opacity** | Spinbutton | `30%` | Card background opacity when transparency is off |
| **Desklet width** | Spinbutton | `340px` | Total widget width in pixels |
| **Desklet height** | Spinbutton | `290px` | Default stable desklet height in pixels |
| **Auto-shrink height** | Switch | `false` | Dynamically shrink height when there are few events |
| **Font size** | Spinbutton | `9pt` | Text size for event titles (7–18pt) |
| **Header font size** | Spinbutton | `11pt` | Text size for header date (8–20pt) |
| **Compact mode** | Switch | `true` | Reduced padding and spacing for sleek Chronus density |
| **Custom colors** | Switch | `false` | Enable custom color pickers for all schedule fields |
| **Section color** | Colorchooser | `rgb(96,165,250)` | Section & day header accent color |
| **Title color** | Colorchooser | `rgb(243,244,246)` | Event title text color |
| **Time color** | Colorchooser | `rgb(209,213,219)` | Time & duration label color |
| **Calendar tag color** | Colorchooser | `rgb(147,197,253)` | Calendar account tag color |

---

## Repository Structure

```text
bri3fing/
├── LICENSE                    # GNU General Public License v3.0
├── README.md                  # Public documentation & user guide
├── CHANGELOG.md               # Release history (Keep a Changelog)
├── .gitignore                 # Git ignore rules
├── .github/
│   ├── workflows/ci.yml       # Automated test, syntax & i18n CI pipeline
│   └── ISSUE_TEMPLATE/        # Bug report template
├── docs/
│   └── screenshots/           # Documentation and showcase preview images
├── scripts/
│   ├── install.sh             # Automated installer & translation compiler
│   ├── uninstall.sh           # Clean uninstallation script
│   └── package.sh             # Release packaging script (.zip)
├── tests/
│   ├── test_eds_helper.py     # Validation & 16-timezone global DST test suite
│   └── test_desklet_assets.py # Metadata, schema, GJS, Spices & i18n checks
└── desklet/
    └── bri3fing@ar3ac/        # Cinnamon Desklet bundle
        ├── metadata.json      # Desklet metadata & versioning
        ├── desklet.js         # Core GJS desklet implementation
        ├── stylesheet.css     # Desklet styling (stealth dark theme)
        ├── settings-schema.json # Cinnamon settings schema
        ├── eds_helper.py      # Standalone EDS backend helper
        ├── icon.png           # Desklet icon
        ├── screenshot.png     # Cinnamon Spices thumbnail preview
        └── po/                # Localization catalogs (100% UI + settings)
            ├── bri3fing@ar3ac.pot # Cinnamon Spices translation template
            ├── en.po          # English base translation
            └── it.po          # Italian translation
```

---

## ☕ Support

If you find **Bri3fing** useful and would like to support its ongoing development and maintenance, consider buying me a coffee:

<p align="left">
  <a href="https://ko-fi.com/ar3ac" target="_blank">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi" style="height: 40px !important;" />
  </a>
</p>

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the [LICENSE](LICENSE) file for details.
