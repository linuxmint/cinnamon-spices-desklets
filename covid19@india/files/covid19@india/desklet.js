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

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
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
        this._title = new St.Label({ text: this.langdl === "hi" ? "कोरोना विवरण" : "Corona Report", styleClass: "title_css" });
        this._india = new St.Label({ text: this.langdl === "hi" ? "भारत: खोज रहा है" : "India: loading", styleClass: "india_css" });
        this._indiaDetails = new St.Label({ text: this.langdl === "hi" ? " खोज रहा है \n  खोज रहा है" : "loading \n loading", styleClass: "indiadetails_css" });
        this._state = new St.Label({ text: this.langdl === "hi" ? "राज्य:  खोज रहा है" : "State loading", styleClass: "state_css" });
        this._stateDetails = new St.Label({ text: this.langdl === "hi" ? " खोज रहा है \n  खोज रहा है" : "loading \n loading", styleClass: "statedetails_css" });
        this._covidContainer.add(this._title);
        this._covidContainer.add(this._india);
        this._covidContainer.add(this._indiaDetails);
        this._covidContainer.add(this._state);
        this._covidContainer.add(this._stateDetails);
        this._districtContainer = new St.BoxLayout({ vertical: true, styleClass: "districtContainer" });
        this._district = new St.Label({ text: this.langdl === "hi" ? "जिला: loading" : "District: loading", styleClass: "district_css" });
        this._districtZone = new St.Label({ text: this.langdl === "hi" ? "क्षेत्र loading" : "zone loading", styleClass: "districtzone_css" });
        this._districtDetails = new St.Label({ text: this.langdl === "hi" ? "loading \n loading \n loading \n loading" : "loading \n loading \n loading \n loading", styleClass: "districtdetails_css" });
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

    refreshStats() {
        let jsonData = this.getJSON("https://api.covid19india.org/data.json");
        if (jsonData !== "" && this.langdl === "hi") {
            this._india.set_text("भारत: " + jsonData.statewise[0].active);
            this._indiaDetails.set_text("पुष्टीकृत: " + jsonData.statewise[0].confirmed + ", रोगमुक्त: " + jsonData.statewise[0].recovered + ", मृतक: " + jsonData.statewise[0].deaths + " \nसमय " + jsonData.statewise[0].lastupdatedtime + " पर");
            jsonData.statewise.forEach(statecd => {
            	if(statecd.statecode===this.mystate) {
            		this._state.set_text(statecd.state+ ": "+statecd.active);
					this._stateDetails.set_text("पुष्टीकृत: "+statecd.confirmed+", रोगमुक्त: "+statecd.recovered+", मृतक: "+statecd.deaths+" \nसमय "+statecd.lastupdatedtime+" पर");
            	}
            });
        } else if (jsonData !== "" && this.langdl === "en") {
            this._india.set_text("India: " + jsonData.statewise[0].active);
            this._indiaDetails.set_text("Confirmed: " + jsonData.statewise[0].confirmed + ", Recovered: " + jsonData.statewise[0].recovered + ", Death: " + jsonData.statewise[0].deaths + " \nat " + jsonData.statewise[0].lastupdatedtime);
            jsonData.statewise.forEach((statecd) => {
            	if(statecd.statecode===this.mystate) {
					this._state.set_text(statecd.state + ": " + statecd.active);
					this._stateDetails.set_text("Confirmed: " + statecd.confirmed + ", Recovered: " + statecd.recovered + ", Death: " + statecd.deaths + " \nat " + statecd.lastupdatedtime);

            	}
            });
        } else {
            this._indiaDetails.set_text(this.langdl==="hi"?"अज्ञात\nअज्ञात" : "unreachable\nunreachable");
            this._stateDetails.set_text(this.langdl==="hi"?"अज्ञात\nअज्ञात" : "unreachable\nunreachable");
        }
        global.log("This is covid19 desklet log");

        if (this.district_enable === true && jsonData !== "") {
            let jsonZone = this.getJSON("https://api.covid19india.org/zones.json");
            if (jsonZone !== "") {
				this.zonefound = false;
                jsonZone.zones.forEach((distzn) => {
                    if (distzn.statecode === this.mystate && distzn.district.toLowerCase() === this.mydistrict.toLowerCase()) {
						this.zonefound=true;
                        if (distzn.zone === "Red") {
                            this._districtContainer.styleClass = "districtred_css";
                            this._districtZone.set_text(this.langdl === "hi" ? "लाल क्षेत्र " + distzn.lastupdated + " से" : "Red Zone from " + distzn.lastupdated);
                        }
                        if (distzn.zone === "Green") {
                            this._districtContainer.styleClass = "districtgreen_css";
                            this._districtZone.set_text(this.langdl === "hi" ? "हरा क्षेत्र " + distzn.lastupdated + " से" : "Green Zone from " + distzn.lastupdated);
                        }
                        if (distzn.zone === "Orange") {
                            this._districtContainer.styleClass = "districtorange_css";
                            this._districtZone.set_text(this.langdl === "hi" ? "नारंगी क्षेत्र " + distzn.lastupdated + " से" : "Orange Zone from " + distzn.lastupdated);
                        }
                    }
                });
                if(this.zonefound===false) {
					this._districtZone.set_text("Zone not found");
                }

            } else { this._districtZone.set_text(this.langdl === "hi" ? "अज्ञात" : "Unreachable"); }
            let jsonDistrict = this.getJSON("https://api.covid19india.org/v2/state_district_wise.json");
            if (jsonDistrict !== "") {
                this.districtfound = false;
                jsonDistrict.forEach((statecd) => {
					if(statecd.statecode===this.mystate) {
						statecd.districtData.forEach((distct) => {
                		    if(distct.district.toLowerCase()===this.mydistrict.toLowerCase()) {
                                this._districtDetails.set_text(this.langdl === "hi" ?
                                    "सक्रिय: " + distct.active +
                                    " \nपुष्टीकृत: " + distct.confirmed +
                                    "\nरोगमुक्त: " + distct.recovered +
                                    "\nमृतक: " + distct.deceased :
                                    "Active: " + distct.active +
                                    " \nConfirmed: " + distct.confirmed +
                                    "\nRecovered: " + distct.recovered +
                                    "\nDeceased: " + distct.deceased);
                                this._district.set_text(distct.district);
                                this.districtfound = true;
                			}
                	    });
                    }
                });
                

                if (this.districtfound === false) {
                    this._districtDetails.set_text(this.langdl === "hi" ?
                        "सक्रिय: " + "अज्ञात" +
                        " \nपुष्टीकृत: " + "अज्ञात" +
                        "\nरोगमुक्त: " + "अज्ञात" +
                        "\nमृतक: " + "अज्ञात" :
                        "Active: " + "Unknown" +
                        " \nConfirmed: " + "Unknown" +
                        "\nRecovered: " + "Unknown" +
                        "\nDeceased: " + "Unknown");
                    this._district.set_text(this.langdl === "hi" ? this.mydistrict + ": राज्य में नहीं" : this.mydistrict + ": Not found in state");
                }

            }
        } else {
            this._districtDetails.set_text(
            	this.langdl==="hi"? 
            	"अज्ञात\nअज्ञात\nअज्ञात\nअज्ञात" :
            	"Unreachable\nUnreachable\nUnreachable\nUnreachable");
            this._district.set_text(this.langdl === "hi" ? this.mydistrict + ": इंटरनेट नहीं है" : this.mydistrict + ": No Internet");
        }
    },


    update() {
        this.refreshStats();
        // update again in two seconds
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

function main(metadata, desklet_id) {
    let desklet = new MyDesklet(metadata, deskletId);
    return desklet;
}