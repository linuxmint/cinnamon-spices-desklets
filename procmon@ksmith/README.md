# ProcMon Table (`procmon@ksmith`)

A Cinnamon desklet that shows a sortable process table powered by `top` batch output.

## Contents

- `info.json`: Cinnamon Spices metadata for listing.
- `screenshot.png`: Main screenshot for the Spices page.
- `files/procmon@ksmith/`: Installable desklet payload.

## Installable payload

The installable folder includes:

- `metadata.json`
- `desklet.js`
- `settings-schema.json`
- `stylesheet.css`
- `icon.png`
- `po/` translations
- `README.md`

## Notes

- Default sort is `CPU%` descending.
- Supports per-core and total-system CPU scaling modes.
- Supports localization via gettext (`en`, `es`, `fr`).
