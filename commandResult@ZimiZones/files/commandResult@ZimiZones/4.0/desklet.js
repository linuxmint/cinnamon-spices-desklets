/* global imports */
const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const uuid = "commandResult@ZimiZones";

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

        this.setHeader(_("Command result"));
        this.update_id = null;
        this.updateInProgress = false;

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);

            this.settings.bind("delay", "delay", this.on_setting_changed);
            this.settings.bind("timeout", "timeout", this.on_setting_changed);
            this.settings.bind("commands", "commands", this.on_setting_changed);

            this.settings.bind("font-size", "fontSize", this.on_font_setting_changed);
        } 
        catch (e) {
            global.logError(e);
        } 

        this.on_setting_changed();
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

        this._content = new St.BoxLayout({
            vertical: true
        });
        this.on_font_setting_changed();
        this.setContent(this._content);
        this.loadings = [];
        this.labels = [];
        for(var i = 0; i < this.commands.length; i++){
            this.loadings.push(false);
            this._addLabel(this.commands[i].label, "Loading...")
        }

        this._update();
        this.updateInProgress = false;
    },

    on_font_setting_changed: function() {
        this._content.style = "font-size: " + this.fontSize + "pt;";
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
     * Display new command results
     **/
    _update: function() {
        this._getCommandResult();
        this.update_id = Mainloop.timeout_add_seconds(this.delay * 60, Lang.bind(this, this._update));
    },

    /**
     * Call command from settings
     **/
    _getCommandResult: function() {
        for(var i = 0; i < this.commands.length; i++){
            if(!this.loadings[i]){
                this.labels[i].label.set_text(this.commands[i].label);
                this.labels[i].result.set_text("Loading...");
                this.loadings[i] = true;

                Util.spawn_async(["/bin/bash", "-c", "timeout -k " + this.timeout + " " + this.timeout + " " + this.commands[i].command + " || echo \"Timeout or error occured.\""], Lang.bind(this, this._setNewCommandResult, i));
            }
        }
    },

    /**
     * Callback for _getCommandResult to set the command result when spawn_async returns
     **/
    _setNewCommandResult: function(result, index) {
        //global.logError(this.commands[index].label);
        //global.logError(result);
        if(result[result.length - 1] == '\n'){
            result = result.slice(0, -1);
        }

        this.loadings[index] = false;
        this.labels[index].label.set_text(this.commands[index].label);
        this.labels[index].result.set_text(result);
    },

    _addLabel: function(left, right) {
        this.labels.push({
            label: new St.Label({
                text: left
            }),
            result: new St.Label({
                style_class: "command-result-result-label-container",
                text: right
            })
        });

        let box = new St.BoxLayout({
        });
        box.add(this.labels[this.labels.length - 1].label, {
        });
        box.add(this.labels[this.labels.length - 1].result, {
            expand: true
        });

        this._content.add(box, { 
        });
    }
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
