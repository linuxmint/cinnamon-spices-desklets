# ProcMon Table Desklet (`procmon@ksmith`)

A Cinnamon desklet for Linux Mint 22.3 / Cinnamon 6.6.7 that shows a sortable process table powered by `top` batch output.

## Features

- Columns: `PID`, `USER`, `CPU%`, `MEM`, `COMMAND`
- Default view: top 10 processes
- Click header to sort by column
- Click same header again to toggle ascending/descending
- Default sort: `CPU%` descending
- Stable, in-desklet JavaScript sorting
- Uses `top -b` (not `ps`) so CPU is interval-based
- Optional "only my processes" mode (`top -u <user>`)
- Async refresh using `Gio.Subprocess.communicate_utf8_async` (no UI blocking)
- Defensive handling for null/empty stdout/stderr and command failures

## Settings

- **Refresh interval** (seconds)
- **Number of rows**
- **PID/USER/CPU%/MEM/COMMAND column widths** (px)
- **Disable desklet decorations**
- **Header text color**
- **Content text color**
- **Background color**
- **Background transparency** (%)
- **Only my processes**
- **CPU scaling mode**
  - `per_core`: top default (100% = one core)
  - `total_scaled`: divide by CPU core count so 100% = full system
- **COMMAND max length** (truncate with `...`)

Desklet width is computed automatically as the sum of all column widths.

## Screenshots

Main process table:
![Main process table](assets/screenshot-main.png)

Custom theming example:
![Custom theming](assets/screenshot-theme.png)

Settings view:
![Desklet settings](assets/screenshot-settings.png)

## Data parsing

The desklet runs:

```bash
top -b -n 1 -d 0.1 -o %CPU -w 512
```

When "Only my processes" is enabled, it adds:

```bash
-u <current_username>
```

Parser behavior:

- Detects the process header row (`PID USER ... %CPU ... RES ... COMMAND`)
- Parses process rows whose first token is numeric PID
- Extracts `PID`, `USER`, `%CPU`, `RES`, `COMMAND`
- Converts RES to internal `memKb` for correct numeric sorting
- Formats memory display consistently as `K`, `M`, or `G`

## How to install locally

1. Copy folder to your local desklets directory:

```bash
mkdir -p ~/.local/share/cinnamon/desklets
cp -r procmon@ksmith ~/.local/share/cinnamon/desklets/
```

2. Open **System Settings -> Desklets**.
3. Add **ProcMon Table** to desktop.
4. Configure options via the desklet settings dialog.

## Reload Cinnamon / desklets for testing

- X11 session: press `Alt+F2`, type `r`, press Enter.
- Wayland session: log out and log back in.
- You can also remove/re-add the desklet from Desklets settings after edits.

## Localization

- Translation template: `po/procmon@ksmith.pot`
- Add/update language files in `po/<lang>.po` and list languages in `po/LINGUAS`.
- Build a local `.mo` for testing:

```bash
mkdir -p ~/.local/share/locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o ~/.local/share/locale/<lang>/LC_MESSAGES/procmon@ksmith.mo
```

## Packaging and release

- Follow `RELEASE_CHECKLIST.md` for preflight checks, archive creation, and post-release verification.

## Versioning and changelog workflow

- Changelog lives in `CHANGELOG.md` with an `[Unreleased]` section.
- Use the helper script to bump `metadata.json` and scaffold a dated changelog section:

```bash
scripts/bump-version.sh patch
```

- Supported bump targets:
  - `major`
  - `minor`
  - `patch`
  - explicit version like `1.2.0`
- Preview without writing changes:

```bash
scripts/bump-version.sh minor --dry-run
```

## Files

- `metadata.json`
- `desklet.js`
- `settings-schema.json`
- `stylesheet.css`
- `po/procmon@ksmith.pot`
- `po/en.po`
- `po/es.po`
- `po/fr.po`
- `po/LINGUAS`
- `CHANGELOG.md`
- `RELEASE_CHECKLIST.md`
- `scripts/bump-version.sh`
- `README.md`
