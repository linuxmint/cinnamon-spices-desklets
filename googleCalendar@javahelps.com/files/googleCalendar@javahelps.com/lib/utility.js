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

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;

imports.searchPath.unshift(GLib.get_home_dir() + '/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/lib');


const XDate = imports.xdate.XDate;

const SpawnReader = function() {};

const CalendarUtility = function() {};

function Event(event_line, use_24h_clock) {
    this._init(event_line, use_24h_clock);
}

SpawnReader.prototype.spawn = function(path, command, func) {

    let pid, stdin, stdout, stderr, stream, reader;

    [res, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
        path, command, null, GLib.SpawnFlags.SEARCH_PATH, null);

    stream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stdout }) });

    this.read(stream, func);
};

SpawnReader.prototype.read = function(stream, func) {

    stream.read_line_async(GLib.PRIORITY_LOW, null, Lang.bind(this, function(source, res) {

        let out, length;

        [out, length] = source.read_line_finish(res);
        if (out !== null) {
            func(out);
            this.read(source, func);
        }
    }));
};

CalendarUtility.prototype.label = function(text, zoom, textColor, leftAlign = true, fontSize = 14) {
    let label = new St.Label();
    label.style = 'text-align : ' + (leftAlign ? 'left' : 'right') + '; font-size:' + (fontSize * zoom) + 'px; color: ' + textColor;
    label.set_text(text);
    return label;
}

CalendarUtility.prototype.container = function(isVertical = false) {
    return new St.BoxLayout({
        vertical: isVertical,
        style_class: 'desklet'
    });
}

CalendarUtility.prototype.window = function(cornerRadius, textColor, bgColor, transparency) {
    let window = this.container(isVertical = true);
    window.style = "padding: 10px; border-radius: " + cornerRadius + "px; background-color: " + (bgColor.replace(")", "," + (1.0 - transparency) + ")")).replace('rgb', 'rgba') + "; color: " + textColor;
    return window;
}

CalendarUtility.prototype.setTooltip = function(widget, text) {
    let tooltip = new Tooltips.Tooltip(widget);
    tooltip.set_text(text);
}

CalendarUtility.prototype.formatParameterDate = function(value) {
    return value.getMonth() + 1 + "/" + value.getDate() + "/" + value.getFullYear();
}

/**
 * Event prototype with the following attributes:
 * - start_date
 * - start_time
 * - start_date_str
 * - end_date
 * - end_time
 * - name
 * - use_24h_clock
 * - MAX_LENGTH = 35
 */
Event.prototype = {
    _init: function(event_line, use_24h_clock) {
        let properties = event_line.split("\t");
        this.start_date = new XDate(properties[0]);
        this.start_time = properties[1];
        this.end_date = new XDate(properties[2]);
        this.end_time = properties[3];
        this.name = properties[4];
        this.use_24h_clock = use_24h_clock;
        this.MAX_LENGTH = 35;
        this.start_date_str = properties[0];
    },

    formatEventDuration: function(date) {
        var start_diff_days = this.start_date.diffDays(date);
        var end_diff_days = this.end_date.diffDays(date);
        if (start_diff_days == 0 && end_diff_days == 0) {
            // Starting and ending at this date
            return this._formatTime(this.start_time) + " - " + this._formatTime(this.end_time);
        } else if ((start_diff_days == 0 && end_diff_days == -1 && this.start_time === "00:00") || (start_diff_days > 0 && end_diff_days < 0)) {
            // Whole day
            return "";
        } else if (start_diff_days == 0 && end_diff_days < 0) {
            if (this.start_time == "00:00") {
                // Whole day
                return "";
            } else {
                // starting at the middle of this day
                return this._formatTime(this.start_time) + " \u2192";
            }
        } else if (start_diff_days > 0 && end_diff_days == 0 && this.end_time != "00:00") {
            // Ending at the middle of this day
            return "\u2192 " + this._formatTime(this.end_time);
        } else {
            return "";
        }
    },

    /**
     * Format the time into 24 hours or 12 hours based on the user preference.
     */
    _formatTime: function(time) {
        if (this.use_24h_clock) {
            return time;
        }
        time = time.toString().match(/^([01]\d|2[0-3])(:)([0-5]\d)(:[0-5]\d)?$/) || [time];
        if (time.length > 1) {
            time = time.slice(1);
            time[5] = +time[0] < 12 ? ' AM' : ' PM';
            time[0] = +time[0] % 12 || 12;
        }
        return time.join('');
    }
}