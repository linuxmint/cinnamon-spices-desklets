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

		//this.mystate = "7";
		//this.mydistrict = "Agra";
		//this.langdl = "hi";
		//this.district_enable = false;
		//this.title_css = "color: #007bff; font-size: 18px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.india_css = "color: #007bff; font-size: 24px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.indiadetails_css = "color: #6c757d; font-size: 10px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.state_css = "color: #007bff; font-size: 24px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.statedetails_css = "color: #6c757d; font-size: 10px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.district_css = "text-align:center; font-size: 24px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.districtdetails_css = "text-align:center; font-size: 14px; text-align: center; text-shadow: #f3ff22 1px 1px 4px;";
		//this.districtred_css = "#ff073a";
		//this.districtorange_css = "#fd7e14";
		//this.districtgreen_css = "#28a745";

		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "langdl", "langdl", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "state", "mystate", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "district", "mydistrict");
		this.settings.bindProperty(Settings.BindingDirection.IN, "district_enable", "district_enable", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "title_css", "title_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "india_css", "india_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "indiadetails_css", "indiadetails_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "state_css", "state_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "statedetails_css", "statedetails_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "district_css", "district_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "districtdetails_css", "districtdetails_css");
		this.settings.bindProperty(Settings.BindingDirection.IN, "districtred_css", "districtred_css", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "districtorange_css", "districtorange_css", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "districtgreen_css", "districtgreen_css", this.on_setting_changed);



		this.setupUI();		
		// start update cycle
		this.update();
	},

	setupUI: function() {
		this._covidContainer = new St.BoxLayout({vertical: true, style_class: ''});
		this._title = new St.Label({text: _(this.langdl=="hi"? "कोरोना रिपोर्ट" : "Corona Report")});
		this._india = new St.Label({text: _(this.langdl=="hi" ? "भारत: loading" : "India: loading")});
		this._indiaDetails = new St.Label({text: _(this.langdl=="hi" ? "loading \n loading" : "loading \n loading")});
		this._state = new St.Label({text: _(this.langdl=="hi" ? "राज्य: loading" : "State loading")});
		this._stateDetails = new St.Label({text: _(this.langdl=="hi" ? "loading \n loading" : "loading \n loading")});
		this._covidContainer.add(this._title);
		this._covidContainer.add(this._india);
		this._covidContainer.add(this._indiaDetails);
		this._covidContainer.add(this._state);
		this._covidContainer.add(this._stateDetails);
		this._districtContainer = new St.BoxLayout({vertical: true, style_class: ""});
		this._district = new St.Label({text: _(this.langdl=="hi" ? "जिला: loading" : "District: loading")});
		this._districtDetails = new St.Label({text: _(this.langdl=="hi" ? "loading \n loading \n loading \n loading" : "loading \n loading \n loading \n loading")});
		this._districtContainer.add(this._district);
		this._districtContainer.add(this._districtDetails);

		if(this.district_enable == true) {
			this._covidContainer.add(this._districtContainer);
		}

		this.setContent(this._covidContainer);
		this.setHeader(_("Covid 19 India"));

		this._title.style= this.title_css;
		this._india.style= this.india_css;
		this._indiaDetails.style= this.indiadetails_css;
		this._state.style= this.state_css;
		this._stateDetails.style= this.statedetails_css;
		
		this._district.style = this.district_css;
		this._districtDetails.style = this.districtdetails_css;
		

		//this._indiatooltip = new Tooltips.Tooltip(this._india);

	},

	getJSON: function(url) {
		let message = Soup.Message.new('GET', url);
		_httpSession.send_message (message);
		if(message.status_code!==Soup.KnownStatusCode.OK) {
			return "";
		} else {
			return message.response_body.data;
		}
		return jsonData;
	},

	refreshStats: function() {
		let jsonData = JSON.parse(this.getJSON("https://api.covid19india.org/data.json"));
		if(jsonData !== "") {
			this._india.set_text((this.langdl=="hi" ? "भारत: " :"India: ") +jsonData.statewise[0].active);
			//this._indiatooltip.set_text((this.langdl=="hi" ? "सक्रिय रोगी" :"Active Patient"))
			if(this.langdl=="hi") {
				this._indiaDetails.set_text("पुष्टीकृत: " + jsonData.statewise[0].confirmed + ", रोगमुक्त: "+ jsonData.statewise[0].recovered+", मृतक: "+jsonData.statewise[0].deaths+" \nat "+ jsonData.statewise[0].lastupdatedtime);
				this._state.set_text(jsonData.statewise[this.mystate].state + ": " +jsonData.statewise[this.mystate].active);
				this._stateDetails.set_text("पुष्टीकृत: " + jsonData.statewise[this.mystate].confirmed + ", रोगमुक्त: "+ jsonData.statewise[this.mystate].recovered+", मृतक: "+jsonData.statewise[this.mystate].deaths+" \nat "+ jsonData.statewise[this.mystate].lastupdatedtime);
			} else {
				this._indiaDetails.set_text("Confirmed: " + jsonData.statewise[0].confirmed + ", Recovered: "+ jsonData.statewise[0].recovered+", Death: "+jsonData.statewise[0].deaths+" \nat "+ jsonData.statewise[0].lastupdatedtime);
				this._state.set_text(jsonData.statewise[this.mystate].state + ": " +jsonData.statewise[this.mystate].active);
				this._stateDetails.set_text("Confirmed: " + jsonData.statewise[this.mystate].confirmed + ", Recovered: "+ jsonData.statewise[this.mystate].recovered+", Death: "+jsonData.statewise[this.mystate].deaths+" \nat "+ jsonData.statewise[this.mystate].lastupdatedtime);
			}
		} else {
			this._india.set_text("No internet");
		}
		if(this.district_enable == true) {
			let jsonZone = JSON.parse(this.getJSON("https://api.covid19india.org/zones.json"));
			var zi;
			if(jsonZone!=="") {
				for(zi=0; zi<jsonZone.zones.length; zi++) {
					if(jsonZone.zones[zi].district.toLowerCase()==this.mydistrict.toLowerCase()) break;
				}
				let zone = jsonZone.zones[zi].zone;
				if(zone == "Red") {
					this._district.style=this.district_css+"color: "+this.districtred_css;
					this._districtDetails.style=this.districtdetails_css+"color: "+this.districtred_css;
				}
				if(zone == "Orange") {
					this._district.style=this.district_css+"color: "+this.districtorange_css;
					this._districtDetails.style=this.districtdetails_css+"color: "+this.districtorange_css;
				}
				if(zone == "Green") {
					this._district.style=this.district_css+"color: "+this.districtgreen_css;
					this._districtDetails.style=this.districtdetails_css+"color: "+this.districtgreen_css;
				}
				this._district.set_text(this.mydistrict+": "+ zone+" Zone");
			} else {

			}

		}
		if(this.district_enable == true) {
			let jsonDistrict = JSON.parse(this.getJSON("https://api.covid19india.org/v2/state_district_wise.json"));
			var si, di, districtDetails = "No Internet";
			if(jsonDistrict!=="" && this.langdl=="hi") {
				for(si=0; si<jsonDistrict.length-1; si++) {
					for(di=0; di<jsonDistrict[si].districtData.length-1; di++) {
						if(this.mydistrict.toLowerCase() == jsonDistrict[si].districtData[di].district.toLowerCase()) districtDetails = "सक्रिय: "+jsonDistrict[si].districtData[di].active+" \nपुष्टीकृत: "+jsonDistrict[si].districtData[di].confirmed+"\nरोगमुक्त"+jsonDistrict[si].districtData[di].recovered+"\nमृतक"+jsonDistrict[si].districtData[di].deceased;
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

		}

		
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
