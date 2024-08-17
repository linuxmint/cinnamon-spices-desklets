/*
* A themeable desklet that shows the time.
*
* Copyright (C) 2024  Gobinath
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

// Import dependencies
const St = imports.gi.St;
const GLib = imports.gi.GLib;
imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/timelet@linuxedo.com/themes");
const Theme = imports.theme.Theme;

/**
 * Modern theme class.
 */
var ModernTheme = class ModernTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: true });

        this._weekday = this.createLabel("Anurati", 72, "center");
        this._date = this.createLabel("Ubuntu", 20, "left");
        this._time = this.createLabel("Ubuntu", 20, "right");

        this._weekday.style += "font-weight: 300;";
        this._date.style += "font-weight: 300; padding-top: 10px;";
        this._time.style += "font-weight: 300; padding-top: 10px;";

        this._clockContainer.add(this._weekday, { x_fill: false, x_align: St.Align.MIDDLE });
        this._clockContainer.add(this._date, { x_fill: false, x_align: St.Align.MIDDLE });
        this._clockContainer.add(this._time, { x_fill: false, x_align: St.Align.MIDDLE });
        return this._clockContainer;
    }

    setDateTime(date, locale) {
        let time = this.to2Digit(this.is24H() ? date.getHours() : this.to12Hours(date.getHours())) + ":" + this.to2Digit(date.getMinutes());
        if (!this.is24H()) {
            time += " " + this.toPeriod(date.getHours());
        }
        this._weekday.set_text(this.formatDateTime(date, locale, { weekday: "long" }).toUpperCase());
        this._date.set_text(this.formatDateTime(date, locale, { day: "2-digit", month: "short", year: "numeric" }));
        this._time.set_text("- " + time + " -");
    }
}