
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

        this.iconbutton = new St.Icon({ icon_name: 'view-refresh-symbolic', icon_type: St.IconType.SYMBOLIC });
        this.iconbutton.style = "width:20px;\nheight:20px;"
        this._rfsbut = new St.Button(); // container for refresh icon
        this._rfsbut.set_child(this.iconbutton);
        this._rfsbut.style = "padding-top:10px;padding-bottom:5px"
        this._rfsbut.connect('clicked', Lang.bind(this, this._get_refresh_report));

        this._weatherContainer.add(this._wloc);
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
        else{
            this._wfeed.set_text("");
        }
    }

    _onWeatherPermChange() {
        if (this.weatherperm) {
            this._create_weather_label();
            this._get_weather_update();
        }
        else {
            this._weatherContainer.destroy();
            this.auto_update = false;
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
        else{
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

    }
    _get_weather_update() {

        if (this.weatherperm == true) {

            if ((this.api !== "") && ((this.latlon !== "") || (this.city !== ""))) {

                var baseurl = "http://api.openweathermap.org/data/2.5/weather?";
                // var weatherapi = "8e44efb0ae84f237a5d93f5f4d629433";
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
                    var reportleft = feels + pressure + humidity;
                    var reportright = windspeed + cloud + visibility;
                    this._wloc.set_text(loc)
                    this._whead.set_text(temp);
                    this._wover.set_text(ovarall);
                    this._weatherleft.set_text(reportleft);
                    this._weatherright.set_text(reportright);
                    var feed = "        data from openweathermap.org....";
                    if(this.feed){
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




    _updateClock() {
        let a = new Date();
        var min = a.getMinutes();
        var sec=a.getSeconds();
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
            if (min % this.dur == 0 && sec<2) {
                this._get_refresh_report();
            }
        }


    }
}

function main(metadata, desklet_id) {
    return new CinnamonClockDesklet(metadata, desklet_id);
}