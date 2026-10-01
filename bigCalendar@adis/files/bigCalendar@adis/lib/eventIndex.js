/* Big Calendar -- a large, configurable month-view calendar desklet.
 *
 * Copyright (C) 2026  adis
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Turning a flat list of events into a day-keyed index.
 *
 * An ES module with no imports, so it is exercised directly by
 * tests/run-tests.js outside of Cinnamon.
 */

export const MS_PER_DAY = 86400000;

// No single event should ever paint more than this many cells. A malformed
// feed can carry an event whose end is centuries away; without a ceiling the
// index would try to materialise one entry per day for the whole span.
export const MAX_SPAN_DAYS = 400;

const pad2 = (n) => (n < 10 ? "0" : "") + n;

/** Civil date key, e.g. "2026-09-30". `month` is 0-based, as everywhere else. */
export function dayKey(year, month, day) {
    return year + "-" + pad2(month + 1) + "-" + pad2(day);
}

/** The same key, built from a Date's UTC fields. */
export function dayKeyUtc(date) {
    return dayKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The same key, built from a Date's local fields. */
export function dayKeyLocal(date) {
    return dayKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Step a civil date by whole days.
 *
 * The arithmetic runs in UTC on purpose: it touches only the calendar
 * fields, so it cannot be perturbed by a DST transition the way adding
 * 24 hours to a local timestamp can.
 */
export function civilAddDays(year, month, day, delta) {
    const t = new Date(Date.UTC(year, month, day) + delta * MS_PER_DAY);
    return { year: t.getUTCFullYear(), month: t.getUTCMonth(), day: t.getUTCDate() };
}

/**
 * Which calendar day does an event's start belong to?
 *
 * This is the one genuinely subtle rule in the file, and it differs by event
 * kind. An all-day event is not an instant -- it is a label on a date. EDS,
 * like every iCalendar implementation, transports it as midnight UTC, so
 * reading it back in local time shifts it a day early everywhere west of
 * Greenwich: a New York user would see "Labor Day, May 1" drawn on April 30.
 * Timed events are true instants and genuinely do belong to the local day.
 *
 * So all-day events resolve against UTC, and timed events against local time.
 */
export function dayOfEventStart(event) {
    const d = new Date(event.start);
    return event.allDay ? dayKeyUtc(d) : dayKeyLocal(d);
}

/**
 * The last calendar day an event occupies.
 *
 * iCalendar DTEND is exclusive -- an all-day event on the 1st has DTEND on
 * the 2nd -- so the final covered day is one millisecond before the end
 * instant. A zero-length timed event (DTSTART with no DTEND) would otherwise
 * compute a day *before* its own start, hence the clamp to `event.start`.
 */
export function dayOfEventEnd(event) {
    const last = new Date(Math.max(event.end, event.start) - 1);
    if (last.getTime() < event.start) return dayOfEventStart(event);
    return event.allDay ? dayKeyUtc(last) : dayKeyLocal(last);
}

/**
 * All-day events first, then by start time, then alphabetically.
 *
 * A total order on purpose: two events sharing a start would otherwise
 * shuffle between renders as the underlying array order changed.
 */
function compareEntries(a, b) {
    const ea = a.event, eb = b.event;
    if (ea.allDay !== eb.allDay) return ea.allDay ? -1 : 1;
    if (ea.start !== eb.start) return ea.start - eb.start;
    return String(ea.summary || "").localeCompare(String(eb.summary || ""));
}

/**
 * Index events by calendar day.
 *
 * Each event needs `{start, end, allDay, summary, color}`, with start/end as
 * millisecond instants. Returns an object mapping "YYYY-MM-DD" to an array of
 * `{event, first, last}`, where `first`/`last` let a renderer draw multi-day
 * events as a continuous run rather than as unrelated blobs.
 *
 * `fromKey` and `toKey` are the first and last day being drawn. They are
 * optional -- leaving them out indexes every day of every event -- but the
 * desklet always passes them, and should:
 *
 *   - Without them a long event was cut off after MAX_SPAN_DAYS from its own
 *     start, so a lease, a sabbatical or a deployed contract simply stopped
 *     appearing in every month past its 400th day while still running. With
 *     them the run is clipped to the window instead, which is the part anyone
 *     can see, and no day in view is ever missing.
 *   - The work stops being proportional to the longest event and becomes
 *     proportional to the size of the grid.
 *
 * `first`/`last` are still decided against the event's real ends, not the
 * window's, so an event that began before the window keeps being drawn as a
 * continuation rather than starting afresh at the edge.
 */
export function buildEventIndex(events, fromKey, toKey) {
    const index = {};
    if (!events) return index;

    for (const event of events) {
        const startKey = dayOfEventStart(event);
        let endKey = dayOfEventEnd(event);

        // A clock that falls back across midnight can put an event's local end
        // date *before* its local start date even though the end instant is
        // later. The cursor below only walks forward, so an end key in the
        // past would never be reached and the event would smear across
        // MAX_SPAN_DAYS days instead of the one it actually occupies.
        // Dates are zero-padded, so string order is chronological order.
        if (endKey < startKey) endKey = startKey;

        let from = startKey;
        let to = endKey;
        if (fromKey && from < fromKey) from = fromKey;
        if (toKey && to > toKey) to = toKey;
        if (from > to) continue;      // the window does not reach this event

        let cursor = from;
        let steps = 0;
        while (steps < MAX_SPAN_DAYS) {
            (index[cursor] || (index[cursor] = [])).push({
                event: event,
                first: cursor === startKey,
                last: cursor === endKey
            });

            if (cursor === to) break;

            const [y, m, d] = cursor.split("-").map(Number);
            const next = civilAddDays(y, m - 1, d, 1);
            cursor = dayKey(next.year, next.month, next.day);
            steps++;
        }
    }

    for (const key in index) index[key].sort(compareEntries);
    return index;
}

/** Entries for one day, or an empty array. */
export function eventsOnDay(index, year, month, day) {
    return index[dayKey(year, month, day)] || [];
}

/** How many events the busiest day of a month carries. */
export function maxEventsInMonth(index, year, month) {
    let max = 0;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
        const n = eventsOnDay(index, year, month, d).length;
        if (n > max) max = n;
    }
    return max;
}

/** "14:30", or "2:30 PM". */
export function formatEventTime(ms, use24h) {
    const d = new Date(ms);
    let h = d.getHours();
    const m = d.getMinutes();
    if (use24h) return pad2(h) + ":" + pad2(m);
    const suffix = h < 12 ? "AM" : "PM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + pad2(m) + " " + suffix;
}

/** One-line summary of an event, for a tooltip row. */
export function describeEvent(event, use24h) {
    const title = event.summary && event.summary.length ? event.summary : "(no title)";
    return event.allDay ? title : formatEventTime(event.start, use24h) + "  " + title;
}

// Marks an event that began on an earlier day. U+21B3, "downwards arrow with
// tip rightwards" -- the same glyph a text editor uses for a wrapped line.
const CONTINUED = "↳";

/**
 * Describe one indexed entry, as it should read on the day it is drawn.
 *
 * The difference from describeEvent is `first`. An event running overnight
 * occupies two cells, but it has only one start time, and that time belongs to
 * the first cell. Printing "22:00  Night shift" under the 22nd as well is not a
 * harmless repetition: 22:00 on the 22nd is a different moment from 22:00 on
 * the 21st, so the second cell showed a time the event was not happening at.
 * On any cell but the first, the time is dropped and the event is marked as
 * carried over. All-day events never carried a time and are unaffected.
 */
export function describeEntry(entry, use24h) {
    const event = entry.event;
    if (entry.first || event.allDay) return describeEvent(event, use24h);

    const title = event.summary && event.summary.length ? event.summary : "(no title)";
    return CONTINUED + "  " + title;
}
