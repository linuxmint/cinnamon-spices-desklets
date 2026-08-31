# Changelog

## [1.1.0] 03.04.2026

- Features
  - Added scaling setting based on system font size
  - Added decoration toggle setting
- Refactoring
  - Switched desklet to `class` syntax
  - Removed `getValue`function in constructor (use binding)
  - Switched desklet entry to `on_desklet_added_to_desktop`
  - Set default countdown to current New Year
  - Defined empty properties in constructor
  - Renamed functions and properties
  - Removed logs
  - Simplified cleanup
  - Removed hard-coded local path
  - Removed unused imports
  - Cleanup settings on desklet remove (`settings.finalize()`)
  - Kebab-case for setting names
  - Organized settings by tabs and sections

## [1.0.0] 24.11.2024

- Initial release
