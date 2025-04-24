const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;


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

        this.container = new St.BoxLayout({ vertical: true });
        this.label = new St.Label({ text: "...", style_class: "calendar-label" });
        this.footerBox = new St.BoxLayout({ vertical: false, x_expand: true });    
        this._nextScheduledUpdate = null;
        this.timeLabel = new St.Label({ text: "..." });
        this.refreshIcon = new St.Icon({
            icon_name: "view-refresh-symbolic",
            style_class: "system-status-icon",
            reactive: true,
            track_hover: true,
            can_focus: true
        });
        this.footerBox.add_child(this.timeLabel);
        this.footerBox.add_child(this.refreshIcon);
        this.refreshIcon.connect("button-press-event", () => {
            this._updateTodaysEvents();
        });
        this.footerBox.set_style("justify-content: space-between; padding-top: 4px;");
        this.container.add_child(this.label);
        this.container.add_child(this.footerBox);
        this.setContent(this.container);

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("sourceType", "sourceType", this._updateTodaysEvents.bind(this));
        this.settings.bind("icsUrl", "icsUrl", this._updateTodaysEvents.bind(this));
        this.settings.bind("icsFilePath", "icsFilePath", this._updateTodaysEvents.bind(this));        
        this.settings.bind("width", "width", this._updateTodaysEvents.bind(this));
        this.settings.bind("height", "height", this._updateTodaysEvents.bind(this));
        this.settings.bind("font", "font", this._updateTodaysEvents.bind(this));
        this.settings.bind("fontSize", "fontSize", this._updateTodaysEvents.bind(this));
        this.settings.bind("checkInterval", "checkInterval", this._resetUpdateTimer.bind(this));

        this._resetUpdateTimer();
        this._updateTodaysEvents();
    },        


    _onDestroy: function() {
        if(this._timeoutId) Mainloop.source_remove(this._timeoutId);
        this._timeoutId = null;
    },


    _resetUpdateTimer: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    
        let now = new Date();
        this._nextScheduledUpdate = new Date(now.getTime() + this.checkInterval * 60 * 1000);        

        if (this.checkInterval > 0) {
            this._timeoutId = Mainloop.timeout_add_seconds(this.checkInterval * 60, () => {
                this._updateTodaysEvents();
                this._resetUpdateTimer(); // schedule the next one
                return false; // don’t keep repeating — we reset manually
            });
        }
    },
    

    _updateTodaysEvents: function () {
        this._updateUIStyles();
        
        this._loadEventsText((eventsText) => {
            if (eventsText == null) return;
    
            let now = new Date();
            this._updateCheckedText(now);
            this._updateEventsList(now, eventsText);
        });
    },
    
    
    _updateUIStyles: function() {
        this.label.set_style(`            
            overflow: hidden;
            text-overflow: ellipsis;
            font-family: ${this.font};
            font-size: ${this.fontSize}pt;
        `);
        this.label.set_x_expand(true);
        this.label.set_y_expand(true);
        this.label.clutter_text.set_line_wrap(false);
    
        this.container.set_style(`
            width: ${this.width}px;
            height: ${this.height}px;            
        `);
    },


    _loadEventsText: function(callback) {
        if (this.sourceType === "file") {
            let filePath = this.icsFilePath;
            if (filePath.startsWith("file://")) {
                filePath = Gio.File.new_for_uri(filePath).get_path();
            }
    
            try {
                if (filePath && GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                    let result = GLib.file_get_contents(filePath);
                    if (result[0]) {
                        let eventsText = result[1].toString();
                        callback(eventsText);
                        return;
                    } else {
                        global.logError("ICS Today: problem reading calendar file, result = " + result[0]);
                    }
                }
            } catch (e) {
                global.logError("ICS Today: Failed to read file: " + e);
            }
    
            this.label.set_text("Error reading calendar. Try 'right click, configure...'");
            callback(null);
        }
    
        else if (this.sourceType === "url") {
            try {
                let command = `curl -fsSL "${this.icsUrl}"`;
                let result = GLib.spawn_command_line_sync(command);
                if (result && result[0]) {
                    let eventsText = result[1].toString();
                    callback(eventsText);
                } else {
                    global.logError("ICS Today: Failed to fetch calendar from URL.");
                    this.label.set_text("Could not fetch calendar from URL.");
                    callback(null);
                }
            } catch (e) {
                global.logError("ICS Today: Error during curl fetch: " + e);
                this.label.set_text("Error fetching calendar from URL.");
                callback(null);
            }
        }
    
        else {
            global.logError("ICS Today: Unknown source type: " + this.sourceType);
            this.label.set_text("Calendar source type not recognised.");
            callback(null);
        }
    },    


    _updateCheckedText: function(now) {
        let timeStr = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
        let text = `Last checked: ${timeStr} `;
        
        if (this._nextScheduledUpdate) {
            let nh = String(this._nextScheduledUpdate.getHours()).padStart(2, "0");
            let nm = String(this._nextScheduledUpdate.getMinutes()).padStart(2, "0");
            text += `• Next: ${nh}:${nm} `;
        }

        this.timeLabel.set_text(text);       
    },


    _updateEventsList: function(now, eventsText) {
        let yyyy = now.getFullYear().toString();
        let mm = String(now.getMonth() + 1).padStart(2, '0');
        let dd = String(now.getDate()).padStart(2, '0');
        let today = yyyy + mm + dd;

        let events = eventsText.split("BEGIN:VEVENT").slice(1);
        let eventList = [];
    
        for (let eventText of events) {
            let dtstartMatch = eventText.match(/DTSTART[^:]*:(\d{8})T?(\d{4})?/);  // Match date and optional time
            let summaryMatch = eventText.match(/SUMMARY:(.*)/);
        
            if (dtstartMatch && summaryMatch) {
                let datePart = dtstartMatch[1];
                let timePart = dtstartMatch[2] || "0000";
            
                if (datePart === today) {
                    let hour = parseInt(timePart.slice(0, 2), 10);
                    let minute = parseInt(timePart.slice(2, 4), 10);
                    let eventDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
            
                    if (!dtstartMatch[2] || eventDate >= now) {
                        let timeStr = dtstartMatch[2]
                            ? timePart.slice(0, 2) + ":" + timePart.slice(2, 4)
                            : "All day";
            
                        eventList.push({
                            time: eventDate,
                            label: `${timeStr} - ${summaryMatch[1].trim()}`,                            
                        });
                    }
                }

                eventList.sort((a,b) => a.time - b.time);
            }            
        }
    
        if (eventList.length > 0) {
            this.label.set_text("Today's Events:\n" + eventList.map(e => e.label).join("\n"));
        } else {
            this.label.set_text("No events today.");
        }
    }
    
};
