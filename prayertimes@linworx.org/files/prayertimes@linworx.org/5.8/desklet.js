
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;

const Adhan = require('./prayertimes');
const Hijri = require('./hijri');
const HTTP = require('./http');
const Logger = require('./log');
const Utils = require('./utils');

class MuslimPrayerTimesDesklet extends Desklet.Desklet {

	constructor(metadata, desklet_id) {
		super(metadata, desklet_id);

		this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "autolocation", "autolocation", this.getLocation, true);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "latitude", "latitude", this.getLocation, null);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "longitude", "longitude", this.getLocation, null);

		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_fajr", "adjust_fajr", this._onSettingsChanged);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_dhuhr", "adjust_dhuhr", this._onSettingsChanged);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_asr", "adjust_asr", this._onSettingsChanged);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_maghrib", "adjust_maghrib", this._onSettingsChanged);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_isha", "adjust_isha", this._onSettingsChanged);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "adjust_date", "adjust_date", this._onSettingsChanged);

		this.settings.bind("method", "method", this._onSettingsChanged);
		this.settings.bind("madhab", "madhab", this._onSettingsChanged);
		this.settings.bind("highlatitude", "highlatitude", this._onSettingsChanged);
		this.settings.bind("polar", "polar", this._onSettingsChanged);
		this.settings.bind("shafaq", "shafaq", this._onSettingsChanged);
		this.settings.bind("rounding", "rounding", this._onSettingsChanged);

		this.settings.bind("vertical_layout", "vertical_layout", this.setupUI);
		this.settings.bind("desklet_size", "desklet_size", this.setupUI);
		this.settings.bind("color", "color", this.setupUI);
		this.settings.bind("show_city", "show_city", this.setupUI);
		this.settings.bind("show_countdown", "show_countdown", this.setupUI);
		this.settings.bind("show_table", "show_table", this.setupUI);
		this.settings.bind("show_date", "show_date", this.setupUI);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "transparency", "transparency", this.setupUI);

		this.color = 'rgb(255,255,255)';
		this.city = "Getting location...";
		this.logger = new Logger.New([metadata.uuid, desklet_id].join('#'));
		this.today = new Date().getDate();
		this.prayerTimes = {
			fajr: null,
			dhuhr: null,
			asr: null,
			maghrib: null,
			isha: null,
		}

		this.setupUI();
		this.getLocation();
	}

	async getLocation() {

		if (this.autolocation !== 'automatic') {
			this.logger.Log(`Auto-location is disabled`);
			if (this.longitude && this.latitude) {
				this.city = "Manual location";
				this.calculatePrayerTimes();
			} else {
				this.city = "Please enter your location";
			}
			return;
		}

		this.logger.Log(`Getting location`)
		const http = new HTTP.Client();
		try {
			const ret = await http.Get("https://geoip.fedoraproject.org/city");
			const parsed = JSON.parse(ret.replace(/null/g, '"null"'));
			this.longitude = parsed.longitude.toString();
			this.latitude = parsed.latitude.toString();
			this.city = parsed.city;
			this.calculatePrayerTimes();
		} catch (e) {
			this.logger.Log(e)
		}
		this.logger.Log(`Got location: ${this.latitude}, ${this.longitude}`)
	}


	setupUI() {

		const window = new St.BoxLayout({ vertical: true });
		window.style = `background-color: rgba(0,0,0,${this.transparency / 100})`;

		const textMuted = this.color.replace('rgb(', 'rgba(').replace(')', ', .4)');

		if (this.show_city) {
			const city = new St.Label({ text: `${this.city}`, style_class: 'location' });
			city.style = `font-size: ${this.desklet_size}px; color: ${this.color}`;
			window.add(city);
		}

		if (this.show_countdown) {
			const currentPrayer = new St.Label({ text: `${Utils.capitalise(this.currentPrayer || '')}: ${this.countdown}`, style_class: 'current_prayer' });
			currentPrayer.style = `font-size: ${this.desklet_size * 4 / 3}px; color: ${this.color}; padding: ${this.vertical_layout ? '20px' : '0px'}`;
			window.add(currentPrayer);
		}

		if (this.show_table) {
			const table = new St.Table({ style_class: 'table' })
			table.style = `min-width: 180px; width: ${this.vertical_layout ? this.desklet_size * 12 : this.desklet_size * 18 + 300}px`

			let i = 1;
			for (const time of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {

				const isNext = time === this.currentPrayer;
				const color = isNext ? this.color : textMuted;

				const label = new St.Label({ text: Utils.capitalise(time), style_class: `prayer_name` });
				label.style = `font-size: ${this.desklet_size}px; color: ${color}; padding: ${this.desklet_size * 5 / 18}px ${this.vertical_layout ? this.desklet_size : 0}px`;
				table.add(label, { row: this.vertical_layout ? i : 0, col: this.vertical_layout ? 0 : i });

				const value = new St.Label({ text: Utils.formatTime(this.prayerTimes[time]), style_class: `prayer_time` });
				value.style = `font-size: ${this.desklet_size * 4 / 3}px; color: ${color}`;
				table.add(value, { row: this.vertical_layout ? i : 1, col: this.vertical_layout ? 1 : i });
				i++;
			}
			window.add_actor(table);
		}

		if (this.show_date) {
			const today = new Date();
			const adjusted = new Date(today.getTime() + this.adjust_date * 86400 * 1000);
			const hijri = new St.Label({ text: Hijri.toHijri(adjusted.getFullYear(), adjusted.getMonth() + 1, adjusted.getDate()), style_class: 'hijri_date' });
			hijri.style = `font-size: ${this.desklet_size * 3 / 4}px; color: ${this.color}`;
			window.add(hijri);
		}

		this.setContent(window);
		this.refresh();
	}

	get countdown() {
		if (!this.currentPrayer) return '--:--:--';
		return Utils.roundTime((this.prayerTimes[this.currentPrayer].getTime() - new Date().getTime()) / 1000)
	}


	calculatePrayerTimes() {
		let method;
		switch (this.method) {
			case "Egyptian": method = Adhan.CalculationMethod.Egyptian(); break;
			case "Karachi": method = Adhan.CalculationMethod.Karachi(); break;
			case "UmmAlQura": method = Adhan.CalculationMethod.UmmAlQura(); break;
			case "Dubai": method = Adhan.CalculationMethod.Dubai(); break;
			case "Qatar": method = Adhan.CalculationMethod.Qatar(); break;
			case "Kuwait": method = Adhan.CalculationMethod.Kuwait(); break;
			case "MoonsightingCommittee": method = Adhan.CalculationMethod.MoonsightingCommittee(); break;
			case "Singapore": method = Adhan.CalculationMethod.Singapore(); break;
			case "Turkey": method = Adhan.CalculationMethod.Turkey(); break;
			case "Tehran": method = Adhan.CalculationMethod.Tehran(); break;
			case "NorthAmerica": method = Adhan.CalculationMethod.NorthAmerica(); break;
			default: method = Adhan.CalculationMethod.MuslimWorldLeague();
		}

		method.highLatitudeRule = this.highlatitude;
		method.polarCircleResolution = this.polar;
		method.shafaq = this.shafaq;
		method.madhab = this.madhab;
		method.adjustments = {
			fajr: this.adjust_fajr,
			dhuhr: this.adjust_dhuhr,
			asr: this.adjust_asr,
			maghrib: this.adjust_maghrib,
			isha: this.adjust_isha,
		}

		const prayerTimes = new Adhan.PrayerTimes(
			new Adhan.Coordinates(this.latitude, this.longitude),
			method,
		);

		this.prayerTimes = {
			fajr: prayerTimes.fajr,
			dhuhr: prayerTimes.dhuhr,
			asr: prayerTimes.asr,
			maghrib: prayerTimes.maghrib,
			isha: prayerTimes.isha,
		}

		this.setupUI();
	}

	get currentPrayer() {
		if (!this.prayerTimes.fajr) return;
		const now = new Date().getTime();
		const post = 30 * 60 * 1000;
		if (now < this.prayerTimes.fajr.getTime() + post) return 'fajr';
		if (now < this.prayerTimes.dhuhr.getTime() + post) return 'dhuhr';
		if (now < this.prayerTimes.asr.getTime() + post) return 'asr';
		if (now < this.prayerTimes.maghrib.getTime() + post) return 'maghrib';
		return 'isha';
	}

	_onSettingsChanged() {
		this.calculatePrayerTimes();
	}


	refresh() {
		this.on_desklet_removed();
		this._timeoutId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this.setupUI));
		const today = new Date().getDate();
		if (today != this.today) {
			this.calculatePrayerTimes();
			this.today = today;
		}
	}

	on_desklet_removed() {
		// this.logger.Log(`Cleaning up timers`)
		if (typeof this._timeoutId !== 'undefined') {
			Mainloop.source_remove(this._timeoutId);
		}
	}
}

function main(metadata, desklet_id) {
	return new MuslimPrayerTimesDesklet(metadata, desklet_id);
}
