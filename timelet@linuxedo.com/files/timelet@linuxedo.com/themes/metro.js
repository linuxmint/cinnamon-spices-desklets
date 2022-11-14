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

// Import dependencies
const St = imports.gi.St;
const GLib = imports.gi.GLib;
imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/timelet@linuxedo.com/themes");
const Theme = imports.theme.Theme;

/**
 * Metro theme class.
 */
class MetroTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: true });

        this._weekday = this.createLabel("Ubuntu", 30);
        this._date_month = this.createLabel("Ubuntu", 30);
        this._time = this.createLabel("Ubuntu", 70);

        this._weekday.style += "font-weight: 200;";
        this._date_month.style += "font-weight: 200;";
        this._time.style += "font-weight: 200;";

        this._clockContainer.add(this._weekday);
        this._clockContainer.add(this._date_month);
        this._clockContainer.add(this._time);

        return this._clockContainer;
    }

    setDateTime(date, locale) {
        let month = this.formatDateTime(date, locale, { month: "long" });
        let time = this.to2Digit(this.to12Hours(date.getHours())) + ":" + this.to2Digit(date.getMinutes()) + " " + this.toPeriod(date.getHours());
        this._weekday.set_text(this.formatDateTime(date, locale, { weekday: "long" }));
        this._date_month.set_text(month + " " + this.to2Digit(date.getDate()));
        this._time.set_text(time);
    }
}