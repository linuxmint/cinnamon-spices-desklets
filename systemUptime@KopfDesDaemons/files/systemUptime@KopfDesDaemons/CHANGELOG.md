# Changelog

## [1.0.0] - 26.11.2024

- Initial release

## [1.0.1] - 31.07.2025

- Update starttime in mainloop
- Updated screenshot

## [1.1.0] - 06.02.2026

- New features:
  - Scale desklet with system font size
  - Use the "Use 24H clock" cinnamon setting
  - Use local date and time format
  - Updated screenshot
- Refactoring:
  - Use St.Icon for the clock icon
  - Use file_get_contents() to get starttime and uptime
  - Added more comments
  - Updated icon initialization
  - Added settings cleanup
  - Changed desklet entry point to `on_desklet_added_to_desktop`
  - Renamed settings names
