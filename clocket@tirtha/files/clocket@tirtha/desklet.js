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

let _httpSession;
if (Soup.MAJOR_VERSION == 2) {
  _httpSession = new Soup.SessionAsync();
} else {
  //version 3
  _httpSession = new Soup.Session();
}

const UUID = "clocket@tirtha";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

class CinnamonClockDesklet extends Desklet.Desklet {
  constructor(metadata, desklet_id) {
    super(metadata, desklet_id);
    this._container = new St.BoxLayout({ vertical: true });
    this._clockContainer = new St.BoxLayout();
    this._dateContainer = new St.BoxLayout({ vertical: true, style_class: "clocket-clock-container" });
    this._dayContainer = new St.BoxLayout();

    this._timeLabel = new St.Label({ style_class: "clocket-clock-container" });
    this._dateLabel = new St.Label({ style_class: "clocket-day-label" });
    this._monthLabel = new St.Label({ style_class: "clocket-month-label" });
    this._weekLabel = new St.Label({ style_class: "clocket-weekday-label" });

    this._clockContainer.add(this._timeLabel);
    this._dayContainer.add(this._dateLabel);
    this._dayContainer.add(this._monthLabel);
    this._dateContainer.add(this._dayContainer);
    this._dateContainer.add(this._weekLabel);
    this._clockContainer.add(this._dateContainer);
    this._container.add(this._clockContainer);

    this.setContent(this._container);
    this.setHeader(_("Clock"));
    this.clock = new CinnamonDesktop.WallClock();
    this.clock_notify_id = 0;

    this.locationChangeDelay = null;
    this.desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockSettingsId = this.desktop_settings.connect("changed::clock-use-24h", () => this._updateClock());

    // default settings
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

    // Generate weekday shorthands based on an arbitrary week starting point (2023-01-01 is a Sunday)
    this.weekdaysShorthands = [];
    for (let i = 0; i < 7; i++) {
      const weekday = GLib.DateTime.new_local(2023, 1, 1 + i, 12, 0, 0);
      this.weekdaysShorthands.push(weekday.format("%a").toUpperCase());
    }

    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("font-size", "fontSize", this._onSettingsChanged);
    settings.bind("text-color", "textColor", this._onSettingsChanged);
    settings.bind("background-color", "backgroundColor", this._onSettingsChanged);
    settings.bind("show-weather-data", "showWeatherData", this._onShowWeatherChange);
    settings.bind("webservice", "webservice", this._updateWeather);
    settings.bind("weather-text-color", "weatherTextColor", this._updateWeatherStyle);
    settings.bind("weather-background-color", "weatherBackgroundColor", this._onSettingsChanged);
    settings.bind("api-key", "apiKey", this._updateWeather);
    settings.bind("location-type", "locationType", this._updateWeather);
    settings.bind("location", "location", this._onLocationChange);
    settings.bind("temperature-unit", "temperatureUnit", this._updateWeather);

    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");

    if (this.showWeatherData) {
      this._loadWeatherLayout();
    }
  }

  _updateWeather() {
    this._loadWeather();
  }

  _onLocationChange() {
    if (this.locationChangeDelay) {
      Mainloop.source_remove(this.locationChangeDelay);
    }
    this.locationChangeDelay = Mainloop.timeout_add(1500, () => {
      this.locationChangeDelay = null;
      this._loadWeather();
      return false;
    });
  }

  _onSettingsChanged() {
    this._timeLabel.style = "font-size: " + this.fontSize + "pt;\ncolor: " + this.textColor + ";\nbackground-color:" + this.backgroundColor;
    this._dateLabel.style = "font-size: " + (this.fontSize - 10) + "pt;";
    this._dateContainer.style = "background-color:" + this.backgroundColor;
    this._monthLabel.style = "font-size: " + (this.fontSize - 20) + "pt;\ncolor: " + this.textColor;
    this._weekLabel.style = "font-size: " + (this.fontSize - 16) + "pt;\ncolor: " + this.textColor;
    if (this.showWeatherData) {
      this._weatherContainer.style = "background-color:" + this.weatherBackgroundColor;
    }

    this._updateClock();
  }

  on_desklet_added_to_desktop() {
    this._onSettingsChanged();

    if (this.clock_notify_id == 0) {
      this.clock_notify_id = this.clock.connect("notify::clock", () => this._updateClock());
    }
  }

  on_desklet_removed() {
    if (this.clock_notify_id > 0) {
      this.clock.disconnect(this.clock_notify_id);
      this.clock_notify_id = 0;
    }
    if (this.locationChangeDelay) {
      Mainloop.source_remove(this.locationChangeDelay);
      this.locationChangeDelay = null;
    }
  }

  _updateWeatherStyle() {
    if (this.showWeatherData) {
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

  _onShowWeatherChange() {
    if (this.showWeatherData) {
      this._loadWeatherLayout();
    } else {
      this._weatherContainer.destroy();
    }
  }

  _getJSON(url) {
    let jsonData = "EMPTY";
    const message = Soup.Message.new("GET", url);

    if (Soup.MAJOR_VERSION === 2) {
      _httpSession.send_message(message);
      if (message.status_code === Soup.KnownStatusCode.OK) {
        jsonData = JSON.parse(message.response_body.data.toString());
        return jsonData;
      } else if (message.status_code === 401) {
        return "401";
      } else if (message.status_code === 404) {
        return "404";
      } else {
        return "unreachable";
      }
    } else {
      //version 3
      const bytes = _httpSession.send_and_read(message, null);
      if (message.get_status() === Soup.Status.OK) {
        jsonData = JSON.parse(ByteArray.toString(bytes.get_data()));
        return jsonData;
      } else if (message.get_status() === 401) {
        return "401";
      } else if (message.get_status() === 404) {
        return "404";
      } else {
        return "unreachable";
      }
    }
  }

  _fetchAutoLocation() {
    const url = "https://ip-check-perf.radar.cloudflare.com/api/info";
    const data = this._getJSON(url);
    if (data && data !== "401" && data !== "404" && data !== "unreachable") {
      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
      };
    }
    return null;
  }

  _getLocation() {
    if (this.locationType == "city") {
      return "q=" + this.location;
    } else if (this.locationType == "lat-lon") {
      const cor = String(this.location).split("-");
      return "lat=" + cor[0] + "&lon=" + cor[1];
    } else if (this.locationType == "automatic") {
      const loc = this._fetchAutoLocation();
      if (loc) {
        return "lat=" + loc.lat + "&lon=" + loc.lon;
      }
      return "q=kolkata";
    } else {
      return "q=kolkata";
    }
  }

  _loadWeather() {
    if (this.webservice == "Open Metro") {
      this._loadWeatherOpenMetro();
    } else if (this.webservice == "openweathermap") {
      this._loadWeatherOpenWeatherMap();
    }
  }

  _loadWeatherOpenMetro() {
    let lat = "";
    let lon = "";
    let locationName = this.location;
    const unitSymbol = this.temperatureUnit === "fahrenheit" ? "℉" : "℃";

    if (this.locationType === "automatic") {
      const location = this._fetchAutoLocation();
      if (location) {
        lat = location.lat;
        lon = location.lon;
        locationName = location.city;
      }
    } else if (this.locationType === "lat-lon") {
      const cor = String(this.location).split("-");
      if (cor.length === 2) {
        lat = cor[0].trim();
        lon = cor[1].trim();
      }
    } else {
      // Geocoding
      const geoUrl =
        "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(this.location) + "&count=1&language=en&format=json";
      const geoData = this._getJSON(geoUrl);
      if (geoData && geoData.results && geoData.results.length > 0) {
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
        locationName = geoData.results[0].name + ", " + geoData.results[0].country_code.toUpperCase();
      } else {
        this._locationLabel.set_text("Loc not found");
        return;
      }
    }

    if (!lat || !lon) {
      this._locationLabel.set_text("Invalid Loc");
      return;
    }

    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      lat +
      "&longitude=" +
      lon +
      "&current=temperature_2m,is_day,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto" +
      "&temperature_unit=" +
      this.temperatureUnit;

    let weatherData = this._getJSON(weatherUrl);

    if (weatherData === "401" || weatherData === "404" || weatherData === "unreachable" || !weatherData.current || !weatherData.daily) {
      this._locationLabel.set_text("Weather Error");
      return;
    }

    // Update Current Weather
    this._locationLabel.set_text(locationName);
    const currentCode = weatherData.current.weather_code;
    const isDay = weatherData.current.is_day;
    const currentTemp = weatherData.current.temperature_2m;

    const iconName = this._getOWMIconName(currentCode, isDay);
    const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + iconName + "@2x.png", 45);
    this._currentWeatherButton.set_child(currentWeatherIcon);
    this._currentTemperatureLabel.set_text(currentTemp + unitSymbol);
    this._currentDescriptionLabel.set_text(this._getWeatherDescription(currentCode));

    // Update Forecast
    const daily = weatherData.daily;
    const today = new Date();
    const dayIndex = today.getDay();

    // Day 1 (Tomorrow)
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
    return codes[code] || "Unknown";
  }

  _loadWeatherOpenWeatherMap() {
    const weatherBaseURL = "http://api.openweathermap.org/data/2.5/weather?";
    const unitSymbol = this.temperatureUnit === "fahrenheit" ? "℉" : "℃";
    const unit = this.temperatureUnit === "fahrenheit" ? "imperial" : "metric";

    const weatherURL = weatherBaseURL + this._getLocation() + "&appid=" + this.apiKey + "&units=" + unit;
    let currentData = this._getJSON(weatherURL);
    if (currentData == "401") {
      currentData = 401;
    } else if (currentData == "unreachable") {
      currentData = "unreachable";
    } else if (currentData == "404") {
      currentData = 404;
    } else {
      const loc = currentData.name + ", " + currentData.sys.country;
      const ovarall = currentData.weather[0].description;
      const temp = currentData.main.temp + " " + unitSymbol;
      const icon = currentData.weather[0].icon;
      currentData = [loc, temp, ovarall, icon];
    }

    const forecastBaseURL = "http://api.openweathermap.org/data/2.5/forecast?";
    const forecastURL = forecastBaseURL + this._getLocation() + "&appid=" + this.apiKey + "&units=" + unit;
    const json = this._getJSON(forecastURL);
    let forecastData = [];
    if (json == "401") {
      forecastData = 404;
    } else if (json == "unreachable") {
      forecastData = "unreachable";
    } else if (json == "404") {
      forecastData = 404;
    } else {
      let forecastDay = Date.now().getDay() + 1;

      for (let i = 7; i < 24; i += 8) {
        const forecastDaysData = json.list[i];
        const temp = Math.round(forecastDaysData["main"]["temp"]);
        const icon = forecastDaysData["weather"][0]["icon"];
        forecastDay = forecastDay % 7;
        const weekday = this.weekdaysShorthands[forecastDay];
        forecastDay++;
        forecastData.push([weekday, icon, temp]);
      }
    }

    if (forecastData == 401 || forecastData == 404 || forecastData == "unreachable" || !forecastData || forecastData.length === 0) {
      this._forecastDay1Label.set_text("no data");
      this._forecastDay2Label.set_text("no data");
      this._forecastDay3Label.set_text("no data");
    } else {
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

    if (currentData == 401 || currentData == 404 || currentData == "unreachable") {
      this._locationLabel.set_text("no data");
    } else {
      this._locationLabel.set_text(currentData[0]);
      const currentWeatherIcon = this._getIcon("/icons/owm_icons/" + currentData[3] + "@2x.png", 45);
      this._currentWeatherButton.set_child(currentWeatherIcon);
      this._currentTemperatureLabel.set_text(currentData[1]);
      this._currentDescriptionLabel.set_text(currentData[2]);
    }
  }

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
    this._container.add(this._weatherContainer);

    this._updateWeatherStyle();
    this._loadWeather();
  }

  _updateClock() {
    const use24h = this.desktop_settings.get_boolean("clock-use-24h");
    const timeFormat = use24h ? "%H:%M" : "%I:%M";
    this._timeLabel.set_text(this.clock.get_clock_for_format(timeFormat));

    this._dateLabel.set_text(this.clock.get_clock_for_format("%d"));

    const month = this.clock.get_clock_for_format("%b").toLowerCase();
    const year = this.clock.get_clock_for_format("%Y");
    this._monthLabel.set_text("  " + month + ", " + year);

    const weekday = this.clock.get_clock_for_format("%A").toUpperCase();
    this._weekLabel.set_text("   " + weekday);
  }
}

function main(metadata, desklet_id) {
  return new CinnamonClockDesklet(metadata, desklet_id);
}
