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

const GLib = imports.gi.GLib;
imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/timelet@linuxedo.com/themes");

const DigitalTheme = imports.digital.DigitalTheme;
const FlairTheme = imports.flair.FlairTheme;
const GothamTheme = imports.gotham.GothamTheme;
const JellyTheme = imports.jelly.JellyTheme;
const MetroTheme = imports.metro.MetroTheme;

/**
 * A factory class acts as a theme register.
 * Theme developers must register their theme in this class to be detected by Timelet.
 * 
 * Step 1: Import your theme as a depenency
 * Step 2: Append your theme name to the `getThemeNames()` function list.
 * Step 3: Add an `else-if` condition to create your theme if the name matches the name you defined in Step 2.
 */
class Themes {

    /**
     * This output will be used as the config GUI theme selector values.
     * Theme developers: append your theme name to the list
     * @returns Return the list of registered theme names.
     */
    static getThemeNames() {
        return ["Digital", "Flair", "Gotham", "Jelly", "Metro"];
    }

    /**
     * Theme developers: add an `else if` condition to this method to create your theme.
     * @param {str} themeName the theme name as defined in getThemeNames function
     * @param {*} config the theme.Config object with user configuration
     * @returns a new Theme object
     */
    static getTheme(themeName, config) {
        if (themeName == "Digital") {
            return new DigitalTheme(config);
        } else if (themeName == "Flair") {
            return new FlairTheme(config);
        } else if (themeName == "Gotham") {
            return new GothamTheme(config);
        } else if (themeName == "Jelly") {
            return new JellyTheme(config);
        } else if (themeName == "Metro") {
            return new MetroTheme(config);
        }
    }
}