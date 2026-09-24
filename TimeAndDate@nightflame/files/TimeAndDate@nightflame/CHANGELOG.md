## [2.1.1] - 09.01.2026

### Changed

- `README.md`: added a warning that `%W` and `%U` formats won't work

## [2.1] - 01.01.2026

### Changed

- Default date format from `%A,%e %B` to `%A, %-d %B`
- Moved `is-order-reversed`, `is-two-column`, `is-width-forced`, `forced-width-size"` settings from Preferences to Theme tab 
- Regenerated translation files

### Fixed

- Desklet freezing/crashing when inputting an invalid strftime format (happened often while editing format)

## [2.0.1] - 13.12.2025

Small CSS update/fix

### Changed

- `stylesheet.css`

### Fixed

- CSS classes `time-container` and `date-container` were reversed and assigned to wrong elements

## [2.0] - 05.11.2025

Overhaul/modernization of 8+ years old code.

### Added

- Many new utility and visual settings
- `CHANGELOG.md`
- `settings-schema.json`


### Changed

- General code refactoring
- Completely changed desklet customization, now its using xlet-settings instead of proprietary `metadata.json` and `stylesheet.css` customization.
- Reworked UI rendering
- New screenshot
- `README.md`
- `TimeAndDate@nightflame.pot`


### Removed

- All previous translation, they are no longer relevant. 