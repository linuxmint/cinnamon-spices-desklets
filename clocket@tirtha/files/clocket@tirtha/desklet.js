const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;

let _httpSession;
if (Soup.MAJOR_VERSION == 2) {
  _httpSession = new Soup.SessionAsync();
} else {
  //version 3
  _httpSession = new Soup.Session();
}

const UUID = "devtest-clocket@tirtha";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

class CinnamonClockDesklet extends Desklet.Desklet {
  constructor(metadata, desklet_id) {
    super(metadata, desklet_id);
    this._container = new St.BoxLayout({ vertical: true });
    this._clockContainer = new St.BoxLayout();
    this._dateContainer = new St.BoxLayout({ vertical: true, style_class: "clock_container_style" });
    this._dayContainer = new St.BoxLayout();

    this._timeLabel = new St.Label({ style_class: "clock_container_style" });
    this._dateLabel = new St.Label({ style_class: "date_label_style" });
    this._monthLabel = new St.Label({ style_class: "month_label_style" });
    this._weekLabel = new St.Label({ style_class: "weekday_label_style" });

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

    this.unit = "metric";

    // default settings
    this.fontSize = 40;
    this.textColor = "rgb(255,255,255)";
    this.backgroundColor = "rgba(0, 0, 0, 0.363)";
    this.showWeatherData = true;
    this.webservice = "openweathermap";
    this.weatherTextColor = "rgb(255,255,255)";
    this.weatherBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.apiKey = "";
    this.locationType = "city";
    this.location = "kolkata";

    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("font-size", "fontSize", this._onSettingsChanged);
    settings.bind("text-color", "textColor", this._onSettingsChanged);
    settings.bind("background-color", "backgroundColor", this._onSettingsChanged);
    settings.bind("show-weather-data", "showWeatherData", this._onShowWeatherChange);
    settings.bind("webservice", "webservice", this._updateWeather);
    settings.bind("weather-text-color", "weatherTextColor", this._updateWeatherStyle);
    settings.bind("weather-background-color", "weatherBackgroundColor", this._onSettingsChanged);
    settings.bind("api-key", "apiKey");
    settings.bind("location-type", "locationType");
    settings.bind("location", "location");

    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");

    if (this.showWeatherData) {
      this._loadWeatherLayout();
    }
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
  }

  _updateWeatherStyle() {
    if (this.showWeatherData) {
      this._locationLabel.style = "color: " + this.weatherTextColor;
      this._currentTemperature.style = "color: " + this.weatherTextColor;
      this._currentDescription.style = "color: " + this.weatherTextColor;
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

  _getLocation() {
    if (this.locationType == "city") {
      return "q=" + this.location;
    } else if (this.locationType == "lat-lon") {
      const cor = String(this.location).split("-");
      return "lat=" + cor[0] + "&lon=" + cor[1];
    } else {
      return "q=kolkata";
    }
  }

  _loadWeather() {
    if (this.webservice == "bbc") {
      this._loadWeatherBBC();
    } else if (this.webservice == "openweathermap") {
      this._loadWeatherOpenWeatherMap();
    }
  }

  _loadWeatherBBC() {}

  _loadWeatherOpenWeatherMap() {
    const weatherBaseURL = "http://api.openweathermap.org/data/2.5/weather?";

    const weatherURL = weatherBaseURL + this._getLocation() + "&appid=" + this.apiKey + "&units=" + this.unit;
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
      const temp = currentData.main.temp + " ℃";
      const icon = currentData.weather[0].icon;
      currentData = [loc, temp, ovarall, icon];
    }

    const forecastBaseURL = "http://api.openweathermap.org/data/2.5/forecast?";

    const forecastURL = forecastBaseURL + "q=katwa" + "&appid=" + this.apiKey + "&units=" + this.unit;
    const json = this._getJSON(forecastURL);
    let forecastData = [];
    if (json == "401") {
      forecastData = 404;
    } else if (json == "unreachable") {
      forecastData = "unreachable";
    } else if (json == "404") {
      forecastData = 404;
    } else {
      const today = new Date();
      let d = today.getDay() + 1;
      const newdata = json;
      const weekdaysShorthands = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const forcustdata = newdata.list;

      let day = "";

      for (var i = 7; i < 24; i += 8) {
        day = forcustdata[i];
        const temp = day["main"]["temp"];
        const icon = day["weather"][0]["icon"];
        d = d % 7;
        const weekday = weekdaysShorthands[d];
        d++;
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
      this._forecastDay1TemperatureLabel.set_text(forecastData[0][2] + "℃");

      this._forecastDay2Label.set_text(forecastData[1][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[1][1] + "@2x.png", 35);
      this._forecastDay2Button.set_child(weatherIcon);
      this._forecastDay2TemperatureLabel.set_text(forecastData[1][2] + "℃");

      this._forecastDay3Label.set_text(forecastData[2][0]);
      weatherIcon = this._getIcon("/icons/owm_icons/" + forecastData[2][1] + "@2x.png", 35);
      this._forecastDay3Button.set_child(weatherIcon);
      this._forecastDay3TemperatureLabel.set_text(forecastData[2][2] + "℃");
    }

    if (currentData == 401 || currentData == 404 || currentData == "unreachable") {
      this._locationLabel.set_text("no data");
    } else {
      this._locationLabel.set_text(currentData[0]);
      let comicon = this._getIcon("/icons/owm_icons/" + currentData[3] + "@2x.png", 45);
      this._currentWeatherButton.set_child(comicon);
      this._currentTemperature.set_text(currentData[1]);
      this._currentDescription.set_text(currentData[2]);
    }
  }

  _updateWeather() {
    if (this.apiKey !== "" && this.location !== "") {
      this._loadWeather();
    }
  }

  _loadWeatherLayout() {
    this._weatherContainer = new St.BoxLayout({ vertical: false, style_class: "compact_container_style" });
    this._currentWeatherContainer = new St.BoxLayout({ vertical: true, style_class: "compact_cur_container_style" });
    this._forecastWeatherContainer = new St.BoxLayout({ vertical: false, style_class: "compact_for_container_style" });

    // Current weather
    this._locationLabel = new St.Label({ style_class: "comloc_label_style" });
    this._locationLabel.set_text(this.location);
    const currentWeatherIcon = this._getIcon("/icons/icon.png", 45);
    this._currentWeatherButton = new St.Button();
    this._currentWeatherButton.set_child(currentWeatherIcon);
    this._currentWeatherButton.connect("clicked", () => {
      this._updateWeather();
    });
    this._currentTemperature = new St.Label({ style_class: "comtemp_label_style" });
    this._currentTemperature.set_text("30℃");
    this._currentDescription = new St.Label({ style_class: "comloc_label_style" });
    this._currentDescription.set_text("light rain");

    // Day 1 forecast
    this._forecastDay1Container = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._forecastDay1Label = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay1Label.set_text("MON");
    const forecastDay1Icon = this._getIcon("/icons/icon.png", 35);
    this._forecastDay1Button = new St.Button();
    this._forecastDay1Button.set_child(forecastDay1Icon);
    this._forecastDay1Button.style = "margin-top:10px;margin-bottom:10px;";
    this._forecastDay1TemperatureLabel = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay1TemperatureLabel.set_text("30℃");
    this._forecastDay1Container.add(this._forecastDay1Label);
    this._forecastDay1Container.add(this._forecastDay1Button);
    this._forecastDay1Container.add(this._forecastDay1TemperatureLabel);
    this._forecastWeatherContainer.add(this._forecastDay1Container);

    // Day 2 forecast
    this._forecastDay2Container = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._forecastDay2Label = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay2Label.set_text("MON");
    const forecastDay2Icon = this._getIcon("/icons/icon.png", 35);
    this._forecastDay2Button = new St.Button();
    this._forecastDay2Button.set_child(forecastDay2Icon);
    this._forecastDay2Button.style = "margin-top:10px;margin-bottom:10px;";
    this._forecastDay2TemperatureLabel = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay2TemperatureLabel.set_text("30℃");
    this._forecastDay2Container.add(this._forecastDay2Label);
    this._forecastDay2Container.add(this._forecastDay2Button);
    this._forecastDay2Container.add(this._forecastDay2TemperatureLabel);
    this._forecastWeatherContainer.add(this._forecastDay2Container);

    // Day 3 forecast
    this._forecastDay3Container = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._forecastDay3Label = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay3Label.set_text("MON");
    const forecastDay3Icon = this._getIcon("/icons/icon.png", 35);
    this._forecastDay3Button = new St.Button();
    this._forecastDay3Button.set_child(forecastDay3Icon);
    this._forecastDay3Button.style = "margin-top:10px;margin-bottom:10px;";
    this._forecastDay3TemperatureLabel = new St.Label({ style_class: "fday_label_style" });
    this._forecastDay3TemperatureLabel.set_text("30℃");
    this._forecastDay3Container.add(this._forecastDay3Label);
    this._forecastDay3Container.add(this._forecastDay3Button);
    this._forecastDay3Container.add(this._forecastDay3TemperatureLabel);
    this._forecastWeatherContainer.add(this._forecastDay3Container);

    this._currentWeatherContainer.add(this._locationLabel);
    this._currentWeatherContainer.add(this._currentWeatherButton);
    this._currentWeatherContainer.add(this._currentTemperature);
    this._currentWeatherContainer.add(this._currentDescription);
    this._weatherContainer.add(this._currentWeatherContainer);
    this._weatherContainer.add(this._forecastWeatherContainer);
    this._container.add(this._weatherContainer);

    this._updateWeather();
  }

  _updateClock() {
    const today = new Date();
    this._timeLabel.set_text(this.clock.get_clock_for_format("%0l:%0M"));
    const date = String(today.getDate()).padStart(2, "0");
    this._dateLabel.set_text(date);

    const month = today.getMonth();
    const monthShorthand = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    this._monthLabel.set_text("  " + monthShorthand[month] + ", " + today.getFullYear());

    const day = today.getDay();
    const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    this._weekLabel.set_text("   " + weekday[day]);
  }
}

function main(metadata, desklet_id) {
  return new CinnamonClockDesklet(metadata, desklet_id);
}
