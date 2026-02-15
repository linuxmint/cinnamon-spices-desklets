Changelog

## [no version number] 13.06.2021

- Initial release

## [no new version number] 03.07.2021

- auto update feature
- feedback display
- more customization
- removed all unnecessary embedded codes

## [2.1] 06.08.2021

- added weather forecast display

## [2.4] 20.01.2022

- fixed bugs pointed by users in comment section
- added compact view
- added unit converting methods
- updated Settings panel

## [no new version number] 03.09.2022

- added support for libsoup3

## [2.5] 16.04.2025

- fix for clock freeze issue

## [3.0.0] 12.02.2026

- added Open-Metro data service (no API key required)
- automatic location detection added and set as default
- show weather on default
- added setting to switch between celcius and fahrenheit
- added translation for desklet GUI
- uses the `clock-use-24h` Cinnamon setting
- usee the `clock-show-seconds`Cinnamon setting
- added line wrapping for weather description
- added weather refresh interval setting
- added desklet scale size setting based on system font size
- added async data fetching
- refactoring
  - dead code removed
    - unused variables
    - unused functions
    - unused settings
    - removed unused style classes
  - commented-out code removed
  - code formatted
  - prefer `const` over `let`
  - prefer `let` over `var`
  - more readable names for properties, variables, functions, etc.
  - removed tooltips without additional information
  - renamed settings
  - removed hardcoded weekday and month shorthands
  - updated desklet metadata and fix typo in description
  - removed hardcoded heights and widths in styles
  - renamed stylesheet class names
  - error handling and logging
  - added more code comments
- added changelog.md
  - previous changes and version numbers extracted from Git history
- retain weather style when toggling the `show-weather-data` setting
- caching of Open Metro geodata retrieved via city name
- fix stretched icons
- added loading text
- reorganize settings layout
- added hover effect and tooltips for reload buttons
- added new settings
  - date font size
  - date text color
  - date accent color
  - date background color
  - weather font size
  - weather forecast background color
  - clock border radius
  - date border radius
  - weather border radius
  - weather forecast border radius
  - hide decorations (set to true by default)
  - show clock setting
  - show date setting
  - clock custom time string
