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


function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}


MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "langdl", "langdl", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "state", "mystate", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "district", "mydistrict");
		this.settings.bindProperty(Settings.BindingDirection.IN, "district_enable", "district_enable", this.on_setting_changed);

		this.setupUI();		
		// start update cycle
		this.update();
	},

	setupUI: function() {
		this._covidContainer = new St.BoxLayout({vertical: true, style_class: 'covidContainer'});
		this._title = new St.Label({text: this.langdl=="hi"? "कोरोना रिपोर्ट" : "Corona Report", style_class: "title_css"});
		this._india = new St.Label({text: this.langdl=="hi" ? "भारत: loading" : "India: loading", style_class: "india_css"});
		this._indiaDetails = new St.Label({text: this.langdl=="hi" ? "loading \n loading" : "loading \n loading", style_class: "indiadetails_css"});
		this._state = new St.Label({text: this.langdl=="hi" ? "राज्य: loading" : "State loading", style_class: "state_css"});
		this._stateDetails = new St.Label({text: this.langdl=="hi" ? "loading \n loading" : "loading \n loading", style_class: "statedetails_css"});
		this._covidContainer.add(this._title);
		this._covidContainer.add(this._india);
		this._covidContainer.add(this._indiaDetails);
		this._covidContainer.add(this._state);
		this._covidContainer.add(this._stateDetails);
		this._districtContainer = new St.BoxLayout({vertical: true, style_class: "districtContainer"});
		this._district = new St.Label({text: this.langdl=="hi" ? "जिला: loading" : "District: loading", style_class: "district_css"});
		this._districtZone = new St.Label({text: this.langdl=="hi" ? "क्षेत्र loading" : "zone loading", style_class: "districtzone_css"});
		this._districtDetails = new St.Label({text: this.langdl=="hi" ? "loading \n loading \n loading \n loading" : "loading \n loading \n loading \n loading", style_class: "districtdetails_css"});
		this._districtContainer.add(this._district);
		this._districtContainer.add(this._districtZone);
		this._districtContainer.add(this._districtDetails);

		if(this.district_enable == true) {
			this._covidContainer.add(this._districtContainer);
		}
		this.setContent(this._covidContainer);
		this.setHeader(_("Covid 19 India"));
	},

	getJSON: function(url) {
		try {
			let message = Soup.Message.new('GET', url);
			_httpSession.send_message (message);
			if(message.status_code!==Soup.KnownStatusCode.OK) {
				return "";
			} else {
				return JSON.parse(message.response_body.data);
			}
		} catch(e) { global.log(e); }
		
	},

	refreshStats: function() {
		let jsonData = this.getJSON("https://api.covid19india.org/data.json");
		if(jsonData !== "" && this.langdl=="hi") {
			this._india.set_text("भारत: " +jsonData.statewise[0].active);
			this._indiaDetails.set_text("पुष्टीकृत: " + jsonData.statewise[0].confirmed + ", रोगमुक्त: "+ jsonData.statewise[0].recovered+", मृतक: "+jsonData.statewise[0].deaths+" \nसमय "+ jsonData.statewise[0].lastupdatedtime+" पर");
			for(var si in jsonData.statewise) { if(jsonData.statewise[si].statecode==this.mystate) break; }
			this._state.set_text(jsonData.statewise[si].state + ": " +jsonData.statewise[si].active);
			this._stateDetails.set_text("पुष्टीकृत: " + jsonData.statewise[si].confirmed + ", रोगमुक्त: "+ jsonData.statewise[si].recovered+", मृतक: "+jsonData.statewise[si].deaths+" \nसमय "+ jsonData.statewise[si].lastupdatedtime+" पर");
		} else if(jsonData !== "" && this.langdl=="en") {
			this._india.set_text("India: "+jsonData.statewise[0].active);
			this._indiaDetails.set_text("Confirmed: " + jsonData.statewise[0].confirmed + ", Recovered: "+ jsonData.statewise[0].recovered+", Death: "+jsonData.statewise[0].deaths+" \nat "+ jsonData.statewise[0].lastupdatedtime);
			for(var si in jsonData.statewise) { if(jsonData.statewise[si].statecode==this.mystate) break; }
			this._state.set_text(jsonData.statewise[si].state + ": " +jsonData.statewise[si].active);
			this._stateDetails.set_text("Confirmed: " + jsonData.statewise[si].confirmed + ", Recovered: "+ jsonData.statewise[si].recovered+", Death: "+jsonData.statewise[si].deaths+" \nat "+ jsonData.statewise[si].lastupdatedtime);
		} else {
			this._indiaDetails.set_text("unreachable"+" \nunreachable");
			
			this._stateDetails.set_text("unreachable\nunreachable");	
		}
		global.log("This is covid19 desklet log");

		if(this.district_enable == true && jsonData !== "") {
			let jsonZone = this.getJSON("https://api.covid19india.org/zones.json");
			if(jsonZone!=="") {
				var zi = "Not found in state"
				for(var zn in jsonZone.zones) { 
					if(jsonZone.zones[zn].statecode == this.mystate && jsonZone.zones[zn].district.toLowerCase() == this.mydistrict.toLowerCase()) {
						zi = zn; break;
					}
				}
				if(zi !== "Not found in state") {
					let zoneColor = jsonZone.zones[zi].zone;
					if(zoneColor == "Red") {
						this._districtContainer.style_class = "districtred_css";
						this._districtZone.set_text(this.langdl=="hi"?"लाल क्षेत्र "+jsonZone.zones[zi].lastupdated+" से":"Red Zone from "+jsonZone.zones[zi].lastupdated);
					}if(zoneColor == "Green") {
						this._districtContainer.style_class = "districtgreen_css";
						this._districtZone.set_text(this.langdl=="hi"?"हरा क्षेत्र "+jsonZone.zones[zi].lastupdated+" से":"Green Zone from "+jsonZone.zones[zi].lastupdated);
					}if(zoneColor == "Orange") {
						this._districtContainer.style_class = "districtorange_css";
						this._districtZone.set_text(this.langdl=="hi"?"नारंगी क्षेत्र "+jsonZone.zones[zi].lastupdated+" से":"Orange Zone from "+jsonZone.zones[zi].lastupdated);
					}
				} else {
					this._districtZone.set_text("Zone not found");
				}
			} else { this._districtZone.set_text(this.langdl=="hi"?"अज्ञात":"Unreachable"); }
			let jsonDistrict = this.getJSON("https://api.covid19india.org/v2/state_district_wise.json");
			if(jsonDistrict!=="") {
				var districtfound = false;
				for(var sn in jsonDistrict) {
					if(jsonDistrict[sn].statecode == this.mystate) {
						for(var dn in jsonDistrict[sn].districtData) {
							global.log(jsonDistrict[sn].districtData[dn].district );
							global.log(jsonDistrict[sn].districtData[dn].district.toLowerCase() == this.mydistrict.toLowerCase());
							if(jsonDistrict[sn].districtData[dn].district.toLowerCase() == this.mydistrict.toLowerCase()) {
								global.log("found");
								this._districtDetails.set_text(this.langdl == "hi" ? 
									"सक्रिय: "+jsonDistrict[sn].districtData[dn].active
									+" \nपुष्टीकृत: "+jsonDistrict[sn].districtData[dn].confirmed
									+"\nरोगमुक्त: "+jsonDistrict[sn].districtData[dn].recovered
									+"\nमृतक: "+jsonDistrict[sn].districtData[dn].deceased 
									: 
									"Active: "+jsonDistrict[sn].districtData[dn].active
									+" \nConfirmed: "+jsonDistrict[sn].districtData[dn].confirmed
									+"\nRecovered: "+jsonDistrict[sn].districtData[dn].recovered
									+"\nDeceased: "+jsonDistrict[sn].districtData[dn].deceased);
								this._district.set_text(jsonDistrict[sn].districtData[dn].district);
								districtfound = true;
								break;
							}
						}
					}
				}
				
				if(districtfound==false) {
					this._districtDetails.set_text(this.langdl == "hi" ? 
									"सक्रिय: "+"अज्ञात"
									+" \nपुष्टीकृत: "+"अज्ञात"
									+"\nरोगमुक्त: "+"अज्ञात"
									+"\nमृतक: "+"अज्ञात"
									: 
									"Active: "+"Unknown"
									+" \nConfirmed: "+"Unknown"
									+"\nRecovered: "+"Unknown"
									+"\nDeceased: "+"Unknown");
					this._district.set_text(this.langdl=="hi"?this.mydistrict+": राज्य में नहीं" : this.mydistrict+": Not found in state");
				} 

			}
		} else {
			this._districtDetails.set_text("Unreachable"
									+" \n"+"Unreachable"
									+"\n"+"Unreachable"
									+"\n"+"Unreachable");
			this._district.set_text(this.langdl=="hi"?this.mydistrict+": इंटरनेट नहीं है": this.mydistrict+": No Internet");
			}
		/*
		if(this.district_enable == true) {
			let jsonDistrict = JSON.parse(this.getJSON("https://api.covid19india.org/v2/state_district_wise.json"));
			var si, di, districtDetails = "No Internet";
			if(jsonDistrict!=="" && this.langdl=="hi") {
				for(si=0; si<jsonDistrict.length-1; si++) {
					for(di=0; di<jsonDistrict[si].districtData.length-1; di++) {
						if(this.mydistrict.toLowerCase() == jsonDistrict[si].districtData[di].district.toLowerCase()) districtDetails = "सक्रिय: "+jsonDistrict[si].districtData[di].active+" \nपुष्टीकृत: "+jsonDistrict[si].districtData[di].confirmed+"\nरोगमुक्त: "+jsonDistrict[si].districtData[di].recovered+"\nमृतक: "+jsonDistrict[si].districtData[di].deceased++jsonDistrict[si];
					}
				}
				this._districtDetails.set_text(districtDetails);
			} else if(jsonDistrict!=="" && this.langdl=="en") {
				for(si=0; si<jsonDistrict.length-1; si++) {
					for(di=0; di<jsonDistrict[si].districtData.length-1; di++) {
						if(this.mydistrict.toLowerCase() == jsonDistrict[si].districtData[di].district.toLowerCase()) districtDetails = "Active"+jsonDistrict[si].districtData[di].active+" \nConfirmed: "+jsonDistrict[si].districtData[di].confirmed+"\nRecovered"+jsonDistrict[si].districtData[di].recovered+"\nDeceased"+jsonDistrict[si].districtData[di].deceased;
					}
				}
				this._districtDetails.set_text(districtDetails);
			} else {
				this._districtDetails.set_text(districtDetails);
			}

		}*/

		
	},


	update: function() {
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
	let desklet = new MyDesklet(metadata, desklet_id);
	return desklet;
}
