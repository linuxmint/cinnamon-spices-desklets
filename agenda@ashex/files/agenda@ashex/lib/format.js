/*
 * format.js - turns instants and durations into the short, glanceable
 * strings the agenda is made of.
 */

const GLib = imports.gi.GLib;

const _ = imports.lib.i18n._;
const ngettext = imports.lib.i18n.ngettext;

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;

function localeName() {
    let names = GLib.get_language_names();
    for (let i = 0; i < names.length; i++) {
        let candidate = names[i].split('.')[0].replace('_', '-');
        if (candidate && candidate !== 'C' && candidate !== 'POSIX')
            return candidate;
    }
    return 'en-US';
}

/*
 * Whether this locale writes times on a 12-hour clock.
 *
 * The probe must not care what timezone the machine is in. Formatting a
 * fixed UTC instant renders it in local time, so an 18:00 UTC sample
 * shows as 10:00 in California and any "is the number small" heuristic
 * then misreads a 24-hour locale as a 12-hour one. Ask the formatter what
 * it resolved instead, and only fall back to inspecting the output.
 */
function prefers12Hour() {
    try {
        let probe = new Intl.DateTimeFormat(localeName(), { hour: 'numeric' });

        if (probe.resolvedOptions) {
            let resolved = probe.resolvedOptions();
            if (typeof resolved.hour12 === 'boolean')
                return resolved.hour12;
            if (resolved.hourCycle)
                return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12';
        }

        // Older engines: a locale that writes a day period is a 12-hour
        // locale. Anchor the sample to local time so the rendered hour is
        // the one asked for regardless of zone.
        let sample = probe.format(new Date(2020, 0, 1, 18, 0, 0));
        return /[AaPp]\.?[Mm]|[\u4e0d-\u9fff]?午/.test(sample) ||
            /\b(1[0-2]|[1-9])\b/.test(sample) && !/\b18\b/.test(sample);
    } catch (e) {
        return false;
    }
}

var Formatter = class Formatter {
    constructor(timeFormat) {
        this.setTimeFormat(timeFormat);
    }

    setTimeFormat(timeFormat) {
        this.timeFormat = timeFormat || 'auto';
        this.locale = localeName();
        this.hour12 = this.timeFormat === '12h'
            ? true
            : (this.timeFormat === '24h' ? false : prefers12Hour());

        try {
            this._time = new Intl.DateTimeFormat(this.locale, {
                hour: 'numeric', minute: '2-digit', hour12: this.hour12,
            });
            this._date = new Intl.DateTimeFormat(this.locale, {
                weekday: 'long', day: 'numeric', month: 'long',
            });
        } catch (e) {
            this._time = null;
            this._date = null;
        }
    }

    time(date) {
        if (this._time)
            return this._time.format(date).replace(/\s+/g, ' ').trim();

        let hours = date.getHours();
        let minutes = String(date.getMinutes()).padStart(2, '0');
        if (!this.hour12)
            return String(hours).padStart(2, '0') + ':' + minutes;
        let suffix = hours >= 12 ? 'PM' : 'AM';
        let display = hours % 12 === 0 ? 12 : hours % 12;
        return display + ':' + minutes + ' ' + suffix;
    }

    // Ranges drop the repeated meridiem so "1:00 PM - 2:00 PM" reads as
    // "1:00 - 2:00 PM" and leaves room for the title.
    range(start, end) {
        let from = this.time(start);
        let to = this.time(end);
        if (!this.hour12)
            return from + ' - ' + to;

        let fromMatch = /^(.*?)\s*(AM|PM)$/i.exec(from);
        let toMatch = /^(.*?)\s*(AM|PM)$/i.exec(to);
        if (fromMatch && toMatch && fromMatch[2].toUpperCase() === toMatch[2].toUpperCase())
            return fromMatch[1] + ' - ' + to;
        return from + ' - ' + to;
    }

    date(value) {
        if (this._date)
            return this._date.format(value);
        return value.toDateString();
    }

    /*
     * Relative phrasing that stays short at every scale: seconds collapse
     * to "now", minutes stay minutes, and anything over an hour gains a
     * minutes component only when it is not a round hour.
     *
     * These are the most prominent strings on the card, so they go
     * through gettext like the rest of the interface rather than being
     * assembled from English fragments.
     */
    countdown(deltaMs) {
        if (deltaMs <= 0)
            return _('now');
        if (deltaMs < MINUTE)
            return _('in under a minute');

        let minutes = Math.round(deltaMs / MINUTE);
        if (minutes < 60)
            return ngettext('in %d minute', 'in %d minutes', minutes).format(minutes);

        let hours = Math.floor(minutes / 60);
        let remainder = minutes % 60;
        if (hours >= 24) {
            let days = Math.round(hours / 24);
            return ngettext('in %d day', 'in %d days', days).format(days);
        }
        if (!remainder)
            return ngettext('in %d hour', 'in %d hours', hours).format(hours);
        return _('in %dh %dm').format(hours, remainder);
    }

    elapsed(deltaMs) {
        let minutes = Math.max(0, Math.round(deltaMs / MINUTE));
        if (minutes < 1)
            return _('just started');
        if (minutes < 60)
            return ngettext('started %d minute ago', 'started %d minutes ago', minutes)
                .format(minutes);

        let hours = Math.floor(minutes / 60);
        let remainder = minutes % 60;
        if (!remainder)
            return ngettext('started %d hour ago', 'started %d hours ago', hours).format(hours);
        return _('started %dh %dm ago').format(hours, remainder);
    }

    remaining(deltaMs) {
        let minutes = Math.max(0, Math.round(deltaMs / MINUTE));
        if (minutes < 1)
            return _('ending now');
        if (minutes < 60)
            return ngettext('%d minute left', '%d minutes left', minutes).format(minutes);

        let hours = Math.floor(minutes / 60);
        let remainder = minutes % 60;
        if (!remainder)
            return ngettext('%d hour left', '%d hours left', hours).format(hours);
        return _('%dh %dm left').format(hours, remainder);
    }

    duration(ms) {
        // Never negative: a feed can describe an event that ends before
        // it starts, and "-60 min" helps nobody.
        let minutes = Math.max(0, Math.round(ms / MINUTE));
        if (minutes < 60)
            return _('%d min').format(minutes);

        let hours = Math.floor(minutes / 60);
        let remainder = minutes % 60;
        if (!remainder)
            return _('%d h').format(hours);
        return _('%dh %dm').format(hours, remainder);
    }
};
