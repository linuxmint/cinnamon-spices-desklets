const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const Main = imports.ui.main;

function _(str) {
    let customTranslation = Gettext.dgettext("nepali-date@khumnath", str);
    if (customTranslation !== str) return customTranslation;
    return Gettext.gettext(str);
}

let NepaliCalendar;

class NepaliDateDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        global.log("Nepali Date Desklet: Starting constructor");

        this.viewMode = 'daily';
        this.displayedYear = 0;
        this.displayedMonth = 0;
        this.use_nepali_numerals = true; // Initialize default

        try {
            if (imports.searchPath.indexOf(metadata.path) === -1) {
                imports.searchPath.push(metadata.path);
            }
            Gettext.bindtextdomain("nepali-date@khumnath", metadata.path + "/locale");
            NepaliCalendar = imports.nepaliCalendar;
        } catch (e) {
            global.logError("Nepali Date Desklet: Failed to import nepaliCalendar.js: " + e);
        }

        this._setupUI();

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

            this.settings.bind("use-nepali-numerals", "use_nepali_numerals", () => this._onSettingsChanged());
            this.settings.bind("show-title", "show_title", () => this._onSettingsChanged());
            this.settings.bind("view-mode", "view_mode", () => this._onViewModeSettingsChanged());
            this.settings.bind("language", "language", () => this._onLanguageSettingsChanged());
            this.settings.bind("show-gregorian", "show_gregorian", () => this._onSettingsChanged());
            this.settings.bind("text-color", "text_color", () => this._updateStyles());
            this.settings.bind("bg-color", "bg_color", () => this._updateStyles());
            this.settings.bind("font-size", "font_size", () => this._updateStyles());
            this.settings.bind("bg-opacity", "bg_opacity", () => this._updateStyles());
            this.settings.bind("show-weekday", "show_weekday", () => this._onSettingsChanged());
            this.settings.bind("layout-style", "layout_style", () => this._onLayoutSettingsChanged());
            this.settings.bind("show-time", "show_time", () => this._onSettingsChanged());
            this.settings.bind("time-zone", "time_zone", () => this._onSettingsChanged());
            this.settings.bind("widget-scale", "widget_scale", () => this._onSettingsChanged());
            this.settings.bind("title-color", "title_color", () => this._onSettingsChanged());
            this.settings.bind("date-color", "date_color", () => this._onSettingsChanged());
            this.settings.bind("month-color", "month_color", () => this._onSettingsChanged());
            this.settings.bind("weekday-color", "weekday_color", () => this._onSettingsChanged());
            this.settings.bind("today-bg-color", "today_bg_color", () => this._onSettingsChanged());
            this.settings.bind("time-color", "time_color", () => this._onSettingsChanged());

            this.viewMode = this.view_mode || 'daily';
        } catch (e) {
            global.logError("Nepali Date Desklet: Failed to bind settings: " + e);
        }

        this._applyViewMode();
        this._updateDate();
        this._updateStyles();
        this._onSettingsChanged();


        this.actor.reactive = true;
        this.actor.connect('button-release-event', (actor, event) => {
            if (event.get_button() === 1) {
                this._toggleView();
                return true;
            }
            return false;
        });
    }

    _setupUI() {
        this.container = new St.BoxLayout({
            vertical: true,
            style_class: "nepali-date-container",
            reactive: true,
            can_focus: true
        });

        // Daily View Elements
        this.dailyBox = new St.BoxLayout({ vertical: true });
        this.titleLabel = new St.Label({ text: _("Today's Date"), style_class: "nepali-date-title" });
        this.weekdayLabel = new St.Label({ style_class: "nepali-date-weekday" });
        this.dateLabel = new St.Label({ style_class: "nepali-date-main" });
        this.monthLabel = new St.Label({ style_class: "nepali-date-month" });
        this.timeLabel = new St.Label({ style_class: "nepali-date-time" });
        this.timeLabel.clutter_text.line_wrap = true;
        this.gregorianLabel = new St.Label({ style_class: "nepali-date-gregorian" });

        this.dailyBox.add_actor(this.titleLabel);
        this.dailyBox.add_actor(this.weekdayLabel);
        this.dailyBox.add_actor(this.dateLabel);
        this.dailyBox.add_actor(this.monthLabel);
        this.dailyBox.add_actor(this.timeLabel);
        this.dailyBox.add_actor(this.gregorianLabel);

        // Calendar View Elements
        this.calendarBox = new St.BoxLayout({ vertical: true, style_class: "calendar-box" });

        this.calHeader = new St.BoxLayout({
            vertical: false,
            style_class: "calendar-header",
            x_align: St.Align.MIDDLE,
            x_expand: true
        });
        this.prevMonthBtn = new St.Button({ label: " \u2BC7 ", style_class: "calendar-nav-button" });
        this.nextMonthBtn = new St.Button({ label: " \u2BC8 ", style_class: "calendar-nav-button" });
        this.jumpBtn = new St.Button({ label: " \ud83d\uddd3 ", style_class: "calendar-nav-button" }); // Calendar icon

        this.monthLabelBtn = new St.Button({ style_class: "calendar-nav-button" });
        this.monthLabelText = new St.Label({ style_class: "calendar-month-label" });
        this.monthLabelBtn.set_child(this.monthLabelText);

        this.calHeader.add_actor(this.prevMonthBtn);
        this.calHeader.add_actor(this.monthLabelBtn);
        this.calHeader.add_actor(this.jumpBtn);
        this.calHeader.add_actor(this.nextMonthBtn);

        this.prevMonthBtn.connect('clicked', () => this._prevMonth());
        this.nextMonthBtn.connect('clicked', () => this._nextMonth());
        this.jumpBtn.connect('clicked', () => this._toggleJumpBox());
        this.monthLabelBtn.connect('clicked', () => {
            this._resetNavigation();
            this._updateDate();
        });

        this.calGrid = new St.BoxLayout({ vertical: true });

        // Jump Box (Hidden by default)
        this.jumpBox = new St.BoxLayout({ vertical: true, style_class: "calendar-jump-box", visible: false });
        this._setupJumpBox();

        this.calendarBox.add_actor(this.calHeader);
        this.calendarBox.add_actor(this.jumpBox);
        this.calendarBox.add_actor(this.calGrid);

        this.container.add_actor(this.dailyBox);
        this.container.add_actor(this.calendarBox);

        this.setContent(this.container);
        this.setHeader(_("Nepali Date"));
    }

    _onViewModeSettingsChanged() {
        this.viewMode = this.view_mode;
        this._resetNavigation();
        this._applyViewMode();
        this._updateDate();
    }

    _onLanguageSettingsChanged() {
        const useNepali = this.language === 'nepali';
        this.settings.setValue("use-nepali-numerals", useNepali);
        this._onSettingsChanged();
    }

    _resetNavigation() {
        if (!NepaliCalendar || !NepaliCalendar.calendar) return;
        const now = new Date();
        const bsDate = NepaliCalendar.calendar.toBikramSambat(now);
        if (bsDate) {
            this.displayedYear = bsDate.year;
            this.displayedMonth = bsDate.monthIndex;
        }
    }

    _applyViewMode() {
        this.container.remove_all_children();
        this.dailyBox.style = "";
        this.calendarBox.style = "";

        if (this.viewMode === 'daily') {
            this.container.vertical = true;
            this.container.add_actor(this.dailyBox);
            this.dailyBox.show();
        } else if (this.viewMode === 'calendar') {
            this.container.vertical = true;
            this.container.add_actor(this.calendarBox);
            this.calendarBox.show();
        } else if (this.viewMode === 'full') {
            this.dailyBox.show();
            this.calendarBox.show();
            if (this.layout_style === 'top') {
                this.container.vertical = true;
                this.container.add_actor(this.dailyBox);
                this.container.add_actor(this.calendarBox);
            } else if (this.layout_style === 'left') {
                this.container.vertical = false;
                this.container.add_actor(this.dailyBox);
                this.container.add_actor(this.calendarBox);
                this.dailyBox.style = "margin-right: 20px;";
            } else if (this.layout_style === 'right') {
                this.container.vertical = false;
                this.container.add_actor(this.calendarBox);
                this.container.add_actor(this.dailyBox);
                this.dailyBox.style = "margin-left: 20px;";
            }
        }
    }

    _onLayoutSettingsChanged() {
        this._applyViewMode();
        this._updateDate();
    }

    _prevMonth() {
        if (this.displayedMonth === 0) {
            if (this.displayedYear > NepaliCalendar.calendar.startYear) {
                this.displayedYear--;
                this.displayedMonth = 11;
            }
        } else {
            this.displayedMonth--;
        }
        this._updateDate();
    }

    _nextMonth() {
        const maxYear = NepaliCalendar.calendar.startYear + NepaliCalendar.calendar.monthData.length - 1;
        if (this.displayedMonth === 11) {
            if (this.displayedYear < maxYear) {
                this.displayedYear++;
                this.displayedMonth = 0;
            }
        } else {
            this.displayedMonth++;
        }
        this._updateDate();
    }

    _toggleView() {
        if (this.viewMode === 'daily') this.viewMode = 'calendar';
        else if (this.viewMode === 'calendar') this.viewMode = 'full';
        else this.viewMode = 'daily';

        this._applyViewMode();
        this._updateDate();
    }

    _onSettingsChanged() {
        if (this.gregorianLabel) {
            if (this.show_gregorian) this.gregorianLabel.show();
            else this.gregorianLabel.hide();
        }
        if (this.titleLabel) {
            if (this.show_title) this.titleLabel.show();
            else this.titleLabel.hide();
        }
        if (this.weekdayLabel) {
            if (this.show_weekday) this.weekdayLabel.show();
            else this.weekdayLabel.hide();
        }
        if (this.timeLabel) {
            if (this.show_time) this.timeLabel.show();
            else this.timeLabel.hide();
        }
        if (this.jumpBox) {
            this.jumpBox.destroy_all_children();
            this._setupJumpBox();
        }
        this._updateStyles();
        this._updateDate();
    }

    _updateStyles() {
        if (!this.container) return;

        // Force transparency on the main actor to remove any theme-provided backgrounds/borders
        this.actor.set_style("background-color: transparent; border: none; box-shadow: none;");

        // Handle background color and opacity
        let color = this.bg_color;
        let opacity = this.bg_opacity / 100;
        let bgColor = color;

        if (color.startsWith('#')) {
            // Very basic hex to rgba conversion
            let r = parseInt(color.slice(1, 3), 16);
            let g = parseInt(color.slice(3, 5), 16);
            let b = parseInt(color.slice(5, 7), 16);
            bgColor = `rgba(${r},${g},${b},${opacity})`;
        } else if (color.startsWith('rgba')) {
            // Replace the alpha value in rgba(r,g,b,a)
            bgColor = color.replace(/[^,]+(?=\))/, opacity);
        } else if (color.startsWith('rgb')) {
            // Convert rgb to rgba
            bgColor = color.replace('rgb', 'rgba').replace(')', ',' + opacity + ')');
        }

        const scaledFontSize = this.font_size * this.widget_scale;
        const scaledPadding = 15 * this.widget_scale;
        const scaledRadius = 15 * this.widget_scale;

        let style = `color: ${this.text_color}; background-color: ${bgColor}; font-size: ${scaledFontSize}pt; padding: ${scaledPadding}px; border-radius: ${scaledRadius}px;`;

        // Dynamic border based on opacity
        if (opacity > 0) {
            style += " border: 1px solid rgba(255, 255, 255, " + (opacity * 0.2) + ");";
        } else {
            style += " border: none;";
        }

        this.container.set_style(style);
    }

    _updateDate() {
        if (!NepaliCalendar || !NepaliCalendar.calendar) return;

        try {
            const now = new Date();
            const bsDate = NepaliCalendar.calendar.toBikramSambat(now);

            if (this.displayedYear === 0) {
                this.displayedYear = bsDate.year;
                this.displayedMonth = bsDate.monthIndex;
            }

            if (this.viewMode === 'daily') {
                this._updateDailyView(bsDate, now);
            } else if (this.viewMode === 'calendar') {
                this._updateCalendarView(bsDate, now);
            } else if (this.viewMode === 'full') {
                this._updateDailyView(bsDate, now);
                this._updateCalendarView(bsDate, now);
            }

            this._updateTime(now);

            let nextUpdate = this.show_time ? 10 : (3600 - (now.getMinutes() * 60 + now.getSeconds()));
            if (this._timeout) Mainloop.source_remove(this._timeout);
            this._timeout = Mainloop.timeout_add_seconds(nextUpdate, () => this._updateDate());
        } catch (e) {
            global.logError("Nepali Date Desklet: Update Date Error: " + e);
        }
    }

    _updateTime(now) {
        if (!this.show_time) return;

        let displayNow = now;
        if (this.time_zone === 'nepal') {
            // Nepal is UTC+5:45
            let utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            displayNow = new Date(utc + (3600000 * 5.75));
        }

        let hours = displayNow.getHours();
        let minutes = displayNow.getMinutes();

        let ampm, tzStr;
        if (this.language === 'english') {
            ampm = hours >= 12 ? 'PM' : 'AM';
            tzStr = this.time_zone === 'nepal' ? '(Nepal)' : '(Local)';
        } else {
            ampm = hours >= 12 ? 'अपराह्न' : 'पूर्वाह्न';
            tzStr = this.time_zone === 'nepal' ? '(नेपाल)' : '(स्थानीय)';
        }

        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;

        let timeStr = hours + ':' + minutes + '\n' + ampm + ' ' + tzStr;
        this.timeLabel.set_text(this._num(timeStr));
        this.timeLabel.style = `color: ${this.time_color};`;
    }

    _num(n) {
        let useNepali = (this.use_nepali_numerals === true || this.use_nepali_numerals === "true");
        let result = useNepali ? NepaliCalendar.calendar.toDevanagari(n) : n.toString();
        return result;
    }

    _updateDailyView(bsDate, now) {
        if (bsDate) {
            const isEnglish = this.language === 'english';
            const dayNames = isEnglish ? NepaliCalendar.calendar.daysEn : NepaliCalendar.calendar.days;
            const monthName = isEnglish ? NepaliCalendar.calendar.monthsEn[bsDate.monthIndex] : bsDate.monthName;

            this.titleLabel.set_text(_("Today's Date"));
            this.weekdayLabel.set_text(dayNames[now.getDay()]);
            this.dateLabel.set_text(this._num(bsDate.day));
            this.monthLabel.set_text(monthName + " " + this._num(bsDate.year));

            this.titleLabel.style = `color: ${this.title_color};`;
            this.weekdayLabel.style = `color: ${this.month_color}; opacity: 0.8;`;
            this.dateLabel.style = `color: ${this.date_color};`;
            this.monthLabel.style = `color: ${this.month_color};`;
        } else {
            this.dateLabel.set_text(_("N/A"));
            this.monthLabel.set_text(_("Out of Range"));
        }

        if (this.show_gregorian) {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            this.gregorianLabel.set_text(now.toLocaleDateString(undefined, options));
        }
    }

    _updateCalendarView(bsDate, now) {
        if (!bsDate) return;

        const isEnglish = this.language === 'english';
        const monthName = isEnglish ? NepaliCalendar.calendar.monthsEn[this.displayedMonth] : NepaliCalendar.calendar.months[this.displayedMonth];
        this.monthLabelText.set_text(monthName + " " + this._num(this.displayedYear));
        this.monthLabelText.style = `color: ${this.month_color};`;
        this.calGrid.destroy_all_children();

        const dayHeaders = isEnglish ? NepaliCalendar.calendar.daysShortEn : NepaliCalendar.calendar.daysShort;
        let headerRow = new St.BoxLayout({ vertical: false });

        const cellWidth = 35 * this.widget_scale;
        const cellHeight = 30 * this.widget_scale;
        const headerStyle = `width: ${cellWidth}px;`;
        const dayStyle = `width: ${cellWidth}px; height: ${cellHeight}px;`;

        headerRow.style = `margin-bottom: ${8 * this.widget_scale}px;`;

        for (let i = 0; i < 7; i++) {
            let headerBin = new St.Bin({
                style: headerStyle + `color: ${this.weekday_color};`,
                x_align: St.Align.MIDDLE,
                y_align: St.Align.MIDDLE
            });
            headerBin.set_child(new St.Label({
                text: dayHeaders[i],
                style_class: "calendar-day-header"
            }));
            headerRow.add_actor(headerBin);
        }
        this.calGrid.add_actor(headerRow);

        const firstOfMonthAD = NepaliCalendar.calendar.fromBikramSambat(this.displayedYear, this.displayedMonth, 1);
        if (!firstOfMonthAD) return;

        const startDay = firstOfMonthAD.getUTCDay();
        const daysInMonth = NepaliCalendar.calendar.monthData[this.displayedYear - NepaliCalendar.calendar.startYear][this.displayedMonth];

        let curDay = 1;
        for (let r = 0; r < 6; r++) {
            let rowBox = new St.BoxLayout({ vertical: false });
            for (let c = 0; c < 7; c++) {
                if (r === 0 && c < startDay) {
                    rowBox.add_actor(new St.Bin({ style: dayStyle }));
                    continue;
                }
                if (curDay > daysInMonth) {
                    rowBox.add_actor(new St.Bin({ style: dayStyle }));
                } else {
                    let styleClass = "calendar-day-num";
                    let currentDayStyle = dayStyle;
                    let labelStyle = "";

                    // Only highlight today if we are viewing the current year and month
                    if (this.displayedYear === bsDate.year && this.displayedMonth === bsDate.monthIndex && curDay === bsDate.day) {
                        styleClass += " calendar-day-today";
                        const scaledTodayRadius = 5 * this.widget_scale;
                        currentDayStyle += `background-color: ${this.today_bg_color}; border-radius: ${scaledTodayRadius}px;`;
                        labelStyle = `color: ${this.today_text_color};`;
                    }

                    let cellBin = new St.Bin({
                        style_class: styleClass,
                        style: currentDayStyle,
                        x_align: St.Align.MIDDLE,
                        y_align: St.Align.MIDDLE
                    });

                    let dayLabel = new St.Label({
                        text: this._num(curDay),
                        style: labelStyle
                    });

                    cellBin.set_child(dayLabel);
                    rowBox.add_actor(cellBin);
                    curDay++;
                }
            }
            this.calGrid.add_actor(rowBox);
            if (curDay > daysInMonth) break;
        }
    }

    on_desklet_removed() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
    }

    _toggleJumpBox() {
        this.jumpBox.visible = !this.jumpBox.visible;
        this.calGrid.visible = !this.jumpBox.visible;
        if (this.jumpBox.visible) {
            this.yearEntry.set_text(this.displayedYear.toString());
        }
    }

    _setupJumpBox() {
        const isEnglish = this.language === 'english';

        let yearBox = new St.BoxLayout({ vertical: false, style: "margin-bottom: 10px;" });
        yearBox.add_actor(new St.Label({ text: _("Year: "), y_align: St.Align.MIDDLE }));
        this.yearEntry = new St.Entry({
            style_class: "calendar-year-entry",
            can_focus: true,
            hint_text: "2080"
        });
        yearBox.add_actor(this.yearEntry);
        this.jumpBox.add_actor(yearBox);

        let monthGrid = new St.BoxLayout({ vertical: true });
        const monthNames = isEnglish ? NepaliCalendar.calendar.monthsEn : NepaliCalendar.calendar.months;

        for (let r = 0; r < 3; r++) {
            let row = new St.BoxLayout({ vertical: false });
            for (let c = 0; c < 4; c++) {
                let mIdx = r * 4 + c;
                let mBtn = new St.Button({
                    label: monthNames[mIdx],
                    style_class: "calendar-month-selector-btn",
                    x_expand: true
                });
                mBtn.connect('clicked', () => {
                    let year = parseInt(this.yearEntry.get_text());
                    if (isNaN(year) || year < NepaliCalendar.calendar.startYear || year >= NepaliCalendar.calendar.startYear + NepaliCalendar.calendar.monthData.length) {
                        return;
                    }
                    this.displayedYear = year;
                    this.displayedMonth = mIdx;
                    this._toggleJumpBox();
                    this._updateDate();
                });
                row.add_actor(mBtn);
            }
            monthGrid.add_actor(row);
        }
        this.jumpBox.add_actor(monthGrid);
    }
}

function main(metadata, desklet_id) {
    return new NepaliDateDesklet(metadata, desklet_id);
}
