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
    this.webservice = "owm";
    this.weatherTextColor = "rgb(255,255,255)";
    this.weatherBackgroundColor = "rgba(0, 0, 0, 0.363)";
    this.apiKey = "";
    this.locationType = "city";
    this.location = "kolkata";

    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("font-size", "fontSize", this._onSettingsChanged);
    settings.bind("text-color", "textColor", this._onSettingsChanged);
    settings.bind("background-color", "backgroundColor", this._onSettingsChanged);
    settings.bind("show-weather-data", "showWeatherData", this._onCompactPermChange);
    settings.bind("webservice", "webservice", this._get_compact_update);
    settings.bind("weather-text-color", "weatherTextColor", this._onchange_weather_style);
    settings.bind("weather-background-color", "weatherBackgroundColor", this._onSettingsChanged);
    settings.bind("api-key", "apiKey");
    settings.bind("location-type", "locationType");
    settings.bind("location", "location");

    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");

    if (this.showWeatherData) {
      this._create_compact_label();
    }
  }

  _onSettingsChanged() {
    this._timeLabel.style = "font-size: " + this.fontSize + "pt;\ncolor: " + this.textColor + ";\nbackground-color:" + this.backgroundColor;
    this._dateLabel.style = "font-size: " + (this.fontSize - 10) + "pt;";
    this._dateContainer.style = "background-color:" + this.backgroundColor;
    this._monthLabel.style = "font-size: " + (this.fontSize - 20) + "pt;\ncolor: " + this.textColor;
    this._weekLabel.style = "font-size: " + (this.fontSize - 16) + "pt;\ncolor: " + this.textColor;
    if (this.showWeatherData) {
      this._compactContainer.style = "background-color:" + this.weatherBackgroundColor;
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
  _onchange_weather_style() {
    if (this.showWeatherData) {
      this.comloc.style = "color: " + this.weatherTextColor;
      this.comtemp.style = "color: " + this.weatherTextColor;
      this.comdes.style = "color: " + this.weatherTextColor;
      this._fcomhead.style = "color: " + this.weatherTextColor;
      this._fcomtemp.style = "color: " + this.weatherTextColor;
      this._scomhead.style = "color: " + this.weatherTextColor;
      this._scomtemp.style = "color: " + this.weatherTextColor;
      this._tcomhead.style = "color: " + this.weatherTextColor;
      this._tcomtemp.style = "color: " + this.weatherTextColor;
    }
  }
  _getIconImage(iconpath, dim) {
    const icon_file = DESKLET_DIR + iconpath;
    const file = Gio.file_new_for_path(icon_file);
    const icon_uri = file.get_uri();
    const iconimage = St.TextureCache.get_default().load_uri_async(icon_uri, 65, 65);
    iconimage.set_size(dim, dim);
    return iconimage;
  }

  _onCompactPermChange() {
    if (this.showWeatherData) {
      this._create_compact_label();
    } else {
      this._compactContainer.destroy();
    }
  }

  getJSON(url) {
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

  id() {
    if (this.locationType == "city") {
      return "q=" + this.location;
    } else if (this.locationType == "lat-lon") {
      const cor = String(this.location).split("-");
      return "lat=" + cor[0] + "&lon=" + cor[1];
    } else {
      return "q=kolkata";
    }
  }

  _get_data_service() {
    if (this.webservice == "bbc") {
      this._return_bbc_data();
    } else if (this.webservice == "owm") {
      return this._return_owm_data();
    }
  }

  _return_bbc_data() {}

  _return_owm_data() {
    let baseurl = "http://api.openweathermap.org/data/2.5/weather?";
    const weatherapi = this.apiKey;

    let url = baseurl + this.id() + "&appid=" + String(weatherapi) + "&units=" + this.unit;
    let curdata = this.getJSON(url);
    if (curdata == "401") {
      curdata = 401;
    } else if (curdata == "unreachable") {
      curdata = "unreachable";
    } else if (curdata == "404") {
      curdata = 404;
    } else {
      const loc = curdata.name + ", " + curdata.sys.country;
      const ovarall = curdata.weather[0].description;
      const temp = curdata.main.temp + " ℃";
      const icon = curdata.weather[0].icon;
      curdata = [loc, temp, ovarall, icon];
    }

    baseurl = "http://api.openweathermap.org/data/2.5/forecast?";

    url = baseurl + "q=katwa" + "&appid=" + String(weatherapi) + "&units=" + this.unit;
    const jsondata = this.getJSON(url);
    let foredata = [];
    if (jsondata == "401") {
      foredata = 404;
    } else if (jsondata == "unreachable") {
      foredata = "unreachable";
    } else if (jsondata == "404") {
      foredata = 404;
    } else {
      const newdate = new Date();
      let d = newdate.getDay() + 1;
      const newdata = jsondata;
      const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const forcustdata = newdata.list;

      let day = "";

      for (var i = 7; i < 24; i += 8) {
        day = forcustdata[i];
        const temp = day["main"]["temp"];
        const icon = day["weather"][0]["icon"];
        d = d % 7;
        const wd = weekday[d];
        d++;
        foredata.push([wd, icon, temp]);
      }
    }

    if (foredata == 401 || foredata == 404 || foredata == "unreachable" || !foredata || foredata.length === 0) {
      this._fcomhead.set_text("no data");
      this._scomhead.set_text("no data");
      this._tcomhead.set_text("no data");
    } else {
      this._fcomhead.set_text(foredata[0][0]);
      let wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[0][1] + "@2x.png", 35);
      this.firstcomiconbtn.set_child(wiconimage);
      this._fcomtemp.set_text(foredata[0][2] + "℃");

      this._scomhead.set_text(foredata[1][0]);
      wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[1][1] + "@2x.png", 35);
      this.secondcomiconbtn.set_child(wiconimage);
      this._scomtemp.set_text(foredata[1][2] + "℃");

      this._tcomhead.set_text(foredata[2][0]);
      wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[2][1] + "@2x.png", 35);
      this.thirdcomiconbtn.set_child(wiconimage);
      this._tcomtemp.set_text(foredata[2][2] + "℃");
    }

    if (curdata == 401 || curdata == 404 || curdata == "unreachable") {
      this.comloc.set_text("no data");
    } else {
      this.comloc.set_text(curdata[0]);
      let comicon = this._getIconImage("/icons/owm_icons/" + curdata[3] + "@2x.png", 45);
      this.comiconbtn.set_child(comicon);
      this.comtemp.set_text(curdata[1]);
      this.comdes.set_text(curdata[2]);
    }
  }

  _get_compact_update() {
    if (this.apiKey !== "" && this.location !== "") {
      this._get_data_service();
    }
  }

  _create_compact_label() {
    this._compactContainer = new St.BoxLayout({ vertical: false, style_class: "compact_container_style" });
    this._compactcur = new St.BoxLayout({ vertical: true, style_class: "compact_cur_container_style" });
    this._compactfor = new St.BoxLayout({ vertical: false, style_class: "compact_for_container_style" });

    this.comloc = new St.Label({ style_class: "comloc_label_style" });
    this.comloc.set_text(this.location);
    const comicon = this._getIconImage("/icons/icon.png", 45);
    this.comiconbtn = new St.Button();
    this.comiconbtn.set_child(comicon);
    this.comiconbtn.connect("clicked", () => {
      this._get_compact_update();
    });
    this.comtemp = new St.Label({ style_class: "comtemp_label_style" });
    this.comtemp.set_text("30℃");
    this.comdes = new St.Label({ style_class: "comloc_label_style" });
    this.comdes.set_text("light rain");

    this.fcomview = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._fcomhead = new St.Label({ style_class: "fday_label_style" });
    this._fcomhead.set_text("MON");
    const fcomicon = this._getIconImage("/icons/icon.png", 35);
    this.firstcomiconbtn = new St.Button();
    this.firstcomiconbtn.set_child(fcomicon);
    this.firstcomiconbtn.style = "margin-top:10px;margin-bottom:10px;";
    this._fcomtemp = new St.Label({ style_class: "fday_label_style" });
    this._fcomtemp.set_text("30℃");

    this.fcomview.add(this._fcomhead);
    this.fcomview.add(this.firstcomiconbtn);
    this.fcomview.add(this._fcomtemp);
    this._compactfor.add(this.fcomview);

    this.scomview = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._scomhead = new St.Label({ style_class: "fday_label_style" });
    this._scomhead.set_text("MON");
    const scomicon = this._getIconImage("/icons/icon.png", 35);
    this.secondcomiconbtn = new St.Button();
    this.secondcomiconbtn.set_child(scomicon);
    this.secondcomiconbtn.style = "margin-top:10px;margin-bottom:10px;";
    this._scomtemp = new St.Label({ style_class: "fday_label_style" });
    this._scomtemp.set_text("30℃");

    this.scomview.add(this._scomhead);
    this.scomview.add(this.secondcomiconbtn);
    this.scomview.add(this._scomtemp);
    this._compactfor.add(this.scomview);

    this.tcomview = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
    this._tcomhead = new St.Label({ style_class: "fday_label_style" });
    this._tcomhead.set_text("MON");
    const tcomicon = this._getIconImage("/icons/icon.png", 35);
    this.thirdcomiconbtn = new St.Button();
    this.thirdcomiconbtn.set_child(tcomicon);
    this.thirdcomiconbtn.style = "margin-top:10px;margin-bottom:10px;";
    this._tcomtemp = new St.Label({ style_class: "fday_label_style" });
    this._tcomtemp.set_text("30℃");

    this.tcomview.add(this._tcomhead);
    this.tcomview.add(this.thirdcomiconbtn);
    this.tcomview.add(this._tcomtemp);
    this._compactfor.add(this.tcomview);

    this._compactcur.add(this.comloc);
    this._compactcur.add(this.comiconbtn);
    this._compactcur.add(this.comtemp);
    this._compactcur.add(this.comdes);
    this._compactContainer.add(this._compactcur);
    this._compactContainer.add(this._compactfor);
    this._container.add(this._compactContainer);

    this._get_compact_update();
  }

  _updateClock() {
    const a = new Date();
    this._timeLabel.set_text(this.clock.get_clock_for_format("%0l:%0M"));
    const date = String(a.getDate()).padStart(2, "0");
    this._dateLabel.set_text(date);

    const mm = a.getMonth();
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    this._monthLabel.set_text("  " + month[mm] + ", " + a.getFullYear());

    const dd = a.getDay();
    const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    this._weekLabel.set_text("   " + weekday[dd]);
  }
}

function main(metadata, desklet_id) {
  return new CinnamonClockDesklet(metadata, desklet_id);
}
