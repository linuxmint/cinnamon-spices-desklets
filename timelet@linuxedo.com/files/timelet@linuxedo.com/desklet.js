/*
* A themeable desklet that shows the time.
*
* Copyright (C) 2022  Gobinath
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http:*www.gnu.org/licenses/>.
*/

const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = "timelet@linuxedo.com";

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/timelet@linuxedo.com/themes");
const Config = imports.theme.Config;
const Themes = imports.themes.Themes;

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function Timelet(metadata, deskletID) {
    this._init(metadata, deskletID);
}

Timelet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletID) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletID);
        this.setHeader(_("Timelet"));

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "themeName", "themeName", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "use24H", "use24H", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "textColor", "textColor", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "bgColor", "bgColor", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale", "scale", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "cornerRadius", "cornerRadius", Lang.bind(this, this._setTheme));
        this.settings.bindProperty(Settings.BindingDirection.IN, "hideDecorations", "hideDecorations", Lang.bind(this, this._toggleDecoration));

        // Populate the theme names
        let themeNames = {};
        let sorted = Themes.getThemeNames().sort();
        sorted.forEach(name => {
            themeNames[name] = name;
        });

        this.settings.setOptions("themeName", themeNames);

        this._setTheme();
        this._updateDateTime();
    },

    on_desklet_removed: function () {
        Mainloop.source_remove(this.timeout);
    },

    _setTheme() {
        // Set the theme
        this._theme = Themes.getTheme(this.themeName, new Config(this.use24H, this.scale, this.textColor));

        // Define the desklet container
        let deskletContainer = new St.BoxLayout({ vertical: true,style_class: "desklet" });
        deskletContainer.style = "padding: 10px; border-radius: " + this.cornerRadius + "px; background-color: " + (this.bgColor.replace(")", "," + (1.0 - this.transparency) + ")")).replace("rgb", "rgba") + "; color: " + this.textColor;
        
        // Add the theme container
        deskletContainer.add(this._theme.getWidget());
        this.setContent(deskletContainer);

        // Update the desklet with current time
        let locale = GLib.getenv("LANG");
        if (locale) {
            // convert $LANG from format "en_GB.UTF-8" to "en-GB"
            locale = GLib.getenv("LANG").replace(/_/g, "-").replace(/\..+/, "");
        } 
        if (!locale || locale === "C") {
            // fallback locale
            locale = "en-US";
        }
        this._theme.setDateTime(new Date(), locale);
    },

    _updateDateTime: function () {
        let locale = GLib.getenv("LANG");
        if (locale) {
            // convert $LANG from format "en_GB.UTF-8" to "en-GB"
            locale = GLib.getenv("LANG").replace(/_/g, "-").replace(/\..+/, "");
        }
        if (!locale || locale === "C") {
            // fallback locale
            locale = "en-US";
        }
        this._theme.setDateTime(new Date(), locale);
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateDateTime));
    },

    _toggleDecoration() {
        this.metadata['prevent-decorations'] = this.hideDecorations;
        this._updateDecoration();
    },
}

function main(metadata, deskletID) {
    let desklet = new Timelet(metadata, deskletID);
    return desklet;
}
