/*
* Google Calendar Desklet displays your agenda based on your Google Calendar in Cinnamon desktop.

* Copyright (C) 2017  Gobinath

* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.

* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.

* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http:*www.gnu.org/licenses/>.
*/

const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Gettext = imports.gettext;
const ByteArray = imports.byteArray;
const Util = imports.misc.util;

imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/lib");

const UUID = "googleCalendar@javahelps.com";
const DESKLET_DIR = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/"
const COMMAND_OUTPUT_FILE = DESKLET_DIR + "output.txt";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
};

var XDate = imports.xdate.XDate;

var SpawnReader = function() {};

var CalendarUtility = function() {};

function Event(eventLine, useTwentyFourHour) {
    this._init(eventLine, useTwentyFourHour);
};

SpawnReader.prototype.spawn = function(path, command, func) {
    let commandStr = command.join(" ");
    Util.spawnCommandLineAsyncIO(
        commandStr,
        (stdout, stderr, exitCode) => {
            if (exitCode == 0) {
                func(stdout);
            } else {
                func("");
            }
        }
    );
};

CalendarUtility.prototype.label = function(text, zoom, textColor, leftAlign = true, fontSize = 10) {
    let label = new St.Label();
    label.style = "text-align : " + (leftAlign ? "left" : "right") + "; font-size:" + (fontSize * zoom) + "pt; color: " + textColor;
    label.set_text(text);
    return label;
};

CalendarUtility.prototype.container = function(isVertical = false) {
    return new St.BoxLayout({
        vertical: isVertical,
        style_class: "desklet"
    });
};

CalendarUtility.prototype.window = function(cornerRadius, textColor, bgColor, transparency) {
    let window = this.container(true);
    window.style = "padding: 10px; border-radius: " + cornerRadius + "px; background-color: " + (bgColor.replace(")", "," + (1.0 - transparency) + ")")).replace("rgb", "rgba") + "; color: " + textColor;
    return window;
};

CalendarUtility.prototype.setTooltip = function(widget, text) {
    let tooltip = new Tooltips.Tooltip(widget);
    tooltip.set_text(text);
};

CalendarUtility.prototype.formatParameterDate = function(value) {
    return value.getMonth() + 1 + "/" + value.getDate() + "/" + value.getFullYear();
};

/**
 * Event prototype with the following attributes:
 * - startDate
 * - startTime
 * - startDateText
 * - endDate
 * - endTime
 * - name
 * - useTwentyFourHour
 * - color
 * - location
 */
Event.prototype = {
    _init(event, useTwentyFourHour) {
        // let properties = eventLine.split("\t");
        this.startDate = new XDate(event["start_date"]);
        this.startDateText = event["start_date"];
        this.startTime = event["start_time"];
        this.endDate = new XDate(event["end_date"]);
        this.endTime = event["end_time"];
        this.name = event["summary"];
        this.color = event["calendar_color"];
        this.location = event["location"];
        if (!this.name) {
            throw "Error in parsing " + eventLine;
        }
        this.useTwentyFourHour = useTwentyFourHour;
    },

    formatEventDuration(date) {
        var startDiffDays = this.startDate.diffDays(date);
        var endDiffDays = this.endDate.diffDays(date);
        if (startDiffDays === 0 && endDiffDays === 0) {
            // Starting and ending at this date
            return this.formatTime(this.startTime) + " - " + this.formatTime(this.endTime);
        } else if ((startDiffDays === 0 && endDiffDays === -1 && this.startTime === "00:00") || (startDiffDays > 0 && endDiffDays < 0)) {
            // Whole day
            return "";
        } else if (startDiffDays === 0 && endDiffDays < 0) {
            if (this.startTime === "00:00") {
                // Whole day
                return "";
            } else {
                // starting at the middle of this day
                return this.formatTime(this.startTime) + " \u2192";
            }
        } else if (startDiffDays > 0 && endDiffDays === 0 && this.endTime !== "00:00") {
            // Ending at the middle of this day
            return "\u2192 " + this.formatTime(this.endTime);
        } else {
            return "";
        }
    },

    /**
     * Format the time into 24 hours or 12 hours based on the user preference.
     */
    formatTime(time) {
        if (this.useTwentyFourHour) {
            return time;
        }
        time = time.toString().match(/^([01]\d|2[0-3])(:)([0-5]\d)(:[0-5]\d)?$/) || [time];
        if (time.length > 1) {
            time = time.slice(1);
            time[5] = +time[0] < 12 ? (" " + _("AM")) : (" " + _("PM"));
            time[0] = +time[0] % 12 || 12;
        }
        return time.join("");
    }
};
