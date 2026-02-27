# Changelog

## [1.0.0] 09.12.2025

- Initial Release

## [2.0.0] 25.02.026

- New features:
  - Added skeleton grid for setup and error UI
  - Added decoration toggle setting
  - Added Desklet scale size setting based on system font size
  - Added block color settings
- Fixes
  - Fixed blocking on grid rendering
- Refactoring:
  - UI logic extracted into `UiHelper`
  - Added `deskletManager` as Fallback for `require` imports
  - Changed Desklet entry point to `on_desklet_added_to_desktop`
  - Added settings cleanup on Desklet removal
  - Added Soup 2 compatibility
