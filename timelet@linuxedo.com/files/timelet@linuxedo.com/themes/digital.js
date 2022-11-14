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
 * Digital theme class.
 */
class DigitalTheme extends Theme {

    constructor(config) {
        super(config);
    }

    getWidget() {
        this._clockContainer = new St.BoxLayout({ vertical: true });

        this._time = this.createLabel("Digital-7", 70);

        // this._time.style += "font-weight: 200;";
        
        this._clockContainer.add(this._time);
        return this._clockContainer;
    }

    setDateTime(date, locale) {
        let time = this.to2Digit(date.getHours()) + ":" + this.to2Digit(date.getMinutes()) + ":" + this.to2Digit(date.getSeconds());
        this._time.set_text(time);
    }
}