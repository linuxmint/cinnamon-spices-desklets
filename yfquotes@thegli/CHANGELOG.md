### 0.16.1 - July 3, 2025

Features:

- update default User-Agent header to latest Firefox ESR release
- update Dutch translation (courtesy of [qadzek](https://github.com/qadzek))
- update Hungarian translation (courtesy of [bossbob88](https://github.com/bossbob88))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

Bugfixes:

- apply individual quote style independent of capitalization of the symbol

### 0.16.0 - May 11, 2025

Features:

- integrate external program *curl* (needed to deal with recent Yahoo Finance changes) - see new *Network* section in settings

Bugfixes:

- adapt to recent changes in Yahoo Finance Quotes API (**requires curl to work**)

### 0.15.7 - May 8, 2025

Bugfixes:

- fix unlimited retries when authorization step failed, stops now after 5 attempts

### 0.15.6 - April 3, 2025

Features:

- add symbols for most currencies
- update Finnish translation (courtesy of [MahtiAnkka](https://github.com/MahtiAnkka))

Bugfixes:

- fix currency symbol for INR

### 0.15.5 - March 18, 2025

Features:

- improve display of error details
- replace Mainloop with GLib for timer functionality

Bugfixes:

- fix "TypeError: responseResult is null"

### 0.15.4 - February 10, 2025

Bugfixes:

- fix infinite loop on empty quotes list

### 0.15.3 - January 8, 2025

Features:

- update Catalan translation (courtesy of [trikaphundo](https://github.com/trikaphundo))
- update Dutch translation (courtesy of [qadzek](https://github.com/qadzek))
- update Hungarian translation (courtesy of [bossbob88](https://github.com/bossbob88))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

Bugfixes:

- restore absent quote details

### 0.15.2 - November 20, 2024

Features:

- update Hungarian translation (courtesy of [bossbob88](https://github.com/bossbob88))
- update Finnish translation (courtesy of [MahtiAnkka](https://github.com/MahtiAnkka))

Bugfixes:

- correct documentation for automatic refresh after import
- detect and replace expired authorization parameters
- update DOW 30 component symbols

### 0.15.1 - September 12, 2024

Features:

- update Catalan translation (courtesy of [Odyssey](https://github.com/odyssey))
- update Dutch translation (courtesy of [qadzek](https://github.com/qadzek))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

Bugfixes:

- cache quotes responses for each desklet instance separately
- restore automatic quotes data refresh on settings import

### 0.15.0 - September 2, 2024

Features:

- new setting to customize the radius of the desklet's corners
- new setting to customize the thickness and color of the desklet border

### 0.14.1 - August 25, 2024

Features:

- setting changes no longer trigger data refresh cycles, resulting in faster layout rendering and reduced network traffic
- update Catalan translation (courtesy of [Odyssey](https://github.com/odyssey))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

Bugfixes:

- prevent spawning multiple data fetching tasks at the same time
- prevent creation of more than one data refresh timer
- fix error "TypeError: symbolCustomization is undefined"
- honor custom names in sorting

### 0.14.0 - August 21, 2024

Features:

- style each quote individually - see README section [Individual Quote Design](README.md#individual-quote-design) for details
- add Catalan translation (courtesy of [Odyssey](https://github.com/odyssey))
- update Dutch translation (courtesy of [qadzek](https://github.com/qadzek))
- update Hungarian translation (courtesy of [bossbob88](https://github.com/bossbob88))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

Bugfixes:

- quotes list sorting is now case-insensitive
- changes in quotes list are not instantly applied anymore (preventing potential network congestion, and desktop instabilities)

### 0.13.0 - July 10, 2024

Features:

- new setting to customize the background color
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))
- update Hungarian translation (courtesy of [bossbob88](https://github.com/bossbob88))

Bugfixes:

- display better error message if quotes list is empty
- improve description for manual update feature

### 0.12.0 - May 22, 2024

Features:

- new setting to manually update data by clicking on the "last update" timestamp label
- add Dutch translation (courtesy of [qadzek](https://github.com/qadzek))
- update Spanish translation (courtesy of [haggen88](https://github.com/haggen88))

### 0.11.0 - March 15, 2024

Features:

- new setting to customize font color and font size
- new setting to customize date and time format (see [date man page](https://man7.org/linux/man-pages/man1/date.1.html) for options)
- new setting to control vertical scrollbar

### 0.10.0 - March 4, 2024

Features:

- add Spanish translation (courtesy of [haggen88](https://github.com/haggen88))
- add Finnish translation (courtesy of [MahtiAnkka](https://github.com/MahtiAnkka))
- update Hungarian translation (courtesy of [KAMI911](https://github.com/KAMI911))
- update Danish translation (courtesy of [Alan01](https://github.com/Alan01))
- update Italian translation (courtesy of [Dragone2](https://github.com/Dragone2))
- brush up this README document
- implement an optional *debug log* mode for tracing and analysis of unexpected problem situations

Bugfixes:

- handle HTTP response status codes not supported by libsoup3
- update DOW 30 component symbols

### 0.9.0 - August 28, 2023

Features:

- support cookie consent process for EU region
- setting for User-Agent header is now active by default
- include status details in error message
- add Romanian translation (courtesy of [AndreiMiculita](https://github.com/AndreiMiculita))

Bugfixes:

- remove obsolete setting to select Yahoo Finance Quotes API version, because V6 got disabled
- general code refactoring, and logging improvements

### 0.8.7 - July 19, 2023

Features:

- add setting to include a User-Agent header in Yahoo Finance Quotes API requests
- update Hungarian translation (courtesy of [KAMI911](https://github.com/KAMI911))

### 0.8.6 - June 5, 2023

Bugfixes:

- fix libsoup3-specific code

### 0.8.5 - May 25, 2023

Bugfixes:

- adapt to recent changes in Yahoo Finance Quotes API

### 0.8.4 - May 8, 2023

Features:

- new setting to select the version of Yahoo Finance Quotes API
- update Danish translation (courtesy of [Alan01](https://github.com/Alan01))
- update Hungarian translation (courtesy of [KAMI911](https://github.com/KAMI911))
- update Italian translation (courtesy of [Dragone2](https://github.com/Dragone2))

### 0.8.3 - September 15, 2022

Bugfixes:

- add support for libsoup3 (courtesy of [fredcw](https://github.com/fredcw))

### 0.8.2 - June 8, 2022

Bugfixes:

- check timer reference before calling Mainloop.source_remove()

### 0.8.1 - May 16, 2022

Features:

- update Brazilian and German translations
- fetch finance data asynchronously to improve responsiveness

Bugfixes:

- do not color percentage change value when corresponding setting is not selected
- increase default desklet width
- update screenshot image
- fix syntax errors in README.md

### 0.8.0 - January 12, 2022

Features:

- add Russian translation (courtesy of [sulonetskyy](https://github.com/sulonetskyy))

### 0.7.0 - January 10, 2022

Features (courtesy of [sulonetskyy](https://github.com/sulonetskyy)):

- add symbolic trend change icons instead of .svg
- add configurable trend change colors instead of hardcoded colors
- add configurable strict rounding
- add UAH and RUB currency symbols
- change table items view (text align to the left, numbers/dates align to the right)

### 0.6.0 - June 18, 2021

Features:

- change layout of settings dialog to tabbed views
- new setting to use alternative colors (use blue instead of green)
- add Hungarian translation (courtesy of [KAMI911](https://github.com/KAMI911))

### 0.5.2 - February 7, 2021

Features:

- add Italian translation (courtesy of [Dragone2](https://github.com/Dragone2))
- add Korean translation (courtesy of [chaeya](https://github.com/chaeya))
- optimize png files (courtesy of [NikoKrause](https://github.com/NikoKrause))

Bugfixes:

- correct a msgid in translation files

### 0.5.1 - December 20, 2020

Features:

- incorporate Danish translation (courtesy of [Alan01](https://github.com/Alan01))

Bugfixes:

- update DOW 30 component symbols
- resolve various issues reported by Codacy

### 0.5.0 - October 4, 2020

Features:

- new setting to color percentage change according to trend. Enabled by default if percentage change is displayed. Courtesy of [plaihonen](https://github.com/plaihonen).
- new setting to add Yahoo Finance hyperlink to symbol/quote. Enabled by default if symbol is displayed. Proposed by [ngaro](https://github.com/ngaro).
- new setting to use long version for verbose quote name. Enabled by default if verbose name is displayed. Courtesy of [ngaro](https://github.com/ngaro).

### 0.4.2 - September 20, 2020

Bugfixes:

- update translation files with new setting
- extend desklet description for better searchability

### 0.4.1 - August 18, 2020

Features:

- add setting to disable quote name hyperlink

Bugfixes:

- remove invalid quote symbol from default list

### 0.4.0 - July 17, 2020

Features:

- allow multiple desklet instances
- add German translation

### 0.3.0 - June 29, 2020

Features:

- add setting to sort quotes list
- update DOW 30 component symbols

Bugfixes:

- auto-retry in case of connection problem (e.g. TLS handshake)

### 0.2.0 - May 23, 2018

Features:

- show absolute price change amount
- show last trade time/date
- show timestamp of latest data refresh
- add setting to configure rounding rule
- make background transparency configurable
- quote name links to Yahoo Finance details page
- display severe errors such as network failure

Bugfixes:

- improve error handling

### 0.1.0 - May 6, 2018

Features:

- minor description adjustments in configuration settings

Bugfixes:

- fix "value "nan" of type 'gfloat' is invalid or out of range for property" errors logged in *.xsession-errors*
- works (again) with Cinnamon 3.2

### 0.0.1 - May 4, 2018

Features:

- setting to show/hide the currency symbol

Bugfixes:

- change data retrieval to alternative url from Yahoo Finance
