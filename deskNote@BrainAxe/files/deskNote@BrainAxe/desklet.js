const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const uuid = "deskNote@BrainAxe";
const Gettext = imports.gettext;

function _(str) {
  return Gettext.dgettext(uuid, str);
}

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function deskNote(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

deskNote.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._note = new St.Label({style_class: "note-container"});
        this.setContent(this._note);
        this.setHeader(_("Desktop Note"));

        this.maxSize = 7000; // Cinnamon can crash if this int is too high

        this.setupUI()

        try {
           this.settings = new Settings.DeskletSettings(
               this, this.metadata["uuid"], desklet_id);

           this.settings.bindProperty(Settings.BindingDirection.IN, "note-entry", "noteEntry", this.on_setting_changed, null);
           this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this.on_font_setting_changed, null);
           this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "fontColor", this.on_font_setting_changed, null);

         }
       catch (e) {
           global.logError(e);
       }

       this.on_setting_changed();
       this.on_font_setting_changed();

    },

    on_setting_changed: function() {
      var new_text = this.noteEntry;
      this.text.set_text(new_text);
    },

    on_font_setting_changed: function() {
        this._note.style="font-size: " + this.fontSize + "pt;\n" +
                          "color: " + this.fontColor + ";\n" ;
    },



    setupUI: function() {
        // main container for the desklet
        this.window = new St.Bin();
        this.text = new St.Label();

        this.text.set_text("");
        this._note = new St.BoxLayout({vertical:true, style_class: 'note-container'})

        this._note.add(this.text);

        this.window.add_actor(this._note)
        this.setContent(this.window);
    }
}

function main(metadata, desklet_id) {
    return new deskNote(metadata, desklet_id);
}
