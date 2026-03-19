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
const St       = imports.gi.St;
const Clutter  = imports.gi.Clutter;
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
// Cinnamon compiles and installs .mo files automatically on desklet install.
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
const Folkdays     = imports.folkdays.Folkdays;
const Holidays     = imports.holidays.Holidays;
const Wikipedia    = imports.wikipedia.Wikipedia;
const Geocoder     = imports.geocoder.Geocoder;

Geocoder.init(DESKLET_DIR);

// ── Default location: Budapest, Hungary ───────────────────────────────────
const DEFAULT_LAT  = 47.4979;
const DEFAULT_LON  = 19.0402;
const FOLKDAY_DIR  = DESKLET_DIR + "/data/folkdays";
const HOLIDAY_DIR  = DESKLET_DIR + "/data/holidays";

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
        this._geoTimeout   = null;
        this._namedayData  = null;
        this._isDestroyed  = false;
        this._wikiRotateStep  = 0;   // advances each minute to rotate Wikipedia items
        this._wikiOnThisDayData = null;  // cached full onthisday response
        this._deskletName  = metadata.name || "Calendarium";

        this.setHeader(this._deskletName);
        this._bindAllSettings(desklet_id);
        try {
            this._setupUI();
        } catch(e) {
            global.logError("Calendarium: _setupUI crash [" + e.message + "] stack:\n" + (e.stack || "(no stack)"));
            throw e;
        }
        // Load locale data files asynchronously; refresh again when done.
        this._loadNamedayData(() => this._refresh());
    },

    _bindAllSettings: function(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let s  = this.settings;
        let IN = Settings.BindingDirection.IN;
        let cb = () => this._onSettingChanged();

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
        s.bindProperty(IN, "progress-separator",  "progress_separator",  cb);

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
        s.bindProperty(IN, "location-search",  "location_search",
            () => this._onLocationSearchChanged());
        s.bindProperty(IN, "latitude",             "latitude",            cb);
        s.bindProperty(IN, "longitude",            "longitude",           cb);
        s.bindProperty(IN, "city1-name", "city1_name",
            () => this._onCityNameChanged(1));
        s.bindProperty(IN, "city1-lat",  "city1_lat",  cb);
        s.bindProperty(IN, "city1-lon",  "city1_lon",  cb);
        s.bindProperty(IN, "city1-tz",   "city1_tz",   cb);
        s.bindProperty(IN, "city2-name", "city2_name",
            () => this._onCityNameChanged(2));
        s.bindProperty(IN, "city2-lat",  "city2_lat",  cb);
        s.bindProperty(IN, "city2-lon",  "city2_lon",  cb);
        s.bindProperty(IN, "city2-tz",   "city2_tz",   cb);
        s.bindProperty(IN, "city3-name", "city3_name",
            () => this._onCityNameChanged(3));
        s.bindProperty(IN, "city3-lat",  "city3_lat",  cb);
        s.bindProperty(IN, "city3-lon",  "city3_lon",  cb);
        s.bindProperty(IN, "city3-tz",   "city3_tz",   cb);
        s.bindProperty(IN, "show-city-time",      "show_city_time",      cb);
        s.bindProperty(IN, "show-city-tz-offset", "show_city_tz_offset", cb);

        // Zodiac display modes
        s.bindProperty(IN, "zodiac-western-display", "zodiac_western_display", cb);
        s.bindProperty(IN, "zodiac-chinese-display", "zodiac_chinese_display", cb);

        // Name days
        s.bindProperty(IN, "show-namedays",       "show_namedays",       cb);
        s.bindProperty(IN, "nameday-locale",      "nameday_locale",      cb);
        s.bindProperty(IN, "nameday-lookahead",   "nameday_lookahead",   cb);
        s.bindProperty(IN, "nameday-two-columns", "nameday_two_columns", cb);

        // Folk sayings
        s.bindProperty(IN, "show-folkdays",  "show_folkdays",  cb);
        s.bindProperty(IN, "folkday-locale", "folkday_locale", cb);

        // Holidays
        s.bindProperty(IN, "show-holidays",      "show_holidays",      cb);
        s.bindProperty(IN, "holiday-locale",     "holiday_locale",     cb);
        s.bindProperty(IN, "holiday-lookahead",  "holiday_lookahead",  cb);

        // New Year
        s.bindProperty(IN, "show-new-year-countdown", "show_new_year_countdown", cb);

        // Wikipedia (online)
        s.bindProperty(IN, "show-wikipedia",       "show_wikipedia",       cb);
        s.bindProperty(IN, "wikipedia-lang",       "wikipedia_lang",       cb);
        s.bindProperty(IN, "show-wiki-events",     "show_wiki_events",     cb);
        s.bindProperty(IN, "show-wiki-births",     "show_wiki_births",     cb);
        s.bindProperty(IN, "show-wiki-deaths",     "show_wiki_deaths",     cb);
        s.bindProperty(IN, "show-wiki-featured",   "show_wiki_featured",   cb);
        s.bindProperty(IN, "wikipedia-items-count",   "wikipedia_items_count",    cb);
        s.bindProperty(IN, "wikipedia-rotate-minutes","wikipedia_rotate_minutes", cb);
        s.bindProperty(IN, "wikipedia-cache-hours",   "wikipedia_cache_hours",    cb);

        // Appearance
        s.bindProperty(IN, "icon-size",        "icon_size",        cb);
        s.bindProperty(IN, "text-scale",       "text_scale",       cb);
        s.bindProperty(IN, "bg-opacity",       "bg_opacity",       cb);
    },

    /**
     * Resolve a locale setting value.
     * If value is "auto", detect the first system language that appears in
     * the `supported` list; fall back to `fallback` if none match.
     */
    _resolveLocale: function(value, supported, fallback) {
        if (value && value !== "auto") return value;
        let candidates = [];
        try {
            let envVars = ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"];
            for (let i = 0; i < envVars.length; i++) {
                let v = GLib.getenv(envVars[i]);
                if (v) candidates.push(v);
            }
        } catch(e) {}
        try {
            let glangs = GLib.get_language_names();
            if (glangs) for (let i = 0; i < glangs.length; i++) if (glangs[i]) candidates.push(glangs[i]);
        } catch(e) {}
        for (let i = 0; i < candidates.length; i++) {
            if (!candidates[i]) continue;
            let lang = candidates[i].split("_")[0].split(".")[0];
            if (lang && lang !== "C" && supported.indexOf(lang) !== -1) return lang;
        }
        return fallback;
    },

    // ── Geocoder handlers ─────────────────────────────────────────────────

    _onLocationSearchChanged: function() {
        let query = this.location_search || "";
        if (this._geoTimeout) {
            Mainloop.source_remove(this._geoTimeout);
            this._geoTimeout = null;
        }
        if (!query.trim()) return;
        let self = this;
        this._geoTimeout = Mainloop.timeout_add(1500, function() {
            self._geoTimeout = null;
            let results = Geocoder.search(query);
            if (results.length === 0) return false;
            let r = results[0];
            self.settings.setValue("latitude",  r.lat);
            self.settings.setValue("longitude", r.lon);
            self.settings.setValue("use-manual-location", true);
            return false;
        });
    },

    _onCityNameChanged: function(n) {
        let name = this["city" + n + "_name"] || "";
        let results = name.trim() ? Geocoder.search(name) : [];
        if (results.length > 0) {
            let r = results[0];
            this.settings.setValue("city" + n + "-lat", r.lat);
            this.settings.setValue("city" + n + "-lon", r.lon);
            this.settings.setValue("city" + n + "-tz",  r.tz || "");
        }
        // Always refresh display immediately — setValue above fires cb for
        // lat/lon only; name change itself must also trigger a redraw.
        this._onSettingChanged();
    },

    /**
     * Get the current UTC offset in hours for an IANA timezone string.
     * Returns null if tzStr is empty or invalid.
     */
    _getCityUtcOffsetHours: function(tzStr) {
        if (!tzStr || !tzStr.trim()) return null;
        try {
            let tz = GLib.TimeZone.new(tzStr.trim());
            let dt = GLib.DateTime.new_now(tz);
            return dt.get_utc_offset() / 3600000000;
        } catch(e) {
            return null;
        }
    },

    /**
     * Format a UTC offset in hours as a "UTC±H" or "UTC±H:MM" string.
     */
    _formatTzOffset: function(offsetHours) {
        if (offsetHours === null || offsetHours === undefined) return "";
        let sign = offsetHours >= 0 ? "+" : "-";
        let abs  = Math.abs(offsetHours);
        let h    = Math.floor(abs);
        let m    = Math.round((abs - h) * 60);
        let str  = "UTC" + sign + h;
        if (m > 0) str += ":" + (m < 10 ? "0" : "") + m;
        return str;
    },

    _loadNamedayData: function(callback) {
        let ndLang = this._resolveLocale(this.nameday_locale,  ["hu","de","en","fr","es","it"], "en");
        let fdLang = this._resolveLocale(this.folkday_locale,  ["hu","de","en","fr","es","it"], "hu");
        let hlLang = this._resolveLocale(this.holiday_locale,  ["hu","de","en","fr","es","it"], "hu");
        // Extra safety: never pass "auto" to data loaders (guards against stale GJS module cache)
        if (!ndLang || ndLang === "auto") ndLang = "en";
        if (!fdLang || fdLang === "auto") fdLang = "hu";
        if (!hlLang || hlLang === "auto") hlLang = "hu";
        let pending = 3;
        let done = () => { if (--pending === 0 && callback) callback(); };
        Namedays.loadData(DATA_DIR,    ndLang, (data) => { this._namedayData = data; done(); });
        Folkdays.loadData(FOLKDAY_DIR, fdLang, (data) => { this._folkdayData = data; done(); });
        Holidays.loadData(HOLIDAY_DIR, hlLang, (data) => { this._holidayData = data; done(); });
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

        // ── Calendar progress — two rows ──────────────────────────────────
        // Row 1: day-of-year  ·  new-year countdown
        this._progressRow1 = new St.BoxLayout({
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

        this._labelNewYear = new St.Label({
            reactive:    true,
            style_class: "calendarium-newyear",
            text:        ""
        });
        this._newYearTooltip = new Tooltips.Tooltip(this._labelNewYear, "");

        this._progressRow1.add_actor(this._labelDayOfYear);
        this._progressRow1.add_actor(this._labelNewYear);
        this._container.add_actor(this._progressRow1);

        // Row 2: week number  ·  month progress
        this._progressRow2 = new St.BoxLayout({
            vertical:    false,
            style_class: "calendarium-progress-row"
        });

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
            this._labelMonthProgress, _("Month highlights")
        );

        this._progressRow2.add_actor(this._labelWeekNumber);
        this._progressRow2.add_actor(this._labelMonthProgress);
        this._container.add_actor(this._progressRow2);

        // ── Traditional month name ─────────────────────────────────────────
        this._labelTraditional = new St.Label({
            style_class: "calendarium-traditional",
            text:        ""
        });
        this._container.add_actor(this._labelTraditional);

        // ── Folk calendar saying ───────────────────────────────────────────
        this._labelFolkday = new St.Label({
            style_class: "calendarium-folkday",
            text:        ""
        });
        this._container.add_actor(this._labelFolkday);

        // ── Holiday / weekend indicator ────────────────────────────────────
        this._labelHoliday = new St.Label({
            style_class: "calendarium-holiday",
            text:        ""
        });
        this._container.add_actor(this._labelHoliday);

        // ── Upcoming holidays ──────────────────────────────────────────────
        this._labelHolidayUpcoming = new St.Label({
            style_class: "calendarium-holiday-upcoming",
            text:        ""
        });
        this._container.add_actor(this._labelHolidayUpcoming);

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

        // Additional cities (up to 3 rows: name + time + UTC offset + sunrise + sunset)
        // Additional cities — all 3 rows in a single GridLayout so columns
        // align across rows (each column width = max of all cells in that column).
        this._cityGrid = new St.Widget({ style_class: "calendarium-city-grid" });
        let cityGL = new Clutter.GridLayout({ column_spacing: 8, row_spacing: 1 });
        this._cityGrid.set_layout_manager(cityGL);

        this._labelCity = [];
        for (let i = 0; i < 3; i++) {
            let nm = new St.Label({ style_class: "calendarium-city-name", text: "" });
            let tm = new St.Label({ style_class: "calendarium-city-time", text: "" });
            let tz = new St.Label({ style_class: "calendarium-city-tz",   text: "" });
            let sr = new St.Label({ style_class: "calendarium-city", text: "" });
            let ss = new St.Label({ style_class: "calendarium-city", text: "" });
            sr.accessible_name = _("Sunrise");
            ss.accessible_name = _("Sunset");
            tm.accessible_name = _("Local time");
            cityGL.attach(nm, 0, i, 1, 1);
            cityGL.attach(tm, 1, i, 1, 1);
            cityGL.attach(tz, 2, i, 1, 1);
            cityGL.attach(sr, 3, i, 1, 1);
            cityGL.attach(ss, 4, i, 1, 1);
            this._labelCity.push({ name: nm, time: tm, tzLabel: tz, sunrise: sr, sunset: ss });
        }
        this._container.add_actor(this._cityGrid);

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

        // Chinese zodiac part (icon + text, mirrors western structure)
        this._zodiacChinesePart = new St.BoxLayout({ vertical: false });

        this._labelZodiacChineseIcon = new St.Label({ reactive: true, text: "" });
        this._labelZodiacChineseIcon.accessible_name = _("Chinese zodiac");
        this._zodiacChineseTooltip = new Tooltips.Tooltip(
            this._labelZodiacChineseIcon, ""
        );

        this._labelZodiacChinese = new St.Label({
            style_class: "calendarium-zodiac-chinese",
            text:        ""
        });

        this._zodiacChinesePart.add_actor(this._labelZodiacChineseIcon);
        this._zodiacChinesePart.add_actor(this._labelZodiacChinese);

        this._zodiacRow.add_actor(this._zodiacWesternPart);
        this._zodiacRow.add_actor(this._zodiacChinesePart);
        this._container.add_actor(this._zodiacRow);

        // ── Name days (today + up to 5 lookahead days, optional 2-column) ──
        this._labelNamedayToday = new St.Label({
            style_class: "calendarium-nameday",
            text:        ""
        });
        this._container.add_actor(this._labelNamedayToday);

        // 5 future rows; each row holds a left and optional right label
        this._namedayFutureRow = [];
        for (let i = 0; i < 10; i++) {
            // Use St.Widget with a homogeneous Clutter.BoxLayout so both
            // columns are always exactly equal width — true column alignment.
            let row = new St.Widget({
                style_class:    "calendarium-nameday-row",
                layout_manager: new Clutter.BoxLayout({
                    homogeneous: true,
                    spacing:     14
                })
            });
            let left  = new St.Label({ style_class: "calendarium-nameday-sub", text: "" });
            let right = new St.Label({ style_class: "calendarium-nameday-sub", text: "" });
            left.set_x_expand(true);
            right.set_x_expand(true);
            row.add_actor(left);
            row.add_actor(right);
            this._namedayFutureRow.push({ row: row, left: left, right: right });
            this._container.add_actor(row);
        }

        // ── Wikipedia ─────────────────────────────────────────────────────
        // Status label: shown when Wikipedia is enabled but no data is available yet
        this._labelWikiStatus = new St.Label({
            style_class: "calendarium-wiki",
            text: ""
        });
        this._container.add_actor(this._labelWikiStatus);

        this._labelWikiEventsHeader   = new St.Label({
            style_class: "calendarium-wiki-header", text: ""
        });
        this._labelWikiEvents         = new St.Label({
            style_class: "calendarium-wiki",        text: ""
        });
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

        this._labelWikiEventsHeader.accessible_name   = _("Events on this day");
        this._labelWikiEvents.accessible_name         = _("Events on this day");
        this._labelWikiBirthsHeader.accessible_name   = _("Births on this day");
        this._labelWikiBirths.accessible_name         = _("Births on this day");
        this._labelWikiDeathsHeader.accessible_name   = _("Deaths on this day");
        this._labelWikiDeaths.accessible_name         = _("Deaths on this day");
        this._labelWikiFeaturedHeader.accessible_name = _("Article of the day");
        this._labelWikiFeatured.accessible_name       = _("Article of the day");

        this._container.add_actor(this._labelWikiEventsHeader);
        this._container.add_actor(this._labelWikiEvents);
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
        try { this._applyAppearance();      } catch(e) { global.logError("Calendarium _applyAppearance: "  + e); }
        try { this._updateDate(now);        } catch(e) { global.logError("Calendarium _updateDate: "        + e); }
        try { this._updateTime(now);        } catch(e) { global.logError("Calendarium _updateTime: "        + e); }
        try { this._updateProgress(now);    } catch(e) { global.logError("Calendarium _updateProgress: "    + e); }
        try { this._updateTraditional(now); } catch(e) { global.logError("Calendarium _updateTraditional: " + e); }
        try { this._updateFolkday(now);     } catch(e) { global.logError("Calendarium _updateFolkday: "     + e); }
        try { this._updateHoliday(now);    } catch(e) { global.logError("Calendarium _updateHoliday: "    + e); }
        try { this._updateMoon(now);        } catch(e) { global.logError("Calendarium _updateMoon: "        + e); }
        try { this._updateSun(now);         } catch(e) { global.logError("Calendarium _updateSun: "         + e); }
        try { this._updateZodiac(now);      } catch(e) { global.logError("Calendarium _updateZodiac: "      + e); }
        try { this._updateNamedays(now);    } catch(e) { global.logError("Calendarium _updateNamedays: "    + e); }
        this._wikiRotateStep++;
        try { this._scheduleWikipedia(now); } catch(e) { global.logError("Calendarium _scheduleWikipedia: " + e); }

        // Schedule next full refresh in 60 s
        this._timeout = Mainloop.timeout_add_seconds(
            60, () => this._refresh()
        );

        // If seconds are shown, drive the clock from a faster timer
        if (this._clockTimeout) {
            Mainloop.source_remove(this._clockTimeout);
            this._clockTimeout = null;
        }
        if ((this.show_time && this.show_seconds) || this.show_city_time) {
            this._clockTimeout = Mainloop.timeout_add(
                1000, () => this._refreshClock()
            );
        }
    },

    /** Fast-path refresh for the time label only (1-second cadence). */
    _refreshClock: function() {
        if (this._isDestroyed) return false;
        this._updateTime(new Date());
        this._updateCityTimes();
        this._clockTimeout = Mainloop.timeout_add(
            1000, () => this._refreshClock()
        );
        return false;
    },

    _updateCityTimes: function() {
        let cityNames = [this.city1_name, this.city2_name, this.city3_name];
        let cityTzs   = [this.city1_tz,   this.city2_tz,   this.city3_tz];
        for (let i = 0; i < 3; i++) {
            if (!cityNames[i] || !cityNames[i].trim()) continue;
            let offset = this._getCityUtcOffsetHours(cityTzs[i]);

            // Local time + timezone abbreviation (shared GLib.DateTime for both)
            let timeStr = "";
            let abbr    = "";
            if (cityTzs[i] && cityTzs[i].trim()) {
                try {
                    let tz = GLib.TimeZone.new(cityTzs[i].trim());
                    let dt = GLib.DateTime.new_now(tz);
                    if (this.show_city_time)
                        timeStr = " " + dt.format("%H:%M");
                    abbr = dt.get_timezone_abbreviation() || "";
                } catch(e) {}
            }
            this._labelCity[i].time.set_text(timeStr);
            this._labelCity[i].time.visible = this.show_city_time && timeStr !== "";

            // UTC offset + abbreviated timezone name in parentheses
            let tzStr = "";
            if (this.show_city_tz_offset && offset !== null) {
                tzStr = " " + this._formatTzOffset(offset);
                if (abbr) tzStr += " (" + abbr + ")";
            }
            this._labelCity[i].tzLabel.set_text(tzStr);
            this._labelCity[i].tzLabel.visible = this.show_city_tz_offset && tzStr !== "";
        }
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
        let s     = this.text_scale || 1.0;
        let basePx = Math.round(13 * s);
        let op    = Math.max(0, Math.min(1, this.bg_opacity || 0));
        let containerStyle =
            "font-size: " + basePx + "px;" +
            "background-color: rgba(0, 0, 0, " + op.toFixed(2) + ");";

        // Icon / symbol size for moon and zodiac symbols
        let px = this._getIconPx();
        this._labelMoonIcon.set_style(
            "font-size: " + px + "px; color: #ccccff; padding-right: 5px;"
        );
        this._labelZodiacWesternIcon.set_style(
            "font-size: " + px + "px; color: #88ffcc; padding-right: 5px;"
        );
        this._labelZodiacChineseIcon.set_style(
            "font-size: " + px + "px; padding-right: 5px;"
        );

        // Always hide frame and header — re-apply after _updateDecoration()
        // which may reset container styles.
        this.metadata["prevent-decorations"] = true;
        this._updateDecoration();
        this._container.set_style(containerStyle);
    },

    // ── Section updaters ──────────────────────────────────────────────────

    _updateDate: function(now) {
        this._labelDate.visible = this.show_date;
        if (!this.show_date) return;
        try {
            let dt  = GLib.DateTime.new_now_local();
            // All real format strings contain at least one '%'.
            // The sentinel "custom" (and any label text a Cinnamon version might
            // store instead of the value) does not — so this check is resilient
            // to both storage behaviours.
            let preset  = this.date_format_preset || "";
            let isCustom = preset.indexOf('%') === -1;
            let fmt = isCustom
                ? (this.date_format_custom || "%A, %d. %B %Y")
                : preset;
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
            let text = (_("Day %d of %d") || "Day %d of %d")
                .replace("%d", String(dayOfYear)).replace("%d", String(daysInYear));
            this._labelDayOfYear.set_text(text || "");
            this._dayOfYearTooltip.set_text(
                _("Day of year") + ": " + dayOfYear + " / " + daysInYear
            );
        }

        // ── ISO week number ──────────────────────────────────────────────
        this._labelWeekNumber.visible = this.show_week_number;
        if (this.show_week_number) {
            let weekNum = this._getISOWeek(now);
            let text    = (_("Week %d") || "Week %d").replace("%d", String(weekNum));
            this._labelWeekNumber.set_text(text || "");
            this._weekNumberTooltip.set_text(
                _("Week number") + ": " + weekNum
            );
        }

        // ── Month progress ───────────────────────────────────────────────
        this._labelMonthProgress.visible = this.show_month_progress;
        if (this.show_month_progress) {
            let dayOfMonth  = now.getDate();
            let daysInMonth = new Date(y, now.getMonth() + 1, 0).getDate();
            let monthName   = (GLib.DateTime.new_now_local().format("%B")) || "";
            let sep = (this.progress_separator || "\u00b7").charAt(0);
            let mpPrefix = this.show_week_number ? " " + sep + " " : "";
            let text = mpPrefix + monthName + " " + sep + " " +
                       dayOfMonth + "/" + daysInMonth + " " + _("days");
            this._labelMonthProgress.set_text(text || "");
            this._monthProgressTooltip.set_text(
                _("Month highlights") + ": " +
                dayOfMonth + " / " + daysInMonth
            );
        }

        // ── New Year countdown ───────────────────────────────────────────
        this._labelNewYear.visible = this.show_new_year_countdown;
        if (this.show_new_year_countdown) {
            let nextNY = new Date(y + 1, 0, 1);
            let days   = Math.ceil((nextNY - now) / 86400000);
            let sep = (this.progress_separator || "\u00b7").charAt(0);
            let nyPrefix = this.show_day_of_year ? " " + sep + " " : "";
            this._labelNewYear.set_text(nyPrefix + days + " " + _("days until New Year"));
            try {
                let nyDt = GLib.DateTime.new_local(y + 1, 1, 1, 0, 0, 0);
                this._newYearTooltip.set_text(nyDt.format("%A, %B %d, %Y"));
            } catch (e) {
                this._newYearTooltip.set_text("");
            }
        }

        this._progressRow1.visible =
            this.show_day_of_year || this.show_new_year_countdown;
        this._progressRow2.visible =
            this.show_week_number || this.show_month_progress;
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
        if (!this.show_traditional) { this._labelTraditional.visible = false; return; }
        let lang = this._resolveLocale(this.traditional_lang, ["hu","de","en","fr","es","it"], "en");
        let name = Localization.getTraditionalMonthName(lang, now.getMonth());
        this._labelTraditional.visible = !!(name && name.trim());
        this._labelTraditional.set_text(name || "");
    },

    _updateFolkday: function(now) {
        if (!this.show_folkdays) { this._labelFolkday.visible = false; return; }
        let saying = Folkdays.getSaying(this._folkdayData, now);
        this._labelFolkday.visible = !!(saying && saying.trim());
        this._labelFolkday.set_text(saying ? this._wrapText(saying, 48) : "");
    },

    _updateHoliday: function(now) {
        let isWeekend = (now.getDay() === 0 || now.getDay() === 6);
        let holiday   = this.show_holidays
            ? Holidays.getHolidayForDate(this._holidayData, now)
            : null;

        // ── Today ────────────────────────────────────────────────────────
        if (!holiday && !isWeekend) {
            this._labelHoliday.visible = false;
        } else {
            let parts = [];
            if (holiday) {
                let prefix = holiday.public ? "\u2605 " : "";
                parts.push(prefix + holiday.name);
                if (holiday.public) parts.push(_("public holiday"));
            }
            if (isWeekend) parts.push(_("weekend"));
            this._labelHoliday.style_class = (holiday && holiday.public)
                ? "calendarium-holiday-public"
                : "calendarium-holiday";
            this._labelHoliday.set_text(parts.join(" \u00b7 "));
            this._labelHoliday.visible = true;
        }

        // ── Upcoming ─────────────────────────────────────────────────────
        let lookahead = this.holiday_lookahead || 0;
        if (!this.show_holidays || lookahead === 0) {
            this._labelHolidayUpcoming.visible = false;
            return;
        }

        // Start from tomorrow (skip today — already shown above)
        let tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        let upcoming = Holidays.getHolidaysRange(
            this._holidayData, tomorrow, lookahead - 1
        );

        if (upcoming.length === 0) {
            this._labelHolidayUpcoming.visible = false;
            return;
        }

        let lines = upcoming.map(function(h) {
            let d      = h.date;
            let prefix = h.public ? "\u2605 " : "";
            let dateStr = (d.getMonth() + 1) + "/" + d.getDate() + ": ";
            return dateStr + prefix + h.name;
        });
        this._labelHolidayUpcoming.set_text(lines.join("\n"));
        this._labelHolidayUpcoming.visible = true;
    },

    _updateMoon: function(now) {
        this._moonRow.visible = this.show_moon;
        if (!this.show_moon) return;

        let moon      = Moon.getMoonPhase(now);
        let phaseName = _(moon.phaseName);

        // Icon (size set by _applyAppearance)
        this._labelMoonIcon.set_text(moon.phaseSymbol || "");
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
        let cityTzs   = [this.city1_tz,   this.city2_tz,   this.city3_tz];

        let anyCity = false;
        for (let i = 0; i < 3; i++) {
            let has = !!(this.show_sun && cityNames[i] && cityNames[i].trim());
            if (has) anyCity = true;
            let c = this._labelCity[i];
            c.name.visible    = has;
            c.sunrise.visible = has;
            c.sunset.visible  = has;
            if (!has) { c.time.visible = false; c.tzLabel.visible = false; }
        }
        this._cityGrid.visible = anyCity;

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

        // Additional cities — sunrise/sunset in the city's local time
        for (let i = 0; i < 3; i++) {
            if (!(cityNames[i] && cityNames[i].trim())) continue;
            let offset = this._getCityUtcOffsetHours(cityTzs[i]);
            let cs = Sun.getSunTimes(now, cityLats[i], cityLons[i], offset);
            this._labelCity[i].name.set_text(cityNames[i]);
            this._labelCity[i].sunrise.set_text("\u2600 " + this._sunStr(cs, "sunrise"));
            this._labelCity[i].sunset.set_text( "\u263D " + this._sunStr(cs, "sunset"));
        }

        // Also refresh city time/offset labels in sync with sun update
        this._updateCityTimes();
    },

    _sunStr: function(sun, key) {
        if (sun.polarDay)   return _("Polar day");
        if (sun.polarNight) return _("Polar night");
        return sun[key] || _("No data");
    },

    _updateZodiac: function(now) {
        // "icon-and-text" | "icon-only" | "text-only" | "none"
        let wMode = this.zodiac_western_display || "icon-and-text";
        let cMode = this.zodiac_chinese_display || "icon-and-text";

        let wVisible = (wMode !== "none");
        let cVisible = (cMode !== "none");

        this._zodiacWesternPart.visible = wVisible;
        this._zodiacChinesePart.visible = cVisible;
        this._zodiacRow.visible = wVisible || cVisible;

        if (wVisible) {
            let w    = Zodiac.getWesternZodiac(now);
            let name = _(w.name) || "";
            this._labelZodiacWesternIcon.visible = (wMode !== "text-only");
            this._labelZodiacWesternText.visible = (wMode !== "icon-only");
            this._labelZodiacWesternIcon.set_text(w.symbol || "");
            this._labelZodiacWesternText.set_text(name);
            this._zodiacWesternTooltip.set_text(
                _("Western zodiac") + ": " + name
            );
        }

        if (cVisible) {
            let c    = Zodiac.getChineseZodiac(
                now.getFullYear(), now.getMonth() + 1, now.getDate()
            );
            let text = _(c.elementKey) + " " + _(c.animalKey);
            this._labelZodiacChineseIcon.visible = (cMode !== "text-only");
            this._labelZodiacChinese.visible     = (cMode !== "icon-only");
            this._labelZodiacChineseIcon.set_text(c.symbol || "");
            this._labelZodiacChinese.set_text(text);
            this._zodiacChineseTooltip.set_text(
                _("Chinese zodiac") + ": " + text
            );
        }
    },

    // Returns "Prefix: Names" or null if no names for this entry.
    _namedayLabel: function(entry, dayIndex) {
        if (!entry || !entry.names || entry.names.length === 0) return null;
        let names = entry.names.join(", ");
        let prefix;
        if (dayIndex === 0) {
            prefix = _("Name days") + ": ";
        } else if (dayIndex === 1) {
            prefix = _("Tomorrow") + ": ";
        } else if (entry.date) {
            let d = entry.date;
            prefix = (d.getMonth() + 1) + "/" + d.getDate() + ": ";
        } else {
            prefix = "";
        }
        return prefix + names;
    },

    _updateNamedays: function(now) {
        let lookahead = this.nameday_lookahead || 0;
        let twoCol    = this.nameday_two_columns;
        let range     = Namedays.getNamedaysRange(
            this._namedayData, now, lookahead
        );

        // Today label — hide if disabled or no data
        if (!this.show_namedays) {
            this._labelNamedayToday.visible = false;
            this._labelNamedayToday.set_text("");
        } else {
            let todayText = this._namedayLabel(range[0], 0);
            this._labelNamedayToday.visible = !!(todayText);
            this._labelNamedayToday.set_text(todayText || "");
        }

        // Future rows
        for (let rowIdx = 0; rowIdx < 10; rowIdx++) {
            let r = this._namedayFutureRow[rowIdx];
            if (!this.show_namedays) {
                r.row.visible = false;
                r.left.set_text(""); r.right.set_text("");
                continue;
            }
            if (twoCol) {
                // 2-column: row i shows lookahead days 2i+1 and 2i+2
                let dayA = rowIdx * 2 + 1;
                let dayB = rowIdx * 2 + 2;
                let labelA = dayA <= lookahead ? this._namedayLabel(range[dayA], dayA) : null;
                let labelB = dayB <= lookahead ? this._namedayLabel(range[dayB], dayB) : null;
                if (!labelA && !labelB) {
                    r.row.visible = false;
                    r.left.set_text(""); r.right.set_text("");
                } else {
                    r.row.visible = true;
                    r.left.set_text(labelA || "");
                    r.right.visible = !!(labelB);
                    r.right.set_text(labelB || "");
                }
            } else {
                // 1-column: row i shows lookahead day i+1
                let dayIdx = rowIdx + 1;
                let label  = dayIdx <= lookahead ? this._namedayLabel(range[dayIdx], dayIdx) : null;
                r.row.visible = !!(label);
                r.right.visible = false;
                r.left.set_text(label || "");
                r.right.set_text("");
            }
        }
    },

    // ── Wikipedia (online, optional) ──────────────────────────────────────

    _scheduleWikipedia: function(now) {
        this._labelWikiStatus.visible         = false;
        this._labelWikiEventsHeader.visible   = false;
        this._labelWikiEvents.visible         = false;
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
        let lang = this._resolveLocale(
            this.wikipedia_lang, ["en","de","hu","fr","es","it"], "en"
        );

        // If we already have data for today, re-render immediately (rotation)
        // before triggering the async fetch (which may return from cache anyway).
        if (this._wikiOnThisDayData) {
            this._renderWikiOnThisDay();
        }

        // Set cache TTL on the module object
        Wikipedia.CACHE_TTL_SECS = (this.wikipedia_cache_hours || 12) * 3600;

        this._wikiPending = 0;

        if (this.show_wiki_births || this.show_wiki_deaths || this.show_wiki_events) {
            this._wikiPending++;
            Wikipedia.fetchOnThisDay(m, d, lang,
                (data) => this._onWikiOnThisDay(data));
        }
        if (this.show_wiki_featured) {
            this._wikiPending++;
            Wikipedia.fetchFeatured(y, m, d, lang,
                (data) => this._onWikiFeatured(data));
        }

        // All sub-options disabled — nothing to show
        if (this._wikiPending === 0) {
            this._labelWikiStatus.visible = false;
        }
    },

    /** Called after each Wikipedia async callback to update the status label. */
    _afterWikiFetch: function() {
        if (this._isDestroyed) return;
        this._wikiPending = Math.max(0, (this._wikiPending || 0) - 1);
        if (this._wikiPending > 0) return;   // more callbacks still pending

        this._labelWikiStatus.visible = false;
    },

    _onWikiOnThisDay: function(data) {
        if (this._isDestroyed) return;
        if (data) {
            this._wikiOnThisDayData = data;
            this._renderWikiOnThisDay();
        } else {
            global.logWarning("Calendarium: Wikipedia onthisday returned no data");
        }
        this._afterWikiFetch();
    },

    /**
     * Render the "On This Day" section using the stored data and current
     * rotation offset.  Called both from the fetch callback and from
     * _scheduleWikipedia when cached data is already available.
     */
    _renderWikiOnThisDay: function() {
        let data = this._wikiOnThisDayData;
        if (!data) return;

        let n      = Math.max(1, this.wikipedia_items_count || 3);
        let every  = Math.max(1, this.wikipedia_rotate_minutes || 5);
        let step   = Math.floor(this._wikiRotateStep / every);

        let self = this;
        function rotateSlice(arr) {
            if (!arr || arr.length === 0) return [];
            let start = (step * n) % arr.length;
            let result = [];
            for (let i = 0; i < n; i++) {
                result.push(arr[(start + i) % arr.length]);
            }
            return result;
        }
        function entryText(e) {
            let year  = e.year ? e.year + ": " : "";
            let title = (e.pages && e.pages[0])
                ? e.pages[0].normalizedtitle
                : (e.text || "");
            return year + title;
        }

        if (this.show_wiki_births && data.births && data.births.length > 0) {
            let items = rotateSlice(data.births).map(entryText);
            this._labelWikiBirthsHeader.set_text(_("Births on this day"));
            this._labelWikiBirths.set_text(
                items.map((s) => this._wrapText(s, 48)).join("\n")
            );
            this._labelWikiBirthsHeader.visible = true;
            this._labelWikiBirths.visible       = true;
        }

        if (this.show_wiki_deaths && data.deaths && data.deaths.length > 0) {
            let items = rotateSlice(data.deaths).map(entryText);
            this._labelWikiDeathsHeader.set_text(_("Deaths on this day"));
            this._labelWikiDeaths.set_text(
                items.map((s) => this._wrapText(s, 48)).join("\n")
            );
            this._labelWikiDeathsHeader.visible = true;
            this._labelWikiDeaths.visible       = true;
        }

        if (this.show_wiki_events && data.events && data.events.length > 0) {
            let items = rotateSlice(data.events).map(entryText);
            this._labelWikiEventsHeader.set_text(_("Events on this day"));
            this._labelWikiEvents.set_text(
                items.map((s) => this._wrapText(s, 48)).join("\n")
            );
            this._labelWikiEventsHeader.visible = true;
            this._labelWikiEvents.visible       = true;
        }
    },

    /**
     * Word-wrap text to at most maxCols characters per line.
     * Splits on spaces; never breaks mid-word unless the word itself is longer.
     */
    _wrapText: function(text, maxCols) {
        if (!text) return "";
        let words  = text.split(" ");
        let lines  = [];
        let line   = "";
        for (let i = 0; i < words.length; i++) {
            let w = words[i];
            if (!line) {
                line = w;
            } else if (line.length + 1 + w.length <= maxCols) {
                line += " " + w;
            } else {
                lines.push(line);
                line = w;
            }
        }
        if (line) lines.push(line);
        return lines.join("\n");
    },

    _onWikiFeatured: function(data) {
        if (this._isDestroyed) return;

        if (data && data.tfa) {
            let tfa     = data.tfa;
            let title   = tfa.normalizedtitle || tfa.title || "";
            let extract = tfa.extract || "";
            let dot     = extract.indexOf(". ");
            if (dot > 0) extract = extract.substring(0, dot + 1);
            let combined = title + (extract ? (": " + extract) : "");
            this._labelWikiFeaturedHeader.set_text(_("Article of the day"));
            this._labelWikiFeatured.set_text(this._wrapText(combined, 48));
            this._labelWikiFeaturedHeader.visible = true;
            this._labelWikiFeatured.visible       = true;
        } else {
            global.logWarning("Calendarium: Wikipedia featured returned no data");
        }

        this._afterWikiFetch();
    },

    // ── Settings change handler ───────────────────────────────────────────

    _onSettingChanged: function() {
        // Reset Wikipedia rotation so the new settings take effect immediately
        this._wikiRotateStep    = 0;
        this._wikiOnThisDayData = null;
        this._loadNamedayData(() => this._refresh());
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
        if (this._geoTimeout) {
            Mainloop.source_remove(this._geoTimeout);
            this._geoTimeout = null;
        }
    }
};
