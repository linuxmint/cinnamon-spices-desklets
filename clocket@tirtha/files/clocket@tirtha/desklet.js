
const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const _httpSession = new Soup.SessionAsync();
// const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const UUID = "clocket@tirtha";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;


class CinnamonClockDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._Container = new St.BoxLayout({ "vertical": true });
        this._clockContainer = new St.BoxLayout();
        this._dateContainer = new St.BoxLayout({ "vertical": true, style_class: "clock_container_style" });
        this._dayContainer = new St.BoxLayout();



        this._time = new St.Label({ style_class: "clock_container_style" });
        this._date = new St.Label({ style_class: "date_label_style" });
        this._month = new St.Label({ style_class: "month_label_style" });
        this._week = new St.Label({ style_class: "weekday_label_style" });
        this.week = new St.Label({ style_class: "weekday_label_style" });

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

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bind("font-size", "size", this._onSettingsChanged);
        this.settings.bind("text-color", "color", this._onSettingsChanged);
        this.settings.bind("background-color", "bgcolor", this._onSettingsChanged);
        this.settings.bind("weather", "weatherperm", this._onWeatherPermChange);
        this.settings.bind("forecast", "forecastperm", this._onForecastPermChange);
        this.settings.bind("api-key", "api", this._dummy_func);
        this.settings.bind("lat-long", "latlon", this._dummy_func);
        this.settings.bind("place", "city", this._dummy_func);
        this.settings.bind("weather-color", "wcolor", this._onchange_weather_style);
        this.settings.bind("weather-bg-color", "wbgcolor", this._onSettingsChanged);
        this.settings.bind("auto-update", "auto_update", this._on_feed_settings_change);
        this.settings.bind("update-duration", "duration", this._on_update_duration_change);
        this.settings.bind("feedback", "feed", this._on_feed_settings_change);
        this._menu.addSettingsAction(_("Date and Time Settings"), "calendar")
        if (this.weatherperm) {
            this._create_weather_label();
            if (this.auto_update) {
                this.dur = parseInt(this.duration);
            }
        }
        if (this.forecastperm) {
            this._create_forecast_label();
        }


    }

    _clockNotify(obj, pspec, data) {
        this._updateClock();
    }

    _onSettingsChanged() {
        this._time.style = "font-size: " + this.size + "pt;\ncolor: " + this.color + ";\nbackground-color:" + this.bgcolor;
        this._date.style = "font-size: " + (this.size - 10) + "pt;";
        this._dateContainer.style = "background-color:" + this.bgcolor;
        this._month.style = "font-size: " + (this.size - 20) + "pt;\ncolor: " + this.color;
        this._week.style = "font-size: " + (this.size - 16) + "pt;\ncolor: " + this.color;
        if (this.weatherperm) {
            this._whead.style = "color: " + this.color;
            this._weatherContainer.style = "background-color:" + this.wbgcolor;
        }
        if (this.forecastperm) {
            
            this._forecustContainer.style = "background-color:" + this.wbgcolor;
        }

        this._updateClock();
    }


    on_desklet_added_to_desktop() {
        this._onSettingsChanged();

        if (this.clock_notify_id == 0) {
            this.clock_notify_id = this.clock.connect("notify::clock", () => this._clockNotify());
        }
    }

    on_desklet_removed() {
        if (this.clock_notify_id > 0) {
            this.clock.disconnect(this.clock_notify_id);
            this.clock_notify_id = 0;
        }
    }
    _onchange_weather_style() {
        if (this.weatherperm) {
            this._wContainer.style = "color: " + this.wcolor;
            this._wloc.style = "color: " + this.wcolor;
            this._wover.style = "color: " + this.wcolor;

        }
        if (this.forecastperm) {
            
            this._fhead.style = "color: " + this.wcolor;
            this._ftemp.style = "color: " + this.wcolor;
            this._shead.style = "color: " + this.wcolor;
            this._stemp.style = "color: " + this.wcolor;
            this._thead.style = "color: " + this.wcolor;
            this._ttemp.style = "color: " + this.wcolor;


        }
    }
    _getIconImage(iconpath, dim) {
        let icon_file = DESKLET_DIR + iconpath;
        let file = Gio.file_new_for_path(icon_file);
        let icon_uri = file.get_uri();
        let iconimage = St.TextureCache.get_default().load_uri_async(icon_uri, 65, 65);
        iconimage.set_size(dim, dim);
        return iconimage;
    }



    _create_weather_label() {
        this._weatherContainer = new St.BoxLayout({ "vertical": true, style_class: "weather_container_style" });
        this._wContainer = new St.BoxLayout();
        this._wloc = new St.Label({ style_class: "wloc_label_style" });
        this._wloc.style = "text-decoration:underline;"
        this._whead = new St.Label({ style_class: "whead_label_style" });
        this._wover = new St.Label({ style_class: "wloc_label_style" });
        this._weatherleft = new St.Label({ style_class: "wbody_label_style" });
        this._weatherright = new St.Label({ style_class: "wbody_label_style" });
        this._weatherright.style = "padding-left:30px;"
        this._wfeed = new St.Label({ style_class: "wbody_label_style" });
        this._wfeed.style = "color:rgb(214, 25, 98);text-align:right;";

        // let gicon = Gio.icon_new_for_string("icons/icon.png");
        // this.wicon = new St.Icon({style_class: 'your-icon-name'});
        this.wicon = this._getIconImage("/icons/icon.png", 40);

        // this.wicon.style='background-image: url("icons/icon.png")'
        this._wiconbut = new St.Button(); // container for weather icon
        this._wiconbut.style = "padding-top:0px;padding-bottom:0px"
        this._wiconbut.set_child(this.wicon);

        this.iconbutton = new St.Icon({ icon_name: 'view-refresh-symbolic', icon_type: St.IconType.SYMBOLIC });
        this.iconbutton.style = "width:20px;\nheight:20px;"
        this._rfsbut = new St.Button(); // container for refresh icon
        this._rfsbut.set_child(this.iconbutton);
        this._rfsbut.style = "padding-top:10px;padding-bottom:5px"
        this._rfsbut.connect('clicked', Lang.bind(this, this._get_refresh_report));

        this._weatherContainer.add(this._wloc);
        this._weatherContainer.add(this._wiconbut);
        this._weatherContainer.add(this._whead);
        this._weatherContainer.add(this._wover);
        this._weatherContainer.add(this._rfsbut);
        this._wContainer.add(this._weatherleft);
        this._wContainer.add(this._weatherright);
        this._weatherContainer.add(this._wContainer);
        this._weatherContainer.add(this._wfeed);
        this._Container.add(this._weatherContainer);

        this._get_weather_update();
    }



    _on_feed_settings_change() {
        if (this.feed) {
            var feed = "data from openweathermap.org....";
            if (this.auto_update) {
                feed = feed + "\nAuto-refresh Enabled.\nduration: " + this.duration + " min";
            }
            this._wfeed.set_text(feed);
        }
        else {
            this._wfeed.set_text("");
        }
    }

    _onWeatherPermChange() {
        if (this.weatherperm) {
            this._create_weather_label();
            // this._get_weather_update();
        }
        else {
            this._weatherContainer.destroy();
            this.auto_update = false;
        }

    }
    _onForecastPermChange() {
        if (this.forecastperm) {
            this._create_forecast_label();
            
        }
        else {
            this._forecustContainer.destroy();

        }

    }
    _dummy_func() {

    }

    _on_update_duration_change() {
        this.dur = parseInt(this.duration);
        if (this.feed) {
            var feed = "data from openweathermap.org....";
            if (this.auto_update) {
                feed = feed + "\nAuto-refresh Enabled.\nduration: " + this.duration + " min";
            }
            this._wfeed.set_text(feed);
        }
        else {
            this._wfeed.set_text("");
        }
    }
    getJSON(url) {

        var jsonData = "EMPTY";
        let message = Soup.Message.new('GET', url);
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

    }

    _get_refresh_report() {
        this._wloc.set_text("")
        this._whead.set_text("");
        this._wover.set_text("");
        this._weatherleft.set_text("");
        this._weatherright.set_text("");
        this._get_weather_update();
        this._get_forecast_update();

    }
    _get_weather_update() {

        if (this.weatherperm == true) {

            if ((this.api !== "") && ((this.latlon !== "") || (this.city !== ""))) {

                var baseurl = "http://api.openweathermap.org/data/2.5/weather?";
                // var weatherapi for api key
                var weatherapi = this.api;
                var id = ""
                if (this.latlon == "") {
                    id = "q=" + this.city;

                }
                else {
                    var cor = (String(this.latlon)).split("-");
                    var id = "lat=" + cor[0] + "&lon=" + cor[1];
                }

                var url = baseurl + id + "&appid=" + String(weatherapi) + "&units=metric";
                var jsondata = this.getJSON(url);
                if (jsondata == "401") {
                    var report = "invalid api key found !!!";
                    this._weatherleft.set_text(report);
                    this._weatherright.set_text("");
                }
                else if (jsondata == "unreachable") {
                    var report = "unreachable !!!\n unknown error occured."
                    this._weatherleft.set_text(report);
                    this._weatherright.set_text("");
                }
                else if (jsondata == "404") {
                    var report = "Error 404 !\n Invalid place found...."
                    this._weatherleft.set_text(report);
                    this._weatherright.set_text("");
                }
                else {
                    var utctime = jsondata.timezone / 3600;
                    utctime = utctime.toFixed(2);
                    var time = String(utctime);
                    time = time.replace(".", ":");
                    if (utctime >= 0) {
                        time = "+" + time;
                    }

                    var loc = jsondata.name + ", " + jsondata.sys.country + ", UTC" + time;
                    var ovarall = jsondata.weather[0].description;
                    var temp = jsondata.main.temp + " ℃";
                    var feels = "feels like : " + jsondata.main.feels_like + " ℃\n";
                    var pressure = "Pressure : " + jsondata.main.pressure + "psi\n";
                    var humidity = "Humidity : " + jsondata.main.humidity + " %\n";
                    var windspeed = "Wind speed : " + jsondata.wind.speed + " m/s \n";
                    var cloud = "Cloudiness : " + jsondata.clouds.all + " %\n"
                    var visibility = "Visibility : " + jsondata.visibility + " m";
                    var icon = jsondata.weather[0].icon;
                    var reportleft = feels + pressure + humidity;
                    var reportright = windspeed + cloud + visibility;
                    this._wloc.set_text(loc)
                    this._whead.set_text(temp);
                    this._wover.set_text(ovarall);
                    this._weatherleft.set_text(reportleft);
                    this._weatherright.set_text(reportright);

                    let wiconimage = this._getIconImage("/icons/owm_icons/" + icon + "@2x.png", 80);
                    this._wiconbut.set_child(wiconimage);


                    var feed = "        data from openweathermap.org....";
                    if (this.feed) {
                        if (this.auto_update) {
                            feed = feed + "\nAuto-refresh Enabled.\nduration: " + this.duration + " min";
                        }
                        this._wfeed.set_text(feed);
                    }

                }


            }
            else {

                this._weatherleft.set_text("To get weather report...\n 1. set api-key(from openweathermap.org only). \n2. set lat-lon or place(only one field).\n      to set api and location right click on\n    desklet and select configure.");
                this._weatherright.set_text("");
            }



        }

    }
    _create_forecast_label() {
        this._forecustContainer = new St.BoxLayout({ vertical: false, style_class: "main_forecast_container_style" });
        this._firstday = new St.BoxLayout({ vertical: true, style_class: "forecast_container_style" });
        this._secondday = new St.BoxLayout({ vertical: true, style_class: "forecast_container_style" });
        this._thirdday = new St.BoxLayout({ vertical: true, style_class: "forecast_container_style" });



        this._fhead = new St.Label({ style_class: "fday_label_style" });
        this._fhead.set_text("MON");
        let ficon = this._getIconImage("/icons/icon.png", 40);
        this.firsticonbtn = new St.Button();
        this.firsticonbtn.set_child(ficon);
        this.firsticonbtn.style = "padding-top:0px;padding-bottom:0px";
        this._ftemp = new St.Label({ style_class: "fday_label_style" });
        this._ftemp.set_text("30℃")


        this._firstday.add(this._fhead);
        this._firstday.add(this.firsticonbtn);
        this._firstday.add(this._ftemp);
        this._forecustContainer.add(this._firstday);


        this._shead = new St.Label({ style_class: "fday_label_style" });
        this._shead.set_text("TUE");
        let sicon = this._getIconImage("/icons/icon.png", 40);
        this.secondiconbtn = new St.Button();
        this.secondiconbtn.set_child(sicon);
        this.secondiconbtn.style = "padding-top:0px;padding-bottom:0px";
        this._stemp = new St.Label({ style_class: "fday_label_style" });
        this._stemp.set_text("31℃");


        this._secondday.add(this._shead);
        this._secondday.add(this.secondiconbtn);
        this._secondday.add(this._stemp);
        this._forecustContainer.add(this._secondday);


        this._thead = new St.Label({ style_class: "fday_label_style" });
        this._thead.set_text("WED");
        let ticon = this._getIconImage("/icons/icon.png", 40);
        this.thirdiconbtn = new St.Button();
        this.thirdiconbtn.set_child(ticon);
        this.thirdiconbtn.style = "padding-top:0px;padding-bottom:0px";
        this._ttemp = new St.Label({ style_class: "fday_label_style" });
        this._ttemp.set_text("32℃")


        this._thirdday.add(this._thead);
        this._thirdday.add(this.thirdiconbtn);
        this._thirdday.add(this._ttemp);
        this._forecustContainer.add(this._thirdday);

        this._Container.add(this._forecustContainer);

        this._get_forecast_update();
    }

    _get_forecast_update() {
        if (this.weatherperm == true) {

            if ((this.api !== "") && ((this.latlon !== "") || (this.city !== ""))) {

                var baseurl = "http://api.openweathermap.org/data/2.5/forecast?";
                // var weatherapi for api key
                var weatherapi = this.api;
                var id = ""
                if (this.latlon == "") {
                    id = "q=" + this.city;

                }
                else {
                    var cor = (String(this.latlon)).split("-");
                    var id = "lat=" + cor[0] + "&lon=" + cor[1];
                }

                var url = baseurl + id + "&appid=" + String(weatherapi) + "&units=metric";
                var jsondata = this.getJSON(url);
                if (jsondata == "401") {
                    var report = "invalid api key found !!!";
                    this._fhead.set_text("401")
                }
                else if (jsondata == "unreachable") {
                    var report = "unreachable !!!\n unknown error occured."
                    this._fhead.set_text("unr")
                }
                else if (jsondata == "404") {
                    var report = "Error 404 !\n Invalid place found...."
                    this._fhead.set_text("404")
                }
                else {
                    var utctime = jsondata.timezone / 3600;
                    utctime = utctime.toFixed(2);
                    var time = String(utctime);
                    time = time.replace(".", ":");
                    if (utctime >= 0) {
                        time = "+" + time;
                    }

                    let newdate = new Date();
                    var d = newdate.getDay() + 1;
                    let newdata = jsondata;
                    var weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
                    let forcustdata = newdata.list;
                    var count = 0;
                    let day = "";
                    let foredata = [];
                    for (var i = 7; i < 24; i += 8) {
                        day = forcustdata[i];
                        let temp = day["main"]["temp"];
                        let icon = day["weather"][0]["icon"];
                        d = d % 7;
                        let wd = weekday[d];
                        d++;
                        foredata.push([wd, icon, temp]);

                    }
                    this._fhead.set_text(foredata[0][0]);
                    let wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[0][1] + "@2x.png", 50);
                    this.firsticonbtn.set_child(wiconimage);
                    this._ftemp.set_text(foredata[0][2] + "℃");

                    this._shead.set_text(foredata[1][0]);
                    wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[1][1] + "@2x.png", 50);
                    this.secondiconbtn.set_child(wiconimage);
                    this._stemp.set_text(foredata[1][2] + "℃");

                    this._thead.set_text(foredata[2][0]);
                    wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[2][1] + "@2x.png", 50);
                    this.thirdiconbtn.set_child(wiconimage);
                    this._ttemp.set_text(foredata[2][2] + "℃");


                }


            }
        }
    }




    _updateClock() {
        let a = new Date();
        var min = a.getMinutes();
        var sec = a.getSeconds();
        this._time.set_text(this.clock.get_clock_for_format("%0l:%0M"));
        var date = String(a.getDate()).padStart(2, '0')
        this._date.set_text(date);

        var mm = a.getMonth();
        var month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        this._month.set_text("  " + month[mm] + ", " + a.getFullYear());

        var dd = a.getDay();
        var weekday = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        this._week.set_text("   " + weekday[dd]);
        if (this.weatherperm && this.auto_update) {
            if (min % this.dur == 0 && sec < 2) {
                this._get_refresh_report();
            }
        }


    }
}

function main(metadata, desklet_id) {
    return new CinnamonClockDesklet(metadata, desklet_id);
}
