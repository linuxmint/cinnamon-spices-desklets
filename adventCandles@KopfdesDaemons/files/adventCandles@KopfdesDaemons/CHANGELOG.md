# Changelog

## [2.0.0] 11.04.2026

- New Features
  - Custom candle colors
  - Color presets (traditional or red)
  - Setting for number of lit candles (1-4 or automatic)
  - Setting to enable/disable animation
- Refactoring
  - Improved performance by image caching
  - Improved animation and candle update loop logic
  - Made `getAdventCandlesNumber()` more readable
  - Removed hard-coded local folder path
  - Removed `settings.getValue()` (use binding)
  - Moved `prevent-decorations` to `metadata.json`
  - Removed `imports.lang`
  - Changed desklet entry point to `on_desklet_added_to_desktop()`
  - Kebab case for setting names
  - Cleaned up settings in `on_desklet_removed()` function
- Fixes
  - fixed broken desklet scale setting on image without a lit candle

## [1.0.0] 03.12.2024

- Initial Release
