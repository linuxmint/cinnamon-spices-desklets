/*
 * ical.js - a small, dependency-free iCalendar (RFC 5545) reader.
 *
 * It is deliberately scoped to what an agenda display needs: read a feed,
 * work out which appointments fall inside a given window, and hand back
 * plain objects with real Date values. Recurrence is expanded lazily
 * against that window rather than materialised for all time.
 */

const GLib = imports.gi.GLib;
const Meeting = imports.lib.meeting;

const MAX_ITERATIONS = 20000;

/*
 * Recurrence expansion is bounded twice over, because desklets run inside
 * the Cinnamon process and an unbounded parse freezes the whole desktop.
 *
 * The two limits do different jobs. The per-event cap keeps one
 * pathological rule from starving every other event in the calendar, so
 * a single bad entry costs only its own share. The document-wide cap
 * bounds the total regardless of how many events a feed contains.
 *
 * For scale: a heavy real calendar of 300 recurring events accumulated
 * over nine years spends about 250 candidates on its busiest event and
 * well under a tenth of the document budget overall.
 */
const MAX_EVENT_CANDIDATES = 1000;
const MAX_TOTAL_CANDIDATES = 40000;

// Untrusted feed text is capped before it ever reaches the toolkit.
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 2000;
// Calendar names appear as a small tag beside an event, so they have to
// stay short enough not to crowd out the title itself.
const MAX_CALENDAR_NAME_CHARS = 40;
const DAY_MS = 86400000;

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// The recurrence frequencies this reader can expand.
const SUPPORTED_FREQ = { DAILY: true, WEEKLY: true, MONTHLY: true, YEARLY: true };

// Feeds exported by Exchange and older Outlook builds label zones with
// Windows display names instead of IANA identifiers.
const WINDOWS_ZONES = {
    'AUS Central Standard Time': 'Australia/Darwin',
    'AUS Eastern Standard Time': 'Australia/Sydney',
    'Arabian Standard Time': 'Asia/Dubai',
    'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
    'Atlantic Standard Time': 'America/Halifax',
    'Belarus Standard Time': 'Europe/Minsk',
    'Canada Central Standard Time': 'America/Regina',
    'Cen. Australia Standard Time': 'Australia/Adelaide',
    'Central America Standard Time': 'America/Guatemala',
    'Central Asia Standard Time': 'Asia/Almaty',
    'Central Brazilian Standard Time': 'America/Cuiaba',
    'Central Europe Standard Time': 'Europe/Budapest',
    'Central European Standard Time': 'Europe/Warsaw',
    'Central Pacific Standard Time': 'Pacific/Guadalcanal',
    'Central Standard Time': 'America/Chicago',
    'Central Standard Time (Mexico)': 'America/Mexico_City',
    'China Standard Time': 'Asia/Shanghai',
    'E. Africa Standard Time': 'Africa/Nairobi',
    'E. Australia Standard Time': 'Australia/Brisbane',
    'E. South America Standard Time': 'America/Sao_Paulo',
    'Eastern Standard Time': 'America/New_York',
    'Egypt Standard Time': 'Africa/Cairo',
    'FLE Standard Time': 'Europe/Kiev',
    'GMT Standard Time': 'Europe/London',
    'GTB Standard Time': 'Europe/Bucharest',
    'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'Hawaiian Standard Time': 'Pacific/Honolulu',
    'India Standard Time': 'Asia/Kolkata',
    'Iran Standard Time': 'Asia/Tehran',
    'Israel Standard Time': 'Asia/Jerusalem',
    'Japan Standard Time': 'Asia/Tokyo',
    'Korea Standard Time': 'Asia/Seoul',
    'Mountain Standard Time': 'America/Denver',
    'Mountain Standard Time (Mexico)': 'America/Chihuahua',
    'New Zealand Standard Time': 'Pacific/Auckland',
    'Newfoundland Standard Time': 'America/St_Johns',
    'Pacific SA Standard Time': 'America/Santiago',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Romance Standard Time': 'Europe/Paris',
    'Russian Standard Time': 'Europe/Moscow',
    'SA Eastern Standard Time': 'America/Cayenne',
    'SA Pacific Standard Time': 'America/Bogota',
    'SA Western Standard Time': 'America/La_Paz',
    'SE Asia Standard Time': 'Asia/Bangkok',
    'Singapore Standard Time': 'Asia/Singapore',
    'South Africa Standard Time': 'Africa/Johannesburg',
    'Taipei Standard Time': 'Asia/Taipei',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Turkey Standard Time': 'Europe/Istanbul',
    'US Eastern Standard Time': 'America/New_York',
    'US Mountain Standard Time': 'America/Phoenix',
    'UTC': 'UTC',
    'W. Australia Standard Time': 'Australia/Perth',
    'W. Central Africa Standard Time': 'Africa/Lagos',
    'W. Europe Standard Time': 'Europe/Berlin',
    'West Asia Standard Time': 'Asia/Tashkent',
    'West Pacific Standard Time': 'Pacific/Port_Moresby',
};

const _zoneCache = Object.create(null);

function resolveTimeZone(tzid) {
    if (!tzid)
        return GLib.TimeZone.new_local();

    let key = String(tzid).replace(/^"|"$/g, '');
    if (_zoneCache[key])
        return _zoneCache[key];

    let candidates = [key];

    // Some producers prefix identifiers, e.g. "/freeassociation.sourceforge.net/Europe/Paris".
    let slash = key.lastIndexOf('/');
    if (key.charAt(0) === '/' && slash > 0) {
        let parts = key.replace(/^\/+/, '').split('/');
        if (parts.length >= 2)
            candidates.push(parts.slice(-2).join('/'));
    }
    if (WINDOWS_ZONES[key])
        candidates.push(WINDOWS_ZONES[key]);

    let zone = null;
    for (let i = 0; i < candidates.length && !zone; i++) {
        try {
            zone = GLib.TimeZone.new_identifier
                ? GLib.TimeZone.new_identifier(candidates[i])
                : GLib.TimeZone.new(candidates[i]);
        } catch (e) {
            zone = null;
        }
        // Older GLib silently falls back to UTC instead of returning null,
        // which would quietly shift every appointment. Only trust an exact
        // identifier match unless we asked for UTC in the first place.
        if (zone && candidates[i] !== 'UTC' && zone.get_identifier &&
            zone.get_identifier() === 'UTC' && !/UTC|GMT|Z$/.test(candidates[i]))
            zone = null;
    }

    if (!zone)
        zone = GLib.TimeZone.new_local();

    _zoneCache[key] = zone;
    return zone;
}

function unfold(text) {
    let source = String(text);

    /*
     * Some exporters write a raw newline inside a DESCRIPTION instead of
     * the "\n" escape the specification requires. Everything after it
     * then looks like a new property and is quietly discarded, which is
     * how a meeting link goes missing.
     *
     * In a document that terminates its lines with CRLF, a lone LF cannot
     * be a line break, so it is safe to read it as content. Feeds that
     * legitimately use bare LF as their terminator are left untouched,
     * since for them the distinction does not exist.
     */
    if (source.indexOf('\r\n') !== -1) {
        const BREAK = '\u0000';
        source = source
            .replace(/\r\n/g, BREAK)
            .replace(/\n/g, '\\n')
            .split(BREAK).join('\n');
    }

    // RFC 5545 lets a long line continue on the next one, marked by a
    // leading space or tab. Normalise line endings first so feeds using
    // bare LF or CR behave the same as strict CRLF feeds.
    return source
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n[ \t]/g, '');
}

/*
 * Reverses RFC 5545 text escaping.
 *
 * Order matters, and chained replaces get it wrong: expanding "\n" first
 * consumes the second backslash of an escaped pair, so the literal text
 * "C:\new" (written "C:\\new") comes back as "C:" plus a newline. Walk
 * the string once instead, so an escaped backslash is always consumed
 * whole and can never introduce the next escape.
 */
function unescapeText(value) {
    if (!value)
        return '';

    let text = String(value);
    let out = '';

    for (let i = 0; i < text.length; i++) {
        let ch = text.charAt(i);
        if (ch !== '\\') {
            out += ch;
            continue;
        }

        let next = text.charAt(i + 1);
        switch (next) {
            case 'n':
            case 'N':
                out += '\n';
                i++;
                break;
            case '\\':
            case ',':
            case ';':
                out += next;
                i++;
                break;
            case '':
                out += '\\';
                break;
            default:
                // Not a recognised escape; keep both characters as-is.
                out += '\\' + next;
                i++;
                break;
        }
    }

    return out.trim();
}

function parseLine(line) {
    // NAME;PARAM=value;PARAM="quoted:value":the actual value
    let inQuotes = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        let ch = line.charAt(i);
        if (ch === '"')
            inQuotes = !inQuotes;
        else if (ch === ':' && !inQuotes) {
            colon = i;
            break;
        }
    }
    if (colon === -1)
        return null;

    let head = line.substring(0, colon);
    let value = line.substring(colon + 1);

    let params = Object.create(null);
    let segments = [];
    let current = '';
    inQuotes = false;
    for (let i = 0; i < head.length; i++) {
        let ch = head.charAt(i);
        if (ch === '"')
            inQuotes = !inQuotes;
        if (ch === ';' && !inQuotes) {
            segments.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    segments.push(current);

    let name = segments.shift().toUpperCase();
    for (let i = 0; i < segments.length; i++) {
        let eq = segments[i].indexOf('=');
        if (eq === -1)
            continue;
        let pname = segments[i].substring(0, eq).toUpperCase();
        let pvalue = segments[i].substring(eq + 1).replace(/^"|"$/g, '');
        params[pname] = pvalue;
    }

    return { name: name, params: params, value: value };
}

/*
 * A date-time as the calendar itself sees it: wall-clock fields plus the
 * zone they belong to. Keeping the fields rather than a single instant is
 * what lets recurrence survive daylight saving transitions intact.
 */
function parseDateTime(value, params) {
    let raw = String(value).trim();
    let match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw);
    if (!match)
        return null;

    let isDate = match[4] === undefined ||
        (params && params['VALUE'] === 'DATE');

    let tzid = params ? params['TZID'] : null;
    let zone;
    if (isDate)
        zone = GLib.TimeZone.new_local();
    else if (match[7] === 'Z')
        zone = GLib.TimeZone.new_utc();
    else
        zone = resolveTimeZone(tzid);

    return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
        hour: isDate ? 0 : parseInt(match[4], 10),
        minute: isDate ? 0 : parseInt(match[5], 10),
        second: isDate ? 0 : parseInt(match[6], 10),
        zone: zone,
        allDay: isDate,
    };
}

function toGDateTime(parts) {
    return GLib.DateTime.new(parts.zone, parts.year, parts.month, parts.day,
        parts.hour, parts.minute, parts.second);
}

function toMillis(parts) {
    let dt = toGDateTime(parts);
    return dt ? dt.to_unix() * 1000 : NaN;
}

function parseDuration(value) {
    // ISO 8601 duration subset used by RFC 5545, e.g. -P1DT2H30M
    let match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
        .exec(String(value).trim());
    if (!match)
        return 0;
    let sign = match[1] === '-' ? -1 : 1;
    let seconds =
        (parseInt(match[2] || 0, 10) * 604800) +
        (parseInt(match[3] || 0, 10) * 86400) +
        (parseInt(match[4] || 0, 10) * 3600) +
        (parseInt(match[5] || 0, 10) * 60) +
        parseInt(match[6] || 0, 10);
    return sign * seconds * 1000;
}

function parseRRule(value) {
    let rule = {
        freq: null,
        interval: 1,
        count: null,
        until: null,
        byDay: [],
        byMonthDay: [],
        byMonth: [],
        bySetPos: [],
        weekStart: 1,
    };

    let pieces = String(value).split(';');
    for (let i = 0; i < pieces.length; i++) {
        let eq = pieces[i].indexOf('=');
        if (eq === -1)
            continue;
        let key = pieces[i].substring(0, eq).toUpperCase();
        let val = pieces[i].substring(eq + 1);

        switch (key) {
            case 'FREQ':
                rule.freq = val.toUpperCase();
                break;
            case 'INTERVAL':
                rule.interval = Math.max(1, parseInt(val, 10) || 1);
                break;
            case 'COUNT':
            case 'COUNT': {
                // COUNT=0 is a rule that produces nothing. Coercing a
                // falsy zero to null would instead mean "no limit" and
                // repeat the event forever.
                let count = parseInt(val, 10);
                rule.count = isNaN(count) ? null : Math.max(0, count);
                break;
            }
                break;
            case 'UNTIL':
                rule.until = parseDateTime(val, null);
                break;
            case 'BYDAY':
                rule.byDay = val.split(',').map(function (token) {
                    let m = /^([+-]?\d+)?([A-Z]{2})$/.exec(token.trim().toUpperCase());
                    if (!m || !(m[2] in WEEKDAYS))
                        return null;
                    return { ordinal: m[1] ? parseInt(m[1], 10) : 0, day: WEEKDAYS[m[2]] };
                }).filter(function (d) { return d !== null; });
                break;
            case 'BYMONTHDAY':
                rule.byMonthDay = val.split(',')
                    .map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); });
                break;
            case 'BYMONTH':
                rule.byMonth = val.split(',')
                    .map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); });
                break;
            case 'BYSETPOS':
                rule.bySetPos = val.split(',')
                    .map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); });
                break;
            case 'WKST':
                // Sunday is zero, and a falsy-zero fallback would turn
                // the commonest WKST value in the world into Monday.
                rule.weekStart = val.toUpperCase() in WEEKDAYS
                    ? WEEKDAYS[val.toUpperCase()]
                    : 1;
                break;
        }
    }

    return rule.freq ? rule : null;
}

/*
 * Reads a whole ICS document into VEVENT records. Anything that is not a
 * VEVENT (alarms, timezone definitions, journals) is skipped, but nested
 * components are tracked properly so their properties never leak upward.
 */
function parse(text) {
    let events = [];
    let calendarName = null;
    let lines = unfold(String(text || '')).split('\n');
    let stack = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (!line || !line.trim())
            continue;

        let parsed = parseLine(line);
        if (!parsed)
            continue;

        if (parsed.name === 'BEGIN') {
            stack.push(parsed.value.toUpperCase());
            if (parsed.value.toUpperCase() === 'VEVENT' && stack.length === 2) {
                current = {
                    uid: null,
                    summary: '',
                    location: '',
                    description: '',
                    url: '',
                    status: '',
                    transparency: '',
                    partstat: '',
                    start: null,
                    end: null,
                    duration: null,
                    rrules: [],
                    rdates: [],
                    exdates: [],
                    recurrenceId: null,
                    sequence: 0,
                    conferences: [],
                    googleConference: '',
                    teamsUrl: '',
                };
            }
            continue;
        }

        if (parsed.name === 'END') {
            let closing = parsed.value.toUpperCase();
            if (closing === 'VEVENT' && current && stack.length === 2) {
                if (current.start)
                    events.push(current);
                current = null;
            }
            // Only unwind when the END actually matches what is open. A
            // stray or mismatched END would otherwise pop VCALENDAR off
            // the stack, after which no further event is ever recognised
            // and the rest of the calendar is silently discarded.
            if (stack.length && stack[stack.length - 1] === closing)
                stack.pop();
            continue;
        }

        let inEvent = current && stack.length === 2 && stack[1] === 'VEVENT';

        if (!inEvent) {
            if (stack.length === 1) {
                // RFC 7986 defines NAME; X-WR-CALNAME is the older
                // property almost every service still writes. Prefer the
                // standard one when a feed offers both.
                if (parsed.name === 'NAME')
                    calendarName = calendarNameFrom(parsed.value);
                else if (parsed.name === 'X-WR-CALNAME' && !calendarName)
                    calendarName = calendarNameFrom(parsed.value);
            }
            continue;
        }

        switch (parsed.name) {
            case 'UID':
                current.uid = parsed.value.trim();
                break;
            case 'SUMMARY':
                current.summary = unescapeText(parsed.value);
                break;
            case 'LOCATION':
                current.location = unescapeText(parsed.value);
                break;
            case 'DESCRIPTION':
                current.description = unescapeText(parsed.value);
                break;
            case 'URL':
                current.url = parsed.value.trim();
                break;
            case 'STATUS':
                current.status = parsed.value.trim().toUpperCase();
                break;
            case 'TRANSP':
                current.transparency = parsed.value.trim().toUpperCase();
                break;
            case 'SEQUENCE':
                current.sequence = parseInt(parsed.value, 10) || 0;
                break;
            case 'ATTENDEE':
                // The feed owner's own participation status is the one that
                // tells us whether they actually agreed to be there.
                if (parsed.params['PARTSTAT'] && !current.partstat)
                    current.partstat = parsed.params['PARTSTAT'].toUpperCase();
                break;
            case 'DTSTART':
                current.start = parseDateTime(parsed.value, parsed.params);
                break;
            case 'DTEND':
                current.end = parseDateTime(parsed.value, parsed.params);
                break;
            case 'DURATION':
                current.duration = parseDuration(parsed.value);
                break;
            case 'RRULE': {
                let rule = parseRRule(parsed.value);
                if (rule)
                    current.rrules.push(rule);
                break;
            }
            case 'RDATE':
                parsed.value.split(',').forEach(function (token) {
                    let dt = parseDateTime(token, parsed.params);
                    if (dt)
                        current.rdates.push(dt);
                });
                break;
            case 'EXDATE':
                parsed.value.split(',').forEach(function (token) {
                    let dt = parseDateTime(token, parsed.params);
                    if (dt)
                        current.exdates.push(dt);
                });
                break;
            case 'RECURRENCE-ID':
                current.recurrenceId = parseDateTime(parsed.value, parsed.params);
                break;
            case 'CONFERENCE':
                // RFC 7986. May appear several times for video, phone
                // dial-in and chat, so keep them all and choose later.
                current.conferences.push({
                    value: parsed.value.trim(),
                    feature: parsed.params['FEATURE'] || '',
                    label: parsed.params['LABEL'] || '',
                });
                break;
            case 'X-GOOGLE-CONFERENCE':
                current.googleConference = parsed.value.trim();
                break;
            case 'X-MICROSOFT-SKYPETEAMSMEETINGURL':
                current.teamsUrl = parsed.value.trim();
                break;
        }
    }

    return { events: events, calendarName: calendarName };
}

/*
 * Prepares untrusted feed text for display.
 *
 * A desklet draws inside the Cinnamon process, so handing Pango a
 * multi-megabyte title does not just break this widget, it hangs the
 * desktop. Control characters and bidirectional overrides are stripped
 * too: a right-to-left override inside an event title reverses the
 * rendering of everything after it, which is exactly the trick used to
 * make a hostile link look like a familiar one.
 */
function displayText(value, limit) {
    if (!value)
        return '';

    let text = String(value)
        // Bidi overrides and isolates.
        .replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, '')
        // Control characters, keeping the newline and tab that real
        // descriptions legitimately contain.
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        // Zero-width characters used to disguise text.
        .replace(/[\u200b-\u200d\ufeff]/g, '');

    if (text.length > limit)
        text = text.substring(0, limit) + '…';

    return text;
}

/*
 * The display name a feed gives itself. Runs through the same escaping
 * and sanitising as any other feed text, because it is shown on screen
 * and comes from a remote source.
 */
function calendarNameFrom(value) {
    return displayText(unescapeText(value), MAX_CALENDAR_NAME_CHARS);
}

function eventDurationMs(event) {
    // A negative span would put the end before the start, which shows up
    // as "-60 min" on screen and hides the event from the day's counts.
    if (event.duration !== null)
        return Math.max(0, event.duration);
    if (event.end) {
        let span = toMillis(event.end) - toMillis(event.start);
        if (!isNaN(span) && span >= 0)
            return span;
    }
    return event.start.allDay ? DAY_MS : 0;
}

function withDate(parts, gdt) {
    return {
        year: gdt.get_year(),
        month: gdt.get_month(),
        day: gdt.get_day_of_month(),
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
        zone: parts.zone,
        allDay: parts.allDay,
    };
}

// GLib counts Monday as 1 through Sunday as 7; we speak in 0-6 from Sunday.
function glibWeekday(gdt) {
    return gdt.get_day_of_week() % 7;
}

function shiftToWeekday(gdt, targetWeekday, weekStart) {
    let currentOffset = (glibWeekday(gdt) - weekStart + 7) % 7;
    let targetOffset = (targetWeekday - weekStart + 7) % 7;
    return gdt.add_days(targetOffset - currentOffset);
}

/*
 * The day of the month for, say, the second Tuesday or the last Friday.
 *
 * Once the weekday of the 1st is known the rest is arithmetic, so this
 * builds two GLib.DateTime objects rather than one per day of the month.
 * A monthly BYDAY rule probes six ordinals for each of up to seven
 * weekdays on every iteration, and the old day-by-day scan made that
 * roughly 1300 allocations per iteration.
 */
function nthWeekdayOfMonth(year, month, zone, weekday, ordinal) {
    let first = GLib.DateTime.new(zone, year, month, 1, 0, 0, 0);
    if (!first)
        return null;

    let daysInMonth = first.add_months(1).add_days(-1).get_day_of_month();
    let firstWeekday = glibWeekday(first);

    let firstMatch = 1 + ((weekday - firstWeekday + 7) % 7);
    let count = Math.floor((daysInMonth - firstMatch) / 7) + 1;
    if (firstMatch > daysInMonth || count < 1)
        return null;

    let index = ordinal > 0 ? ordinal - 1 : count + ordinal;
    if (index < 0 || index >= count)
        return null;

    return firstMatch + index * 7;
}

/*
 * Walks a recurrence rule forward and yields every start instant that
 * lands inside [windowStart, windowEnd]. Rules without COUNT are
 * fast-forwarded arithmetically so a daily meeting created a decade ago
 * costs the same as one created yesterday.
 */
/*
 * The start of the nth repetition period, counted from the event's own
 * start. Calendar arithmetic rather than millisecond arithmetic, so a
 * monthly rule lands on the same day each month and daylight saving
 * transitions do not drag the wall-clock time around.
 */
function anchorFor(base, rule, step) {
    switch (rule.freq) {
        case 'DAILY':
            return base.add_days(step * rule.interval);
        case 'WEEKLY':
            return base.add_weeks(step * rule.interval);
        case 'MONTHLY':
            return base.add_months(step * rule.interval);
        case 'YEARLY':
            return base.add_years(step * rule.interval);
        default:
            return null;
    }
}

function expandRule(event, rule, windowStart, windowEnd, emit, budget) {
    let start = event.start;
    let base = toGDateTime(start);
    if (!base)
        return;

    let untilMs = rule.until ? toMillis(rule.until) : null;
    // An out-of-range UNTIL (say February 30th) yields NaN, and every
    // comparison against NaN is false, which would quietly disable the
    // loop's termination guards. Treat it as absent instead.
    if (untilMs !== null && isNaN(untilMs))
        untilMs = null;
    let hardStop = untilMs !== null ? Math.min(untilMs, windowEnd) : windowEnd;
    let counted = 0;

    let baseMs = base.to_unix() * 1000;

    let step = 0;
    if (rule.count === null && baseMs < windowStart) {
        /*
         * Skip ahead rather than grinding through years of history we are
         * going to discard anyway.
         *
         * Estimating with a period slightly longer than reality
         * guarantees the jump lands short, but the shortfall grows with
         * the age of the rule: a daily meeting created decades ago would
         * still need hundreds of wasted iterations to catch up. So
         * estimate with the true period length, then walk back until the
         * anchor is genuinely at or before the window. The correction
         * loop is bounded and usually runs once or twice.
         */
        let elapsed = windowStart - baseMs;
        let periodMs = 0;
        if (rule.freq === 'DAILY')
            periodMs = DAY_MS * rule.interval;
        else if (rule.freq === 'WEEKLY')
            periodMs = DAY_MS * 7 * rule.interval;
        else if (rule.freq === 'MONTHLY')
            periodMs = DAY_MS * 30 * rule.interval;
        else if (rule.freq === 'YEARLY')
            periodMs = DAY_MS * 365 * rule.interval;

        if (periodMs > 0) {
            step = Math.max(0, Math.floor(elapsed / periodMs));

            for (let back = 0; step > 0 && back < 64; back++) {
                let probe = anchorFor(base, rule, step);
                if (probe && probe.to_unix() * 1000 <= windowStart)
                    break;
                step--;
            }
        }
    }

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++, step++) {
        if (budget && (budget.spent > budget.limit || budget.event > budget.eventLimit))
            return;

        let anchor = anchorFor(base, rule, step);
        if (!anchor)
            return;

        let candidates = [];

        if (rule.freq === 'DAILY') {
            if (!rule.byDay.length ||
                rule.byDay.some(function (d) { return d.day === glibWeekday(anchor); }))
                candidates.push(anchor);
        } else if (rule.freq === 'WEEKLY') {
            if (rule.byDay.length) {
                rule.byDay.forEach(function (d) {
                    let shifted = shiftToWeekday(anchor, d.day, rule.weekStart);
                    if (shifted)
                        candidates.push(shifted);
                });
            } else {
                candidates.push(anchor);
            }
        } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
            let year = anchor.get_year();
            let months = (rule.freq === 'YEARLY' && rule.byMonth.length)
                ? rule.byMonth
                : [anchor.get_month()];

            months.forEach(function (month) {
                if (rule.byDay.length) {
                    rule.byDay.forEach(function (d) {
                        let ordinals = d.ordinal ? [d.ordinal] : [1, 2, 3, 4, 5, -1];
                        ordinals.forEach(function (ordinal) {
                            let day = nthWeekdayOfMonth(year, month, start.zone, d.day, ordinal);
                            if (day === null)
                                return;
                            let candidate = GLib.DateTime.new(start.zone, year, month, day,
                                start.hour, start.minute, start.second);
                            if (candidate)
                                candidates.push(candidate);
                        });
                    });
                } else if (rule.byMonthDay.length) {
                    rule.byMonthDay.forEach(function (monthDay) {
                        let probe = GLib.DateTime.new(start.zone, year, month, 1, 0, 0, 0);
                        if (!probe)
                            return;
                        let daysInMonth = probe.add_months(1).add_days(-1).get_day_of_month();
                        let day = monthDay > 0 ? monthDay : daysInMonth + monthDay + 1;
                        if (day < 1 || day > daysInMonth)
                            return;
                        let candidate = GLib.DateTime.new(start.zone, year, month, day,
                            start.hour, start.minute, start.second);
                        if (candidate)
                            candidates.push(candidate);
                    });
                } else {
                    // No BY* parts: repeat the original day of month, and
                    // skip months too short to contain it, as RFC 5545 asks.
                    let probe = GLib.DateTime.new(start.zone, year, month, 1, 0, 0, 0);
                    if (!probe)
                        return;
                    let daysInMonth = probe.add_months(1).add_days(-1).get_day_of_month();
                    if (start.day > daysInMonth)
                        return;
                    let candidate = GLib.DateTime.new(start.zone, year, month, start.day,
                        start.hour, start.minute, start.second);
                    if (candidate)
                        candidates.push(candidate);
                }
            });
        }

        if (rule.freq !== 'YEARLY' && rule.byMonth.length) {
            candidates = candidates.filter(function (c) {
                return rule.byMonth.indexOf(c.get_month()) !== -1;
            });
        }

        // BYDAY without an ordinal probes 1st through 5th plus last, and
        // in a month with four of that weekday the 4th and the last are
        // the same day. Left in, the duplicate shifts every BYSETPOS
        // index and makes COUNT run out early.
        if (candidates.length > 1) {
            let unique = [];
            let seenMs = Object.create(null);
            candidates.forEach(function (candidate) {
                let key = candidate.to_unix();
                if (seenMs[key])
                    return;
                seenMs[key] = true;
                unique.push(candidate);
            });
            candidates = unique;
        }

        candidates.sort(function (a, b) { return a.to_unix() - b.to_unix(); });

        if (rule.bySetPos.length && candidates.length) {
            let picked = [];
            rule.bySetPos.forEach(function (pos) {
                let index = pos > 0 ? pos - 1 : candidates.length + pos;
                if (index >= 0 && index < candidates.length)
                    picked.push(candidates[index]);
            });
            candidates = picked;
        }

        if (budget) {
            budget.spent += candidates.length + 1;
            budget.event += candidates.length + 1;
        }

        // If every candidate this period already sits beyond the window,
        // no later period can help either and we are done.
        let allBeyondWindow = candidates.length > 0;

        for (let c = 0; c < candidates.length; c++) {
            let candidateMs = candidates[c].to_unix() * 1000;
            if (candidateMs <= windowEnd)
                allBeyondWindow = false;
            if (candidateMs < baseMs)
                continue;
            if (untilMs !== null && candidateMs > untilMs)
                return;

            counted++;
            if (rule.count !== null && counted > rule.count)
                return;

            if (candidateMs >= windowStart && candidateMs <= windowEnd)
                emit(withDate(start, candidates[c]));
        }

        if (allBeyondWindow && rule.count === null)
            return;

        // Guards against rules whose periods legitimately produce nothing,
        // such as a monthly rule pinned to the 31st.
        let anchorMs = anchor.to_unix() * 1000;
        if (anchorMs > hardStop + DAY_MS * 800)
            return;
    }
}

/*
 * Turns parsed VEVENTs into concrete occurrences overlapping the window.
 * Modified instances (RECURRENCE-ID) replace the generated occurrence
 * they point at, which is how "just this once, an hour later" is encoded.
 */
function occurrencesInRange(events, windowStart, windowEnd, context) {
    let overrides = Object.create(null);
    let masters = [];
    // Shared across every rule in the document, so no single feed can
    // monopolise the main loop no matter how it is shaped.
    let budget = {
        spent: 0,
        limit: MAX_TOTAL_CANDIDATES,
        event: 0,
        eventLimit: MAX_EVENT_CANDIDATES,
    };

    events.forEach(function (event) {
        if (event.recurrenceId) {
            let key = (event.uid || '') + '@' + toMillis(event.recurrenceId);
            overrides[key] = event;
        } else {
            masters.push(event);
        }
    });

    let results = [];

    function push(event, startParts) {
        let startMs = toMillis(startParts);
        if (isNaN(startMs))
            return;

        let key = (event.uid || '') + '@' + startMs;
        let source = overrides[key] || event;
        let effectiveStart = overrides[key] ? source.start : startParts;
        let effectiveStartMs = overrides[key] ? toMillis(source.start) : startMs;
        let endMs = effectiveStartMs + eventDurationMs(source);

        if (endMs <= windowStart || effectiveStartMs > windowEnd)
            return;

        // A daily standup has one meeting link, not one per occurrence.
        // Detection walks the whole description, so cache it per event.
        if (source._meeting === undefined) {
            source._meeting = Meeting.detect({
                conferences: source.conferences,
                googleConference: source.googleConference,
                teamsUrl: source.teamsUrl,
                location: source.location,
                description: source.description,
                url: source.url,
            });
        }

        results.push({
            uid: source.uid,
            summary: displayText(source.summary, MAX_TITLE_CHARS) || '(untitled)',
            location: displayText(source.location, MAX_TITLE_CHARS),
            description: displayText(source.description, MAX_DESCRIPTION_CHARS),
            url: source.url,
            status: source.status,
            transparency: source.transparency,
            partstat: source.partstat,
            meeting: source._meeting,
            allDay: effectiveStart.allDay,
            start: new Date(effectiveStartMs),
            end: new Date(endMs),
            startMs: effectiveStartMs,
            endMs: endMs,
            calendarIndex: context ? context.index : 0,
            calendarName: context ? context.name : '',
        });
    }

    masters.forEach(function (event) {
        let excluded = Object.create(null);
        event.exdates.forEach(function (parts) {
            excluded[toMillis(parts)] = true;
        });

        let seen = Object.create(null);

        function emit(parts) {
            let ms = toMillis(parts);
            if (excluded[ms] || seen[ms])
                return;
            seen[ms] = true;
            push(event, parts);
        }

        if (event.rrules.length) {
            // An occurrence that begins before the window can still run
            // into it, so look back by the length of the appointment.
            let lookback = Math.min(Math.max(eventDurationMs(event), 0), DAY_MS * 31);
            let produced = 0;
            budget.event = 0;
            event.rrules.forEach(function (rule) {
                expandRule(event, rule, windowStart - lookback, windowEnd, function (parts) {
                    produced++;
                    emit(parts);
                }, budget);
            });

            // A rule this reader cannot expand (FREQ=HOURLY, or a typo)
            // must not make the appointment disappear altogether. Falling
            // back to the event's own start keeps the first instance
            // visible instead of silently hiding it.
            if (!produced && !SUPPORTED_FREQ[event.rrules[0].freq])
                emit(event.start);
        } else {
            emit(event.start);
        }

        event.rdates.forEach(emit);
    });

    // Deduplicate identical entries that some feeds publish twice.
    let unique = Object.create(null);
    let deduped = [];
    results.forEach(function (occurrence) {
        let key = occurrence.calendarIndex + '|' + occurrence.uid + '|' +
            occurrence.startMs + '|' + occurrence.summary;
        if (unique[key])
            return;
        unique[key] = true;
        deduped.push(occurrence);
    });

    deduped.sort(function (a, b) {
        if (a.allDay !== b.allDay)
            return a.allDay ? -1 : 1;
        return a.startMs - b.startMs;
    });

    return deduped;
}

function parseOccurrences(text, windowStart, windowEnd, context) {
    let parsed = parse(text);
    let ctx = {
        index: context ? context.index : 0,
        name: (context && context.name) || parsed.calendarName || '',
    };
    return {
        calendarName: parsed.calendarName,
        occurrences: occurrencesInRange(parsed.events, windowStart, windowEnd, ctx),
    };
}
