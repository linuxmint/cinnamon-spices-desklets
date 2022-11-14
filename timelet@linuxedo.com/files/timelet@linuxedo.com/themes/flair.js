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
 * Flair theme class.
 */
class FlairTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: false });
        this._timeContainer = new St.BoxLayout({ vertical: false });
        this._PeriodContainer = new St.BoxLayout({ vertical: true, y_align: St.Align.START });

        this._time = this.createLabel("LG Weather_Z", 80, "right");
        this._period = this.createLabel("LG Weather_Z", 40, "left");

        this._period.style += "font-weight: 100; margin-top: 5px;"

        this._timeContainer.add(this._time);
        this._PeriodContainer.add(this._period);
        this._clockContainer.add(this._timeContainer);
        this._clockContainer.add(this._PeriodContainer);

        return this._clockContainer;
    }

    setDateTime(date, locale) {
        let time = this.to2Digit(this.to12Hours(date.getHours())) + ":" + this.to2Digit(date.getMinutes());
        this._time.set_text(time);
        this._period.set_text(this.toPeriod(date.getHours()));
    }
}