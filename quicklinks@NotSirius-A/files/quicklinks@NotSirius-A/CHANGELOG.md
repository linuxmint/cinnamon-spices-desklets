# Changelog

## [1.3] - 09.11.2025

### Added
- PopupMenuItem: "Add new link", which opens a gtk dialog, when confirmed it adds a new link
- file `open_add_edit_dialog_gtk.py`

### Changed
- Improved font parsing
- Changed desklet name from "Quick Links" to "Quick Links - Launcher" to make it clearer what this desklet does
- Changed desklet description: added the word "launcher" 
- Updated `quicklinks@NotSirius-A.pot`
- Some default visual settings
- Improved border rendering
- Minor setting changes
- Changed "icon-name" setting from string to icon. Why did no one tell me there's an icon data type inside lists!!
- Updated `README.md`

### Removed

- Bold/italic options, because they are no longer needed

## [1.2] - 14.10.2025

### Added

- Added new border styling + settings
- Added new spacing styling + settings
- Option to disable tooltips
- Invisible padding without desklet decorations to make it easier to grab

### Changed

- Some default settings
- Some setting names/positions
- Decreased link padding slightly in `stylesheet.css`

### Fixed

- Incorrect width scaling width different display scales


## [1.1] - 16.06.2025

### Added

- `CHANGELOG.md`
- New option to active links on double-click not just single-click and a new settings tab for its options

### Changed

- Incremented version in `metadata.json`
- Overhauled Settings regarding desklet decorations
- Updated translation template `quicklinks@NotSirius-A.pot`
- Updated `README.md`
- Desklet icon was changed, now it shouldn't look like its linked to SQL databases.

### Fixed

- Some missing docstrings
- Some inconsistent variable naming


## [1.0] - 13.06.2025

Initial release
