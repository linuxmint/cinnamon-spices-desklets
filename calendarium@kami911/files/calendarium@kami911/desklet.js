/*
 * Calendarium — A rich calendar and astronomical information desklet
 * for the Cinnamon Desktop.
 *
 * UUID: calendarium@kami911
 * Author: kami911 <kami911@gmail.com>
 * License: GPL-3.0
 *
 * Features (all individually toggleable):
 *   • Date display with customizable strftime format
 *   • Time (12h/24h, optional seconds)
 *   • Traditional/historical month names (hu/en/de)
 *   • Moon phase (local Julian-date algorithm)
 *   • Sunrise & sunset (NOAA simplified, local calculation)
 *   • Western and Chinese zodiac
 *   • Days until New Year countdown
 *   • Name days with lookahead (local JSON datasets)
 *   • Optional Wikipedia features (births/deaths, article of the day)
 */

const Desklet   = imports.ui.desklet;
const Settings  = imports.ui.settings;
const Mainloop  = imports.mainloop;
const Lang      = imports.lang;
const St        = imports.gi.St;
const GLib      = imports.gi.GLib;
const Gio       = imports.gi.Gio;
const Gettext   = imports.gettext;

// ── UUID and paths ────────────────────────────────────────────────────────
const UUID       = "calendarium@kami911";
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

// ── Default location: Budapest, Hungary ──────────────────────────────────
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

        this._bindAllSettings(desklet_id);
        this._loadNamedayData();
        this._setupUI();
    },

    _bindAllSettings: function(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let s = this.settings;
        let IN = Settings.BindingDirection.IN;
        let cb = Lang.bind(this, this._onSettingChanged);

        // Date & Time
        s.bindProperty(IN, "show-date",          "show_date",          cb);
        s.bindProperty(IN, "date-format-preset", "date_format_preset", cb);
        s.bindProperty(IN, "date-format-custom", "date_format_custom", cb);
        s.bindProperty(IN, "show-time",          "show_time",          cb);
        s.bindProperty(IN, "time-format",  "time_format",  cb);
        s.bindProperty(IN, "show-seconds", "show_seconds", cb);

        // Traditional month names
        s.bindProperty(IN, "show-traditional",  "show_traditional",  cb);
        s.bindProperty(IN, "traditional-lang",  "traditional_lang",  cb);

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
        s.bindProperty(IN, "show-namedays",      "show_namedays",      cb);
        s.bindProperty(IN, "nameday-locale",     "nameday_locale",     cb);
        s.bindProperty(IN, "nameday-lookahead",  "nameday_lookahead",  cb);

        // New Year
        s.bindProperty(IN, "show-new-year-countdown", "show_new_year_countdown", cb);

        // Wikipedia (online)
        s.bindProperty(IN, "show-wikipedia",    "show_wikipedia",    cb);
        s.bindProperty(IN, "wikipedia-lang",    "wikipedia_lang",    cb);
        s.bindProperty(IN, "show-wiki-births",  "show_wiki_births",  cb);
        s.bindProperty(IN, "show-wiki-deaths",  "show_wiki_deaths",  cb);
        s.bindProperty(IN, "show-wiki-featured","show_wiki_featured",cb);

        // Appearance
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

        // Date
        this._labelDate = new St.Label({ style_class: "calendarium-date",     text: "" });
        // Time
        this._labelTime = new St.Label({ style_class: "calendarium-time",     text: "" });
        // Traditional month name
        this._labelTraditional = new St.Label({ style_class: "calendarium-traditional", text: "" });
        // Moon phase (symbol + name)
        this._labelMoon = new St.Label({ style_class: "calendarium-moon",     text: "" });
        // Moon age
        this._labelMoonAge = new St.Label({ style_class: "calendarium-moon-age", text: "" });
        // Sunrise
        this._labelSunrise = new St.Label({ style_class: "calendarium-sun",   text: "" });
        // Sunset
        this._labelSunset  = new St.Label({ style_class: "calendarium-sun",   text: "" });
        // Additional cities (up to 3 × 2 rows: sunrise + sunset)
        this._labelCity = [];
        for (let i = 0; i < 3; i++) {
            this._labelCity.push({
                sunrise: new St.Label({ style_class: "calendarium-city", text: "" }),
                sunset:  new St.Label({ style_class: "calendarium-city", text: "" })
            });
        }
        // Western zodiac
        this._labelZodiacWestern = new St.Label({ style_class: "calendarium-zodiac-western", text: "" });
        // Chinese zodiac
        this._labelZodiacChinese = new St.Label({ style_class: "calendarium-zodiac-chinese", text: "" });
        // Name days (today + up to 5 lookahead days)
        this._labelNameday = [];
        for (let i = 0; i <= 5; i++) {
            let cls = i === 0 ? "calendarium-nameday" : "calendarium-nameday-sub";
            this._labelNameday.push(new St.Label({ style_class: cls, text: "" }));
        }
        // New Year countdown
        this._labelNewYear = new St.Label({ style_class: "calendarium-newyear", text: "" });
        // Wikipedia
        this._labelWikiBirthsHeader  = new St.Label({ style_class: "calendarium-wiki-header", text: "" });
        this._labelWikiBirths        = new St.Label({ style_class: "calendarium-wiki",         text: "" });
        this._labelWikiDeathsHeader  = new St.Label({ style_class: "calendarium-wiki-header",  text: "" });
        this._labelWikiDeaths        = new St.Label({ style_class: "calendarium-wiki",         text: "" });
        this._labelWikiFeaturedHeader= new St.Label({ style_class: "calendarium-wiki-header",  text: "" });
        this._labelWikiFeatured      = new St.Label({ style_class: "calendarium-wiki-featured",text: "" });

        // Add everything to the container
        this._container.add_actor(this._labelDate);
        this._container.add_actor(this._labelTime);
        this._container.add_actor(this._labelTraditional);
        this._container.add_actor(this._labelMoon);
        this._container.add_actor(this._labelMoonAge);
        this._container.add_actor(this._labelSunrise);
        this._container.add_actor(this._labelSunset);
        for (let i = 0; i < 3; i++) {
            this._container.add_actor(this._labelCity[i].sunrise);
            this._container.add_actor(this._labelCity[i].sunset);
        }
        this._container.add_actor(this._labelZodiacWestern);
        this._container.add_actor(this._labelZodiacChinese);
        for (let i = 0; i <= 5; i++) {
            this._container.add_actor(this._labelNameday[i]);
        }
        this._container.add_actor(this._labelNewYear);
        this._container.add_actor(this._labelWikiBirthsHeader);
        this._container.add_actor(this._labelWikiBirths);
        this._container.add_actor(this._labelWikiDeathsHeader);
        this._container.add_actor(this._labelWikiDeaths);
        this._container.add_actor(this._labelWikiFeaturedHeader);
        this._container.add_actor(this._labelWikiFeatured);

        this.setContent(this._container);

        if (this.hide_decorations) {
            this.setHeader("");
        }

        this._refresh();
    },

    // ── Refresh orchestration ─────────────────────────────────────────────

    /**
     * Master refresh: update all sections, then schedule the next tick.
     * Runs every 60 seconds (or 1 second when show_seconds is true).
     */
    _refresh: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }

        let now = new Date();
        this._updateDate(now);
        this._updateTime(now);
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
        this._updateTime(new Date());
        this._clockTimeout = Mainloop.timeout_add(
            1000, Lang.bind(this, this._refreshClock)
        );
        return false;  // Don't repeat via GLib; we reschedule manually
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

    _updateTraditional: function(now) {
        this._labelTraditional.visible = this.show_traditional;
        if (!this.show_traditional) return;
        let name = Localization.getTraditionalMonthName(
            this.traditional_lang, now.getMonth()
        );
        this._labelTraditional.set_text(name || "");
    },

    _updateMoon: function(now) {
        this._labelMoon.visible    = this.show_moon;
        this._labelMoonAge.visible = this.show_moon && this.show_moon_age;
        if (!this.show_moon) return;

        let moon = Moon.getMoonPhase(now);

        // Phase symbol + name
        let phaseTxt = moon.phaseSymbol + "  " + _(moon.phaseName);
        if (!this.show_moon_name) phaseTxt = moon.phaseSymbol;
        this._labelMoon.set_text(phaseTxt);

        // Age line
        if (this.show_moon_age) {
            this._labelMoonAge.set_text(
                "  " + moon.age.toFixed(1) + " " + _("days")
            );
        }
    },

    _updateSun: function(now) {
        this._labelSunrise.visible = this.show_sun;
        this._labelSunset.visible  = this.show_sun;

        let cityNames = [this.city1_name, this.city2_name, this.city3_name];
        let cityLats  = [this.city1_lat,  this.city2_lat,  this.city3_lat];
        let cityLons  = [this.city1_lon,  this.city2_lon,  this.city3_lon];

        for (let i = 0; i < 3; i++) {
            let hasCityName = cityNames[i] && cityNames[i].trim() !== "";
            this._labelCity[i].sunrise.visible = this.show_sun && hasCityName;
            this._labelCity[i].sunset.visible  = this.show_sun && hasCityName;
        }

        if (!this.show_sun) return;

        // Primary location
        let lat = this.use_manual_location ? this.latitude  : DEFAULT_LAT;
        let lon = this.use_manual_location ? this.longitude : DEFAULT_LON;
        let sun = Sun.getSunTimes(now, lat, lon);

        this._labelSunrise.set_text(
            "\u2600 " + _("Sunrise") + ": " + this._sunStr(sun, "sunrise")
        );
        this._labelSunset.set_text(
            "\u263D " + _("Sunset")  + ": " + this._sunStr(sun, "sunset")
        );

        // Additional cities
        for (let i = 0; i < 3; i++) {
            if (!(cityNames[i] && cityNames[i].trim())) continue;
            let cs = Sun.getSunTimes(now, cityLats[i], cityLons[i]);
            this._labelCity[i].sunrise.set_text(
                "  " + cityNames[i] + " \u2600 " + this._sunStr(cs, "sunrise")
            );
            this._labelCity[i].sunset.set_text(
                "  " + cityNames[i] + " \u263D " + this._sunStr(cs, "sunset")
            );
        }
    },

    _sunStr: function(sun, key) {
        if (sun.polarDay)   return _("Polar day");
        if (sun.polarNight) return _("Polar night");
        return sun[key] || _("No data");
    },

    _updateZodiac: function(now) {
        this._labelZodiacWestern.visible = this.show_western_zodiac;
        this._labelZodiacChinese.visible = this.show_chinese_zodiac;

        if (this.show_western_zodiac) {
            let w = Zodiac.getWesternZodiac(now);
            this._labelZodiacWestern.set_text(w.symbol + "  " + _(w.name));
        }

        if (this.show_chinese_zodiac) {
            let c = Zodiac.getChineseZodiac(
                now.getFullYear(), now.getMonth() + 1, now.getDate()
            );
            this._labelZodiacChinese.set_text(
                _(c.elementKey) + " " + _(c.animalKey)
            );
        }
    },

    _updateNewYear: function(now) {
        this._labelNewYear.visible = this.show_new_year_countdown;
        if (!this.show_new_year_countdown) return;

        let nextNY = new Date(now.getFullYear() + 1, 0, 1);
        let msLeft = nextNY - now;
        let days   = Math.ceil(msLeft / 86400000);
        this._labelNewYear.set_text(days + " " + _("days until New Year"));
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
            let entry = range[i];
            let names = (entry && entry.names.length > 0)
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
        // Hide all Wikipedia labels immediately
        this._labelWikiBirthsHeader.visible  = false;
        this._labelWikiBirths.visible        = false;
        this._labelWikiDeathsHeader.visible  = false;
        this._labelWikiDeaths.visible        = false;
        this._labelWikiFeaturedHeader.visible= false;
        this._labelWikiFeatured.visible      = false;

        if (!this.show_wikipedia) return;

        let m = now.getMonth() + 1;
        let d = now.getDate();
        let y = now.getFullYear();
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
        if (!data) return;

        if (this.show_wiki_births && data.births && data.births.length > 0) {
            let items = data.births.slice(0, 3).map(function(b) {
                let year  = b.year ? b.year + ": " : "";
                let title = (b.pages && b.pages[0]) ? b.pages[0].normalizedtitle : (b.text || "");
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
                let title = (d.pages && d.pages[0]) ? d.pages[0].normalizedtitle : (d.text || "");
                return year + title;
            });
            this._labelWikiDeathsHeader.set_text(_("Deaths on this day"));
            this._labelWikiDeaths.set_text(items.join("\n"));
            this._labelWikiDeathsHeader.visible = true;
            this._labelWikiDeaths.visible       = true;
        }
    },

    _onWikiFeatured: function(data) {
        if (!data || !data.tfa) return;
        let tfa = data.tfa;
        let title   = tfa.normalizedtitle || tfa.title || "";
        let extract = tfa.extract || "";
        // Trim extract to first sentence
        let dot = extract.indexOf(". ");
        if (dot > 0) extract = extract.substring(0, dot + 1);
        this._labelWikiFeaturedHeader.set_text(_("Article of the day"));
        this._labelWikiFeatured.set_text(title + (extract ? ("\n" + extract) : ""));
        this._labelWikiFeaturedHeader.visible = true;
        this._labelWikiFeatured.visible       = true;
    },

    // ── Settings change handler ───────────────────────────────────────────

    _onSettingChanged: function() {
        // Reload nameday data if locale may have changed
        this._loadNamedayData();
        // Full refresh (cancels and reschedules timers)
        this._refresh();
    },

    // ── Cleanup ───────────────────────────────────────────────────────────

    on_desklet_removed: function() {
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
