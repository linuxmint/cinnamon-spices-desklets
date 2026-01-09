
## [1.1.1] - 8.11.2025

### Changed

- Improved font parsing
- Slightly increased task paddings and margins in `stylesheet.css`
- Adjusted some default theme options to improve default visuals (IMO)
- Updated `README.md`

### Deleted

- Font bold/italic options, because they are no longer needed

## [1.1] - 13.10.2025

### Added

- New toolbar function - Edit task name, which supports alternate input methods like ibus/fcitx
- Mark as important/not important functionality + toolbar button
- Added new border styling options
- New settings to accommodate important/not important functionality
- `edit_dialog_gtk.py` - Python script opening a Gtk dialog for editing task names 
- `edit_dialog_gtk.ui` - Gtk dialog XML config
- Invisible padding without desklet decorations to make it easier to grab
- Options to disable/enable tooltips
- Added some visual indication when hovering over mark done/not done icons
- New options to disable/enable delete confirmation dialogs

### Changed

- Font size and icon sizes are now scaled by the system text scaling factor
- Changed default settings, changed some setting names/descriptions
- Now task names support multi line names + added text wrap
- `todo@NotSirius-A.pot` - updated translation table
- Minor changes to setting names/tooltips
- Update `README.MD`
- Minor improvements to `stylesheet.css`

### Fixed

- Incorrect width scaling width different display scales


## [1.0] - 26.06.2025

Initial release
