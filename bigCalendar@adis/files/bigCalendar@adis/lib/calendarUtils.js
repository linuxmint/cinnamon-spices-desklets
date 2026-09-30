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

/* Pure date logic for the Big Calendar desklet.
 *
 * An ES module with no imports at all, so it loads identically under the
 * Cinnamon process and under a plain `cjs` test run.
 *
 * All calendar maths happens on UTC timestamps. Local-time arithmetic is
 * unsafe here: adding seven days across a DST boundary can land on the same
 * weekday twice, which silently corrupts week numbers and month grids.
 */

export const MS_PER_DAY = 86400000;
export const MS_PER_WEEK = 604800000;

/* ------------------------------------------------------------------ *
 * Locale / region conventions
 * ------------------------------------------------------------------ */

// First day of the week, by ISO 3166-1 alpha-2 region code.
// 0 = Sunday, 1 = Monday, 6 = Saturday.
//
// Most of the world starts the week on Monday (ISO 8601). The Americas,
// Japan, Israel and a few others start on Sunday. Much of the Middle East
// and North Africa starts on Saturday.
const SATURDAY_FIRST = [
    "AE", "AF", "BH", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM",
    "QA", "SA", "SD", "SY", "YE"
];

const SUNDAY_FIRST = [
    "AG", "AS", "AU", "BD", "BR", "BS", "BT", "BW", "BZ", "CA", "CN",
    "CO", "DM", "DO", "ET", "FM", "GB", "GD", "GT", "GU", "HK", "HN",
    "ID", "IL", "IN", "JM", "JP", "KE", "KH", "KR", "LA", "MH", "MM",
    "MO", "MT", "MX", "MZ", "NI", "NP", "PA", "PE", "PH", "PK", "PR",
    "PT", "PY", "SG", "SV", "TH", "TT", "TW", "UM", "US", "VE", "VI",
    "WS", "YE", "ZA", "ZW"
];

export function firstDayOfWeekForRegion(region) {
    if (!region) return 1;
    const cc = String(region).toUpperCase();
    if (SATURDAY_FIRST.indexOf(cc) !== -1) return 6;
    if (SUNDAY_FIRST.indexOf(cc) !== -1) return 0;
    return 1;
}

/** Region subtag of a locale: "ro-RO" -> "RO", "en" -> "US". */
export function regionFromLocale(locale) {
    if (!locale) return "";
    const parts = String(locale).replace(/_/g, "-").split("-");
    for (let i = 1; i < parts.length; i++) {
        if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
    }
    // A bare language with no region falls back to a small language map.
    const langMap = { en: "US", ja: "JP", he: "IL", ar: "SA", ko: "KR", zh: "CN" };
    return langMap[parts[0].toLowerCase()] || "";
}

export function firstDayOfWeekForLocale(locale) {
    return firstDayOfWeekForRegion(regionFromLocale(locale));
}

/* ------------------------------------------------------------------ *
 * Basic calendar maths
 * ------------------------------------------------------------------ */

export function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 1 && isLeapYear(year)) return 29;
    return lengths[month];
}

/**
 * UTC midnight for a local calendar date.
 *
 * Taking the local Y/M/D components and re-anchoring them in UTC keeps the
 * "which day is this" identity stable while making every subsequent
 * arithmetic step immune to DST.
 */
export function utcDay(year, month, day) {
    return Date.UTC(year, month, day);
}

/** Numeric day identity, e.g. 20260930. */
export function dayKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

export function addMonths(year, month, delta) {
    const total = year * 12 + month + delta;
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Weekday index for a local calendar date, 0 = Sunday. */
export function weekdayOf(year, month, day) {
    return new Date(utcDay(year, month, day)).getUTCDay();
}

export function isWeekendDate(year, month, day) {
    const wd = weekdayOf(year, month, day);
    return wd === 0 || wd === 6;
}

/* ------------------------------------------------------------------ *
 * Week numbering
 * ------------------------------------------------------------------ */

/**
 * ISO 8601 week number.
 *
 * Weeks start Monday and week 1 is the week containing the year's first
 * Thursday. A week therefore belongs to the year its Thursday falls in,
 * which is why the year comes back alongside the number.
 */
export function isoWeek(year, month, day) {
    let t = utcDay(year, month, day);
    const weekday = (new Date(t).getUTCDay() + 6) % 7;   // Monday = 0
    t += (3 - weekday) * MS_PER_DAY;                     // Thursday of this week

    const thursdayYear = new Date(t).getUTCFullYear();
    const jan4 = Date.UTC(thursdayYear, 0, 4);
    const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
    const firstThursday = jan4 + (3 - jan4Weekday) * MS_PER_DAY;

    return {
        week: 1 + Math.round((t - firstThursday) / MS_PER_WEEK),
        year: thursdayYear
    };
}

/**
 * North American week number.
 *
 * Weeks start Sunday and week 1 is the week containing 1 January. Simpler
 * than ISO, and unlike ISO it never spans a year boundary.
 *
 * The week holding 1 January is week 1 of *that* January's year even when it
 * begins in the December before -- which is what stops the numbering skipping.
 * A grid row running 28 December 2025 to 3 January 2026 contains 1 January
 * 2026, so it is week 1 of 2026. Counting from the queried year's own January
 * instead labelled it week 53 of 2025, and the row after it, 4 January, is
 * week 2 of 2026: week 1 of 2026 then appeared on no row at all, and the
 * column read ... 52, 53, 2, 3.
 */
export function usWeek(year, month, day) {
    const sunday = utcDay(year, month, day) - weekdayOf(year, month, day) * MS_PER_DAY;

    // Whichever January falls inside this week is the year it counts towards.
    // Next year first, so a week straddling the boundary is not claimed by the
    // year that is ending.
    for (const y of [year + 1, year]) {
        const jan1 = utcDay(y, 0, 1);
        if (jan1 >= sunday && jan1 < sunday + MS_PER_WEEK) return { week: 1, year: y };
    }

    const firstSunday = utcDay(year, 0, 1) - weekdayOf(year, 0, 1) * MS_PER_DAY;
    return {
        week: Math.round((sunday - firstSunday) / MS_PER_WEEK) + 1,
        year: year
    };
}

/** Week number for a date under the configured convention, or null if off. */
export function weekNumberFor(year, month, day, convention) {
    if (convention === "iso") return isoWeek(year, month, day);
    if (convention === "us") return usWeek(year, month, day);
    return null;
}

/* ------------------------------------------------------------------ *
 * Month grid
 * ------------------------------------------------------------------ */

/**
 * Build the matrix of days a month view displays.
 *
 * Returns an array of week rows, each `{week: {week, year}|null, days: [...]}`
 * where a cell is `{year, month, day, date, inMonth, isToday, isWeekend}`.
 *
 * `options.rows` may be "auto" (5 or 6 rows, whichever the month needs) or an
 * explicit count -- typically 6, so the desklet keeps a constant height while
 * the user pages through months.
 */
export function buildMonthMatrix(year, month, firstDayOfWeek, options) {
    options = options || {};
    const weekConvention = options.weekNumbering || "none";
    const rowsMode = options.rows === undefined ? "auto" : options.rows;
    const today = options.today || new Date();

    const totalDays = daysInMonth(year, month);
    const firstWeekday = weekdayOf(year, month, 1);
    // How many leading days spill in from the previous month.
    const lead = (firstWeekday - firstDayOfWeek + 7) % 7;

    let rowCount;
    if (rowsMode === "auto") {
        rowCount = Math.max(5, Math.ceil((lead + totalDays) / 7));
    } else {
        rowCount = Number(rowsMode) || 6;
    }

    const weeks = [];
    // Start at the first visible cell; negative offsets roll back into the
    // previous month naturally through Date.UTC.
    let cursor = utcDay(year, month, 1) - lead * MS_PER_DAY;

    for (let r = 0; r < rowCount; r++) {
        const days = [];
        for (let c = 0; c < 7; c++) {
            const d = new Date(cursor);
            const cy = d.getUTCFullYear();
            const cm = d.getUTCMonth();
            const cd = d.getUTCDate();
            days.push({
                year: cy,
                month: cm,
                day: cd,
                date: new Date(cy, cm, cd),
                inMonth: (cy === year && cm === month),
                isToday: (cy === today.getFullYear() &&
                    cm === today.getMonth() &&
                    cd === today.getDate()),
                isWeekend: (d.getUTCDay() === 0 || d.getUTCDay() === 6)
            });
            cursor += MS_PER_DAY;
        }
        const head = days[0];
        weeks.push({
            week: weekNumberFor(head.year, head.month, head.day, weekConvention),
            days: days
        });
    }

    return weeks;
}

/** The first and last instants a month grid touches, for range queries. */
export function gridRange(year, month, firstDayOfWeek, rows) {
    const weeks = buildMonthMatrix(year, month, firstDayOfWeek, { rows: rows, today: new Date() });
    const first = weeks[0].days[0];
    const lastWeek = weeks[weeks.length - 1].days;
    const last = lastWeek[lastWeek.length - 1];
    return {
        start: new Date(first.year, first.month, first.day, 0, 0, 0, 0),
        end: new Date(last.year, last.month, last.day + 1, 0, 0, 0, 0)
    };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

// Constructing an Intl formatter is comparatively expensive and the desklet
// rebuilds its whole grid on every settings change and at midnight, so the
// formatters are memoised.
const formatterCache = new Map();

export function getFormatter(locale, options) {
    const key = locale + "|" + JSON.stringify(options);
    let fmt = formatterCache.get(key);
    if (!fmt) {
        try {
            fmt = new Intl.DateTimeFormat(locale, options);
        } catch (e) {
            fmt = new Intl.DateTimeFormat(undefined, options);
        }
        formatterCache.set(key, fmt);
    }
    return fmt;
}

/**
 * Format a month heading.
 *
 * Style is one of "long", "short", "numeric", "year-first" or "stacked". The
 * locale decides the natural order; year-first and stacked reorder the parts
 * explicitly for users who prefer that.
 */
export function formatMonthYear(year, month, locale, style) {
    const when = new Date(year, month, 1);

    if (style === "numeric") {
        return getFormatter(locale, { year: "numeric", month: "2-digit" }).format(when);
    }
    if (style !== "year-first" && style !== "stacked") {
        const monthStyle = style === "short" ? "short" : "long";
        return getFormatter(locale, { year: "numeric", month: monthStyle }).format(when);
    }

    const parts = getFormatter(locale, { year: "numeric", month: "long" }).formatToParts(when);
    let monthText = "", yearText = "";
    for (const p of parts) {
        if (p.type === "month") monthText = p.value;
        else if (p.type === "year") yearText = p.value;
    }
    if (!monthText || !yearText) return getFormatter(locale, { year: "numeric", month: "long" }).format(when);
    return style === "stacked" ? monthText + "\n" + yearText : yearText + " " + monthText;
}

/** Short weekday names rotated so index 0 is `firstDayOfWeek`. */
export function weekdayNames(locale, firstDayOfWeek, width) {
    const fmt = getFormatter(locale, { weekday: width || "short" });
    // 2024-01-07 was a Sunday, giving a stable anchor for index 0.
    const names = [];
    for (let i = 0; i < 7; i++) names.push(fmt.format(new Date(2024, 0, 7 + i)));

    const rotated = [];
    for (let i = 0; i < 7; i++) rotated.push(names[(firstDayOfWeek + i) % 7]);
    return rotated;
}
