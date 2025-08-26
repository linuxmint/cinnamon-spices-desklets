const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const Desklet = imports.ui.desklet;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;

const UUID = "calendar@bahrampc";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(DESKLET_DIR);

const STYLE_TEXT_CENTER = "text-align: center;";
const STYLE_LABEL_DAY = "padding: 2pt, 4pt; " + STYLE_TEXT_CENTER;

// Names of the Month
var MONTHS = [
	"فروردین",
	"اردیبهشت",
	"خرداد",
	"تیر",
	"مرداد",
	"شهریور",
	"مهر",
	"آبان",
	"آذر",
	"دی",
	"بهمن",
	"اسفند"
];

// Names of the Weekdays
var WEEKDAYS = [
	"شنبه",
	"یکشنبه",
	"دوشنبه",
	"سه‌شنبه",
	"چهارشنبه",
	"پنجشنبه",
	"جمعه"
];

var WEEKDAY_NAMES = [...WEEKDAYS];

function convertToPersianNumbers(input) {
    const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return input.toString().replace(/\d/g, (digit) => persianNumbers[digit]);
}

function getPersianMonthInfo(date) {
	let sD=new Date(date),c='en-u-ca-persian-nu-latn',d=sD,gD=0,tD= 0,pD,n='numeric',
		iDay  =new Intl.DateTimeFormat(c,{day:n}).format(sD),
		iMonth=new Intl.DateTimeFormat(c,{month:'long'}).format(sD),
		iYear =new Intl.DateTimeFormat(c,{year:n}).format(sD).split(" ")[0];
	for (let i=0;i<32;i++) {
		pD= new Intl.DateTimeFormat(c,{day:n}).format(d);
		if (+pD>tD) tD=pD,gD++; else break;
		d=new Date(d.setUTCDate(d.getUTCDate()+1));
		}
	let gEndT=new Date(sD.setUTCDate(sD.getUTCDate()+gD-2));
	return [new Date(date).toISOString().split("T")[0],+iDay,iMonth,+iYear,tD,new Date(gEndT.setUTCDate(gEndT.getUTCDate()-tD+1)),new Date(gEndT)];
}

function gregorian_to_jalali(gy, gm, gd) {
  var g_d_m, jy, jm, jd, gy2, days;
  g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  gy2 = (gm > 2) ? (gy + 1) : gy;
  days = 355666 + (365 * gy) + ~~((gy2 + 3) / 4) - ~~((gy2 + 99) / 100) + ~~((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  jy = -1595 + (33 * ~~(days / 12053));
  days %= 12053;
  jy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += ~~((days - 1) / 365);
    days = (days - 1) % 365;
  }
  if (days < 186) {
    jm = 1 + ~~(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + ~~((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

// Method to return a Date (first day) after adding specified months to specified Date
function dateMonthAdd(date, add) {
	return new Date(date.getFullYear(), date.getMonth() + add, 1);
}

// Method to return the number of days in a given month of a given year
function getDaysInMonth(month, fullYear) {
	let dd = new Date(fullYear, month, 1);
	let dj = getPersianMonthInfo(dd);
	return dj[4];
}

function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function (metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

		// Initialise settings
		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "panels", "panels", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "auto-advance", "autoAdvance", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-weekday", "showWeekday", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "short-month-name", "shortMonthName", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-year", "showYear", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-time", "showTime", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-24h", "use24h", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "layout", "layout", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-font-family", "customFontFamily", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-text", "colourText", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-friday", "colourFridays", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "colour-background", "colourBackground", this.onSettingChanged);
		this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", this.onSettingChanged);

		// Date of the calendar
		this.date = new Date();

		//////// Today Panel ////////
		this.labelDay = new St.Label();
		this.labelDate = new St.Label();
		this.labelMonthYear = new St.Label();
		this.labelTime = new St.Label();

		this.boxLayoutToday = new St.BoxLayout({ vertical: true, y_align: 2 });

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
		let WEEKDAY_LIST = [...WEEKDAYS];
		WEEKDAY_NAMES = WEEKDAY_LIST;

		this.labelWeekdays = [];
		for (let i = 0; i < 7; i++) {
			this.labelWeekdays[i] = new St.Label();
			this.labelWeekdays[i].set_text(WEEKDAY_NAMES[6-i].substring(0, 1));
			this.tableMonth.add(this.labelWeekdays[i], { row: 1, col: i });
		}

		this.buttonPrevious.set_child(this.labelPrevious);
		this.buttonMonth.set_child(this.labelMonth);
		this.buttonNext.set_child(this.labelNext);

		this.buttonPrevious.connect("clicked", Lang.bind(this, function () {
			this.date = dateMonthAdd(this.date, -1);
			this.updateCalendar();
		}));
		this.buttonNext.connect("clicked", Lang.bind(this, function () {
			this.date = dateMonthAdd(this.date, 1);
			this.updateCalendar();
		}));

		this.tooltipMonth = new Tooltips.Tooltip(this.buttonMonth);
		this.tooltipPrevious = new Tooltips.Tooltip(this.buttonPrevious,
			"ماه قبل");
		this.tooltipNext = new Tooltips.Tooltip(this.buttonNext,
			"ماه بعد");

		this.tableMonth.add(this.buttonPrevious, { row: 0, col: 0 });
		this.tableMonth.add(this.buttonMonth, { row: 0, col: 1, colSpan: 5 });
		this.tableMonth.add(this.buttonNext, { row: 0, col: 6 });

		// Create buttons with labels (with tooltips) for days
		for (let i = 0; i < 31; i++) {
			this.labelDays[i] = new St.Label();
			this.labelDays[i].style = STYLE_LABEL_DAY;
			this.labelDays[i].set_text(convertToPersianNumbers(String(i + 1)));
		}

		//////// Calendar Layout ////////
		// Set Desklet header
		this.setHeader("تقویم شمسی");

		this.updateCalendar();
	},

	// Called on user clicking the desklet
	on_desklet_clicked: function (event) {
		this.date = new Date();
		this.updateCalendar();
	},

	on_desklet_removed: function () {
		this.removed = true;
		Mainloop.source_remove(this.timeout);
	},

	// Refresh on change of settings
	onSettingChanged: function () {
		if (this.timeout)
			Mainloop.source_remove(this.timeout);
		this.updateCalendar();
	},

	/* Method to update the Desklet layout*/
	updateCalendar: function () {
		let now = new Date();
		
		let gtj = gregorian_to_jalali(this.date.getFullYear(), this.date.getMonth()+1, this.date.getDate());
		let ngtj = gregorian_to_jalali(now.getFullYear(), now.getMonth()+1, now.getDate());

		let d = now.getDay();
		if (d==6){
			d=0;
		} else {
			d++;
		}
		
		this.lastUpdate = { fullYear: ngtj[0], month: ngtj[1], date: ngtj[2] };

		//////// Today Panel ////////
		this.labelDate.style = (d === 6 ? "color: " + this.colourFridays + "; " : "") + "font-size: 4em; " + STYLE_TEXT_CENTER;
		this.labelDay.style = "font-size: 1.5em;";
		this.labelMonthYear.style = "margin-bottom: 5pt; font-size: 1.2em;";
		this.labelTime.style = "font-size: 1.2em;";

		if (d === 6){
			this.labelDay.style = "color: " + (d === 0 ? this.colourFridays : this.colourFridays) + "; " + STYLE_TEXT_CENTER;
		}
		this.boxLayoutToday.remove_all_children();
		if (this.showWeekday !== "off"){
			this.boxLayoutToday.add(this.labelDay);
		}
		this.boxLayoutToday.add(this.labelDate);
		this.boxLayoutToday.add(this.labelMonthYear);
		if (this.showTime){
			this.boxLayoutToday.add(this.labelTime);
		}
		//////// Month Panel ////////
		let month = MONTHS[gtj[1]-1];
		this.labelMonth.set_text(month.substring(0, this.shortMonthName ? 3 : month.length) + " " + convertToPersianNumbers(gtj[0]));

		// Create labels for weekdays
		let WEEKDAY_LIST = [...WEEKDAYS];
		WEEKDAY_NAMES = WEEKDAY_LIST;

		for (let i = 0; i < 7; i++) {
			this.labelWeekdays[i].set_text(WEEKDAY_NAMES[6-i].substring(0, 1));
			if (this.labelWeekdays[i].get_parent())
				this.tableMonth.remove_child(this.labelWeekdays[i]);
			this.tableMonth.add(this.labelWeekdays[i], { row: 1, col: i });
		}

		let isFri;
		// Set weekday style
		for (let i = 0; i < 7; i++) {
			isFri = i === 0;
			this.labelWeekdays[i].style = STYLE_LABEL_DAY + (ngtj[2] === i ? " font-weight: bold;" : "") + (isFri ? " color: " + this.colourFridays + ";" : "");
		}

		// Remove currently added days
		for (let i = 0; i < 31; i++){
			if (this.labelDays[i].get_parent()){
				this.tableMonth.remove_child(this.labelDays[i]);
			}
		}
		let startOfWeeka = getPersianMonthInfo(new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate()));
		let startOfWeek = 5 - new Date(startOfWeeka[5]).getDay();
		startOfWeek = startOfWeek < 0 ? 6 : startOfWeek;
		let isFriday;
		for (let i = 0, row = 2, col = startOfWeek > 6 ? 0 : startOfWeek,
			monthLength = getDaysInMonth(this.date.getMonth(), this.date.getFullYear()); i < monthLength; i++) {
			this.labelDays[i].style = STYLE_LABEL_DAY;
			// Set specified colour of Sunday and Saturday
			isFriday = col === 0;
			
			if (isFriday)
				this.labelDays[i].style = this.labelDays[i].style + " color: " + this.colourFridays + ";";

			// Emphasise today's date
			if (gtj[0] == ngtj[0] && gtj[1] == ngtj[1] && ngtj[2] === i + 1)
				this.labelDays[i].style = this.labelDays[i].style + "background-color: "
					+ this.colourText + "; color: " + this.colourBackground + "; border-radius: " + (this.fontSize / 4) + "pt;";
			this.tableMonth.add(this.labelDays[i], { row: row, col: col });
			col--;
			if (col == -1) {
				row++;
				col = 6;
			}
		}
		
		this.tooltipMonth.set_text(MONTHS[gtj[1]-1] + " " + convertToPersianNumbers(gtj[0]));

		//////// Calendar Layout ////////
		if (typeof this.boxLayoutCalendar !== "undefined"){
			this.boxLayoutCalendar.remove_all_children();
		}
		this.boxLayoutCalendar = new St.BoxLayout({ vertical: this.layout !== "horizontal" });
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
			this.boxLayoutToday.style = "margin: " + (this.layout === "horizontal" ? 0 : (this.fontSize * 1.5)) + "pt, " + (this.fontSize * 2) + "pt; " + STYLE_TEXT_CENTER;

		this.setContent(this.boxLayoutCalendar);

		this.updateValues();
	},

	/* Method to update the Desklet values*/
	updateValues: function () {
		if (this.removed) {
			this.timeout = 0;
			return false;
		}

		let now = new Date();
		let ngtj = gregorian_to_jalali(now.getFullYear(), now.getMonth()+1, now.getDate());
		
		if (this.lastUpdate.fullYear !== ngtj[0] || this.lastUpdate.month !== ngtj[1] || this.lastUpdate.date !== ngtj[2]) {
			if (this.autoAdvance)
				this.date = new Date();
			this.updateCalendar();
			return;
		}

		let d = now.getDay();
		if (d==6){
			d=0;
		} else {
			d++;
		}

		//////// Today Panel ////////
		let day = WEEKDAYS[d];
		if (this.labelDay !== null)
			this.labelDay.set_text(day.substring(0, this.showWeekday !== "full" ? 3 : day.length));
		if (this.labelDate !== null)
			this.labelDate.set_text(convertToPersianNumbers(String(ngtj[2])));
		let month = MONTHS[ngtj[1]-1];
		if (this.labelMonthYear !== null)
			this.labelMonthYear.set_text(month.substring(0, this.shortMonthName ? 3 : month.length)
				+ (this.showYear !== "off" ? " " + (convertToPersianNumbers(String(ngtj[0]).substring(this.showYear !== "full" ? 2 : 0))) : ""));
		if (this.labelTime !== null) {
			let timeFormat = "%-l:%M %p";
			if (this.use24h)
				timeFormat = "%R";
			this.labelTime.set_text(convertToPersianNumbers(now.toLocaleFormat(timeFormat)));
		}

		// Setup loop to update values
		this.timeout = Mainloop.timeout_add_seconds(this.showTime ? 1 : 10, Lang.bind(this, this.updateValues));
	}
};

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}
