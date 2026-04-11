# Changelog

## [1.1.0] 11.04.2026

- New Features
  - Custom candle colors
  - Color presets (traditional or red)
  - Setting for number of lit candles (1-4 or automatic)
  - Setting for enable/disable animation
- Refactoring
  - Removed hard-coded local folder path
  - Removed `settings.getValue()` (use binding)
  - Moved `prevent-decorations`to `metadata.json`
  - Removed `imports.lang`
  - Changed desklet entry point to `on_desklet_added_to_desktop()`
  - kebab case for setting names
  - cleanup settings in `on_desklet_removed()` function
  - Made `getAdventCandlesNumber()` more readable
  - Improve animation and candle update loop logic
  - Image caching

## [1.0.0] 03.12.2024

- Initial Release
