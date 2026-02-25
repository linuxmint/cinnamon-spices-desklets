# Changelog

## [1.0.0] 09.12.2025

- Initial Release

## [2.0.0] 25.02.026

- New features:
  - Added skeleton grid for setup and error UI
- Fixes
  - Fixed blocking on grid rendering
- Refactoring:
  - Added `deskletManager` as Fallback for `require` imports
  - Changed Desklet entry point to `on_desklet_removed`
  - Added settings cleanup on Desklet removal
  - Added `CHANGELOG.md`
  - Removed unused styles in `stylesheet,css`
  - UI logic extracted into UI Helper
  - Added Soup 2 compatibility
