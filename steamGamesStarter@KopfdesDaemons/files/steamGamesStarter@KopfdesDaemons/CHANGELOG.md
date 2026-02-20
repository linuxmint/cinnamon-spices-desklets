changelog

## [1.0.0] 11.10.2025

- Initial release

## [2.0.0] 17.02.2026

- New features:
  - Added custom Steam installation setting
  - Added desklet scaling setting based on system font size
  - Added decoration toggle to settings (no decorations by default)
  - Added settings to hide game start and shop buttons
  - Added font size settings
  - Added desklet width setting
  - Added hide game header image setting
  - Added hide "last played" label setting
  - Added game header image scale setting
- Refactoring:
  - Added fallback to `deskletManager` for imports
  - Removed clutter
  - Moved icons to icons folder
  - Changed desklet entry point to on_desklet_added_to_desktop
  - Updated UI loading (games or error UI)
  - Added settings cleanup on desklet removal
  - Added UUID to logs
  - Organized settings in tabs
- Fixes:
  - Fixed reload button size
