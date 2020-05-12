const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const _httpSession = new Soup.SessionAsync();
const Tooltips = imports.ui.tooltips;

const PopupMenu = imports.ui.popupMenu;
const Gettext = imports.gettext;

//const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["covid19@india"].path;

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}


MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "langdl", "langdl", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "state", "mystate", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "district", "mydistrict");
        this.settings.bindProperty(Settings.BindingDirection.IN, "district_enable", "district_enable", this.on_setting_changed);

        this.setupUI();
        // start update cycle
        this.update();
    },

    setupUI() {
        this._covidContainer = new St.BoxLayout({ vertical: true, styleClass: "covidContainer" });
        this._districtContainer = new St.BoxLayout({ vertical: true, styleClass: "districtContainer" });

        if (this.langdl === "hi") {
            this._title = new St.Label({ text: "कोरोना विवरण", styleClass: "title_css" });
            this._india = new St.Label({ text: "भारत: खोज रहा है", styleClass: "india_css" });
            this._indiaDetails = new St.Label({ text: " खोज रहा है \n  खोज रहा है", styleClass: "indiadetails_css" });
            this._state = new St.Label({ text: "राज्य:  खोज रहा है", styleClass: "state_css" });
            this._stateDetails = new St.Label({ text: " खोज रहा है \n  खोज रहा है", styleClass: "statedetails_css" });
            this._district = new St.Label({ text: "जिला: खोज रहा है", styleClass: "district_css" });
            this._districtZone = new St.Label({ text: "क्षेत्र खोज रहा है", styleClass: "districtzone_css" });
            this._districtDetails = new St.Label({ text: "खोज रहा है \n खोज रहा है \n खोज रहा है \n खोज रहा है", styleClass: "districtdetails_css" });

        } else {
            this._title = new St.Label({ text: "Corona Report", styleClass: "title_css" });
            this._india = new St.Label({ text: "India: loading", styleClass: "india_css" });
            this._indiaDetails = new St.Label({ text: "loading \n loading", styleClass: "indiadetails_css" });
            this._state = new St.Label({ text: "State loading", styleClass: "state_css" });
            this._stateDetails = new St.Label({ text: "loading \n loading", styleClass: "statedetails_css" });
            this._district = new St.Label({ text: "District: loading", styleClass: "district_css" });
            this._districtZone = new St.Label({ text: "zone loading", styleClass: "districtzone_css" });
            this._districtDetails = new St.Label({ text: "loading \n loading \n loading \n loading", styleClass: "districtdetails_css" });

        }
        this._covidContainer.add(this._title);
        this._covidContainer.add(this._india);
        this._covidContainer.add(this._indiaDetails);
        this._covidContainer.add(this._state);
        this._covidContainer.add(this._stateDetails);
        this._districtContainer.add(this._district);
        this._districtContainer.add(this._districtZone);
        this._districtContainer.add(this._districtDetails);

        if (this.district_enable === true) {
            this._covidContainer.add(this._districtContainer);
        }
        this.setContent(this._covidContainer);
        this.setHeader("Covid 19 India");
    },

    getJSON(url) {
        try {
            let message = Soup.Message.new("GET", url);
            _httpSession.send_message(message);
            if (message.status_code !== Soup.KnownStatusCode.OK) {
                return "";
            } else {
                return JSON.parse(message.response_body.data);
            }
        } catch (e) { global.log(e); }

    },


    refreshStatshi() {
        let jsonData = this.getJSON("https://api.covid19india.org/data.json");
        if (jsonData !== "") {
            this._india.set_text("भारत: " + jsonData.statewise[0].active);
            this._indiaDetails.set_text("पुष्टीकृत: " + jsonData.statewise[0].confirmed + ", रोगमुक्त: " + jsonData.statewise[0].recovered + ", मृतक: " + jsonData.statewise[0].deaths + " \nसमय " + jsonData.statewise[0].lastupdatedtime + " पर");
            jsonData.statewise.forEach((statecd) => {
                if (statecd.statecode === this.mystate) {
                    this._state.set_text(statecd.state + ": " + statecd.active);
                    this._stateDetails.set_text("पुष्टीकृत: " + statecd.confirmed + ", रोगमुक्त: " + statecd.recovered + ", मृतक: " + statecd.deaths + " \nसमय " + statecd.lastupdatedtime + " पर");
                }
            });
            this.checkDistricthi();
        } else {
            this._indiaDetails.set_text("अज्ञात\nअज्ञात");
            this._stateDetails.set_text("अज्ञात\nअज्ञात");
        }
    },
    refreshStatsen() {
        let jsonDataen = this.getJSON("https://api.covid19india.org/data.json");
        if (jsonDataen !== "") {
            this._india.set_text("India: " + jsonDataen.statewise[0].active);
            this._indiaDetails.set_text("Confirmed: " + jsonDataen.statewise[0].confirmed + ", Recovered: " + jsonDataen.statewise[0].recovered + ", Death: " + jsonDataen.statewise[0].deaths + " \nat " + jsonDataen.statewise[0].lastupdatedtime);
            jsonDataen.statewise.forEach((stateencd) => {
                if (stateencd.statecode === this.mystate) {
                    this._state.set_text(stateencd.state + ": " + stateencd.active);
                    this._stateDetails.set_text("Confirmed: " + stateencd.confirmed + ", Recovered: " + stateencd.recovered + ", Death: " + stateencd.deaths + " \nat " + stateencd.lastupdatedtime);

                }
            });
            this.checkDistricten();
        } else {
            this._indiaDetails.set_text("unreachable\nunreachable");
            this._stateDetails.set_text("unreachable\nunreachable");
        }
    },

    checkDistricthi() {
        if (this.district_enable) {
            this.refreshdistricthi();
        }
    },
    checkDistricten() {
        if (this.district_enable) {
            this.refreshdistricten();
        }
    },

    refreshZonehi() {
        let jsonZone = this.getJSON("https://api.covid19india.org/zones.json");
        if (jsonZone !== "") {
            jsonZone.zones.forEach((distzn) => {
                if (distzn.statecode === this.mystate && distzn.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                    this.refreshZoneTexthi(distzn);
                }
            });
        } else { this._districtZone.set_text("अज्ञात"); }

    },
    refreshZoneTexthi(distzn) {
        switch (distzn.zone) {
            case "Red":
                this._districtContainer.styleClass = "districtred_css";
                this._districtZone.set_text("लाल क्षेत्र " + distzn.lastupdated + " से");
                break;
            case "Green":
                this._districtContainer.styleClass = "districtgreen_css";
                this._districtZone.set_text("हरा क्षेत्र " + distzn.lastupdated + " से");
                break;
            case "Orange":
                this._districtContainer.styleClass = "districtorange_css";
                this._districtZone.set_text("नारंगी क्षेत्र " + distzn.lastupdated + " से");
                break;
        }
    },
    refreshZoneen() {
        let jsonZoneen = this.getJSON("https://api.covid19india.org/zones.json");
        if (jsonZoneen !== "") {
            jsonZoneen.zones.forEach((distenzn) => {
                if (distenzn.statecode === this.mystate && distenzn.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                    this.refreshZoneTexten(distenzn);
                }
            });
        } else { this._districtZone.set_text("Unreachable"); }

    },
    refreshZoneTexten(distenzn) {
        switch (distenzn.zone) {
            case "Red":
                this._districtContainer.styleClass = "districtred_css";
                this._districtZone.set_text("Red Zone from " + distenzn.lastupdated);
                break;
            case "Green":
                this._districtContainer.styleClass = "districtgreen_css";
                this._districtZone.set_text("Green Zone from " + distenzn.lastupdated);
                break;
            case "Orange":
                this._districtContainer.styleClass = "districtorange_css";
                this._districtZone.set_text("Orange Zone from " + distenzn.lastupdated);
                break;
        }
    },

    refreshdistricthi() {

        let jsonDistrict = this.getJSON("https://api.covid19india.org/v2/state_district_wise.json");
        if (jsonDistrict !== "") {
            this.districtfound = false;
            jsonDistrict.forEach((statecd) => {
                if (statecd.statecode === this.mystate) {
                    statecd.districtData.forEach((distct) => {
                        if (distct.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                            this._district.set_text(distct.district);
                            this._districtDetails.set_text("सक्रिय: " + distct.active + " \nपुष्टीकृत: " + distct.confirmed + "\nरोगमुक्त: " + distct.recovered + "\nमृतक: " + distct.deceased);
                            this.districtfound = true;
                        }
                    });
                }
            });


            if (this.districtfound === false) {
                this._districtDetails.set_text("सक्रिय: " + "अज्ञात" + " \nपुष्टीकृत: " + "अज्ञात" + "\nरोगमुक्त: " + "अज्ञात" + "\nमृतक: " + "अज्ञात");
                this._district.set_text(this.mydistrict + ": राज्य में नहीं");
            }
            this.refreshZonehi();
        }
    },



    refreshdistricten() {
        let jsonDistricten = this.getJSON("https://api.covid19india.org/v2/state_district_wise.json");
        if (jsonDistricten !== "") {
            this.districtfound = false;
            jsonDistricten.forEach((statecden) => {
                if (statecden.statecode === this.mystate) {
                    statecden.districtData.forEach((distcten) => {
                        if (distcten.district.toLowerCase() === this.mydistrict.toLowerCase()) {

                            this._districtDetails.set_text("Active: " + distcten.active + " \nConfirmed: " + distcten.confirmed + "\nRecovered: " + distcten.recovered + "\nDeceased: " + distcten.deceased);
                            this._district.set_text(distcten.district);
                            this.districtfound = true;
                        }
                    });
                }
            });


            if (this.districtfound === false) {
                this._districtDetails.set_text("Active: " + "Unknown" + " \nConfirmed: " + "Unknown" + "\nRecovered: " + "Unknown" + "\nDeceased: " + "Unknown");
                this._district.set_text(this.mydistrict + ": Not found in state");
            }
            this.refreshZoneen();
        }


    },
    refreshStats() {
    	 if (this.langdl === "hi") {
            this.refreshStatshi();
        } else {
            this.refreshStatsen();
        }
    },

    update() {
       this.refreshStats();
        this.timeout = Mainloop.timeout_add_seconds(3600, Lang.bind(this, this.update));
    },

    on_setting_changed() {
        this.setupUI();
        this.refreshStats();
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    }
}

function main(metadata, deskletId) {
    let desklet = new MyDesklet(metadata, deskletId);
    return desklet;
}