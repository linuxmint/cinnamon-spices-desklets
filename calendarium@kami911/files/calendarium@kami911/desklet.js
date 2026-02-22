/*
 * Calendarium — A rich calendar and astronomical information desklet
 * for the Cinnamon Desktop.
 *
 * UUID: calendarium@kami911
 * Author: kami911 <kami911@gmail.com>
 * License: GPL-3.0
 *
 * Features (all individually toggleable):
 *   • Date display with selectable/custom strftime format
 *   • Time (12h/24h, optional seconds)
 *   • Calendar progress: day of year, ISO week number, month progress
 *   • Traditional/historical month names (hu/en/de)
 *   • Moon phase (local Julian-date algorithm)
 *   • Sunrise & sunset (NOAA simplified, local calculation)
 *   • Western and Chinese zodiac
 *   • Days until New Year countdown
 *   • Name days with lookahead (local JSON datasets)
 *   • Optional Wikipedia features (births/deaths, article of the day)
 *   • Accessibility: accessible names + hover tooltips on all icon labels
 *   • Configurable icon/symbol size (small / medium / large)
 */

const Desklet  = imports.ui.desklet;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const Mainloop = imports.mainloop;
const Lang     = imports.lang;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Gettext  = imports.gettext;

// ── UUID and paths ────────────────────────────────────────────────────────
const UUID        = "calendarium@kami911";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
const DATA_DIR    = DESKLET_DIR + "/data/namedays";

// Make lib/ modules importable
imports.searchPath.push(DESKLET_DIR + "/lib");

// ── Gettext ───────────────────────────────────────────────────────────────
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
function _(str) {
    if (!str) return "";
    return Gettext.dgettext(UUID, str);
}

// ── Local modules ─────────────────────────────────────────────────────────
const Moon         = imports.moon.Moon;
const Sun          = imports.sun.Sun;
const Zodiac       = imports.zodiac.Zodiac;
const Localization = imports.localization.Localization;
const Namedays     = imports.namedays.Namedays;
const Wikipedia    = imports.wikipedia.Wikipedia;

// ── Default location: Budapest, Hungary ───────────────────────────────────
const DEFAULT_LAT = 47.4979;
const DEFAULT_LON = 19.0402;

// ── Desklet class ─────────────────────────────────────────────────────────

function CalendariumDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new CalendariumDesklet(metadata, desklet_id);
}

CalendariumDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    // ── Initialisation ────────────────────────────────────────────────────

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._timeout      = null;
        this._clockTimeout = null;
        this._namedayData  = null;
        this._isDestroyed  = false;

        this._bindAllSettings(desklet_id);
        this._loadNamedayData();
        this._setupUI();
    },

    _bindAllSettings: function(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let s  = this.settings;
        let IN = Settings.BindingDirection.IN;
        let cb = Lang.bind(this, this._onSettingChanged);

        // Date & Time
        s.bindProperty(IN, "show-date",          "show_date",          cb);
        s.bindProperty(IN, "date-format-preset", "date_format_preset", cb);
        s.bindProperty(IN, "date-format-custom", "date_format_custom", cb);
        s.bindProperty(IN, "show-time",          "show_time",          cb);
        s.bindProperty(IN, "time-format",        "time_format",        cb);
        s.bindProperty(IN, "show-seconds",       "show_seconds",       cb);

        // Calendar progress
        s.bindProperty(IN, "show-day-of-year",    "show_day_of_year",    cb);
        s.bindProperty(IN, "show-week-number",    "show_week_number",    cb);
        s.bindProperty(IN, "show-month-progress", "show_month_progress", cb);

        // Traditional month names
        s.bindProperty(IN, "show-traditional", "show_traditional", cb);
        s.bindProperty(IN, "traditional-lang", "traditional_lang", cb);

        // Moon
        s.bindProperty(IN, "show-moon",      "show_moon",      cb);
        s.bindProperty(IN, "show-moon-name", "show_moon_name", cb);
        s.bindProperty(IN, "show-moon-age",  "show_moon_age",  cb);

        // Sun
        s.bindProperty(IN, "show-sun", "show_sun", cb);

        // Location
        s.bindProperty(IN, "use-manual-location", "use_manual_location", cb);
        s.bindProperty(IN, "latitude",             "latitude",            cb);
        s.bindProperty(IN, "longitude",            "longitude",           cb);
        s.bindProperty(IN, "city1-name", "city1_name", cb);
        s.bindProperty(IN, "city1-lat",  "city1_lat",  cb);
        s.bindProperty(IN, "city1-lon",  "city1_lon",  cb);
        s.bindProperty(IN, "city2-name", "city2_name", cb);
        s.bindProperty(IN, "city2-lat",  "city2_lat",  cb);
        s.bindProperty(IN, "city2-lon",  "city2_lon",  cb);
        s.bindProperty(IN, "city3-name", "city3_name", cb);
        s.bindProperty(IN, "city3-lat",  "city3_lat",  cb);
        s.bindProperty(IN, "city3-lon",  "city3_lon",  cb);

        // Zodiac
        s.bindProperty(IN, "show-western-zodiac", "show_western_zodiac", cb);
        s.bindProperty(IN, "show-chinese-zodiac", "show_chinese_zodiac", cb);

        // Name days
        s.bindProperty(IN, "show-namedays",     "show_namedays",     cb);
        s.bindProperty(IN, "nameday-locale",    "nameday_locale",    cb);
        s.bindProperty(IN, "nameday-lookahead", "nameday_lookahead", cb);

        // New Year
        s.bindProperty(IN, "show-new-year-countdown", "show_new_year_countdown", cb);

        // Wikipedia (online)
        s.bindProperty(IN, "show-wikipedia",     "show_wikipedia",     cb);
        s.bindProperty(IN, "wikipedia-lang",     "wikipedia_lang",     cb);
        s.bindProperty(IN, "show-wiki-births",   "show_wiki_births",   cb);
        s.bindProperty(IN, "show-wiki-deaths",   "show_wiki_deaths",   cb);
        s.bindProperty(IN, "show-wiki-featured", "show_wiki_featured", cb);

        // Appearance
        s.bindProperty(IN, "icon-size",        "icon_size",        cb);
        s.bindProperty(IN, "text-scale",       "text_scale",       cb);
        s.bindProperty(IN, "hide-decorations", "hide_decorations", cb);
    },

    _loadNamedayData: function() {
        this._namedayData = Namedays.loadData(DATA_DIR, this.nameday_locale);
    },

    // ── UI construction ───────────────────────────────────────────────────

    _setupUI: function() {
        this._container = new St.BoxLayout({
            vertical:    true,
            style_class: "calendarium-container"
        });

        // ── Date ──────────────────────────────────────────────────────────
        this._labelDate = new St.Label({
            style_class: "calendarium-date",
            text: ""
        });
        this._labelDate.accessible_name = _("Current date");
        this._container.add_actor(this._labelDate);

        // ── Time ──────────────────────────────────────────────────────────
        this._labelTime = new St.Label({
            style_class: "calendarium-time",
            text: ""
        });
        this._labelTime.accessible_name = _("Current time");
        this._container.add_actor(this._labelTime);

        // ── Calendar progress ─────────────────────────────────────────────
        this._progressRow = new St.BoxLayout({
            vertical:    false,
            style_class: "calendarium-progress-row"
        });

        this._labelDayOfYear = new St.Label({
            reactive:    true,
            style_class: "calendarium-progress",
            text:        ""
        });
        this._dayOfYearTooltip = new Tooltips.Tooltip(
            this._labelDayOfYear, _("Day of year")
        );

        this._labelWeekNumber = new St.Label({
            reactive:    true,
            style_class: "calendarium-progress",
            text:        ""
        });
        this._weekNumberTooltip = new Tooltips.Tooltip(
            this._labelWeekNumber, _("Week number")
        );

        this._labelMonthProgress = new St.Label({
            reactive:    true,
            style_class: "calendarium-progress",
            text:        ""
        });
        this._monthProgressTooltip = new Tooltips.Tooltip(
            this._labelMonthProgress, _("Month progress")
        );

        this._progressRow.add_actor(this._labelDayOfYear);
        this._progressRow.add_actor(this._labelWeekNumber);
        this._progressRow.add_actor(this._labelMonthProgress);
        this._container.add_actor(this._progressRow);

        // ── Traditional month name ─────────────────────────────────────────
        this._labelTraditional = new St.Label({
            style_class: "calendarium-traditional",
            text:        ""
        });
        this._container.add_actor(this._labelTraditional);

        // ── Moon phase ────────────────────────────────────────────────────
        // Symbol, name, and age in a horizontal row.
        this._moonRow = new St.BoxLayout({
            vertical:    false,
            style_class: "calendarium-moon-row"
        });

        this._labelMoonIcon = new St.Label({ reactive: true, text: "" });
        this._labelMoonIcon.accessible_name = _("Moon phase");
        this._moonTooltip = new Tooltips.Tooltip(this._labelMoonIcon, "");

        this._labelMoonText = new St.Label({
            style_class: "calendarium-moon",
            text:        ""
        });

        this._labelMoonAge = new St.Label({
            reactive:    true,
            style_class: "calendarium-moon-age",
            text:        ""
        });
        this._moonAgeTooltip = new Tooltips.Tooltip(this._labelMoonAge, "");

        this._moonRow.add_actor(this._labelMoonIcon);
        this._moonRow.add_actor(this._labelMoonText);
        this._moonRow.add_actor(this._labelMoonAge);
        this._container.add_actor(this._moonRow);

        // ── Sunrise & sunset ───────────────────────────────────────────────
        this._sunRow = new St.BoxLayout({
            vertical:    false,
            style_class: "calendarium-sun-row"
        });

        this._labelSunrise = new St.Label({
            reactive:    true,
            style_class: "calendarium-sun",
            text:        ""
        });
        this._labelSunrise.accessible_name = _("Sunrise");
        this._sunriseTooltip = new Tooltips.Tooltip(this._labelSunrise, _("Sunrise"));

        this._labelSunset = new St.Label({
            reactive:    true,
            style_class: "calendarium-sun",
            text:        ""
        });
        this._labelSunset.accessible_name = _("Sunset");
        this._sunsetTooltip = new Tooltips.Tooltip(this._labelSunset, _("Sunset"));

        this._sunRow.add_actor(this._labelSunrise);
        this._sunRow.add_actor(this._labelSunset);
        this._container.add_actor(this._sunRow);

        // Additional cities (up to 3 rows: name + sunrise + sunset)
        this._labelCity = [];
        for (let i = 0; i < 3; i++) {
            let row = new St.BoxLayout({
                vertical:    false,
                style_class: "calendarium-city-row"
            });
            let nm = new St.Label({ style_class: "calendarium-city-name", text: "" });
            let sr = new St.Label({ style_class: "calendarium-city", text: "" });
            let ss = new St.Label({ style_class: "calendarium-city", text: "" });
            sr.accessible_name = _("Sunrise");
            ss.accessible_name = _("Sunset");
            row.add_actor(nm);
            row.add_actor(sr);
            row.add_actor(ss);
            this._labelCity.push({ row: row, name: nm, sunrise: sr, sunset: ss });
            this._container.add_actor(row);
        }

        // ── Zodiac (western + chinese in one row) ─────────────────────────
        this._zodiacRow = new St.BoxLayout({
            vertical:    false,
            style_class: "calendarium-zodiac-row"
        });

        // Western sub-layout (icon + text)
        this._zodiacWesternPart = new St.BoxLayout({ vertical: false });

        this._labelZodiacWesternIcon = new St.Label({ reactive: true, text: "" });
        this._labelZodiacWesternIcon.accessible_name = _("Western zodiac");
        this._zodiacWesternTooltip = new Tooltips.Tooltip(
            this._labelZodiacWesternIcon, ""
        );

        this._labelZodiacWesternText = new St.Label({
            style_class: "calendarium-zodiac-western",
            text:        ""
        });

        this._zodiacWesternPart.add_actor(this._labelZodiacWesternIcon);
        this._zodiacWesternPart.add_actor(this._labelZodiacWesternText);

        // Chinese zodiac label
        this._labelZodiacChinese = new St.Label({
            reactive:    true,
            style_class: "calendarium-zodiac-chinese",
            text:        ""
        });
        this._labelZodiacChinese.accessible_name = _("Chinese zodiac");
        this._zodiacChineseTooltip = new Tooltips.Tooltip(
            this._labelZodiacChinese, ""
        );

        this._zodiacRow.add_actor(this._zodiacWesternPart);
        this._zodiacRow.add_actor(this._labelZodiacChinese);
        this._container.add_actor(this._zodiacRow);

        // ── Name days (today + up to 5 lookahead days) ────────────────────
        this._labelNameday = [];
        for (let i = 0; i <= 5; i++) {
            let cls = i === 0 ? "calendarium-nameday" : "calendarium-nameday-sub";
            let lbl = new St.Label({ style_class: cls, text: "" });
            this._labelNameday.push(lbl);
            this._container.add_actor(lbl);
        }

        // ── New Year countdown ─────────────────────────────────────────────
        this._labelNewYear = new St.Label({
            reactive:    true,
            style_class: "calendarium-newyear",
            text:        ""
        });
        this._newYearTooltip = new Tooltips.Tooltip(this._labelNewYear, "");
        this._container.add_actor(this._labelNewYear);

        // ── Wikipedia ─────────────────────────────────────────────────────
        this._labelWikiBirthsHeader   = new St.Label({
            style_class: "calendarium-wiki-header", text: ""
        });
        this._labelWikiBirths         = new St.Label({
            style_class: "calendarium-wiki",        text: ""
        });
        this._labelWikiDeathsHeader   = new St.Label({
            style_class: "calendarium-wiki-header", text: ""
        });
        this._labelWikiDeaths         = new St.Label({
            style_class: "calendarium-wiki",        text: ""
        });
        this._labelWikiFeaturedHeader = new St.Label({
            style_class: "calendarium-wiki-header", text: ""
        });
        this._labelWikiFeatured       = new St.Label({
            style_class: "calendarium-wiki-featured", text: ""
        });

        this._labelWikiBirthsHeader.accessible_name   = _("Births on this day");
        this._labelWikiBirths.accessible_name         = _("Births on this day");
        this._labelWikiDeathsHeader.accessible_name   = _("Deaths on this day");
        this._labelWikiDeaths.accessible_name         = _("Deaths on this day");
        this._labelWikiFeaturedHeader.accessible_name = _("Article of the day");
        this._labelWikiFeatured.accessible_name       = _("Article of the day");

        this._container.add_actor(this._labelWikiBirthsHeader);
        this._container.add_actor(this._labelWikiBirths);
        this._container.add_actor(this._labelWikiDeathsHeader);
        this._container.add_actor(this._labelWikiDeaths);
        this._container.add_actor(this._labelWikiFeaturedHeader);
        this._container.add_actor(this._labelWikiFeatured);

        this.setContent(this._container);

        this._refresh();
    },

    // ── Refresh orchestration ─────────────────────────────────────────────

    /**
     * Master refresh: update all sections, then schedule the next tick.
     */
    _refresh: function() {
        if (this._isDestroyed) return;
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }

        let now = new Date();
        this._applyAppearance();
        this._updateDate(now);
        this._updateTime(now);
        this._updateProgress(now);
        this._updateTraditional(now);
        this._updateMoon(now);
        this._updateSun(now);
        this._updateZodiac(now);
        this._updateNewYear(now);
        this._updateNamedays(now);
        this._scheduleWikipedia(now);

        // Schedule next full refresh in 60 s
        this._timeout = Mainloop.timeout_add_seconds(
            60, Lang.bind(this, this._refresh)
        );

        // If seconds are shown, drive the clock from a faster timer
        if (this._clockTimeout) {
            Mainloop.source_remove(this._clockTimeout);
            this._clockTimeout = null;
        }
        if (this.show_time && this.show_seconds) {
            this._clockTimeout = Mainloop.timeout_add(
                1000, Lang.bind(this, this._refreshClock)
            );
        }
    },

    /** Fast-path refresh for the time label only (1-second cadence). */
    _refreshClock: function() {
        if (this._isDestroyed) return false;
        this._updateTime(new Date());
        this._clockTimeout = Mainloop.timeout_add(
            1000, Lang.bind(this, this._refreshClock)
        );
        return false;
    },

    // ── Appearance helpers ────────────────────────────────────────────────

    _getIconPx: function() {
        switch (this.icon_size) {
            case "small":  return 14;
            case "large":  return 30;
            default:       return 20;   // medium
        }
    },

    _applyAppearance: function() {
        // Text scale: visual zoom of the whole container
        let s = this.text_scale || 1.0;
        this._container.set_scale(s, s);

        // Icon / symbol size for moon and zodiac symbols
        let px = this._getIconPx();
        this._labelMoonIcon.set_style(
            "font-size: " + px + "px; color: #ccccff; padding-right: 5px;"
        );
        this._labelZodiacWesternIcon.set_style(
            "font-size: " + px + "px; color: #88ffcc; padding-right: 5px;"
        );

        // Decorations
        if (this.hide_decorations) {
            this.setHeader(" ");
        }
    },

    // ── Section updaters ──────────────────────────────────────────────────

    _updateDate: function(now) {
        this._labelDate.visible = this.show_date;
        if (!this.show_date) return;
        try {
            let dt  = GLib.DateTime.new_now_local();
            let fmt = (this.date_format_preset === "custom")
                ? (this.date_format_custom || "%A, %d. %B %Y")
                : (this.date_format_preset  || "%A, %d. %B %Y");
            this._labelDate.set_text(dt.format(fmt) || "");
        } catch (e) {
            this._labelDate.set_text("--");
        }
    },

    _updateTime: function(now) {
        this._labelTime.visible = this.show_time;
        if (!this.show_time) return;
        try {
            let dt  = GLib.DateTime.new_now_local();
            let fmt;
            if (this.time_format === "12h") {
                fmt = this.show_seconds ? "%I:%M:%S %p" : "%I:%M %p";
            } else {
                fmt = this.show_seconds ? "%H:%M:%S" : "%H:%M";
            }
            this._labelTime.set_text(dt.format(fmt) || "");
        } catch (e) {
            this._labelTime.set_text("--:--");
        }
    },

    _updateProgress: function(now) {
        let y = now.getFullYear();

        // ── Day of year ──────────────────────────────────────────────────
        this._labelDayOfYear.visible = this.show_day_of_year;
        if (this.show_day_of_year) {
            let startOfYear = new Date(y, 0, 1);
            let dayOfYear   = Math.floor((now - startOfYear) / 86400000) + 1;
            let isLeap      = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
            let daysInYear  = isLeap ? 366 : 365;
            let text = _("Day %d of %d").format(dayOfYear, daysInYear);
            this._labelDayOfYear.set_text(text);
            this._dayOfYearTooltip.set_text(
                _("Day of year") + ": " + dayOfYear + " / " + daysInYear
            );
        }

        // ── ISO week number ──────────────────────────────────────────────
        this._labelWeekNumber.visible = this.show_week_number;
        if (this.show_week_number) {
            let weekNum = this._getISOWeek(now);
            let text    = _("Week %d").format(weekNum);
            this._labelWeekNumber.set_text(text);
            this._weekNumberTooltip.set_text(
                _("Week number") + ": " + weekNum
            );
        }

        // ── Month progress ───────────────────────────────────────────────
        this._labelMonthProgress.visible = this.show_month_progress;
        if (this.show_month_progress) {
            let dayOfMonth  = now.getDate();
            let daysInMonth = new Date(y, now.getMonth() + 1, 0).getDate();
            let monthName   = GLib.DateTime.new_now_local().format("%B");
            let text = monthName + " \u00b7 " +
                       dayOfMonth + "/" + daysInMonth + " " + _("days");
            this._labelMonthProgress.set_text(text);
            this._monthProgressTooltip.set_text(
                _("Month progress") + ": " +
                dayOfMonth + " / " + daysInMonth
            );
        }

        this._progressRow.visible =
            this.show_day_of_year || this.show_week_number || this.show_month_progress;
    },

    /** ISO 8601 week number (1–53). */
    _getISOWeek: function(date) {
        let d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        let dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        let yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    },

    _updateTraditional: function(now) {
        this._labelTraditional.visible = this.show_traditional;
        if (!this.show_traditional) return;
        let name = Localization.getTraditionalMonthName(
            this.traditional_lang, now.getMonth()
        );
        this._labelTraditional.set_text(name || "");
    },

    _updateMoon: function(now) {
        this._moonRow.visible = this.show_moon;
        if (!this.show_moon) return;

        let moon      = Moon.getMoonPhase(now);
        let phaseName = _(moon.phaseName);

        // Icon (size set by _applyAppearance)
        this._labelMoonIcon.set_text(moon.phaseSymbol);
        this._moonTooltip.set_text(_("Moon phase") + ": " + phaseName);

        // Name text (visibility depends on show_moon_name)
        this._labelMoonText.visible = this.show_moon_name;
        this._labelMoonText.set_text(phaseName);

        // Age — now inside the moon row
        this._labelMoonAge.visible = this.show_moon_age;
        if (this.show_moon_age) {
            let ageText = moon.age.toFixed(1) + " " + _("days");
            this._labelMoonAge.set_text("\u00b7 " + ageText);
            this._moonAgeTooltip.set_text(_("Moon age") + ": " + ageText);
        }
    },

    _updateSun: function(now) {
        this._sunRow.visible = this.show_sun;

        let cityNames = [this.city1_name, this.city2_name, this.city3_name];
        let cityLats  = [this.city1_lat,  this.city2_lat,  this.city3_lat];
        let cityLons  = [this.city1_lon,  this.city2_lon,  this.city3_lon];

        for (let i = 0; i < 3; i++) {
            let has = cityNames[i] && cityNames[i].trim() !== "";
            this._labelCity[i].row.visible = this.show_sun && has;
        }

        if (!this.show_sun) return;

        // Primary location
        let lat = this.use_manual_location ? this.latitude  : DEFAULT_LAT;
        let lon = this.use_manual_location ? this.longitude : DEFAULT_LON;
        let sun = Sun.getSunTimes(now, lat, lon);

        let sunriseStr = this._sunStr(sun, "sunrise");
        let sunsetStr  = this._sunStr(sun, "sunset");

        this._labelSunrise.set_text("\u2600 " + sunriseStr);
        this._labelSunset.set_text( "\u263D " + sunsetStr);
        this._sunriseTooltip.set_text(_("Sunrise") + ": " + sunriseStr);
        this._sunsetTooltip.set_text( _("Sunset")  + ": " + sunsetStr);

        // Additional cities
        for (let i = 0; i < 3; i++) {
            if (!(cityNames[i] && cityNames[i].trim())) continue;
            let cs = Sun.getSunTimes(now, cityLats[i], cityLons[i]);
            this._labelCity[i].name.set_text(cityNames[i]);
            this._labelCity[i].sunrise.set_text("\u2600 " + this._sunStr(cs, "sunrise"));
            this._labelCity[i].sunset.set_text( "\u263D " + this._sunStr(cs, "sunset"));
        }
    },

    _sunStr: function(sun, key) {
        if (sun.polarDay)   return _("Polar day");
        if (sun.polarNight) return _("Polar night");
        return sun[key] || _("No data");
    },

    _updateZodiac: function(now) {
        this._zodiacWesternPart.visible  = this.show_western_zodiac;
        this._labelZodiacChinese.visible = this.show_chinese_zodiac;
        this._zodiacRow.visible = this.show_western_zodiac || this.show_chinese_zodiac;

        if (this.show_western_zodiac) {
            let w    = Zodiac.getWesternZodiac(now);
            let name = _(w.name);
            this._labelZodiacWesternIcon.set_text(w.symbol);
            this._labelZodiacWesternText.set_text(name);
            this._zodiacWesternTooltip.set_text(
                _("Western zodiac") + ": " + name
            );
        }

        if (this.show_chinese_zodiac) {
            let c    = Zodiac.getChineseZodiac(
                now.getFullYear(), now.getMonth() + 1, now.getDate()
            );
            let text = _(c.elementKey) + " " + _(c.animalKey);
            this._labelZodiacChinese.set_text(text);
            this._zodiacChineseTooltip.set_text(
                _("Chinese zodiac") + ": " + text
            );
        }
    },

    _updateNewYear: function(now) {
        this._labelNewYear.visible = this.show_new_year_countdown;
        if (!this.show_new_year_countdown) return;

        let nextNY = new Date(now.getFullYear() + 1, 0, 1);
        let days   = Math.ceil((nextNY - now) / 86400000);
        this._labelNewYear.set_text(days + " " + _("days until New Year"));

        // Tooltip: show the exact date of the next New Year
        try {
            let nyDt = GLib.DateTime.new_local(now.getFullYear() + 1, 1, 1, 0, 0, 0);
            this._newYearTooltip.set_text(nyDt.format("%A, %B %d, %Y"));
        } catch (e) {
            this._newYearTooltip.set_text("");
        }
    },

    _updateNamedays: function(now) {
        let range = Namedays.getNamedaysRange(
            this._namedayData, now, this.nameday_lookahead
        );

        for (let i = 0; i <= 5; i++) {
            let lbl = this._labelNameday[i];
            if (!this.show_namedays || i > this.nameday_lookahead) {
                lbl.visible = false;
                lbl.set_text("");
                continue;
            }
            lbl.visible = true;
            let entry  = range[i];
            let names  = (entry && entry.names.length > 0)
                ? entry.names.join(", ")
                : _("No data");
            let prefix;
            if (i === 0) {
                prefix = _("Name days") + ": ";
            } else if (i === 1) {
                prefix = _("Tomorrow") + ": ";
            } else {
                let d = entry.date;
                prefix = (d.getMonth() + 1) + "/" + d.getDate() + ": ";
            }
            lbl.set_text(prefix + names);
        }
    },

    // ── Wikipedia (online, optional) ──────────────────────────────────────

    _scheduleWikipedia: function(now) {
        this._labelWikiBirthsHeader.visible   = false;
        this._labelWikiBirths.visible         = false;
        this._labelWikiDeathsHeader.visible   = false;
        this._labelWikiDeaths.visible         = false;
        this._labelWikiFeaturedHeader.visible = false;
        this._labelWikiFeatured.visible       = false;

        if (!this.show_wikipedia) return;

        let m    = now.getMonth() + 1;
        let d    = now.getDate();
        let y    = now.getFullYear();
        let lang = this.wikipedia_lang || "en";

        if (this.show_wiki_births || this.show_wiki_deaths) {
            Wikipedia.fetchOnThisDay(m, d, lang,
                Lang.bind(this, this._onWikiOnThisDay));
        }
        if (this.show_wiki_featured) {
            Wikipedia.fetchFeatured(y, m, d, lang,
                Lang.bind(this, this._onWikiFeatured));
        }
    },

    _onWikiOnThisDay: function(data) {
        if (this._isDestroyed || !data) return;

        if (this.show_wiki_births && data.births && data.births.length > 0) {
            let items = data.births.slice(0, 3).map(function(b) {
                let year  = b.year ? b.year + ": " : "";
                let title = (b.pages && b.pages[0])
                    ? b.pages[0].normalizedtitle
                    : (b.text || "");
                return year + title;
            });
            this._labelWikiBirthsHeader.set_text(_("Births on this day"));
            this._labelWikiBirths.set_text(items.join("\n"));
            this._labelWikiBirthsHeader.visible = true;
            this._labelWikiBirths.visible       = true;
        }

        if (this.show_wiki_deaths && data.deaths && data.deaths.length > 0) {
            let items = data.deaths.slice(0, 3).map(function(d) {
                let year  = d.year ? d.year + ": " : "";
                let title = (d.pages && d.pages[0])
                    ? d.pages[0].normalizedtitle
                    : (d.text || "");
                return year + title;
            });
            this._labelWikiDeathsHeader.set_text(_("Deaths on this day"));
            this._labelWikiDeaths.set_text(items.join("\n"));
            this._labelWikiDeathsHeader.visible = true;
            this._labelWikiDeaths.visible       = true;
        }
    },

    _onWikiFeatured: function(data) {
        if (this._isDestroyed || !data || !data.tfa) return;
        let tfa     = data.tfa;
        let title   = tfa.normalizedtitle || tfa.title || "";
        let extract = tfa.extract || "";
        let dot     = extract.indexOf(". ");
        if (dot > 0) extract = extract.substring(0, dot + 1);
        this._labelWikiFeaturedHeader.set_text(_("Article of the day"));
        this._labelWikiFeatured.set_text(title + (extract ? ("\n" + extract) : ""));
        this._labelWikiFeaturedHeader.visible = true;
        this._labelWikiFeatured.visible       = true;
    },

    // ── Settings change handler ───────────────────────────────────────────

    _onSettingChanged: function() {
        this._loadNamedayData();
        this._refresh();
    },

    // ── Cleanup ───────────────────────────────────────────────────────────

    on_desklet_removed: function() {
        // Set the flag first so any already-queued timer callbacks bail
        // out immediately without touching the now-destroyed actor tree.
        this._isDestroyed = true;
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._clockTimeout) {
            Mainloop.source_remove(this._clockTimeout);
            this._clockTimeout = null;
        }
    }
};
