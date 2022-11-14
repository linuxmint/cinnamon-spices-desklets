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
 * Gotham theme class.
 */
class GothamTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: false });
        this._timeContainer = new St.BoxLayout({ vertical: false });
        this._dateParentContainer = new St.BoxLayout({ vertical: true, y_align: St.Align.END });
        this._dateContainer = new St.BoxLayout({ vertical: false });

        this._time = this.createLabel("GE Inspira", 80, "right");
        this._weekday = this.createLabel("GE Inspira", 40, "left");
        this._date = this.createLabel("GE Inspira", 20, "left", "#fca903");
        this._month_year = this.createLabel("GE Inspira", 20, "right");

        this._time.style += "margin-right: 10px;";
        this._date.style += "margin-right: 5px;";

        this._timeContainer.add(this._time);
        this._dateContainer.add(this._date);
        this._dateContainer.add(this._month_year);
        this._dateParentContainer.add(this._dateContainer);
        this._dateParentContainer.add(this._weekday);
        this._clockContainer.add(this._timeContainer);
        this._clockContainer.add(this._dateParentContainer);

        return this._clockContainer;
    }

    setDateTime(date, locale) {
        let time = this.to2Digit(this.to12Hours(date.getHours())) + ":" + this.to2Digit(date.getMinutes());
        this._time.set_text(time);
        this._weekday.set_text(this.formatDateTime(date, locale, { weekday: "long" }));
        this._date.set_text(this.formatDateTime(date, locale, { day: "2-digit" }));
        this._month_year.set_text(this.formatDateTime(date, locale, { month: "long", year: "numeric" }));
    }

}