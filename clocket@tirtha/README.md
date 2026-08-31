# clocket@tirtha

Clocket is a desklet built for the Cinnamon DE (based on GNOME 3).
It displays time, date, and current weather data.

I built this desklet because I just wanted a desklet of my own taste.

Other desklets are great, but I wanted a desklet having a clock and weather viewer combined.

## Installation

### Installation from desklet manager (Recommended)

1. Right-click on your desktop
2. Select `add desklet`
3. Go to "Download" tab and search `clocket`
4. Go to "Manage" tab and add the desklet to the desktop

### Manually installation

1. Download the desklet from [here](https://cinnamon-spices.linuxmint.com/files/desklets/clocket@tirtha.zip)
2. Extract the archive
3. Copy the `clocket@tirtha` folder into your `~/.local/share/cinnamon/desklets` folder
4. You can now add the desklet in the desklet manager.

## Setup weather service

By default, the location is determined based on the IP address and the weather data is loaded from [Open-Meteo](https://open-meteo.com).

### Open Weather

The weather service can be changed to [Open Weather](http://openweathermap.org). An API key is required for this.

### Latitude and longitude format

The string for a latitude and longitude can be generated, for example, at [gps-coordinates.net](https://www.gps-coordinates.net/).

Two string formats are supported. Separated by a comma or a colon:

- 40.741895,-73.989308
- 40.741895:-73.989308
