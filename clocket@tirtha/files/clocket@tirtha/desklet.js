const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Pango = imports.gi.Pango;
const Tooltips = imports.ui.tooltips;

// Initialize HTTP session for API requests
let _httpSession;
if (Soup.MAJOR_VERSION == 2) {
  _httpSession = new Soup.SessionAsync();
} else {
  //version 3
  _httpSession = new Soup.Session();
}

// Setup for translations
const UUID = "clocket@tirtha";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

// Helper function for translations
function _(str) {
  return Gettext.dgettext(UUID, str);
}

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

class CinnamonClockDesklet extends Desklet.Desklet {
  constructor(metadata, desklet_id) {
    super(metadata, desklet_id);
    this.setHeader(_("Clock"));

    // Caching data for performance optimization
    this._geocodingCache = null;
    this._lastDateString = null;
    this._isRemoved = false;

    // Setup container
    this._deskletContainer = new St.BoxLayout({ vertical: true });
    this._clockAndDateContainer = new St.BoxLayout();
    this._dateAndWeekdayContainer = new St.BoxLayout({ vertical: true });
    this._dateContainer = new St.BoxLayout();
    this._forecastDay1Container = null;
    this._forecastDay2Container = null;
    this._forecastDay3Container = null;

    // Create time and date labels
    this._timeLabel = new St.Label();
    this._dayLabel = new St.Label();
    this._monthAndYearLabel = new St.Label();
    this._weekLabel = new St.Label();

    // Add labels to containers
    this._clockAndDateContainer.add(this._timeLabel);
    this._dateContainer.add(this._dayLabel);
    this._dateContainer.add(this._monthAndYearLabel);
    this._dateAndWeekdayContainer.add(this._dateContainer);
    this._dateAndWeekdayContainer.add(this._weekLabel);
    this._clockAndDateContainer.add(this._dateAndWeekdayContainer);
    this._deskletContainer.add(this._clockAndDateContainer);

    this.setContent(this._deskletContainer);

    // Initialize clock for updating time and date
    this.clock = new CinnamonDesktop.WallClock();
    this.clock_notify_id = 0;

    // Timeouts that are added to the main loop and are called after a certain time period
    this.locationChangeTimeout = null;
    this.weatherRefreshTimeout = null;

    // Initialize and connect settings to automatically update the desklet when cinnamon settings change
    this.desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockUse24hId = this.desktop_settings.connect("changed::clock-use-24h", () => this._updateClock());
    this._clockShowSecondsId = this.desktop_settings.connect("changed::clock-show-seconds", () => this._updateClock());

    // Default settings used as fallback
    this.scaleSize = 1;
    this.hideDecorations = true;
    this.showClock = true;
    this.showDate = true;
    this.showWeatherData = true;
    this.temperatureUnit = "celsius";
    this.webservice = "Open-Metro";
    this.apiKey = "";
    this.locationType = "automatic";
    this.location = "";
    this.weatherRefreshInterval = 5;
    this.clockFontSize = 40;
    this.clockTextColor = "rgb(255,255,255)";
    this.clockBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.clockBorderRadius = 20;
    this.dateTextSize = 40;
    this.dateTextColor = "rgb(255,255,255)";
    this.dateAccentColor = "red";
    this.dateBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.dateBorderRadius = 20;
    this.weatherFontSize = 14;
    this.weatherTextColor = "rgb(255,255,255)";
    this.weatherBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.weatherForecastBackgroundColor = "rgba(0, 0, 0, 0.4)";
    this.weatherBorderRadius = 20;
    this.weatherForecastBorderRadius = 15;

    // Generate weekday shorthands based on an arbitrary week starting point (2023-01-01 is a Sunday)
    this.weekdaysShorthands = [];
    for (let i = 0; i < 7; i++) {
      const weekday = GLib.DateTime.new_local(2023, 1, 1 + i, 12, 0, 0);
      this.weekdaysShorthands.push(weekday.format("%a").toUpperCase());
    }

    // Icon sizes
    this.forecastWeatherIconSize = 60;
    this.currentWeatherIconSize = 50;

    // Initialize settings and bind them to the desklet properties
    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("scale-size", "scaleSize", this._onScaleSizeChange);
    settings.bind("hide-decorations", "hideDecorations", this._onDecorationChanged);
    settings.bind("show-clock", "showClock", this._onShowClockSettingChanged);
    settings.bind("show-date", "showDate", this._onShowDateSettingChanged);
    settings.bind("show-weather-data", "showWeatherData", this._onShowWeatherSettingChanged);
    settings.bind("temperature-unit", "temperatureUnit", this._loadWeather);
    settings.bind("webservice", "webservice", this._loadWeather);
    settings.bind("api-key", "apiKey", this._loadWeather);
    settings.bind("location-type", "locationType", this._loadWeather);
    settings.bind("location", "location", this._onLocationChange);
    settings.bind("weather-refresh-interval", "weatherRefreshInterval", this._loadWeather);
    settings.bind("clock-font-size", "clockFontSize", this._updateClockStyle);
    settings.bind("clock-text-color", "clockTextColor", this._updateClockStyle);
    settings.bind("clock-background-color", "clockBackgroundColor", this._updateClockStyle);
    settings.bind("clock-border-radius", "clockBorderRadius", this._updateClockStyle);
    settings.bind("date-font-size", "dateTextSize", this._updateDateStyle);
    settings.bind("date-text-color", "dateTextColor", this._updateDateStyle);
    settings.bind("date-accent-color", "dateAccentColor", this._updateDateStyle);
    settings.bind("date-background-color", "dateBackgroundColor", this._updateDateStyle);
    settings.bind("date-border-radius", "dateBorderRadius", this._updateDateStyle);
    settings.bind("weather-font-size", "weatherFontSize", this._updateWeatherStyle);
    settings.bind("weather-text-color", "weatherTextColor", this._updateWeatherStyle);
    settings.bind("weather-background-color", "weatherBackgroundColor", this._updateWeatherStyle);
    settings.bind("weather-forecast-background-color", "weatherForecastBackgroundColor", this._updateWeatherStyle);
    settings.bind("weather-border-radius", "weatherBorderRadius", this._updateWeatherStyle);
    settings.bind("weather-forecast-border-radius", "weatherForecastBorderRadius", this._updateWeatherStyle);

    // Add action to desklet right-click menu
    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");
  }

  on_desklet_added_to_desktop() {
    this._updateClockStyle();
    this._onDecorationChanged();
    this._onShowClockSettingChanged();
    this._onShowDateSettingChanged();
    this._updateDateStyle();
    this._updateClock();
    this._updateDate();
    if (this.showWeatherData) {
      this._loadWeatherLayout();
    }
  }

  // Weather data is loaded with a delay when changing location to avoid multiple requests while typing
  _onLocationChange() {
    this._geocodingCache = null;
    if (this.locationChangeTimeout) {
      Mainloop.source_remove(this.locationChangeTimeout);
    }
    this.locationChangeTimeout = Mainloop.timeout_add(1500, () => {
      this.locationChangeTimeout = null;
      this._loadWeather();
      return false;
    });
  }

  // Clean up
  on_desklet_removed() {
    this._isRemoved = true;
    if (this.clock_notify_id > 0) {
      this.clock.disconnect(this.clock_notify_id);
      this.clock_notify_id = 0;
    }
    if (this._clockUse24hId) {
      this.desktop_settings.disconnect(this._clockUse24hId);
      this._clockUse24hId = 0;
    }
    if (this._clockShowSecondsId) {
      this.desktop_settings.disconnect(this._clockShowSecondsId);
      this._clockShowSecondsId = 0;
    }
    if (this.locationChangeTimeout) {
      Mainloop.source_remove(this.locationChangeTimeout);
      this.locationChangeTimeout = null;
    }
    if (this.weatherRefreshTimeout) {
      Mainloop.source_remove(this.weatherRefreshTimeout);
      this.weatherRefreshTimeout = null;
    }
  }

  _updateClockStyle() {
    const fontSize = size => (size * this.scaleSize) / 10 + "em";
    const s = this.scaleSize;

    this._timeLabel.style =
      "font-size: " +
      fontSize(this.clockFontSize) +
      "; color: " +
      this.clockTextColor +
      "; background-color:" +
      this.clockBackgroundColor +
      `; padding: ${10 * s}px; border-radius: ${this.clockBorderRadius * s}px; vertical-align: center;`;
  }

  _updateDateStyle() {
    const fontSize = size => (size * this.scaleSize) / 10 + "em";
    const s = this.scaleSize;
    this._dayLabel.style = "font-size: " + fontSize(this.dateTextSize - 10) + "; color: " + this.dateAccentColor + ";";
    this._dateAndWeekdayContainer.style =
      "background-color:" +
      this.dateBackgroundColor +
      `; padding: ${1 * s}em; border-radius: ${this.dateBorderRadius * s}px; margin-left: ${0.3 * s}em;`;
    this._clockAndDateContainer.style = `margin-bottom: ${0.3 * s}em;`;
    this._monthAndYearLabel.style = "font-size: " + fontSize(this.dateTextSize - 20) + ";\ncolor: " + this.dateTextColor;
    this._weekLabel.style = "font-size: " + fontSize(this.dateTextSize - 16) + ";\ncolor: " + this.dateTextColor;
  }

  _updateWeatherStyle() {
    if (this.showWeatherData) {
      const fontSize = size => `${(size * this.scaleSize) / 10}em`;

      // Define styles
      const currentWeather = `color: ${this.weatherTextColor};`;
      const forecastStyle = `${currentWeather}font-size: ${fontSize(this.weatherFontSize)};`;
      const forecastDayContainerStyle = `background-color:${this.weatherForecastBackgroundColor}; padding:${0.5 * this.scaleSize}em ${0.3 * this.scaleSize}em; margin: 0${0.2 * this.scaleSize}em; border-radius: ${this.scaleSize * this.weatherForecastBorderRadius}px;`;

      // Set weather container styles
      this._weatherContainer.style = `background-color:${this.weatherBackgroundColor}; padding:${0.65 * this.scaleSize}em; border-radius:${this.weatherBorderRadius * this.scaleSize}px; margin-top:${0.2 * this.scaleSize}em; margin-bottom:${0.2 * this.scaleSize}em;`;
      this._currentWeatherContainer.style = `padding:${1 * this.scaleSize}em;`;

      // Set current weather label styles
      this._locationLabel.style = `${currentWeather}font-size: ${fontSize(this.weatherFontSize + 2)};`;
      this._currentTemperatureLabel.style = `${currentWeather}font-size: ${fontSize(this.weatherFontSize + 4)}; text-align: center; margin-bottom:${0.1 * this.scaleSize}em;`;
      this._currentDescriptionLabel.style = `${currentWeather}font-size: ${fontSize(this.weatherFontSize)};`;

      // Set forecast label styles
      this._forecastDay1Label.style = forecastStyle;
      this._forecastDay1TemperatureLabel.style = forecastStyle;
      this._forecastDay2Label.style = forecastStyle;
      this._forecastDay2TemperatureLabel.style = forecastStyle;
      this._forecastDay3Label.style = forecastStyle;
      this._forecastDay3TemperatureLabel.style = forecastStyle;
      this._forecastDay1Container.style = forecastDayContainerStyle;
      this._forecastDay2Container.style = forecastDayContainerStyle;
      this._forecastDay3Container.style = forecastDayContainerStyle;
    }
  }

  _onScaleSizeChange() {
    this._updateClockStyle();
    this._updateDateStyle();
    if (this.showWeatherData) {
      this._updateWeatherStyle();
      // Resize icons
      const iconSize = Math.round(this.forecastWeatherIconSize * this.scaleSize);
      const currentWeatherIconSize = Math.round(this.currentWeatherIconSize * this.scaleSize);
      if (this._currentWeatherButton.get_child()) this._currentWeatherButton.get_child().set_icon_size(currentWeatherIconSize);
      for (let i = 1; i <= 3; i++) {
        if (this["_forecastDay" + i + "Button"].get_child()) this["_forecastDay" + i + "Button"].get_child().set_icon_size(iconSize);
      }
    }
  }

  _onDecorationChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _getIcon(path, size) {
    const icon_file = DESKLET_DIR + path;
    const scaledSize = Math.round(size * this.scaleSize);
    return new St.Icon({ gicon: Gio.icon_new_for_string(icon_file), icon_size: scaledSize });
  }

  _onShowWeatherSettingChanged() {
    if (this.showWeatherData) {
      this._loadWeatherLayout();
    } else {
      if (this.weatherRefreshTimeout) {
        Mainloop.source_remove(this.weatherRefreshTimeout);
        this.weatherRefreshTimeout = null;
      }
      this._weatherContainer.destroy();
    }
  }

  _updateSignalConnection() {
    if (this.showClock || this.showDate) {
      if (this.clock_notify_id == 0) {
        this.clock_notify_id = this.clock.connect("notify::clock", () => {
          this._updateClock();
          this._updateDate();
        });
      }
    } else if (this.clock_notify_id > 0) {
      this.clock.disconnect(this.clock_notify_id);
      this.clock_notify_id = 0;
    }
  }

  _onShowClockSettingChanged() {
    if (this.showClock) {
      this._updateClock();
      this._timeLabel.show();
    } else {
      this._timeLabel.hide();
    }
    this._updateSignalConnection();
  }

  _onShowDateSettingChanged() {
    if (this.showDate) {
      this._updateDate();
      this._dateAndWeekdayContainer.show();
    } else {
      this._dateAndWeekdayContainer.hide();
    }
    this._updateSignalConnection();
  }

  _fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new("GET", url);
      if (!message) {
        resolve("Invalid URL");
        return;
      }

      if (Soup.MAJOR_VERSION === 2) {
        _httpSession.queue_message(message, (session, msg) => {
          if (msg.status_code !== Soup.KnownStatusCode.OK) {
            const body = msg.response_body.data ? msg.response_body.data.toString() : "";
            resolve(`HTTP ${msg.status_code} ${msg.reason_phrase} BODY: ${body}`);
            return;
          }
          try {
            const body = msg.response_body.data.toString();
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(`Error fetching ${url}: ${e}`);
          }
        });
      } else {
        _httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
          try {
            const bytes = _httpSession.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
              const body = bytes ? ByteArray.toString(bytes.get_data()) : "";
              resolve(`HTTP ${message.get_status()} ${message.reason_phrase} BODY: ${body}`);
              return;
            }
            const body = ByteArray.toString(bytes.get_data());
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(`Error fetching ${url}: ${e}`);
          }
        });
      }
    });
  }

  // Fetches automatic location data based on the user's IP address and caches the result
  async _fetchAutoLocation() {
    const url = "https://ip-check-perf.radar.cloudflare.com/api/info";
    const data = await this._fetchJSON(url);
    if (data && typeof data === "object") {
      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
      };
    }
    let errorMsg = typeof data === "string" ? data : "Invalid data";
    global.logError(`${UUID}: Failed to fetch automatic location. Error: ${errorMsg}`);
    return null;
  }

  // Splits the location string into latitude and longitude
  _parseCoordinates(location) {
    const separators = [",", "-", ":"];
    for (const sep of separators) {
      const parts = String(location).split(sep);
      if (parts.length === 2) {
        return {
          lat: parts[0].trim(),
          lon: parts[1].trim(),
        };
      }
    }
    return null;
  }

  // Loads the weather data from the selected webservice and sets a timeout for automatic refresh
  _loadWeather() {
    if (this.weatherRefreshTimeout) {
      Mainloop.source_remove(this.weatherRefreshTimeout);
      this.weatherRefreshTimeout = null;
    }
    if (this.webservice == "Open Metro") {
      this._loadWeatherOpenMetro();
    } else if (this.webservice == "openweathermap") {
      this._loadWeatherOpenWeatherMap();
    }

    if (this.weatherRefreshInterval > 0) {
      this.weatherRefreshTimeout = Mainloop.timeout_add_seconds(this.weatherRefreshInterval * 60, () => {
        this._loadWeather();
        return false;
      });
    }
  }

  // Set error text for all weather labels
  _setWeatherError() {
    this._locationLabel.set_text(_("Error"));
    this._currentTemperatureLabel.set_text(_("Error"));
    this._currentDescriptionLabel.set_text(_("Error"));
    this._forecastDay1Label.set_text(_("Error"));
    this._forecastDay1TemperatureLabel.set_text(_("Error"));
    this._forecastDay2Label.set_text(_("Error"));
    this._forecastDay2TemperatureLabel.set_text(_("Error"));
    this._forecastDay3Label.set_text(_("Error"));
    this._forecastDay3TemperatureLabel.set_text(_("Error"));
  }

  // Loads weather data from www.open-meteo.com and updates the weather section
  async _loadWeatherOpenMetro() {
    if (this._isRemoved) return;
    let lat = "";
    let lon = "";
    let locationName = this.location;

    if (this.locationType === "automatic") {
      // Use latitude and longitude from auto-location service
      const location = await this._fetchAutoLocation();
      if (location) {
        lat = location.lat;
        lon = location.lon;
        locationName = location.city;
      }
    } else if (this.locationType === "lat-lon") {
      // Use latitude and longitude desklet settings
      const coords = this._parseCoordinates(this.location);
      if (coords) {
        lat = coords.lat;
        lon = coords.lon;
      } else {
        this._locationLabel.set_text("Invalid Loc");
        global.logError(`${UUID}: Invalid lat-lon format: ${this.location}`);
        this._setWeatherError();
        return;
      }
    } else {
      // Use cache for city geodata when available
      if (this._geocodingCache && this._geocodingCache.query === this.location) {
        lat = this._geocodingCache.lat;
        lon = this._geocodingCache.lon;
        locationName = this._geocodingCache.name;
      } else {
        // Request latitude and longitude for the specified city name
        const geoUrl =
          "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(this.location) + "&count=1&language=en&format=json";
        const geoData = await this._fetchJSON(geoUrl);
        if (this._isRemoved) return;
        if (geoData && geoData.results && geoData.results.length > 0) {
          lat = geoData.results[0].latitude;
          lon = geoData.results[0].longitude;
          locationName = geoData.results[0].name + ", " + geoData.results[0].country_code.toUpperCase();
          this._geocodingCache = { query: this.location, lat: lat, lon: lon, name: locationName };
        } else {
          let errorMsg = typeof geoData === "string" ? geoData : "No results found";
          global.logError(`${UUID}: Failed to fetch location for city: ${errorMsg}`);
          this._setWeatherError();
          return;
        }
      }
    }

    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      lat +
      "&longitude=" +
      lon +
      "&current=temperature_2m,is_day,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto" +
      "&temperature_unit=" +
      this.temperatureUnit;

    const weatherData = await this._fetchJSON(weatherUrl);
    if (this._isRemoved) return;

    if (!weatherData || typeof weatherData !== "object" || !weatherData.current || !weatherData.daily) {
      let errorMsg = typeof weatherData === "string" ? weatherData : "Invalid data structure";
      global.logError(`${UUID}: Failed to fetch weather data. Error: ${errorMsg}`);
      this._setWeatherError();
      return;
    }

    // Update current weather
    this._locationLabel.set_text(locationName);
    const currentCode = weatherData.current.weather_code;
    const isDay = weatherData.current.is_day;
    const currentTemp = weatherData.current.temperature_2m;
    const iconName = this._getOWMIconName(currentCode, isDay);
    const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + iconName + "@2x.png", this.currentWeatherIconSize);
    const unitSymbol = this.temperatureUnit === "fahrenheit" ? "℉" : "℃";
    this._currentWeatherButton.set_child(currentWeatherIcon);
    this._currentTemperatureLabel.set_text(currentTemp + unitSymbol);
    this._currentDescriptionLabel.set_text(this._getWeatherDescription(currentCode));

    // Update Forecast
    const daily = weatherData.daily;
    const dayIndex = new Date().getDay();

    // Day 1
    if (daily.time.length > 1) {
      this._updateForecastDay(1, daily, dayIndex + 1, this.weekdaysShorthands, unitSymbol);
    }
    // Day 2
    if (daily.time.length > 2) {
      this._updateForecastDay(2, daily, dayIndex + 2, this.weekdaysShorthands, unitSymbol);
    }
    // Day 3
    if (daily.time.length > 3) {
      this._updateForecastDay(3, daily, dayIndex + 3, this.weekdaysShorthands, unitSymbol);
    }
  }

  _updateForecastDay(uiIndex, dailyData, weekDayIndex, weekDays, unitSymbol) {
    const dataIndex = uiIndex;
    const tempMax = Math.round(dailyData.temperature_2m_max[dataIndex]);
    const code = dailyData.weather_code[dataIndex];
    const iconName = this._getOWMIconName(code, 1);

    const dayName = weekDays[weekDayIndex % 7];

    this["_forecastDay" + uiIndex + "Label"].set_text(dayName);
    const weatherIcon = this._getIcon("/icons/owm_icons/" + iconName + "@2x.png", this.forecastWeatherIconSize);
    this["_forecastDay" + uiIndex + "Button"].set_child(weatherIcon);
    this["_forecastDay" + uiIndex + "TemperatureLabel"].set_text(tempMax + unitSymbol);
  }

  _getOWMIconName(wmoCode, isDay) {
    const suffix = isDay ? "d" : "n";
    const map = {
      0: "01",
      1: "01",
      2: "02",
      3: "03",
      45: "50",
      48: "50",
      51: "09",
      53: "09",
      55: "09",
      56: "13",
      57: "13",
      61: "10",
      63: "10",
      65: "10",
      66: "13",
      67: "13",
      71: "13",
      73: "13",
      75: "13",
      77: "13",
      80: "09",
      81: "09",
      82: "09",
      85: "13",
      86: "13",
      95: "11",
      96: "11",
      99: "11",
    };
    return (map[wmoCode] || "01") + suffix;
  }

  _getWeatherDescription(code) {
    const codes = {
      0: _("Clear sky"),
      1: _("Mainly clear"),
      2: _("Partly cloudy"),
      3: _("Overcast"),
      45: _("Fog"),
      48: _("Depositing rime fog"),
      51: _("Light drizzle"),
      53: _("Moderate drizzle"),
      55: _("Dense drizzle"),
      56: _("Light freezing drizzle"),
      57: _("Dense freezing drizzle"),
      61: _("Slight rain"),
      63: _("Moderate rain"),
      65: _("Heavy rain"),
      66: _("Light freezing rain"),
      67: _("Heavy freezing rain"),
      71: _("Slight snow fall"),
      73: _("Moderate snow fall"),
      75: _("Heavy snow fall"),
      77: _("Snow grains"),
      80: _("Slight rain showers"),
      81: _("Moderate rain showers"),
      82: _("Violent rain showers"),
      85: _("Slight snow showers"),
      86: _("Heavy snow showers"),
      95: _("Thunderstorm"),
      96: _("Thunderstorm with slight hail"),
      99: _("Thunderstorm with heavy hail"),
    };
    return codes[code] || _("Unknown description");
  }

  // Loads weather data from www.openweathermap.org and updates the weather section
  async _loadWeatherOpenWeatherMap() {
    if (this._isRemoved) return;
    const weatherBaseURL = "http://api.openweathermap.org/data/2.5/weather?";
    const forecastBaseURL = "http://api.openweathermap.org/data/2.5/forecast?";
    const unitSymbol = this.temperatureUnit === "fahrenheit" ? "℉" : "℃";
    const unit = this.temperatureUnit === "fahrenheit" ? "imperial" : "metric";

    let locationString = "";
    if (this.locationType == "city") {
      locationString = "q=" + this.location;
    } else if (this.locationType == "lat-lon") {
      const coords = this._parseCoordinates(this.location);
      if (coords) {
        locationString = "lat=" + coords.lat + "&lon=" + coords.lon;
      } else {
        global.logError(`${UUID}: Invalid lat-lon format: ${this.location}`);
        this._setWeatherError();
        return;
      }
    } else if (this.locationType == "automatic") {
      const loc = await this._fetchAutoLocation();
      if (this._isRemoved) return;
      if (loc) {
        locationString = "lat=" + loc.lat + "&lon=" + loc.lon;
      }
    }
    const weatherURL = weatherBaseURL + locationString + "&appid=" + this.apiKey + "&units=" + unit;
    const forecastURL = forecastBaseURL + locationString + "&appid=" + this.apiKey + "&units=" + unit;

    const [currentDataRaw, forecastDataRaw] = await Promise.all([this._fetchJSON(weatherURL), this._fetchJSON(forecastURL)]);

    if (this._isRemoved) return;

    let currentData = null;
    if (currentDataRaw && typeof currentDataRaw === "object") {
      try {
        const loc = currentDataRaw.name + ", " + currentDataRaw.sys.country;
        const ovarall = currentDataRaw.weather[0].description;
        const temp = currentDataRaw.main.temp + " " + unitSymbol;
        const icon = currentDataRaw.weather[0].icon;
        currentData = [loc, temp, ovarall, icon];
      } catch (e) {
        global.logError(`${UUID}: Error parsing OpenWeatherMap current data: ${e}`);
        this._setWeatherError();
        return;
      }
    } else {
      let errorMsg = typeof currentDataRaw === "string" ? currentDataRaw : "Invalid data structure";
      global.logError(`${UUID}: Failed to fetch current weather data. Error: ${errorMsg}`);
      this._setWeatherError();
      return;
    }

    let forecastData = [];
    if (!forecastDataRaw || typeof forecastDataRaw !== "object") {
      let errorMsg = typeof forecastDataRaw === "string" ? forecastDataRaw : "Invalid data structure";
      global.logError(`${UUID}: Failed to fetch forecast data. Error: ${errorMsg}`);
      this._setWeatherError();
      return;
    } else {
      try {
        let forecastDay = new Date().getDay() + 1;

        // 3 hour based data list, 3h x 8 = 24h (1 day),
        // 3 days x 8 = 24 total entries needed for 3 day forecast
        for (let i = 7; i < 24; i += 8) {
          if (forecastDataRaw.list && forecastDataRaw.list[i]) {
            const forecastDaysData = forecastDataRaw.list[i];
            const temp = Math.round(forecastDaysData["main"]["temp"]);
            const icon = forecastDaysData["weather"][0]["icon"];
            forecastDay = forecastDay % 7;
            const weekday = this.weekdaysShorthands[forecastDay];
            forecastDay++;
            forecastData.push([weekday, icon, temp]);
          }
        }
      } catch (e) {
        global.logError(`${UUID}: Error parsing OpenWeatherMap forecast data: ${e}`);
        this._setWeatherError();
        return;
      }
    }

    // Update forecast UI
    if (forecastData.length >= 3) {
      this._forecastDay1Label.set_text(forecastData[0][0]);
      let weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[0][1] + "@2x.png", this.forecastWeatherIconSize);
      this._forecastDay1Button.set_child(weatherIcon);
      this._forecastDay1TemperatureLabel.set_text(forecastData[0][2] + unitSymbol);

      this._forecastDay2Label.set_text(forecastData[1][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[1][1] + "@2x.png", this.forecastWeatherIconSize);
      this._forecastDay2Button.set_child(weatherIcon);
      this._forecastDay2TemperatureLabel.set_text(forecastData[1][2] + unitSymbol);

      this._forecastDay3Label.set_text(forecastData[2][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[2][1] + "@2x.png", this.forecastWeatherIconSize);
      this._forecastDay3Button.set_child(weatherIcon);
      this._forecastDay3TemperatureLabel.set_text(forecastData[2][2] + unitSymbol);
    }

    // Update current weather UI
    this._locationLabel.set_text(currentData[0]);
    const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + currentData[3] + "@2x.png", this.currentWeatherIconSize);
    this._currentWeatherButton.set_child(currentWeatherIcon);
    this._currentTemperatureLabel.set_text(currentData[1]);
    this._currentDescriptionLabel.set_text(currentData[2]);
  }

  // Initializes the weather section layout and loads the weather data
  _loadWeatherLayout() {
    if (this._weatherContainer) {
      this._weatherContainer.destroy();
    }
    this._weatherContainer = new St.BoxLayout();
    this._currentWeatherContainer = new St.BoxLayout({ vertical: true });
    this._forecastWeatherContainer = new St.BoxLayout();

    // Current weather
    this._locationLabel = new St.Label({ style_class: "clocket-current-location-label" });
    this._locationLabel.set_text(_("Loading..."));
    this._currentWeatherButton = new St.Button({ style_class: "clocket-reload-weather-button" });
    this._currentWeatherButton.connect("clicked", () => {
      this._loadWeather();
    });
    new Tooltips.Tooltip(this._currentWeatherButton, _("Reload weather data"));
    this._currentTemperatureLabel = new St.Label();
    this._currentTemperatureLabel.set_text(_("Loading..."));
    this._currentDescriptionLabel = new St.Label({ style_class: "clocket-current-description-label" });
    this._currentDescriptionLabel.clutter_text.line_wrap = true;
    this._currentDescriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    this._currentDescriptionLabel.set_text(_("Loading..."));

    this._currentWeatherContainer.add(this._locationLabel);
    this._currentWeatherContainer.add(this._currentWeatherButton);
    this._currentWeatherContainer.add(this._currentTemperatureLabel);
    this._currentWeatherContainer.add(this._currentDescriptionLabel);

    // Forecast days
    for (let i = 1; i <= 3; i++) {
      let forecastDayContainer = new St.BoxLayout({ vertical: true });
      this["_forecastDay" + i + "Container"] = forecastDayContainer;
      this["_forecastDay" + i + "Label"] = new St.Label({ style_class: "clocket-forecast-day-label" });
      this["_forecastDay" + i + "Button"] = new St.Button({
        style_class: "clocket-reload-weather-button",
        style: "margin-top:10px;margin-bottom:10px;",
      });
      this["_forecastDay" + i + "Button"].connect("clicked", () => {
        this._loadWeather();
      });
      new Tooltips.Tooltip(this["_forecastDay" + i + "Button"], _("Reload weather data"));
      this["_forecastDay" + i + "TemperatureLabel"] = new St.Label({ style_class: "clocket-forecast-day-label" });
      this["_forecastDay" + i + "Label"].set_text("    ...    ");
      this["_forecastDay" + i + "TemperatureLabel"].set_text("    ...    ");

      forecastDayContainer.add(this["_forecastDay" + i + "Label"]);
      forecastDayContainer.add(this["_forecastDay" + i + "Button"]);
      forecastDayContainer.add(this["_forecastDay" + i + "TemperatureLabel"]);
      this._forecastWeatherContainer.add(forecastDayContainer);
    }

    this._weatherContainer.add(this._currentWeatherContainer);
    this._weatherContainer.add(this._forecastWeatherContainer);
    this._deskletContainer.add(this._weatherContainer);

    this._updateWeatherStyle();
    this._loadWeather();

    // Reload after a delay after starting, as the first request may fail if the network is not yet ready
    if (this.weatherRefreshTimeout) {
      Mainloop.source_remove(this.weatherRefreshTimeout);
    }
    this.weatherRefreshTimeout = Mainloop.timeout_add_seconds(this.weatherRefreshInterval * 3, () => {
      this._loadWeather();
      return false;
    });
  }

  // Helper function to set text of a label only if it's different from the current text
  _setText(label, text) {
    if (label.get_text() !== text) {
      label.set_text(text);
    }
  }

  _updateClock() {
    if (!this.showClock) return;

    const use24h = this.desktop_settings.get_boolean("clock-use-24h");
    const showSeconds = this.desktop_settings.get_boolean("clock-show-seconds");
    const timeFormat = (use24h ? "%H:%M" : "%I:%M") + (showSeconds ? ":%S" : "");

    this._setText(this._timeLabel, this.clock.get_clock_for_format(timeFormat));
  }

  _updateDate() {
    if (!this.showDate) return;

    const dateString = this.clock.get_clock_for_format("%d");
    if (this._lastDateString !== dateString) {
      this._lastDateString = dateString;
      this._setText(this._dayLabel, dateString);

      const month = this.clock.get_clock_for_format("%b").toLowerCase();
      const year = this.clock.get_clock_for_format("%Y");
      this._setText(this._monthAndYearLabel, "  " + month + ", " + year);

      const weekday = this.clock.get_clock_for_format("%A").toUpperCase();
      this._setText(this._weekLabel, "   " + weekday);
    }
  }
}

function main(metadata, desklet_id) {
  return new CinnamonClockDesklet(metadata, desklet_id);
}
