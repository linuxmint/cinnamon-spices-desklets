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
 * Jelly theme class.
 */
 class JellyTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: true });
        this._timeContainer = new St.BoxLayout({ vertical: false });
        this._dateContainer = new St.BoxLayout({ vertical: false });

        this._hour = this.createLabel("Roboto", 80, "right");
        this._seperator = this.createLabel("Roboto", 80, "right");
        this._minute = this.createLabel("Roboto", 80, "left");
        this._weekday = this.createLabel("Roboto", 20, "right");
        this._date = this.createLabel("Roboto", 20, "right");
        this._month = this.createLabel("Roboto", 20, "right");

        this._hour.style += "font-weight: 400;";
        this._seperator.style += "font-weight: 200;";
        this._minute.style += "font-weight: 100;";
        this._weekday.style += "font-weight: 300;";
        this._date.style += "margin-left: 5px; margin-right:5px; font-weight: 400;";
        this._month.style += "font-weight: 300;";

        this._timeContainer.add(this._hour);
        this._timeContainer.add(this._seperator);
        this._timeContainer.add(this._minute);
        this._dateContainer.add(this._weekday);
        this._dateContainer.add(this._date);
        this._dateContainer.add(this._month);
        this._clockContainer.add(this._timeContainer, {x_fill: false, x_align: St.Align.MIDDLE});
        this._clockContainer.add(this._dateContainer, {x_fill: false, x_align: St.Align.MIDDLE});

        return this._clockContainer;
    }

    setDateTime(date, locale) {
        this._hour.set_text(this.to2Digit(date.getHours()));
        this._seperator.set_text(":");
        this._minute.set_text(this.to2Digit(date.getMinutes()));
        this._weekday.set_text(this.formatDateTime(date, locale, { weekday: "long" }));
        this._date.set_text(this.to2Digit(date.getDate()));
        this._month.set_text(this.formatDateTime(date, locale, { month: "long" }));
    }
}