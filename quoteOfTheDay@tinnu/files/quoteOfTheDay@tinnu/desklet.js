const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const uuid = "quoteOfTheDay@tinnu";

// l10n/translation support

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
         // Would like to change the style class name to qotd-desklet-label,
         // but leave it as it is for backwards compatibility with user modifications to stylesheet.css
        this._quote = new St.Label({style_class: "quote-container"});
        this.setContent(this._quote);
        this.setHeader(_("Quote of the day"));
        this.update_id = null;
        this.updateInProgress = false;
        
        this.sep = "%"; // Space
        this.maxSize = 7000; // Cinnamon can crash if this int is too high

        try {
            this.settings = new Settings.DeskletSettings(
                this, this.metadata["uuid"], this.instance_id);

            this.settings.bindProperty(Settings.BindingDirection.IN, "file", "file", this.on_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "delay", "delay", this.on_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "fontColor", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "horizontal-shadow", "horShadow", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "vertical-shadow", "vertShadow", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "shadow-blur", "shadowBlur", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "shadow-color", "shadowColor", this.on_font_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "fortune-params", "fortuneParams", this.on_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "ignore-input-file", "ignoreInputFile", this.on_setting_changed, null);

            this._menu.addAction(_("Copy"), Lang.bind(this, function() {
                cb = St.Clipboard.get_default();
                cb.set_text(this._quote.get_text());
            }));
        } 
        catch (e) {
            global.logError(e);
        } 

        this.on_setting_changed();
        this.on_font_setting_changed();
    },

    on_setting_changed: function() {
        // Avoid accidently having more than one Mainloop timeout active at a time
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;

        if (this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
        }
       
        this.file = this.file.replace('~', GLib.get_home_dir());
        this._update();
        this.updateInProgress = false;
    },

    on_font_setting_changed: function() {
        let shadow = this.horShadow + "px " + this.vertShadow + "px " + this.shadowBlur + "px " + this.shadowColor + ";";
        this._quote.style="font-size: " + this.fontSize + "pt;\n" + 
                          "color: " + this.fontColor + ";\n" + 
                          "text-shadow: " + shadow;
    },

    on_desklet_clicked: function(event) {  
        this._update();
    },

    on_desklet_removed: function() {
        if (this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
        }
    },

    /**
     * Display a new quote
     **/
    _update: function() {
        this._getNewQuote();
        this.update_id = Mainloop.timeout_add_seconds(this.delay*60, Lang.bind(this, this._update));
    },

    /**
     * Call fortune to obtain a random quote from the input file
     **/
    _getNewQuote: function() {
        if (this.ignoreInputFile == false) { // Use the configured input file
            // spawn_async seems to ignore this.file when an empty this.fortuneParams is passed, so if the
            // fortuneParams are empty, don't pass them
            if (this.fortuneParams == "") {
                Util.spawn_async(["fortune", this.file], Lang.bind(this, this._setNewQuote));
            }
            else {
                Util.spawn_async(["fortune", this.fortuneParams, this.file], Lang.bind(this, this._setNewQuote));
            }
        }
        else { // don't pass a file to fortune
            Util.spawn_async(["fortune", this.fortuneParams], Lang.bind(this, this._setNewQuote));
        }
    },

    /**
     * Callback for _getNewQuote to set the quote text when spawn_async returns
     **/
    _setNewQuote: function(quote) {
        this._quote.set_text(quote);
    }
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
