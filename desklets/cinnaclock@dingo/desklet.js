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

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this._showDeskletHeader = false;
        this.setHeader("");

        this.clock = new CinnamonDesktop.WallClock();
        this.clock_notify_id = 0;

        this._clockContainer = new St.Widget({
            style_class: 'clock-container'
        });

        this._time = new St.Label();
        this._day  = new St.Label();
        this._date = new St.Label();

        this._timeBox = new St.BoxLayout({ style_class: 'time-container', vertical: true });
        this._dayBox = new St.BoxLayout({ style_class: 'day-container', vertical: true });
        this._dateBox = new St.BoxLayout({ style_class: 'date-container', vertical: true });

        // Centratura verticale nativa tramite layout
        this._timeBox.add_child(this._time, { 
            y_align: St.Align.MIDDLE, 
            y_fill: false, 
            y_expand: false 
        });
        this._dayBox.add_child(this._day, { 
            y_align: St.Align.MIDDLE, 
            y_fill: false, 
            y_expand: false 
        });
        this._dateBox.add_child(this._date, { 
            y_align: St.Align.MIDDLE, 
            y_fill: false, 
            y_expand: false 
        });

        this._clockContainer.add_child(this._timeBox);
        this._clockContainer.add_child(this._dayBox);
        this._clockContainer.add_child(this._dateBox);

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
        // Binding standard
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

        // Binding uppercase and other
        this.settings.bind("time-uppercase", "timeUppercase", this._onSettingsChanged);
        this.settings.bind("day-uppercase", "dayUppercase", this._onSettingsChanged);
        this.settings.bind("date-uppercase", "dateUppercase", this._onSettingsChanged);

        this.settings.bind("show-time", "showTime", this._onSettingsChanged);
        this.settings.bind("show-day", "showDay", this._onSettingsChanged);
        this.settings.bind("show-date", "showDate", this._onSettingsChanged);

        this.settings.bind("day-vertical-offset", "dayVerticalOffset", this._onSettingsChanged);
        this.settings.bind("date-vertical-offset", "dateVerticalOffset", this._onSettingsChanged);
    },
    
    _onSettingsChanged: function() {
        // Visibility
        this._timeBox.visible = this.showTime;
        this._dayBox.visible = this.showDay;
        this._dateBox.visible = this.showDate;

        // Style
        let s = (h, v, b, c) => (b > 0 || h != 0 || v != 0) ? `text-shadow: ${h}px ${v}px ${b}px ${c};` : "";
        
        this._time.set_style(this._parseFontString(this.timeFont, this.timeColor) + s(this.horTimeShadow, this.vertTimeShadow, this.timeShadowBlur, this.timeShadowColor));
        this._day.set_style(this._parseFontString(this.dayFont, this.dayColor) + s(this.horDayShadow, this.vertDayShadow, this.dayShadowBlur, this.dayShadowColor));
        this._date.set_style(this._parseFontString(this.dateFont, this.dateColor) + s(this.horDateShadow, this.vertDateShadow, this.dateShadowBlur, this.dateShadowColor));

        // Offset
        this._dayBox.set_translation(0, this.dayVerticalOffset, 0);
        this._dateBox.set_translation(0, this.dateVerticalOffset, 0);

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
            this.clock_notify_id = WallClock.connect("notify::clock", Lang.bind(this, this._clockNotify));
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
