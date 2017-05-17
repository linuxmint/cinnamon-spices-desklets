const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
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

            this.settings.bind("file", "file", this.on_setting_changed);
            this.settings.bind("delay", "delay", this.on_setting_changed);
            this.settings.bind("font-size", "fontSize", this.on_font_setting_changed);
            this.settings.bind("text-color", "fontColor", this.on_font_setting_changed);
            this.settings.bind("horizontal-shadow", "horShadow", this.on_font_setting_changed);
            this.settings.bind("vertical-shadow", "vertShadow", this.on_font_setting_changed);
            this.settings.bind("shadow-blur", "shadowBlur", this.on_font_setting_changed);
            this.settings.bind("shadow-color", "shadowColor", this.on_font_setting_changed);

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
       
        this.update_id = Mainloop.timeout_add_seconds(this.delay*60, Lang.bind(this, this._update));
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
        Mainloop.source_remove(this.update_id);
    },

    /**
     * Display a new quote
     **/
    _update: function() {
        this._quote.set_text(this._getNewQuote());
        return true; // Returns true so that the timeout keeps getting called
    },

    /**
     * Return a string containing a quote
     **/
    _getNewQuote: function() {
        let allQuotes = "";
        try {
            // Since we update infrequently, reread the file in case it has changed
            let quote_file_uri = Gio.File.new_for_uri(this.file);
            if (!quote_file_uri.query_exists(null)) {
                return "Quote file not found: " + quote_file_uri;
            }
            let quoteFileContents = Cinnamon.get_file_contents_utf8_sync(quote_file_uri.get_path());
            allQuotes = quoteFileContents.toString();
        }
        catch (e) {
            global.logError(e);
            return "";
        }

        // Ensure first and last chars are 'sep', for symmetry
        if (allQuotes.charAt(0) !== this.sep) {
            allQuotes = this.sep + allQuotes;
        }
        if (allQuotes.lastIndexOf(this.sep) !== allQuotes.length - 1) {
            allQuotes = allQuotes + this.sep;
        }

        // Now find the beginning and end of each quotation
        this._findSeparators(allQuotes);

        // Choose a quote randomly, subtract 1 so we don't select the ending separator 
        let index = Math.floor(Math.random() * (this.separators.length - 1));

        // Parse chosen quote for display
        let currentQuote = allQuotes.substring(this.separators[index] + 1, this.separators[index+1]);

        // Truncate if needed
        currentQuote = currentQuote.substring(0, Math.min(currentQuote.length, this.maxSize)); 
        return currentQuote;
    },

    /**
     * Helper function for _getNewQuote
     *   - Returns an array containing the indicies of the separators in the allQuotes string
     **/
    _findSeparators: function(allQuotes) {
        this.separators = [];
        let index = 0;

        while (index < allQuotes.length) {
            index = allQuotes.indexOf(this.sep, index);
            if (index === -1) {
                break;  // no more separators
            }
            this.separators.push(index);
            index++;
        }
    }
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
