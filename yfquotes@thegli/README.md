# Cinnamon Desklet for Yahoo Finance quotes

## Description
This repository contains a [desklet for the Cinnamon desktop environment](https://cinnamon-spices.linuxmint.com/desklets) that displays stock quote information provided by [Yahoo! Finance](https://finance.yahoo.com/).

![Screenshot](screenshot.png)

This desklet is based on the [desklet from fthuin](https://cinnamon-spices.linuxmint.com/desklets/view/23). The data retrieval part is adopted to an alternative service url, after the Yahoo Finance community table got retired in May 2017.

Tested with Linux Mint 18.3 / Cinnamon 3.6.

## Installation
Download the folder **yfquotes@thegli** and copy it to *~/.local/share/cinnamon/desklets/*.
Check out the desklet configuration settings, and choose the refresh period, the quote details to display, and the list of quotes to show. The default list contains the Dow 30 companies.

## Release Notes

### 0.0.1 - May 3, 2018

Features:
* setting to show/hide the currency code

Bugfix:
* change data retrieval to alternative url from Yahoo Finance
 
Known Limitations:
* quotes list cannot be edited in the desklet's configuration dialog. As a workaround, export the configuration using the standard desklet settings menu to a (json) file, then edit the file with your favorite text editor, and finally import the configuration file again.
 
## Credits
Based on the desklet source code from [fthuin](https://github.com/fthuin/yahoofinance-cinnamon-desklet).

## License
GNU General Public License v3.0
