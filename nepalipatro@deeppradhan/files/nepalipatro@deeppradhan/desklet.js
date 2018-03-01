/* Nepali Patro Desklet
 * Configurable Nepali Patro (Calendar) desklet with browsable months
 *
 * Copyright 2018 Deep Pradhan (https://deeppradhan.heliohost.org/)
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const Desklet = imports.ui.desklet;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;

const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "nepalipatro@deeppradhan";

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

const STYLE_TEXT_CENTER = "text-align: center;";
const STYLE_LABEL_DAY = "padding: 0, 1.5pt; " + STYLE_TEXT_CENTER;

const NepaliPatro = imports.nepalipatro;
const BikramSambat = imports.nepalipatro.BikramSambat;

function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

		// Initialise settings
		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "language", "language", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "panels", "panels", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-weekday", "showWeekday", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "short-month-name", "shortMonthName", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-year", "showYear", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-time", "showTime", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "time-zone", "timeZone", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "layout", "layout", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-family", "fontFamily", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-font-family", "customFontFamily", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-text", "colourText", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-saturdays", "colourSaturdays", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-sundays", "colourSundays", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-background", "colourBackground", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", this.onSettingChanged);

		let bsNow = new BikramSambat();
		// Year, month of the calendar
		this.bsYear = bsNow.getYear();
		this.bsMonth = bsNow.getMonth();

		//////// Today Panel ////////
		this.buttonToday = new St.Button();

		this.labelDay = new St.Label();
		this.labelDate = new St.Label();
		this.labelMonthYear = new St.Label();
		this.labelTime = new St.Label();

		this.boxLayoutToday = new St.BoxLayout({vertical: true, y_align: 2});

		this.tooltipToday = new Tooltips.Tooltip(this.buttonToday);

		this.buttonToday.set_child(this.boxLayoutToday);

		this.labelDay.style = this.labelMonthYear.style = this.labelTime.style = STYLE_TEXT_CENTER;

		this.buttonToday.connect("clicked", Lang.bind(this, function() {
			this.setCurrentMonth();
		}));

		//////// Month Panel ////////
		this.buttonPrevious = new St.Button();
		this.buttonNext = new St.Button();
		this.buttonMonth = new St.Button();
		this.buttonDays = [];		

		this.labelPrevious = new St.Label();
		this.labelNext = new St.Label();
		this.labelMonth = new St.Label();
		this.labelDays = [];

		this.tableMonth = new St.Table();

		this.tooltipDays = [];

		this.labelPrevious.style = "text-align: left;";
		this.labelPrevious.set_text("\u2BC7");
		this.labelNext.style = "text-align: right;";
		this.labelNext.set_text("\u2BC8");
		this.labelMonth.style = STYLE_LABEL_DAY + " font-weight: bold;";

		// Create labels for weekdays
		this.labelWeekdays = [];
		for (let i = 0; i < 7; i++) {
			this.labelWeekdays[i] = new St.Label();
			this.labelWeekdays[i].set_text(BikramSambat.prototype.weekdayNameCharacter[this.language][i]);
			this.tableMonth.add(this.labelWeekdays[i], {row: 1, col: i});
		}

		this.buttonPrevious.set_child(this.labelPrevious);
		this.buttonMonth.set_child(this.labelMonth);
		this.buttonNext.set_child(this.labelNext);

		this.buttonPrevious.connect("clicked", Lang.bind(this, function() {
			if (this.bsYear === BikramSambat.prototype.epoch.bikramSambat.year
					&& this.bsMonth === BikramSambat.prototype.epoch.bikramSambat.month + 1)
				return;
			this.bsMonth--;
				if (this.bsMonth === -1) {
					this.bsMonth = 11;
					this.bsYear--;
				}
				this.updateCalendar();
		}));
		this.buttonNext.connect("clicked", Lang.bind(this, function() {
			if (this.bsYear === BikramSambat.prototype.maxYearBS
					&& this.bsMonth === 11)
				return;
			this.bsMonth++;
			if (this.bsMonth === 12) {
				this.bsMonth = 0;
				this.bsYear++;
			}
			this.updateCalendar();
		}));

		this.tooltipMonth = new Tooltips.Tooltip(this.buttonMonth);
		this.tooltipPrevious = new Tooltips.Tooltip(this.buttonPrevious,
				_("Previous month..."));
		this.tooltipNext = new Tooltips.Tooltip(this.buttonNext,
				_("Next month..."));

		this.tableMonth.add(this.buttonPrevious, {row: 0, col: 0});
		this.tableMonth.add(this.buttonMonth, {row: 0, col: 1, colSpan: 5});
		this.tableMonth.add(this.buttonNext, {row: 0, col: 6});

		// Create buttons with labels (with tooltips) for days
		for (let i = 0; i < 32; i++) {
			this.buttonDays[i] = new St.Button();
			this.labelDays[i] = new St.Label();
			this.labelDays[i].style = STYLE_LABEL_DAY;
			this.labelDays[i].set_text(String(i + 1));
			this.buttonDays[i].set_child(this.labelDays[i]);
			this.tooltipDays[i] = new Tooltips.Tooltip(this.buttonDays[i]);
		}

		////////Calendar Layout ////////
		// Set Desklet header
		this.setHeader("Nepali Patro");

		this.updateCalendar();
	},

	// Called on user clicking the desklet
	on_desklet_clicked: function(event) {
		this.setCurrentMonth();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},

	// Refresh on change of settings
	onSettingChanged: function() {
		Mainloop.source_remove(this.timeout);
		this.updateCalendar();
	},

	setCurrentMonth: function() {
		let bsNow = new BikramSambat(); 
		this.bsYear = bsNow.getYear();
		this.bsMonth = bsNow.getMonth();
		this.updateCalendar();
	},

	/* Method to update the Desklet layout*/
	updateCalendar: function() {

		let now = new Date();
		// Convert to Nepali TimeZone if specified
		if (this.timeZone === "nepali")
			now = NepaliPatro.dateWithOffset(now, 5.75);

		this.lastUpdate = { fullYear: now.getFullYear(), month: now.getMonth(), date: now.getDate()};

		let bsNow = new BikramSambat(now);

		//////// Today Panel ////////
		this.labelDate.style = (now.getDay() === 0 ? "color: " + this.colourSundays + "; " : "")
				+ (now.getDay() === 6 ? "color: " + this.colourSaturdays + "; " : "")
				+ "font-size: 4em; " + STYLE_TEXT_CENTER;

		if (now.getDay() === 0 || now.getDay() === 6)
			this.labelDay.style = "color: " + (now.getDay() === 0 ?
					this.colourSundays : this.colourSaturdays) + "; " + STYLE_TEXT_CENTER;

		this.boxLayoutToday.remove_all_children();
		if (this.showWeekday !== "off")
			this.boxLayoutToday.add(this.labelDay);
		this.boxLayoutToday.add(this.labelDate);
		this.boxLayoutToday.add(this.labelMonthYear);
		if (this.showTime)
			this.boxLayoutToday.add(this.labelTime);

		//////// Month Panel ////////
		this.labelMonth.set_text(BikramSambat.prototype.monthNameShort[this.language][this.bsMonth] + " "
				+ (this.language !== "ne" ? this.bsYear : BikramSambat.prototype.digitsEnToNe(this.bsYear)));

		// Set weekday style
		for (let i = 0; i < 7; i++) {
			this.labelWeekdays[i].set_text(BikramSambat.prototype.weekdayNameCharacter[this.language][i]);
			this.labelWeekdays[i].style = STYLE_LABEL_DAY + (this.bsYear == bsNow.getYear()
					&& this.bsMonth == bsNow.getMonth() && i == now.getDay() ?
					" font-weight: bold;" : "") + (i === 0 ? " color: " + this.colourSundays + ";" : "")
					+ (i === 6 ? " color: " + this.colourSaturdays + ";" : "");
		}

		let monthLength = BikramSambat.prototype.monthLength[this.bsYear][this.bsMonth],
				textDateFirst, textDateLast;
		// Remove all days and set day number as per language
		for (let i = 0, date, textDate; i < 32; i++) {
			if (i < monthLength) {
				date = (new BikramSambat(this.bsYear, this.bsMonth, i + 1)).toDate();
				textDate = date.getDate() + " " + NepaliPatro.MONTH_NAMES[this.language][date.getMonth()]
						+ " " + date.getFullYear();
				this.tooltipDays[i].set_text(this.language !== "en" ?
						BikramSambat.prototype.digitsEnToNe(textDate) : textDate);
				if (i === 0)
					textDateFirst = date.getDate() + " " + NepaliPatro.MONTH_NAMES[this.language][date.getMonth()]
							+ " " + date.getFullYear();
				else if (i === monthLength - 1)
					textDateLast = date.getDate() + " " + NepaliPatro.MONTH_NAMES[this.language][date.getMonth()]
							+ " " + date.getFullYear();
			}
			this.labelDays[i].set_text(this.language === "ne" ? BikramSambat.prototype.digitsEnToNe(i + 1) : String(i + 1));
			this.tableMonth.remove_child(this.buttonDays[i]);
		}

		for (let i = 0, row = 2, col = (new BikramSambat(this.bsYear, this.bsMonth, 1)).toDate().getDay(); i < monthLength; i++) {
			this.labelDays[i].style = STYLE_LABEL_DAY;
			// Set specified colour of Sunday and Saturday
			if (col === 0)
				this.labelDays[i].style = this.labelDays[i].style + " color: " + this.colourSundays + ";";
			else if (col === 6)
				this.labelDays[i].style = this.labelDays[i].style + " color: " + this.colourSaturdays + ";";

			// Emphasise today's date 
			if (this.bsYear == bsNow.getYear() && this.bsMonth == bsNow.getMonth()
					&& i + 1 === bsNow.getDate())
				this.labelDays[i].style = this.labelDays[i].style + "background-color: "
						+ this.colourText + "; color: " + this.colourBackground
						+ "; border-radius: " + (this.fontSize / 4) + "pt;";
			this.tableMonth.add(this.buttonDays[i], {row: row, col: col});
			col++;
			if (col > 6) {
				row++;
				col = 0;
			}
		}
		this.tooltipMonth.set_text(BikramSambat.prototype.monthName[this.language][this.bsMonth] + " "
				+ (this.language !== "ne" ? this.bsYear : BikramSambat.prototype.digitsEnToNe(this.bsYear))
				+ "\n" + (this.language !== "en" ? BikramSambat.prototype.digitsEnToNe(textDateFirst) : textDateFirst)
				+ " - " + (this.language !== "en" ? BikramSambat.prototype.digitsEnToNe(textDateLast) : textDateLast));

		//////// Calendar Layout ////////
		let fontFamily;
		if (this.fontFamily !== "default") {
			if (this.fontFamily === "custom-font-family" && this.customFontFamily !== "")
				fontFamily = this.customFontFamily;
			else
				fontFamily = this.fontFamily;
		}
		if (typeof (this.boxLayoutCalendar) !== "undefined")
			this.boxLayoutCalendar.remove_all_children();
		this.boxLayoutCalendar = new St.BoxLayout({vertical: this.layout !== "horizontal"});
		this.boxLayoutCalendar.style = "background-color: " + (this.colourBackground.replace(")", ","
				+ (1 - this.transparency / 100) + ")")).replace('rgb', 'rgba')
				+ "; border-radius: " + (this.fontSize / 3 * 2) + "pt; color: " + this.colourText + ";"
				+ (typeof(fontFamily) !== "undefined" ? " font-family: '" + fontFamily + "';" : "")
				+ " font-size: " + this.fontSize + "pt; padding: " + (this.fontSize / 3 * 2) + "pt; text-shadow: 1px 1px 2px #000;";
		if (this.panels === "both" || this.panels === "today")
			this.boxLayoutCalendar.add_actor(this.buttonToday);
		if (this.panels === "both" || this.panels === "month")
			this.boxLayoutCalendar.add_actor(this.tableMonth);
		if (this.panels === "both")
			this.buttonToday.style = "margin-" + (this.layout === "horizontal" ? "right" : "bottom")
					+ ": " + (this.fontSize / 2) + "pt;";
		
		this.setContent(this.boxLayoutCalendar);

		this.updateValues();
	},

	/* Method to update the Desklet values*/
	updateValues: function() {

		let now = new Date();
		// Convert to Nepali TimeZone if specified
		if (this.timeZone === "nepali")
			now = NepaliPatro.dateWithOffset(now, 5.75);

		if (this.lastUpdate.fullYear !== now.getFullYear() || this.lastUpdate.month !== now.getMonth() || this.lastUpdate.date !== now.getDate()) {
			this.updateCalendar();
			return;
		}

		let bsNow = new BikramSambat(now);
		bsNow.language = this.language;
		bsNow.monthTextShort = this.shortMonthName;

		//////// Today Panel ////////
		this.labelDay.set_text(this.showWeekday !== "full" ?
				BikramSambat.prototype.weekdayNameShort[this.language][now.getDay()] :
				BikramSambat.prototype.weekdayName[this.language][now.getDay()]);
		this.labelDate.set_text(bsNow.getDateText());
		this.labelMonthYear.set_text(bsNow.getMonthText()
				+ (this.showYear !== "off" ? " " + (bsNow.getYearText().substring(this.showYear !== "full" ? 2 : 0)) : ""));
		let time = NepaliPatro.zeroPad(now.getHours()) + ":"
				+ NepaliPatro.zeroPad(now.getMinutes());
		if (this.language !== "en")
			time = BikramSambat.prototype.digitsEnToNe(time);
		this.labelTime.set_text(time);
		let todayText = now.getDate() + " " + NepaliPatro.MONTH_NAMES[this.language][now.getMonth()]
				+ " " + now.getFullYear();
		if (this.language !== "en")
			todayText = BikramSambat.prototype.digitsEnToNe(todayText);
		this.tooltipToday.set_text(todayText);

		// Setup loop to update values
		this.timeout = Mainloop.timeout_add_seconds(this.showTime ? 1 : 10, Lang.bind(this, this.updateValues));
	}
};

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}

