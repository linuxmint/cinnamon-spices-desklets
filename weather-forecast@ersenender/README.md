# Weather

Current weather and a forecast for up to seven days for a place of your choice: temperature, feels-like temperature, wind with direction, humidity, sunrise and sunset, and per day the minimum, maximum and chance of rain.

- **Next 24 hours** as a small chart: temperature as a curve, chance of rain as bars.
- **Rain note**: from when or until when precipitation is expected ("Precipitation from 15:00", "Dry for 24 hours").
- **UV index** (maximum of the day) and **air quality** (European AQI, particulates in the tooltip).
- Units: °C, km/h, mm or °F, mph, inch.
- The tooltips add gusts, precipitation amount and the details of each day.

The data comes from [Open-Meteo](https://open-meteo.com/) - free, without an API key or account. The place is chosen with a search dialog (right-click -> *Search place*), which uses Open-Meteo's geocoding service. Air quality is a second request to Open-Meteo and can be switched off. Until you choose a place, nothing is requested.

Requires `python3` with GTK 3 bindings (`python3-gi`), preinstalled on Linux Mint.

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/weather-forecast@ersenender/po/weather-forecast@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/weather-forecast@ersenender/COPYING`.
