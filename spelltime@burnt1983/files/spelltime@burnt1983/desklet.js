const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const GLib = imports.gi.GLib;

const UUID = "spelltime@burnt1983";

const NUM = {
    0: "twelve", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
    6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven",
    12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen",
    17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
    21: "twenty one", 22: "twenty two", 23: "twenty three", 24: "twenty four",
    25: "twenty five", 26: "twenty six", 27: "twenty seven", 28: "twenty eight",
    29: "twenty nine", 30: "thirty", 31: "thirty one", 32: "thirty two",
    33: "thirty three", 34: "thirty four", 35: "thirty five", 36: "thirty six",
    37: "thirty seven", 38: "thirty eight", 39: "thirty nine", 40: "forty",
    41: "forty one", 42: "forty two", 43: "forty three", 44: "forty four",
    45: "forty five", 46: "forty six", 47: "forty seven", 48: "forty eight",
    49: "forty nine", 50: "fifty", 51: "fifty one", 52: "fifty two",
    53: "fifty three", 54: "fifty four", 55: "fifty five", 56: "fifty six",
    57: "fifty seven", 58: "fifty eight", 59: "fifty nine"
};

function spellTime(hour24, minute) {
    let hour = hour24 % 12;
    if (hour === 0) {
        hour = 12;
    }
    if (minute === 0) {
        return NUM[hour] + " o'clock";
    }
    if (minute === 15) {
        return "quarter past " + NUM[hour];
    }
    if (minute === 30) {
        return "half past " + NUM[hour];
    }
    if (minute === 45) {
        let next = hour === 12 ? 1 : hour + 1;
        return "quarter to " + NUM[next];
    }
    if (minute < 30) {
        return NUM[minute] + " past " + NUM[hour];
    }
    let next = hour === 12 ? 1 : hour + 1;
    return NUM[60 - minute] + " to " + NUM[next];
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bind("font-size", "font_size", this._rebuild);
        this.settings.bind("hide-decorations", "hide_decorations", this._rebuild);
        this._timeout = 0;
        this._rebuild();
        this._tick();
    },

    _rebuild: function() {
        this.setHeader("Spelltime");
        this.metadata["prevent-decorations"] = !!this.hide_decorations;
        this._updateDecoration();
        this.label = new St.Label({ text: "", style_class: "spelltime-label" });
        this.label.style = "font-size: " + (this.font_size || 36) + "px; font-weight: bold; color: #ffffff;";
        this.box = new St.BoxLayout({ vertical: true, style_class: "spelltime-box" });
        this.box.add_actor(this.label);
        this.setContent(this.box);
    },

    _tick: function() {
        let now = GLib.DateTime.new_now_local();
        if (this.label) {
            this.label.set_text(spellTime(now.get_hour(), now.get_minute()));
        }
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
        }
        this._timeout = Mainloop.timeout_add_seconds(1, () => {
            this._tick();
            return false;
        });
    },

    on_desklet_removed: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = 0;
        }
    }
};
