changelog

## [1.0.0] 11.10.2025

- Initial release

## [1.1.0] 17.02.2026

- New features:
  - Added custom steam installation setting
  - Added desklet scaling setting based on system font size
  - Added decoration toggle to settings (no decorations on default)
  - Added settings to hide game start and shop button
  - Added font size settings
  - Added desklet width setting
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
  - Reload button size fixed
