# Changelog

## [1.0.0] 09.11.2024

- Initial release

## [1.1.0] 04.04.2026

- Features
  - Added scaling setting based on system font size
  - Added decoration toggle setting
- Refactoring
  - Async file loading by `load_contents_async`
  - Removed hard-coded locale path
  - Removed `settings.getValue()`function in constructor (use binding)
  - Renamed properties and functions
  - Switched desklet entry to `on_desklet_added_to_desktop`
  - Removed `stylesheet.css`
  - Removed unused imports
  - Added settings cleanup
  - Kebab-case for setting names
