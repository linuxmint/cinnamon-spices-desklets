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
    this._Container = new St.BoxLayout({ vertical: true });
    this._clockContainer = new St.BoxLayout();
    this._dateContainer = new St.BoxLayout({ vertical: true, style_class: "clock_container_style" });
    this._dayContainer = new St.BoxLayout();

    this._time = new St.Label({ style_class: "clock_container_style" });
    this._date = new St.Label({ style_class: "date_label_style" });
    this._month = new St.Label({ style_class: "month_label_style" });
    this._week = new St.Label({ style_class: "weekday_label_style" });

    this._clockContainer.add(this._time);
    this._dayContainer.add(this._date);
    this._dayContainer.add(this._month);
    this._dateContainer.add(this._dayContainer);
    this._dateContainer.add(this._week);
    this._clockContainer.add(this._dateContainer);
    this._Container.add(this._clockContainer);

    this.setContent(this._Container);
    this.setHeader(_("Clock"));

    this.clock = new CinnamonDesktop.WallClock();
    this.clock_notify_id = 0;

    const settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
    settings.bind("font-size", "size", this._onSettingsChanged);
    settings.bind("text-color", "color", this._onSettingsChanged);
    settings.bind("background-color", "bgcolor", this._onSettingsChanged);
    settings.bind("compact", "compactperm", this._onCompactPermChange);
    settings.bind("webservice", "webservice", this._get_compact_update);
    settings.bind("unit", "unit", this._get_compact_update);
    settings.bind("api-key", "api");
    settings.bind("loctype", "loctype");
    settings.bind("loc", "loc");
    settings.bind("weather-color", "wcolor", this._onchange_weather_style);
    settings.bind("weather-bg-color", "wbgcolor", this._onSettingsChanged);

    this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");

    if (this.compactperm) {
      this._create_compact_label();
    }
  }

  _onSettingsChanged() {
    this._time.style = "font-size: " + this.size + "pt;\ncolor: " + this.color + ";\nbackground-color:" + this.bgcolor;
    this._date.style = "font-size: " + (this.size - 10) + "pt;";
    this._dateContainer.style = "background-color:" + this.bgcolor;
    this._month.style = "font-size: " + (this.size - 20) + "pt;\ncolor: " + this.color;
    this._week.style = "font-size: " + (this.size - 16) + "pt;\ncolor: " + this.color;
    if (this.compactperm) {
      this._compactContainer.style = "background-color:" + this.wbgcolor;
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
    if (this.compactperm) {
      this.comloc.style = "color: " + this.wcolor;
      this.comtemp.style = "color: " + this.wcolor;
      this.comdes.style = "color: " + this.wcolor;
      this._fcomhead.style = "color: " + this.wcolor;
      this._fcomtemp.style = "color: " + this.wcolor;
      this._scomhead.style = "color: " + this.wcolor;
      this._scomtemp.style = "color: " + this.wcolor;
      this._tcomhead.style = "color: " + this.wcolor;
      this._tcomtemp.style = "color: " + this.wcolor;
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
    if (this.compactperm) {
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
    if (this.loctype == "city") {
      return "q=" + this.loc;
    } else if (this.loctype == "lat-lon") {
      const cor = String(this.loc).split("-");
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
    const weatherapi = this.api;

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
    if (this.api !== "" && this.loc !== "") {
      this._get_data_service();
    }
  }

  _create_compact_label() {
    this._compactContainer = new St.BoxLayout({ vertical: false, style_class: "compact_container_style" });
    this._compactcur = new St.BoxLayout({ vertical: true, style_class: "compact_cur_container_style" });
    this._compactfor = new St.BoxLayout({ vertical: false, style_class: "compact_for_container_style" });

    this.comloc = new St.Label({ style_class: "comloc_label_style" });
    this.comloc.set_text(this.loc);
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
    this._Container.add(this._compactContainer);

    this._get_compact_update();
  }

  _updateClock() {
    const a = new Date();
    this._time.set_text(this.clock.get_clock_for_format("%0l:%0M"));
    const date = String(a.getDate()).padStart(2, "0");
    this._date.set_text(date);

    const mm = a.getMonth();
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    this._month.set_text("  " + month[mm] + ", " + a.getFullYear());

    const dd = a.getDay();
    const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    this._week.set_text("   " + weekday[dd]);
  }
}

function main(metadata, desklet_id) {
  return new CinnamonClockDesklet(metadata, desklet_id);
}
