const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;

const UUID = "sticky-pad@burnt1983";

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
        this.settings.bind("note-text", "note_text", this._onTextSetting);
        this.settings.bind("width", "width", this._rebuild);
        this.settings.bind("height", "height", this._rebuild);
        this.settings.bind("hide-decorations", "hide_decorations", this._rebuild);
        this._rebuild();
    },

    _rebuild: function() {
        this.setHeader("Sticky Pad");
        this.metadata["prevent-decorations"] = !!this.hide_decorations;
        this._updateDecoration();

        this.box = new St.BoxLayout({ vertical: true, style_class: "sticky-pad" });
        this.box.set_width(this.width || 280);
        this.box.set_height(this.height || 320);

        this.entry = new St.Entry({
            style_class: "sticky-pad-entry",
            hint_text: "Type here",
            can_focus: true,
            x_expand: true,
            y_expand: true
        });
        this.entry.clutter_text.set_line_wrap(true);
        this.entry.clutter_text.set_single_line_mode(false);
        this.entry.clutter_text.set_activatable(false);
        if (this.note_text) {
            this.entry.set_text(this.note_text);
        }
        this.entry.clutter_text.connect("text-changed", () => {
            this.note_text = this.entry.get_text();
            this.settings.setValue("note-text", this.note_text);
        });
        this.box.add_actor(this.entry);
        this.setContent(this.box);
    },

    _onTextSetting: function() {
        if (this.entry && this.entry.get_text() !== this.note_text) {
            this.entry.set_text(this.note_text || "");
        }
    }
};
