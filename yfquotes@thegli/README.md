# Cinnamon Desklet for Yahoo Finance quotes

## Description
This repository contains a [desklet for the Cinnamon desktop environment](https://cinnamon-spices.linuxmint.com/desklets) that displays financial market information provided by [Yahoo Finance](https://finance.yahoo.com/).

![Screenshot](screenshot.png)

This desklet is based on the [desklet from fthuin](https://github.com/fthuin/yahoofinance-cinnamon-desklet). The data retrieval part is adopted to an alternative service url, after the Yahoo Finance community table got retired in May 2017.

Tested with

- Linux Mint Cinnamon 17 up to 20
- Debian 9 with Cinnamon 3.2
- Manjaro with Cinnamon 3.8


## Installation
Either follow the installation instructions on [Cinnamon spices](https://cinnamon-spices.linuxmint.com/desklets), or manually download the folder **yfquotes@thegli** (below "files") and copy the folder and its content to *~/.local/share/cinnamon/desklets/*.

## Configuration
Check out the desklet configuration settings, and choose the data refresh period, the list of quotes to show (see also [Known Limitations](#known-limitations)), and quote details to display. The default list contains the Dow 30 companies.

## Release Notes

### 0.5.0 - October 4, 2020
Features:
* new setting to color percentage change according to trend. Enabled by default if percentage change is displayed. Courtesy of [plaihonen](https://github.com/plaihonen).
* new setting to add Yahoo Finance hyperlink to symbol/quote. Enabled by default if symbol is displayed. Proposed by [ngaro](https://github.com/ngaro).
* new setting to use long version for verbose quote name. Enabled by default if verbose name is displayed. Courtesy of [ngaro](https://github.com/ngaro).

### 0.4.2 - September 20, 2020
Bugfixes:
* update translation files with new setting
* extend desklet description for better searchability

### 0.4.1 - August 18, 2020
Features:
* add setting to disable quote name hyperlink

Bugfixes:
* remove invalid quote symbol from default list

### 0.4.0 - July 17, 2020 
Features:
* allow multiple Desklet instances
* add German translation

### 0.3.0 - June 29, 2020
Features:
* add setting to sort quotes list
* update DOW 30 component symbols

Bugfixes:
* auto-retry in case of connection problem (e.g. TLS handshake)

### 0.2.0 - May 23, 2018
Features:
* show absolute price change amount
* show last trade time/date
* show timestamp of latest data refresh
* add setting to configure rounding rule
* make background transparency configurable
* quote name links to Yahoo Finance details page
* display severe errors such as network failure

Bugfixes:
* improve error handling

### 0.1.0 - May 6, 2018
Features:
* minor description adjustments in configuration settings

Bugfixes:
* fix "value "nan" of type 'gfloat' is invalid or out of range for property" errors logged in *.xsession-errors*
* works (again) with Cinnamon 3.2

### 0.0.1 - May 4, 2018
Features:
* setting to show/hide the currency symbol

Bugfixes:
* change data retrieval to alternative url from Yahoo Finance

## Known Limitations

* The quotes list might not be editable using the desklet's configuration dialog (encountered in Cinnamon 3.6 and earlier 3.x versions). As a workaround, export the configuration using the standard desklet settings menu to a (json) file, then edit the file with your favorite text editor, and finally import the configuration file again.

## Credits
Based on the desklet source code from [fthuin](https://github.com/fthuin/yahoofinance-cinnamon-desklet).

## License
GNU General Public License v3.0
