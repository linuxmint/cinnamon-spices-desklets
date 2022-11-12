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

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = "timelet@linuxedo.com";

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")
function _(str) {
    return Gettext.dgettext(UUID, str);
}

/**
 * This class is used to pass user configurations to themes.
 */
class Config {
    constructor(scale, textColor) {
        this.scale = scale;
        this.textColor = textColor;
    }
}

/**
 * The base Theme class. All themes must extend this class.
 */
class Theme {

    /**
     * Timelet will parse the user input into a Config object and pass it to the theme.
     * 
     * @constructor
     * @param {Config} config user configuration for the theme
     */
    constructor(config) {
        this._config = config;
    }

    /**
     * It can be any GUI widget from the St package.
     * Theme developers must override this function.
     * 
     * @returns Return a GUI widget to display.
     */
    getWidget() {
        return null;
    }

    /**
     * Timelet will call this function with the current date and system locale.
     * Theme developers must override this function and implement how they want to show
     * the date and time.
     * 
     * @link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
     * @param {Date} date the current date time
     * @param {str} locale the system locale (eg: en-US)
     */
    setDateTime(date, locale) {
        // do nothing
    }

    /**
     * A utility function to format the Date into a string.
     * 
     * @link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
     * @link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options
     * @param {Date} date the date to format
     * @param {str} locale the system locale
     * @param {options} options DateTimeFormat options (see the link)
     * @returns formatted string
     */
    formatDateTime(date, locale, options) {
        const dateFormatter = new Intl.DateTimeFormat(locale, options);
        return dateFormatter.format(date);
    }

    /**
     * A utility function to format a single digit number to a 2 digit string.
     * 
     * @example
     * // returns 07
     * this.to2Digit(7)
     * @param {Number} number an int number
     * @returns 2 digit string
     */
    to2Digit(number) {
        return number.toLocaleString("en-US", {
            minimumIntegerDigits: 2,
            useGrouping: false
        });
    }

    /**
     * A utility function to convert hour in 24h to 12h format.
     * 
     * @example
     * // returns 2
     * this.to12Hours(14)
     * @param {Number} hourIn24 hour in 24h format (0-23)
     * @returns hour in 12 hour format Number
     */
    to12Hours(hourIn24) {
        return hourIn24 % 12 || 12;
    }

    /**
     * Returns the translated period abbreviations.
     * Theme developers must decide whether they want to follow the locale time format or custom time format.
     * To use the locale time format, use the this.formatDateTime function. This function may not return
     * localized period abbreviations if there is no translation.
     * 
     * @param {Number} hourIn24 hour in 24h format (0-23)
     * @returns the translated AM/Noon/PM abbreviations
     */
    toPeriod(hourIn24) {
        if (hourIn24 < 12) {
            return _("AM");
        } else if (hourIn24 == 12 && date.getMinutes() == 0 && date.getSeconds() == 0) {
            return _("Noon");
        } else {
            return _("PM");
        }
    }

    /**
     * Use this utility function to scale all your font sizes and widget sizes to match user preference.
     * 
     * @param {Number} size the UI size to scale
     * @returns a scaled Number according to the system scale and user preference
     */
    scale(size) {
        return this._config.scale * size * global.ui_scale;
    }

    /**
     * Use this color for all your texts unless your theme decides to override certain color choices.
     * 
     * @returns the user selected text color
     */
    getTextColor() {
        return this._config.textColor;
    }

    /**
     * A utility function to create a new Label.
     * 
     * @param {str} font the CSS font-family value
     * @param {NUmber} fontSize unscaled font-size in pt (this function will scale the size)
     * @param {str} textAlignment the CSS text alignment (left, right, center, justify). Not set by default.
     * @param {str} color the CSS color value. Uses this.getTextColor() by default. 
     * @returns a new St.Label with custom style
     */
    createLabel(font, fontSize, textAlignment = null, color = this.getTextColor()) {
        let style = "color: " + color + ";";
        if (textAlignment != null) {
            style += "text-align: " + textAlignment + ";";
        }
        if (font != null) {
            style += "font-family: " + font + ";";
        }
        if (fontSize != null) {
            style += "font-size: " + this.scale(fontSize) + "pt;";
        }
        let label = new St.Label();
        label.style = style;
        return label;
    }
}




