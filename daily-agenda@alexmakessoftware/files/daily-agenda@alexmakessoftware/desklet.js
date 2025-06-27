const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

const UUID_text_lookup = "daily-agenda@alexmakessoftware";
const FOOTER_ALLOWANCE = 30; //px


// Dynamically get the desklet path from available UUIDs, (works with dev-test too).
let DESKLET_DIR = '.';
for (let key in imports.ui.deskletManager.deskletMeta) {
    if (key.endsWith('daily-agenda@alexmakessoftware')) {
        DESKLET_DIR = imports.ui.deskletManager.deskletMeta[key].path;
        break;
    }
}
imports.searchPath.unshift(`${DESKLET_DIR}/helpers`);
//helper module imports (must be at module scope)
const IcsHelperModule = imports['ics-helper']; 
const helper = new IcsHelperModule.IcsHelper();
// helper.setLogger(global.log); //uncomment to enabled debugging of helper.


function _(str) {
    return Gettext.dgettext(UUID_text_lookup, str);
}


function formatTime(date) {
    const hours = date.get_hour().toString().padStart(2, "0");
    const minutes = date.get_minute().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}


function main(metadata, desklet_id) {    
    return new IcsDesklet(metadata, desklet_id);    
}


function IcsDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);    
}


IcsDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {               
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        Gettext.bindtextdomain(metadata.uuid, GLib.get_home_dir() + "/.local/share/locale");
        this._timeoutId = null;
        this._nextScheduledUpdate = null;
        this._httpSession = new Soup.Session();
        this._bindSettings(metadata.uuid, desklet_id);
        this._prepareGUI();
        this._resetUpdateTimer();
        this._updateTodaysEvents();
    },        


    _onDestroy: function() {
        if(this._timeoutId) Mainloop.source_remove(this._timeoutId);
        this._timeoutId = null;
    },


    _errorMessage: function(msg) {
        this.label.set_text(_(msg));
    },


    _prepareGUI: function() {
        const footerBox = new St.BoxLayout({ vertical: false, x_expand: true });
    
        this.timeLabel = new St.Label({ text: "..." });
        footerBox.add_child(this.timeLabel);
    
        const refreshIcon = new St.Icon({
            icon_name: "view-refresh-symbolic",
            style_class: "system-status-icon",
            reactive: true,
            track_hover: true,
            can_focus: true
        });
        footerBox.add_child(refreshIcon);
        refreshIcon.connect("button-press-event", () => {
            this._updateTodaysEvents();
        });
        footerBox.set_style("justify-content: space-between; padding-top: 4px;");
            
        this.label = new St.Label({
            text: "...",
            x_expand: true,
            y_expand: false
        });
        this.label.clutter_text.set_line_wrap(false);
        this.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    
        const labelClip = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false
        });
        labelClip.set_size(this.width, this.height - FOOTER_ALLOWANCE);
        labelClip.set_clip_to_allocation(true);
        labelClip.add_child(this.label);
    
        this.container = new St.BoxLayout({ vertical: true });
        this.container.add_child(labelClip);
        this.container.add_child(footerBox);
    
        this.setContent(this.container);
    },  


    _updateUIStyles: function() {
        this.label.set_style(`            
            font-family: ${this.font};
            font-size: ${this.fontSize}pt;
        `);
        this.label.set_x_expand(true);
        this.label.set_y_expand(true);
    
        this.container.set_style(`
            width: ${this.width}px;
            height: ${this.height}px;            
        `);
    },


    _bindSettings: function(uuid, desklet_id) {
        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);
        this.settings.bind("sourceType", "sourceType", this._updateTodaysEvents.bind(this));
        this.settings.bind("icsUrl", "icsUrl", this._updateTodaysEvents.bind(this));
        this.settings.bind("icsFilePath", "icsFilePath", this._updateTodaysEvents.bind(this));        
        this.settings.bind("width", "width", this._updateTodaysEvents.bind(this));
        this.settings.bind("height", "height", this._updateTodaysEvents.bind(this));
        this.settings.bind("font", "font", this._updateTodaysEvents.bind(this));
        this.settings.bind("fontSize", "fontSize", this._updateTodaysEvents.bind(this));
        this.settings.bind("checkInterval", "checkInterval", this._resetUpdateTimer.bind(this));
    },


    _resetUpdateTimer: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    
        const now = new Date();
        this._nextScheduledUpdate = new Date(now.getTime() + this.checkInterval * 60 * 1000);        

        if (this.checkInterval > 0) {
            this._timeoutId = Mainloop.timeout_add_seconds(this.checkInterval * 60, () => {
                this._updateTodaysEvents();
                this._resetUpdateTimer();
                return false;
            });
        }
    },


    _updateTodaysEvents: function () {
        this._updateUIStyles();
        
        this._fetchEvents((rawIcsText) => {
            if (rawIcsText === null) return;

            const now = new Date();
            this._updateCheckedText(now);
            const eventList = helper.parseTodaysEvents(rawIcsText);
            this._renderEventList(eventList);
        });
    },


    _fetchEvents: function(callback) {
        if (this.sourceType === "file") {
            this._loadFromFile(this.icsFilePath, callback);
        }
    
        else if (this.sourceType === "url") {
            this._loadFromUrl(this.icsUrl, callback);
        } else {
            global.logError(_("ICS Today: Unknown source type: ") + this.sourceType);
            this._errorMessage("Calendar source type not recognised.");
            callback(null);
        }        
    },    


    _loadFromFile: function(filePath, callback) {
        
        if (!filePath) {
            this._errorMessage("Error reading calendar. Try 'right click, configure...'");
            callback(null);
            return;
        }
        
        if (filePath.startsWith("file://")) {
            filePath = Gio.File.new_for_uri(filePath).get_path();
        }

        try {
            if (filePath && GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                const result = GLib.file_get_contents(filePath);
                if (result[0]) {
                    let eventsText = ByteArray.toString(result[1]);
                    callback(eventsText);
                    return;
                } else {
                    global.logError(_("ICS Today: problem reading calendar file, result = ") + result[0]);
                }
            }
        } catch (e) {
            global.logError(_("ICS Today: Failed to read file: ") + e);
        }

        this._errorMessage("Error reading calendar. Try 'right click, configure...'");            
        callback(null);
    },


    _loadFromUrl: function(url, callback) {        
        const message = Soup.Message.new('GET', url);        
    
        this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                const bytes = this._httpSession.send_and_read_finish(res);
                const eventsText = ByteArray.toString(bytes.get_data());
                callback(eventsText);
            } catch (e) {
                global.logError(_("ICS Today: Failed to fetch calendar from URL: ") + e.message);
                this._errorMessage("Could not fetch calendar from URL.");
                callback(null);
            }
        });
    },    


    _updateCheckedText: function(now) {
        const timeStr = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
        let text = `${_("Last checked")}: ${timeStr} `;
        
        if (this._nextScheduledUpdate) {
            let nh = String(this._nextScheduledUpdate.getHours()).padStart(2, "0");
            let nm = String(this._nextScheduledUpdate.getMinutes()).padStart(2, "0");
            text += `• ${_("Next")}: ${nh}:${nm} `;
        }

        this.timeLabel.set_text(text);       
    },


    _renderEventList: function(eventList) {        
        const allDayStr = _("All day");
        
        if (eventList.length > 0) {
            this.label.set_text(_("Today's Events:") + "\n" + eventList.map(
                (e) => `${e.is_all_day ? allDayStr : formatTime(e.time)} : ${e.summary}`
            ).join("\n"));
        } else {
            this.label.set_text(_("No events today."));
        }
    }
    
};
