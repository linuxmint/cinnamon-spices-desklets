
const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
let _httpSession;
if (Soup.MAJOR_VERSION == 2) {
    _httpSession = new Soup.SessionAsync();
} else { //version 3
    _httpSession = new Soup.Session();
}
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
        this.settings.bind("compact", "compactperm", this._onCompactPermChange);
        this.settings.bind("webservice", "webservice", this._get_compact_update);
        this.settings.bind("unit", "unit", this._get_compact_update);
        this.settings.bind("icon-pack", "icon_pack", this._get_compact_update);
        this.settings.bind("api-key", "api", this._dummy_func);
        this.settings.bind("loctype", "loctype", this._dummy_func);
        this.settings.bind("loc", "loc", this._dummy_func);
        this.settings.bind("weather-color", "wcolor", this._onchange_weather_style);
        this.settings.bind("weather-bg-color", "wbgcolor", this._onSettingsChanged);

        // this.settings.bind("auto-update", "auto_update", this._on_feed_settings_change);
        // this.settings.bind("update-duration", "duration", this._on_update_duration_change);
        // this.settings.bind("feedback", "feed", this._on_feed_settings_change);
        this._menu.addSettingsAction(_("Date and Time Settings"), "calendar")

        if (this.compactperm) {
            this._create_compact_label()
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
        if (this.compactperm) {

            this._compactContainer.style = "background-color:" + this.wbgcolor;
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
        let icon_file = DESKLET_DIR + iconpath;
        let file = Gio.file_new_for_path(icon_file);
        let icon_uri = file.get_uri();
        let iconimage = St.TextureCache.get_default().load_uri_async(icon_uri, 65, 65);
        iconimage.set_size(dim, dim);
        return iconimage;
    }



    _onCompactPermChange() {
        if (this.compactperm) {
            this._create_compact_label();

        }
        else {
            this._compactContainer.destroy();

        }
    }
    _dummy_func() {

    }

    getJSON(url) {

        var jsonData = "EMPTY";
        let message = Soup.Message.new('GET', url);

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
        } else { //version 3
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
        }
        else if (this.loctype == "lat-lon") {
            var cor = (String(this.loc)).split("-");
            return "lat=" + cor[0] + "&lon=" + cor[1];
        }
        else {
            return "q=kolkata";
        }

    }

    _get_data_service() {
        if (this.webservice == "bbc") {
            this._return_bbc_data();
        }
        else if (this.webservice == "owm") {
            return this._return_owm_data();
        }
    }

    _get_icon_pack() {
        if (this.icon_pack == "default") {
            return "owm_icons";
        }
    }

    _return_bbc_data() {

    }

    _return_owm_data() {

        var baseurl = "http://api.openweathermap.org/data/2.5/weather?";
        // var weatherapi for api key
        var weatherapi = this.api;


        var url = baseurl + this.id() + "&appid=" + String(weatherapi) + "&units="+this.unit;
        var curdata = this.getJSON(url);
        if (curdata == "401") {
            curdata = 401
        }
        else if (curdata == "unreachable") {
            curdata = "unreachable";
        }
        else if (curdata == "404") {
            curdata = 404;
        }
        else {
            var loc = curdata.name + ", " + curdata.sys.country;
            var ovarall = curdata.weather[0].description;
            var temp = curdata.main.temp + " ℃";
            var icon = curdata.weather[0].icon;
            curdata = [loc, temp, ovarall, icon];
        }

        // forecast data loading

        baseurl = "http://api.openweathermap.org/data/2.5/forecast?";



        url = baseurl + "q=katwa" + "&appid=" + String(weatherapi) + "&units="+this.unit;
        var jsondata = this.getJSON(url);
        let foredata = [];
        if (jsondata == "401") {
            foredata = 404;
        }
        else if (jsondata == "unreachable") {
            foredata = "unreachable";
        }
        else if (jsondata == "404") {
            foredata = 404;
        }
        else {

            let newdate = new Date();
            var d = newdate.getDay() + 1;
            let newdata = jsondata;
            var weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
            let forcustdata = newdata.list;

            let day = "";

            for (var i = 7; i < 24; i += 8) {
                day = forcustdata[i];
                let temp = day["main"]["temp"];
                let icon = day["weather"][0]["icon"];
                d = d % 7;
                let wd = weekday[d];
                d++;
                foredata.push([wd, icon, temp]);

            }


        }




        // var foredata=this._return_forecast_data();
        if (foredata == 401 && foredata == 404 && foredata == "unreachable") {
            this.comloc = foredata;
        }
        else {

            this._fcomhead.set_text(foredata[0][0]);
            let wiconimage = this._getIconImage("/icons/" + this._get_icon_pack() + "/" + foredata[0][1] + "@2x.png", 35);
            this.firstcomiconbtn.set_child(wiconimage);
            this._fcomtemp.set_text(foredata[0][2] + "℃");

            this._scomhead.set_text(foredata[1][0]);
            wiconimage = this._getIconImage("/icons/" + this._get_icon_pack() + "/" + foredata[1][1] + "@2x.png", 35);
            this.secondcomiconbtn.set_child(wiconimage);
            this._scomtemp.set_text(foredata[1][2] + "℃");

            this._tcomhead.set_text(foredata[2][0]);
            wiconimage = this._getIconImage("/icons/" + this._get_icon_pack() + "/" + foredata[2][1] + "@2x.png", 35);
            this.thirdcomiconbtn.set_child(wiconimage);
            this._tcomtemp.set_text(foredata[2][2] + "℃");
        }


        if (curdata == 401 && curdata == 404 && curdata == "unreachable") {
            this.comloc = "no data";
        }
        else {
            this.comloc.set_text(curdata[0]);
            let comicon = this._getIconImage("/icons/" + this._get_icon_pack() + "/" + curdata[3] + "@2x.png", 45);
            this.comiconbtn.set_child(comicon);
            this.comtemp.set_text(curdata[1]);
            this.comdes.set_text(curdata[2])
        }






    }

    _get_compact_update() {
        if (true) {

            if ((this.api !== "") && (this.loc !== "")) {
                this._get_data_service();
                // var data = this._return_owm_data();
                // var foredata = data[1];
                // // var foredata=this._return_forecast_data();
                // if (foredata == 401 && foredata == 404 && foredata == "unreachable") {
                //     this.comloc = foredata;
                // }
                // else {

                //     this._fcomhead.set_text(foredata[0][0]);
                //     let wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[0][1] + "@2x.png", 35);
                //     this.firstcomiconbtn.set_child(wiconimage);
                //     this._fcomtemp.set_text(foredata[0][2] + "℃");

                //     this._scomhead.set_text(foredata[1][0]);
                //     wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[1][1] + "@2x.png", 35);
                //     this.secondcomiconbtn.set_child(wiconimage);
                //     this._scomtemp.set_text(foredata[1][2] + "℃");

                //     this._tcomhead.set_text(foredata[2][0]);
                //     wiconimage = this._getIconImage("/icons/owm_icons/" + foredata[2][1] + "@2x.png", 35);
                //     this.thirdcomiconbtn.set_child(wiconimage);
                //     this._tcomtemp.set_text(foredata[2][2] + "℃");
                // }

                // var curdata = data[0]
                // if (curdata == 401 && curdata == 404 && curdata == "unreachable") {
                //     this.comloc = "no data";
                // }
                // else {
                //     this.comloc.set_text(curdata[0]);
                //     let comicon = this._getIconImage("/icons/owm_icons/" + curdata[3] + "@2x.png", 45);
                //     this.comiconbtn.set_child(comicon);
                //     this.comtemp.set_text(curdata[1]);
                //     this.comdes.set_text(curdata[2])
                // }

            }


        }



    }
    _create_compact_label() {
        this._compactContainer = new St.BoxLayout({ vertical: false, style_class: "compact_container_style" });
        this._compactcur = new St.BoxLayout({ vertical: true, style_class: "compact_cur_container_style" });
        this._compactfor = new St.BoxLayout({ vertical: false, style_class: "compact_for_container_style" });

        this.comloc = new St.Label({ style_class: "comloc_label_style" });
        this.comloc.set_text(this.loc);
        let comicon = this._getIconImage("/icons/icon.png", 45);
        this.comiconbtn = new St.Button();
        this.comiconbtn.set_child(comicon);
        this.comiconbtn.connect('clicked', Lang.bind(this, this._get_compact_update));
        this.comtemp = new St.Label({ style_class: "comtemp_label_style" });
        this.comtemp.set_text("30℃");
        this.comdes = new St.Label({ style_class: "comloc_label_style" });
        this.comdes.set_text("light rain");

        this.fcomview = new St.BoxLayout({ vertical: true, style_class: "compact_day_container_style" });
        this._fcomhead = new St.Label({ style_class: "fday_label_style" });
        this._fcomhead.set_text("MON");
        let fcomicon = this._getIconImage("/icons/icon.png", 35);
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
        let scomicon = this._getIconImage("/icons/icon.png", 35);
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
        let tcomicon = this._getIconImage("/icons/icon.png", 35);
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


    }
}

function main(metadata, desklet_id) {
    return new CinnamonClockDesklet(metadata, desklet_id);
}
