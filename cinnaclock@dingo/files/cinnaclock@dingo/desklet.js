const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "cinnaclock@dingo";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

const WallClock = new CinnamonDesktop.WallClock();

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

const PRESETS = {
    "modern": {
        "timeFormat": "%A", "dayFormat": "%H:%M", "dateFormat": "%e %B %Y",
        "show-background": false, "bgColor": "rgba(255, 255, 255, 0.0)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 20, "time-horizontal-offset": 0,
        "timeFont": "Anurati Bold 50", "timeColor": "#ffffff", "time-uppercase": true,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": true, "day-vertical-offset": -120, "day-horizontal-offset": 0,
        "dayFont": "Smooch Regular 46", "dayColor": "rgba(26,95,180,1)", "day-uppercase": false,
        "horizontal-dayshadow": 2, "vertical-dayshadow": 2, "dayshadow-blur": 3, "dayshadow-color": "rgba(0,0,0,0.2)",
        "show-date": true, "date-vertical-offset": -160, "date-horizontal-offset": 0,
        "dateFont": "Noto Sans Regular 14", "dateColor": "rgba(222,221,218,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "clear": {
        "timeFormat": "%H:%M", "dayFormat": "%A", "dateFormat": "%e %B %Y",
        "show-background": false, "bgColor": "rgba(255, 255, 255, 0.0)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 40, "time-horizontal-offset": 0,
        "timeFont": "Maven Pro Bold 70", "timeColor": "#ffffff", "time-uppercase": true,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": true, "day-vertical-offset": -186, "day-horizontal-offset": 0,
        "dayFont": "Smooch Regular 46", "dayColor": "rgba(255,120,0,0.9)", "day-uppercase": false,
        "horizontal-dayshadow": 6, "vertical-dayshadow": 6, "dayshadow-blur": 5, "dayshadow-color": "rgba(0,0,0,0.2)",
        "show-date": true, "date-vertical-offset": -200, "date-horizontal-offset": 0,
        "dateFont": "Liberation Sans Regular 12", "dateColor": "rgba(255,255,255,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "digital_neon": {
        "timeFormat": "%H:%M:%S", "dayFormat": "> %A", "dateFormat": "[ %d.%m.%y ]",
        "show-background": true, "bgColor": "rgba(0, 20, 0, 0.9)", "borderRadius": 5,
        "show-time": true, "time-vertical-offset": 0, "time-horizontal-offset": 0,
        "timeFont": "DSEG14 Classic Bold 40", "timeColor": "rgba(57,255,20,1)", "time-uppercase": true,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 16, "timeshadow-color": "rgba(57,255,20,1)",
        "show-day": true, "day-vertical-offset": 0, "day-horizontal-offset": 0,
        "dayFont": "Monospace Regular 20", "dayColor": "rgba(57,255,20,1)", "day-uppercase": true,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 10, "dayshadow-color": "rgba(57,255,20,1)",
        "show-date": true, "date-vertical-offset": 0, "date-horizontal-offset": 0,
        "dateFont": "Monospace Regular 14", "dateColor": "rgba(57,255,20,1)", "date-uppercase": true,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 5, "dateshadow-color": "rgba(57,255,20,1)"
    },
    "MX": {
        "timeFormat": "%H", "dayFormat": "%M", "dateFormat": "%A %B %e",
        "show-background": false, "bgColor": "rgba(255, 255, 255, 0.0)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 50, "time-horizontal-offset": -40,
        "timeFont": "Ubuntu Condensed 66", "timeColor": "rgba(190,179,165,1)", "time-uppercase": false,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": true, "day-vertical-offset": -142, "day-horizontal-offset": 37,
        "dayFont": "Ubuntu Condensed 66", "dayColor": "rgba(252,138,1,1)", "day-uppercase": false,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 0, "dayshadow-color": "rgba(0,0,0,0.0)",
        "show-date": true, "date-vertical-offset": -170, "date-horizontal-offset": -16,
        "dateFont": "Liberation Sans Regular 8", "dateColor": "rgba(255,255,255,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "minimal_dark": {
        "timeFormat": "%H:%M", "dayFormat": "%M", "dateFormat": "%A %e %B",
        "show-background": false, "bgColor": "rgba(255, 255, 255, 0.0)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 0, "time-horizontal-offset": 0,
        "timeFont": "Poiret One Regular 50", "timeColor": "rgba(0,0,0,1)", "time-uppercase": false,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": false, "day-vertical-offset": -142, "day-horizontal-offset": 37,
        "dayFont": "Ubuntu Condensed 66", "dayColor": "rgba(252,138,1,1)", "day-uppercase": false,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 0, "dayshadow-color": "rgba(0,0,0,0.0)",
        "show-date": true, "date-vertical-offset": 0, "date-horizontal-offset": 0,
        "dateFont": "Poiret One Regular 12", "dateColor": "rgba(0,0,0,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "minimal_white": {
        "timeFormat": "%H:%M", "dayFormat": "%M", "dateFormat": "%A %e %B",
        "show-background": false, "bgColor": "rgba(255, 255, 255, 0.0)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 0, "time-horizontal-offset": 0,
        "timeFont": "Poiret One Regular 50", "timeColor": "rgba(255,255,255,1)", "time-uppercase": false,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": false, "day-vertical-offset": -142, "day-horizontal-offset": 37,
        "dayFont": "Ubuntu Condensed 66", "dayColor": "rgba(252,138,1,1)", "day-uppercase": false,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 0, "dayshadow-color": "rgba(0,0,0,0.0)",
        "show-date": true, "date-vertical-offset": 0, "date-horizontal-offset": 0,
        "dateFont": "Poiret One Regular 12", "dateColor": "rgba(255,255,255,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "phantom": {
        "timeFormat": "%H:%M %a %e %b", "dayFormat": "%m", "dateFormat": "%e",
        "show-background": true, "bgColor": "rgba(255, 255, 255, 0.3)", "borderRadius": 12,
        "show-time": true, "time-vertical-offset": 0, "time-horizontal-offset": 0,
        "timeFont": "Outfit Bold 30", "timeColor": "rgba(255, 255, 255, 0.5)", "time-uppercase": false,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 0, "timeshadow-color": "rgba(0,0,0,0.0)",
        "show-day": false, "day-vertical-offset": -142, "day-horizontal-offset": 37,
        "dayFont": "Ubuntu Condensed 66", "dayColor": "rgba(252,138,1,1)", "day-uppercase": false,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 0, "dayshadow-color": "rgba(0,0,0,0.0)",
        "show-date": false, "date-vertical-offset": -170, "date-horizontal-offset": -16,
        "dateFont": "Liberation Sans Regular 8", "dateColor": "rgba(255,255,255,1)", "date-uppercase": false,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 0, "dateshadow-color": "rgba(0,0,0,0)"
    },
    "cyberpunk": {
        "timeFormat": "%H:%M", "dayFormat": "%A", "dateFormat": "%d / %m / %Y",
        "show-background": true, "bgColor": "rgba(0, 0, 0, 0.8)", "borderRadius": 5,
        "show-time": true, "time-vertical-offset": 0, "time-horizontal-offset": 0,
        "timeFont": "Monospace Bold 50", "timeColor": "rgba(238,0,255,1)", "time-uppercase": true,
        "horizontal-timeshadow": 0, "vertical-timeshadow": 0, "timeshadow-blur": 15, "timeshadow-color": "rgba(238,0,255,1)",
        "show-day": true, "day-vertical-offset": 0, "day-horizontal-offset": 0,
        "dayFont": "Monospace Regular 30", "dayColor": "rgba(0,255,255,1)", "day-uppercase": true,
        "horizontal-dayshadow": 0, "vertical-dayshadow": 0, "dayshadow-blur": 15, "dayshadow-color": "rgba(0,255,255,1)",
        "show-date": true, "date-vertical-offset": 0, "date-horizontal-offset": 0,
        "dateFont": "Monospace Regular 12", "dateColor": "rgba(255,255,0,1)", "date-uppercase": true,
        "horizontal-dateshadow": 0, "vertical-dateshadow": 0, "dateshadow-blur": 5, "dateshadow-color": "rgba(255,255,0,1)"
    }
};

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this._showDeskletHeader = false;
        this.setHeader("");

        this.clock = new CinnamonDesktop.WallClock();
        this.clock.set_format_string("%H:%M:%S");
        this.clock_notify_id = 0;

        this._clockContainer = new St.BoxLayout({
            style_class: 'clock-container',
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this._time = new St.Label();
        this._day  = new St.Label();
        this._date = new St.Label();

        this._timeBox = new St.BoxLayout({ style_class: 'time-container', vertical: true });
        this._dayBox = new St.BoxLayout({ style_class: 'day-container', vertical: true });
        this._dateBox = new St.BoxLayout({ style_class: 'date-container', vertical: true });

        this._timeBox.add_child(this._time, { 
            x_align: St.Align.MIDDLE, 
            y_align: St.Align.MIDDLE, 
            x_fill: false, 
            y_fill: false, 
            x_expand: false, 
            y_expand: false 
        });
        this._dayBox.add_child(this._day, { 
            x_align: St.Align.MIDDLE, 
            y_align: St.Align.MIDDLE, 
            x_fill: false, 
            y_fill: false, 
            x_expand: false, 
            y_expand: false 
        });
        this._dateBox.add_child(this._date, { 
            x_align: St.Align.MIDDLE, 
            y_align: St.Align.MIDDLE, 
            x_fill: false, 
            y_fill: false, 
            x_expand: false, 
            y_expand: false 
        });

        this._clockContainer.add_child(this._timeBox, {
            x_expand: false,
            y_expand: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this._clockContainer.add_child(this._dayBox, {
            x_expand: false,
            y_expand: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this._clockContainer.add_child(this._dateBox, {
            x_expand: false,
            y_expand: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this.setContent(this._clockContainer);

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._bindSettings();

        let configFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/cinnaclock@dingo/settings-schema.json";
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.TOP);
        this._menuManager.addMenu(this.menu);

        this.menu.addAction(_("Edit Config"), Lang.bind(this, function() {
            Util.spawnCommandLine("xdg-open " + configFile);
        }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(_("Date and Time Settings"), "calendar");
    },

    _parseFontString: function(fontString, color) {
        if (!fontString) return "color: " + color + "; font: Sans Regular 16;";
        let fontprep = fontString.split(' ');
        let fontsize = fontprep.pop().replace('pt', '').replace(/[^0-9.]/g, ''); 
        let fontweight = '';
        let fontstyle = '';
        let fontname = fontprep.join(' ').replace(/,/g, ' ');

        ['Italic', 'Oblique'].forEach(function(item) {
            if (fontname.includes(item)) { fontstyle = item; fontname = fontname.replace(item, ''); }
        });
        ['Bold', 'Light', 'Medium', 'Heavy', 'Regular'].forEach(function(item) {
            if (fontname.includes(item)) { fontweight = item; fontname = fontname.replace(item, ''); }
        });

        fontname = fontname.trim().replace(/\s+/g, ' ');
        let style = "color: " + color + "; font-size: " + fontsize + "pt; font-family: " + fontname + ", Sans; ";
        if (fontstyle) style += "font-style: " + fontstyle + "; ";
        if (fontweight) style += "font-weight: " + fontweight + "; ";
        style += "text-align: center;";
        return style.toLowerCase();
    },

    _bindSettings: function() {
        this.settings.bind("timeFormat", "timeFormat", this._onSettingsChanged);
        this.settings.bind("dayFormat", "dayFormat", this._onSettingsChanged);
        this.settings.bind("dateFormat", "dateFormat", this._onSettingsChanged);
        this.settings.bind("timeColor", "timeColor", this._onSettingsChanged);
        this.settings.bind("dayColor", "dayColor", this._onSettingsChanged);
        this.settings.bind("dateColor", "dateColor", this._onSettingsChanged);
        this.settings.bind("timeFont", "timeFont", this._onSettingsChanged);
        this.settings.bind("dayFont", "dayFont", this._onSettingsChanged);
        this.settings.bind("dateFont", "dateFont", this._onSettingsChanged);

        // Binding Shadow
        this.settings.bind("horizontal-dayshadow", "horDayShadow", this._onSettingsChanged);
        this.settings.bind("vertical-dayshadow", "vertDayShadow", this._onSettingsChanged);
        this.settings.bind("dayshadow-blur", "dayShadowBlur", this._onSettingsChanged);
        this.settings.bind("dayshadow-color", "dayShadowColor", this._onSettingsChanged);
        this.settings.bind("horizontal-timeshadow", "horTimeShadow", this._onSettingsChanged);
        this.settings.bind("vertical-timeshadow", "vertTimeShadow", this._onSettingsChanged);
        this.settings.bind("timeshadow-blur", "timeShadowBlur", this._onSettingsChanged);
        this.settings.bind("timeshadow-color", "timeShadowColor", this._onSettingsChanged);
        this.settings.bind("horizontal-dateshadow", "horDateShadow", this._onSettingsChanged);
        this.settings.bind("vertical-dateshadow", "vertDateShadow", this._onSettingsChanged);
        this.settings.bind("dateshadow-blur", "dateShadowBlur", this._onSettingsChanged);
        this.settings.bind("dateshadow-color", "dateShadowColor", this._onSettingsChanged);

        // Binding Uppercase
        this.settings.bind("time-uppercase", "timeUppercase", this._onSettingsChanged);
        this.settings.bind("day-uppercase", "dayUppercase", this._onSettingsChanged);
        this.settings.bind("date-uppercase", "dateUppercase", this._onSettingsChanged);
        
        // Binding Visibility
        this.settings.bind("show-time", "showTime", this._onSettingsChanged);
        this.settings.bind("show-day", "showDay", this._onSettingsChanged);
        this.settings.bind("show-date", "showDate", this._onSettingsChanged);

        // Binding Offset
        this.settings.bind("time-vertical-offset", "timeVerticalOffset", this._onSettingsChanged);
        this.settings.bind("day-vertical-offset", "dayVerticalOffset", this._onSettingsChanged);
        this.settings.bind("date-vertical-offset", "dateVerticalOffset", this._onSettingsChanged);
        this.settings.bind("time-horizontal-offset", "timeHorizontalOffset", this._onSettingsChanged);
        this.settings.bind("day-horizontal-offset", "dayHorizontalOffset", this._onSettingsChanged);
        this.settings.bind("date-horizontal-offset", "dateHorizontalOffset", this._onSettingsChanged);

        // Binding Background and Rounding
        this.settings.bind("show-background", "showBackground", this._onSettingsChanged);
        this.settings.bind("bgColor", "bgColor", this._onSettingsChanged);
        this.settings.bind("borderRadius", "borderRadius", this._onSettingsChanged);
        // Binding Preset
        this.settings.bind("presetChoice", "presetChoice", this._onPresetChanged);
    },

    _onPresetChanged: function() {
        if (this.presetChoice === "manual") return;
    
        let preset = PRESETS[this.presetChoice];
        if (preset) {
            for (let key in preset) {
                this.settings.setValue(key, preset[key]);
            }
        }

        this.presetChoice = "manual";
        this.settings.setValue("presetChoice", "manual");

        this._onSettingsChanged();
    },
   
    _onSettingsChanged: function() {
        // Layer Visibility
        this._timeBox.visible = this.showTime;
        this._dayBox.visible = this.showDay;
        this._dateBox.visible = this.showDate;

        // Text style (Font, Color, Shadow)
        let s = (h, v, b, c) => (b > 0 || h != 0 || v != 0) ? `text-shadow: ${h}px ${v}px ${b}px ${c};` : "";
        
        this._time.set_style(this._parseFontString(this.timeFont, this.timeColor) + s(this.horTimeShadow, this.vertTimeShadow, this.timeShadowBlur, this.timeShadowColor));
        this._day.set_style(this._parseFontString(this.dayFont, this.dayColor) + s(this.horDayShadow, this.vertDayShadow, this.dayShadowBlur, this.dayShadowColor));
        this._date.set_style(this._parseFontString(this.dateFont, this.dateColor) + s(this.horDateShadow, this.vertDateShadow, this.dateShadowBlur, this.dateShadowColor));

        // Offset
        this._timeBox.set_translation(this.timeHorizontalOffset, this.timeVerticalOffset, 0);
        this._dayBox.set_translation(this.dayHorizontalOffset, this.dayVerticalOffset, 0);
        this._dateBox.set_translation(this.dateHorizontalOffset, this.dateVerticalOffset, 0);

        // Background
        let bgColor = this.showBackground ? this.bgColor : "rgba(0,0,0,0)";
        this._clockContainer.set_style(`background-color: ${bgColor}; border-radius: ${this.borderRadius}px;`);

    this._updateDate();
    },
    

    _updateDate: function() {
        let displayDate = new Date(); 
        try {
            let timeText = displayDate.toLocaleFormat(this.timeFormat);
            let dayText = displayDate.toLocaleFormat(this.dayFormat);
            let dateText = displayDate.toLocaleFormat(this.dateFormat);

            if (this.timeUppercase) {
                timeText = timeText.toUpperCase();
            }

            if (this.dayUppercase) {
                dayText = dayText.toUpperCase();
            } else {
                // If it's not all capitalized, just capitalize the first letter (e.g. Saturday)
                if (dayText) {
                    dayText = dayText.charAt(0).toUpperCase() + dayText.slice(1);
                }
            }
            
            if (this.dateUppercase) {
                dateText = dateText.toUpperCase();
            }

            this._time.set_text(timeText);
            this._day.set_text(dayText);
            this._date.set_text(dateText);
            
        } catch(e) {
            this._time.set_text(displayDate.toLocaleTimeString());
            this._day.set_text(displayDate.toDateString());
            this._date.set_text(displayDate.toLocaleDateString());
        }
    },
    
    _clockNotify: function() { this._updateDate(); },
    
    on_desklet_added_to_desktop: function() {
        this._onSettingsChanged(); 
        if (this.clock_notify_id === 0) {
        this.clock_notify_id = this.clock.connect("notify::clock", Lang.bind(this, this._clockNotify));
    }
},
    
    on_desklet_removed: function() {
        if (this.clock_notify_id > 0) {
            WallClock.disconnect(this.clock_notify_id);
            this.clock_notify_id = 0;
        }
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
