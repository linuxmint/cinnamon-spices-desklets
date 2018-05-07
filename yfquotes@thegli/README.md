# Cinnamon Desklet for Yahoo Finance quotes

## Description
This repository contains a [desklet for the Cinnamon desktop environment](https://cinnamon-spices.linuxmint.com/desklets) that displays stock quote information provided by [Yahoo! Finance](https://finance.yahoo.com/).

![Screenshot](screenshot.png)

This desklet is based on the [desklet from fthuin](https://cinnamon-spices.linuxmint.com/desklets/view/23). The data retrieval part is adopted to an alternative service url, after the Yahoo Finance community table got retired in May 2017.

Tested with Debian 9 (Cinnamon 3.2), Linux Mint 18.3 (Cinnamon 3.6), and Manjaro (Cinnamon 3.8).

## Installation
Download the folder **yfquotes@thegli** and copy it to *~/.local/share/cinnamon/desklets/*.
Check out the desklet configuration settings, and choose the refresh period, the quote details to display, and the list of quotes to show. The default list contains the Dow 30 companies.

## Release Notes

### current

Features:
* none so far...

Bugfix:
* fix "value "nan" of type 'gfloat' is invalid or out of range for property" errors logged in *.xsession-errors*
* works (again) with Cinnamon 3.2

### 0.1.0 - May 4, 2018

Features:
* setting to show/hide the currency code

Bugfix:
* change data retrieval to alternative url from Yahoo Finance
 
Known Limitations:
* quotes list cannot be edited in the desklet's configuration dialog with Cinnamon 3.6. As a workaround, export the configuration using the standard desklet settings menu to a (json) file, then edit the file with your favorite text editor, and finally import the configuration file again.
 
## Credits
Based on the desklet source code from [fthuin](https://github.com/fthuin/yahoofinance-cinnamon-desklet).

## License
GNU General Public License v3.0
