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
    this._autoLocationCache = null;
    this._geocodingCache = null;
    this._lastDateString = null;
    this._isRemoved = false;

    // Setup container
    this._deskletContainer = new St.BoxLayout({ vertical: true });
    this._clockAndDateContainer = new St.BoxLayout();
    this._dateAndWeekdayContainer = new St.BoxLayout({ vertical: true, style_class: "clocket-date-and-weekday-container" });
    this._dateContainer = new St.BoxLayout();

    // Create time and date labels
    this._timeLabel = new St.Label({ style_class: "clocket-time-label" });
    this._dayLabel = new St.Label({ style_class: "clocket-day-label" });
    this._monthAndYearLabel = new St.Label({ style_class: "clocket-month-label" });
    this._weekLabel = new St.Label({ style_class: "clocket-weekday-label" });

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
    this._clockSettingsId = this.desktop_settings.connect("changed::clock-use-24h", () => this._updateClock());

    // Default settings used as fallback
    this.fontSize = 40;
    this.textColor = "rgb(255,255,255)";
    this.backgroundColor = "rgba(0, 0, 0, 0.363)";
    this.showWeatherData = true;
    this.webservice = "Open-Metro";
    this.weatherTextColor = "rgb(255,255,255)";
    this.weatherBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.apiKey = "";
    this.locationType = "automatic";
    this.location = "";
    this.temperatureUnit = "celsius";
    this.weatherRefreshInterval = 10;

    // Generate weekday shorthands based on an arbitrary week starting point (2023-01-01 is a Sunday)
    this.weekdaysShorthands = [];
    for (let i = 0; i < 7; i++) {
      const weekday = GLib.DateTime.new_local(2023, 1, 1 + i, 12, 0, 0);
      this.weekdaysShorthands.push(weekday.format("%a").toUpperCase());
    }

    // Initialize settings and bind them to the desklet properties
    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("font-size", "fontSize", this._updateClockStyle);
    settings.bind("text-color", "textColor", this._updateClockStyle);
    settings.bind("background-color", "backgroundColor", this._updateClockStyle);
    settings.bind("show-weather-data", "showWeatherData", this._onShowWeatherSettingChanged);
    settings.bind("webservice", "webservice", this._loadWeather);
    settings.bind("weather-text-color", "weatherTextColor", this._updateWeatherStyle);
    settings.bind("weather-background-color", "weatherBackgroundColor", this._updateWeatherStyle);
    settings.bind("api-key", "apiKey", this._loadWeather);
    settings.bind("location-type", "locationType", this._loadWeather);
    settings.bind("location", "location", this._onLocationChange);
    settings.bind("temperature-unit", "temperatureUnit", this._loadWeather);
    settings.bind("weather-refresh-interval", "weatherRefreshInterval", this._loadWeather);

    // Add action to desklet right-click menu
    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");

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

  _updateClockStyle() {
    this._timeLabel.style = "font-size: " + this.fontSize + "pt;\ncolor: " + this.textColor + ";\nbackground-color:" + this.backgroundColor;
    this._dayLabel.style = "font-size: " + (this.fontSize - 10) + "pt;";
    this._dateAndWeekdayContainer.style = "background-color:" + this.backgroundColor;
    this._monthAndYearLabel.style = "font-size: " + (this.fontSize - 20) + "pt;\ncolor: " + this.textColor;
    this._weekLabel.style = "font-size: " + (this.fontSize - 16) + "pt;\ncolor: " + this.textColor;
    this._updateClock();
  }

  on_desklet_added_to_desktop() {
    this._updateClockStyle();

    if (this.clock_notify_id == 0) {
      this.clock_notify_id = this.clock.connect("notify::clock", () => this._updateClock());
    }
  }

  // Clean up
  on_desklet_removed() {
    this._isRemoved = true;
    if (this.clock_notify_id > 0) {
      this.clock.disconnect(this.clock_notify_id);
      this.clock_notify_id = 0;
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

  _updateWeatherStyle() {
    if (this.showWeatherData) {
      this._weatherContainer.style = "background-color:" + this.weatherBackgroundColor;
      this._locationLabel.style = "color: " + this.weatherTextColor;
      this._currentTemperatureLabel.style = "color: " + this.weatherTextColor;
      this._currentDescriptionLabel.style = "color: " + this.weatherTextColor;
      this._forecastDay1Label.style = "color: " + this.weatherTextColor;
      this._forecastDay1TemperatureLabel.style = "color: " + this.weatherTextColor;
      this._forecastDay2Label.style = "color: " + this.weatherTextColor;
      this._forecastDay2TemperatureLabel.style = "color: " + this.weatherTextColor;
      this._forecastDay3Label.style = "color: " + this.weatherTextColor;
      this._forecastDay3TemperatureLabel.style = "color: " + this.weatherTextColor;
    }
  }

  _getIcon(path, size) {
    const icon_file = DESKLET_DIR + path;
    const file = Gio.file_new_for_path(icon_file);
    const icon_uri = file.get_uri();
    const icon = St.TextureCache.get_default().load_uri_async(icon_uri, 65, 65);
    icon.set_size(size, size);
    return icon;
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
    if (this._autoLocationCache) return this._autoLocationCache;
    const url = "https://ip-check-perf.radar.cloudflare.com/api/info";
    const data = await this._fetchJSON(url);
    if (data && typeof data === "object") {
      this._autoLocationCache = {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
      };
      return this._autoLocationCache;
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
    const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + iconName + "@2x.png", 45);
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
    const weatherIcon = this._getIcon("/icons/owm_icons/" + iconName + "@2x.png", 35);
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
      let weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[0][1] + "@2x.png", 35);
      this._forecastDay1Button.set_child(weatherIcon);
      this._forecastDay1TemperatureLabel.set_text(forecastData[0][2] + unitSymbol);

      this._forecastDay2Label.set_text(forecastData[1][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[1][1] + "@2x.png", 35);
      this._forecastDay2Button.set_child(weatherIcon);
      this._forecastDay2TemperatureLabel.set_text(forecastData[1][2] + unitSymbol);

      this._forecastDay3Label.set_text(forecastData[2][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[2][1] + "@2x.png", 35);
      this._forecastDay3Button.set_child(weatherIcon);
      this._forecastDay3TemperatureLabel.set_text(forecastData[2][2] + unitSymbol);
    }

    // Update current weather UI
    this._locationLabel.set_text(currentData[0]);
    const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + currentData[3] + "@2x.png", 45);
    this._currentWeatherButton.set_child(currentWeatherIcon);
    this._currentTemperatureLabel.set_text(currentData[1]);
    this._currentDescriptionLabel.set_text(currentData[2]);
  }

  // Initializes the weather section layout and loads the weather data
  _loadWeatherLayout() {
    this._weatherContainer = new St.BoxLayout({ vertical: false, style_class: "clocket-weather-container" });
    this._currentWeatherContainer = new St.BoxLayout({ vertical: true, style_class: "clocket-current-weather-container" });
    this._forecastWeatherContainer = new St.BoxLayout({ vertical: false, style_class: "clocket-forecast-weather-container" });

    // Current weather
    this._locationLabel = new St.Label({ style_class: "clocket-current-location-label" });
    this._currentWeatherButton = new St.Button();
    this._currentWeatherButton.connect("clicked", () => {
      this._loadWeather();
    });
    this._currentTemperatureLabel = new St.Label({ style_class: "clocket-current-temperature-label" });
    this._currentDescriptionLabel = new St.Label({ style_class: "clocket-current-description-label" });
    this._currentDescriptionLabel.clutter_text.line_wrap = true;
    this._currentDescriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    this._currentWeatherContainer.add(this._locationLabel);
    this._currentWeatherContainer.add(this._currentWeatherButton);
    this._currentWeatherContainer.add(this._currentTemperatureLabel);
    this._currentWeatherContainer.add(this._currentDescriptionLabel);

    // Forecast days
    for (let i = 1; i <= 3; i++) {
      const forecastDayContainer = new St.BoxLayout({ vertical: true, style_class: "clocket-forecast-day-container" });
      this["_forecastDay" + i + "Label"] = new St.Label({ style_class: "clocket-forecast-day-label" });
      this["_forecastDay" + i + "Button"] = new St.Button({ style: "margin-top:10px;margin-bottom:10px;" });
      this["_forecastDay" + i + "TemperatureLabel"] = new St.Label({ style_class: "clocket-forecast-day-label" });

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
  }

  // Helper function to set text of a label only if it's different from the current text
  _setText(label, text) {
    if (label.get_text() !== text) {
      label.set_text(text);
    }
  }

  _updateClock() {
    const use24h = this.desktop_settings.get_boolean("clock-use-24h");
    const timeFormat = use24h ? "%H:%M" : "%I:%M";
    this._setText(this._timeLabel, this.clock.get_clock_for_format(timeFormat));

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
