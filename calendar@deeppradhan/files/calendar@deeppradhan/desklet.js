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

const UUID = "calendar@deeppradhan";

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

let Calendar = typeof require !== "undefined" ? require("./calendar") : imports.ui.deskletManager.desklets[UUID].calendar;

const STYLE_TEXT_CENTER = "text-align: center;";
const STYLE_LABEL_DAY = "padding: 0, 1.5pt; " + STYLE_TEXT_CENTER;


function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

		// Initialise settings
		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "panels", "panels", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-weekday", "showWeekday", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "short-month-name", "shortMonthName", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-year", "showYear", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-time", "showTime", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "layout", "layout", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-font-family", "customFontFamily", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-text", "colourText", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-saturdays", "colourSaturdays", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-sundays", "colourSundays", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-background", "colourBackground", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", this.onSettingChanged);

		// Date of the calendar
		this.date = new Date();

		//////// Today Panel ////////
		this.labelDay = new St.Label();
		this.labelDate = new St.Label();
		this.labelMonthYear = new St.Label();
		this.labelTime = new St.Label();

		this.boxLayoutToday = new St.BoxLayout({vertical: true, y_align: 2});

		this.labelDay.style = this.labelMonthYear.style = this.labelTime.style = STYLE_TEXT_CENTER;

		//////// Month Panel ////////
		this.buttonPrevious = new St.Button();
		this.buttonNext = new St.Button();
		this.buttonMonth = new St.Button();

		this.labelPrevious = new St.Label();
		this.labelNext = new St.Label();
		this.labelMonth = new St.Label();
		this.labelDays = [];

		this.tableMonth = new St.Table();

		this.labelPrevious.style = "text-align: left;";
		this.labelPrevious.set_text("\u2BC7");
		this.labelNext.style = "text-align: right;";
		this.labelNext.set_text("\u2BC8");
		this.labelMonth.style = STYLE_LABEL_DAY + " font-weight: bold;";

		// Create labels for weekdays
		this.labelWeekdays = [];
		for (let i = 0; i < 7; i++) {
			this.labelWeekdays[i] = new St.Label();
			this.labelWeekdays[i].set_text(Calendar.WEEKDAY_NAMES[i].substring(0, 1));
			this.tableMonth.add(this.labelWeekdays[i], {row: 1, col: i});
		}

		this.buttonPrevious.set_child(this.labelPrevious);
		this.buttonMonth.set_child(this.labelMonth);
		this.buttonNext.set_child(this.labelNext);

		this.buttonPrevious.connect("clicked", Lang.bind(this, function() {
			this.date = Calendar.dateMonthAdd(this.date, -1);
			this.updateCalendar();
		}));
		this.buttonNext.connect("clicked", Lang.bind(this, function() {
			this.date = Calendar.dateMonthAdd(this.date, 1);
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
		for (let i = 0; i < 31; i++) {
			this.labelDays[i] = new St.Label();
			this.labelDays[i].style = STYLE_LABEL_DAY;
			this.labelDays[i].set_text(String(i + 1));
		}

		//////// Calendar Layout ////////
		// Set Desklet header
		this.setHeader("Calendar");

		this.updateCalendar();
	},

	// Called on user clicking the desklet
	on_desklet_clicked: function(event) {
		this.date = new Date();
		this.updateCalendar();
	},
	
	on_desklet_removed: function() {
		this.removed = true;
		Mainloop.source_remove(this.timeout);
	},
	
	// Refresh on change of settings
	onSettingChanged: function() {
		if (this.timeout)
			Mainloop.source_remove(this.timeout);
		this.updateCalendar();
	},

	/* Method to update the Desklet layout*/
	updateCalendar: function() {

		let now = new Date();

		this.lastUpdate = { fullYear: now.getFullYear(), month: now.getMonth(), date: now.getDate()};

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
		this.labelMonth.set_text(Calendar.MONTH_NAMES[this.date.getMonth()].substring(0, 3) + " " + this.date.getFullYear());

		// Set weekday style
		for (let i = 0; i < 7; i++)
			this.labelWeekdays[i].style = STYLE_LABEL_DAY + (this.date.getFullYear() == now.getFullYear()
					&& this.date.getMonth() == now.getMonth() && i == now.getDay() ?
					" font-weight: bold;" : "") + (i === 0 ? " color: " + this.colourSundays + ";" : "")
					+ (i === 6 ? " color: " + this.colourSaturdays + ";" : "");

		// Remove currently added days
		for (let i = 0; i < 31; i++)
			if (this.labelDays[i].get_parent())
				this.tableMonth.remove_child(this.labelDays[i]);

		for (let i = 0, row = 2, col = (new Date(this.date.getFullYear(), this.date.getMonth(), 1)).getDay(),
				monthLength = Calendar.daysInMonth(this.date.getMonth(), this.date.getFullYear()); i < monthLength; i++) {
			this.labelDays[i].style = STYLE_LABEL_DAY;
			// Set specified colour of Sunday and Saturday
			if (col === 0)
				this.labelDays[i].style = this.labelDays[i].style + " color: " + this.colourSundays + ";";
			else if (col === 6)
				this.labelDays[i].style = this.labelDays[i].style + " color: " + this.colourSaturdays + ";";

			// Emphasise today's date 
			if (this.date.getFullYear() == now.getFullYear() && this.date.getMonth() == now.getMonth()
					&& i + 1 === now.getDate())
				this.labelDays[i].style = this.labelDays[i].style + "background-color: "
						+ this.colourText + "; color: " + this.colourBackground
						+ "; border-radius: " + (this.fontSize / 4) + "pt;";
			this.tableMonth.add(this.labelDays[i], {row: row, col: col});
			col++;
			if (col > 6) {
				row++;
				col = 0;
			}
		}
		this.tooltipMonth.set_text(Calendar.MONTH_NAMES[this.date.getMonth()] + " " + this.date.getFullYear());

		//////// Calendar Layout ////////
		if (typeof this.boxLayoutCalendar !== "undefined")
			this.boxLayoutCalendar.remove_all_children();
		this.boxLayoutCalendar = new St.BoxLayout({vertical: this.layout !== "horizontal"});
		this.boxLayoutCalendar.style = "background-color: " + (this.colourBackground.replace(")", ","
				+ (1 - this.transparency / 100) + ")")).replace('rgb', 'rgba')
				+ "; border-radius: " + (this.fontSize / 3 * 2) + "pt; color: " + this.colourText + ";"
				+ (this.customFontFamily !== "" ? " font-family: '" + this.customFontFamily + "';" : "")
				+ " font-size: " + this.fontSize + "pt; padding: " + (this.fontSize / 3 * 2) + "pt; text-shadow: 1px 1px 2px #000;";
		if (this.panels === "both" || this.panels === "today")
			this.boxLayoutCalendar.add_actor(this.boxLayoutToday);
		if (this.panels === "both" || this.panels === "month")
			this.boxLayoutCalendar.add_actor(this.tableMonth);
		if (this.panels === "both")
			this.boxLayoutToday.style = "margin-" + (this.layout === "horizontal" ? "right" : "bottom")
					+ ": " + (this.fontSize / 2) + "pt;";
		
		this.setContent(this.boxLayoutCalendar);

		this.updateValues();
	},

	/* Method to update the Desklet values*/
	updateValues: function() {

		if (this.removed) {
			this.timeout = 0;
			return false;
		}

		let now = new Date();

		if (this.lastUpdate.fullYear !== now.getFullYear() || this.lastUpdate.month !== now.getMonth() || this.lastUpdate.date !== now.getDate()) {
			this.updateCalendar();
			return;
		}

		//////// Today Panel ////////
		this.labelDay.set_text(Calendar.WEEKDAY_NAMES[now.getDay()].substring(0, this.showWeekday !== "full" ? 3 : 9));
		this.labelDate.set_text(String(now.getDate()));
		this.labelMonthYear.set_text(Calendar.MONTH_NAMES[now.getMonth()].substring(0, this.shortMonthName ? 3 : 9)
				+ (this.showYear !== "off" ? " " + (String(now.getFullYear()).substring(this.showYear !== "full" ? 2 : 0)) : ""));
		this.labelTime.set_text(Calendar.zeroPad(now.getHours()) + ":"
				+ Calendar.zeroPad(now.getMinutes()));

		// Setup loop to update values
		this.timeout = Mainloop.timeout_add_seconds(this.showTime ? 1 : 10, Lang.bind(this, this.updateValues));
	}
};

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}
