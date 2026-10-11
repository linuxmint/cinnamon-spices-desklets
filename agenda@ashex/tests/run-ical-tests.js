#!/usr/bin/env cjs-console
/*
 * Test harness for the ICS engine. Run with:
 *   cjs-console tests/run-ical-tests.js
 */


/*
 * Cinnamon installs this on startup (js/ui/environment.js); the shipped
 * code relies on it, so stand it up the same way rather than faking it.
 */
if (typeof String.prototype.format !== 'function')
    String.prototype.format = imports.format.format;


/*
 * Locate the desklet source relative to this file, so the suite can be
 * run from anywhere:  cjs-console agenda@ashex/tests/run-...-tests.js
 */
function deskletSourceDir() {
    const GLib = imports.gi.GLib;
    let here = imports.system.programPath;
    if (here) {
        // .../<uuid>/tests/run-x-tests.js  ->  .../<uuid>/files/<uuid>
        let testsDir = GLib.path_get_dirname(here);
        let spiceDir = GLib.path_get_dirname(testsDir);
        let uuid = GLib.path_get_basename(spiceDir);
        return GLib.build_filenamev([spiceDir, 'files', uuid]);
    }
    return GLib.get_current_dir() + '/agenda@ashex/files/agenda@ashex';
}

imports.searchPath.unshift(deskletSourceDir());

const GLib = imports.gi.GLib;


const ICal = imports.lib.ical;

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
    let a = JSON.stringify(actual);
    let e = JSON.stringify(expected);
    if (a === e) {
        passed++;
        print('  ok   ' + name);
    } else {
        failed++;
        print('  FAIL ' + name);
        print('       expected: ' + e);
        print('       actual:   ' + a);
    }
}

function ics(body) {
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n' + body + '\r\nEND:VCALENDAR\r\n';
}

function ms(zone, y, mo, d, h, mi) {
    return GLib.DateTime.new(GLib.TimeZone.new_identifier(zone), y, mo, d, h, mi, 0).to_unix() * 1000;
}

function startsIn(text, fromMs, toMs, zone) {
    let result = ICal.parseOccurrences(text, fromMs, toMs, { index: 0, name: 'test' });
    let tz = GLib.TimeZone.new_identifier(zone || 'UTC');
    return result.occurrences.map(function (o) {
        return GLib.DateTime.new_from_unix_utc(Math.floor(o.startMs / 1000))
            .to_timezone(tz).format('%Y-%m-%d %H:%M');
    });
}

function summaries(text, fromMs, toMs) {
    let result = ICal.parseOccurrences(text, fromMs, toMs, { index: 0, name: 'test' });
    return result.occurrences.map(function (o) { return o.summary; });
}

print('\nline folding and escaping');
{
    let text = ics(
        'BEGIN:VEVENT\r\n' +
        'UID:fold-1\r\n' +
        'SUMMARY:A very long title that has been\r\n  wrapped across lines\r\n' +
        'DESCRIPTION:line one\\nline two\\; with semicolon\\, and comma\r\n' +
        'DTSTART:20240615T090000Z\r\n' +
        'DTEND:20240615T100000Z\r\n' +
        'END:VEVENT'
    );
    let parsed = ICal.parse(text);
    check('unfolds continuation lines', parsed.events[0].summary,
        'A very long title that has been wrapped across lines');
    check('unescapes text', parsed.events[0].description,
        'line one\nline two; with semicolon, and comma');
}
{
    // Several exporters write a raw newline inside a description rather
    // than the escape the specification requires. In a CRLF document a
    // lone LF cannot be a line break, so the remainder must be content
    // and not a new property to be discarded.
    let text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
        'BEGIN:VEVENT\r\nUID:lf-1\r\nSUMMARY:Board call\r\n' +
        'DTSTART:20240615T090000Z\r\nDTEND:20240615T100000Z\r\n' +
        'DESCRIPTION:Papers attached\nJoin: https://meet.example.com/x\r\n' +
        'LOCATION:Room 1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    let event = ICal.parse(text).events[0];
    check('a raw newline in a CRLF feed is kept as description content',
        event.description, 'Papers attached\nJoin: https://meet.example.com/x');
    check('and the properties after it are still read', event.location, 'Room 1');
}
{
    // Feeds terminating lines with bare LF are common and legitimate;
    // for them no such distinction exists and nothing should change.
    let text = 'BEGIN:VCALENDAR\nVERSION:2.0\n' +
        'BEGIN:VEVENT\nUID:lf-2\nSUMMARY:Plain\n' +
        'DTSTART:20240615T090000Z\nDTEND:20240615T100000Z\n' +
        'DESCRIPTION:Nothing unusual\nLOCATION:Room 2\nEND:VEVENT\nEND:VCALENDAR\n';
    let event = ICal.parse(text).events[0];
    check('an LF-terminated feed still parses each property separately',
        [event.description, event.location, event.summary],
        ['Nothing unusual', 'Room 2', 'Plain']);
}
{
    // Folding must still win: a CRLF followed by a space is a
    // continuation, not the start of a new property.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:lf-3\r\nSUMMARY:Folded\r\n' +
        'DTSTART:20240615T090000Z\r\nDTEND:20240615T100000Z\r\n' +
        'DESCRIPTION:first part \r\n second part\r\nEND:VEVENT'
    );
    check('folding is unaffected by the raw newline handling',
        ICal.parse(text).events[0].description, 'first part second part');
}

print('\ntimezone handling');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:tz-1\r\nSUMMARY:NY meeting\r\n' +
        'DTSTART;TZID=America/New_York:20240615T090000\r\n' +
        'DTEND;TZID=America/New_York:20240615T100000\r\n' +
        'END:VEVENT'
    );
    check('TZID resolves to the right instant',
        startsIn(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), 'UTC'),
        ['2024-06-15 13:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:tz-2\r\nSUMMARY:Outlook style\r\n' +
        'DTSTART;TZID="Eastern Standard Time":20240615T090000\r\n' +
        'DTEND;TZID="Eastern Standard Time":20240615T100000\r\n' +
        'END:VEVENT'
    );
    check('Windows zone names are mapped',
        startsIn(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), 'UTC'),
        ['2024-06-15 13:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:tz-3\r\nSUMMARY:Prefixed zone\r\n' +
        'DTSTART;TZID=/freeassociation.sourceforge.net/America/New_York:20240615T090000\r\n' +
        'DTEND;TZID=/freeassociation.sourceforge.net/America/New_York:20240615T100000\r\n' +
        'END:VEVENT'
    );
    check('prefixed TZID falls back to the trailing identifier',
        startsIn(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), 'UTC'),
        ['2024-06-15 13:00']);
}

print('\nwindowing');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:w-1\r\nSUMMARY:Before\r\n' +
        'DTSTART:20240614T090000Z\r\nDTEND:20240614T100000Z\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:w-2\r\nSUMMARY:Inside\r\n' +
        'DTSTART:20240615T090000Z\r\nDTEND:20240615T100000Z\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:w-3\r\nSUMMARY:After\r\n' +
        'DTSTART:20240616T090000Z\r\nDTEND:20240616T100000Z\r\nEND:VEVENT'
    );
    check('only events overlapping the window survive',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 15, 23, 59)),
        ['Inside']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:w-4\r\nSUMMARY:Straddles midnight\r\n' +
        'DTSTART:20240614T220000Z\r\nDTEND:20240615T060000Z\r\nEND:VEVENT'
    );
    check('an event still running at window start is included',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 15, 23, 59)),
        ['Straddles midnight']);
}

print('\nduration and end times');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:d-1\r\nSUMMARY:By duration\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H30M\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), null);
    check('DURATION sets the end time',
        (result.occurrences[0].endMs - result.occurrences[0].startMs) / 60000, 90);
}

print('\nrecurrence: daily');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:r-1\r\nSUMMARY:Standup\r\n' +
        'DTSTART;TZID=Europe/Berlin:20200101T093000\r\nDURATION:PT15M\r\n' +
        'RRULE:FREQ=DAILY\r\nEND:VEVENT'
    );
    check('a long-running daily rule reaches far into the future',
        startsIn(text, ms('Europe/Berlin', 2030, 3, 14, 0, 0), ms('Europe/Berlin', 2030, 3, 14, 23, 59), 'Europe/Berlin'),
        ['2030-03-14 09:30']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:r-2\r\nSUMMARY:Every third day\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY;INTERVAL=3\r\nEND:VEVENT'
    );
    check('INTERVAL is respected',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 12, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-04 09:00', '2024-06-07 09:00', '2024-06-10 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:r-3\r\nSUMMARY:Five only\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT'
    );
    check('COUNT stops the series',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 30, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-02 09:00', '2024-06-03 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:r-4\r\nSUMMARY:Until\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY;UNTIL=20240603T235959Z\r\nEND:VEVENT'
    );
    check('UNTIL stops the series',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 30, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-02 09:00', '2024-06-03 09:00']);
}

print('\nrecurrence: daylight saving');
{
    // Berlin springs forward on 2024-03-31. A 09:30 meeting must stay at
    // 09:30 wall clock, which means the UTC instant shifts by an hour.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:dst-1\r\nSUMMARY:Standup\r\n' +
        'DTSTART;TZID=Europe/Berlin:20240325T093000\r\nDURATION:PT15M\r\n' +
        'RRULE:FREQ=DAILY\r\nEND:VEVENT'
    );
    check('wall-clock time survives a DST transition',
        startsIn(text, ms('Europe/Berlin', 2024, 3, 30, 0, 0), ms('Europe/Berlin', 2024, 4, 1, 23, 59), 'UTC'),
        ['2024-03-30 08:30', '2024-03-31 07:30', '2024-04-01 07:30']);
}

print('\nrecurrence: weekly');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:w-r1\r\nSUMMARY:Mon and Wed\r\n' +
        'DTSTART:20240603T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEND:VEVENT'
    );
    check('BYDAY expands within each week',
        startsIn(text, ms('UTC', 2024, 6, 3, 0, 0), ms('UTC', 2024, 6, 14, 0, 0), 'UTC'),
        ['2024-06-03 09:00', '2024-06-05 09:00', '2024-06-10 09:00', '2024-06-12 09:00']);
}
{
    // DTSTART is a Wednesday but the rule only fires on Mondays, so the
    // first occurrence is the following week.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:w-r2\r\nSUMMARY:Mondays only\r\n' +
        'DTSTART:20240605T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT'
    );
    check('BYDAY earlier in the start week does not abort the series',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 20, 0, 0), 'UTC'),
        ['2024-06-10 09:00', '2024-06-17 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:w-r3\r\nSUMMARY:Fortnightly\r\n' +
        'DTSTART:20240603T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO\r\nEND:VEVENT'
    );
    check('weekly INTERVAL is respected',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 7, 2, 0, 0), 'UTC'),
        ['2024-06-03 09:00', '2024-06-17 09:00', '2024-07-01 09:00']);
}

print('\nrecurrence: monthly and yearly');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m-1\r\nSUMMARY:Second Tuesday\r\n' +
        'DTSTART:20240109T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=MONTHLY;BYDAY=2TU\r\nEND:VEVENT'
    );
    check('ordinal BYDAY picks the nth weekday',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 8, 31, 0, 0), 'UTC'),
        ['2024-06-11 09:00', '2024-07-09 09:00', '2024-08-13 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m-2\r\nSUMMARY:Last Friday\r\n' +
        'DTSTART:20240126T170000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=MONTHLY;BYDAY=-1FR\r\nEND:VEVENT'
    );
    check('negative ordinals count back from the end of the month',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 8, 31, 0, 0), 'UTC'),
        ['2024-06-28 17:00', '2024-07-26 17:00', '2024-08-30 17:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m-3\r\nSUMMARY:Rent\r\n' +
        'DTSTART:20240131T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=MONTHLY\r\nEND:VEVENT'
    );
    check('months too short for the start day are skipped, not clamped',
        startsIn(text, ms('UTC', 2024, 2, 1, 0, 0), ms('UTC', 2024, 6, 1, 0, 0), 'UTC'),
        ['2024-03-31 09:00', '2024-05-31 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:y-1\r\nSUMMARY:Birthday\r\n' +
        'DTSTART;VALUE=DATE:19900712\r\n' +
        'RRULE:FREQ=YEARLY\r\nEND:VEVENT'
    );
    check('yearly all-day recurrence reaches the current era',
        startsIn(text, ms('UTC', 2031, 7, 12, 0, 0), ms('UTC', 2031, 7, 12, 23, 0), 'UTC').length, 1);
}

print('\nexceptions and overrides');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:e-1\r\nSUMMARY:Daily\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY\r\n' +
        'EXDATE:20240603T090000Z\r\nEND:VEVENT'
    );
    check('EXDATE removes a single occurrence',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 5, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-02 09:00', '2024-06-04 09:00']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:o-1\r\nSUMMARY:Daily\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:o-1\r\nSUMMARY:Daily (moved)\r\n' +
        'RECURRENCE-ID:20240602T090000Z\r\n' +
        'DTSTART:20240602T140000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
    );
    check('RECURRENCE-ID replaces the generated occurrence',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 4, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-02 14:00', '2024-06-03 09:00']);
    check('the override supplies its own title',
        summaries(text, ms('UTC', 2024, 6, 2, 0, 0), ms('UTC', 2024, 6, 2, 23, 59)),
        ['Daily (moved)']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:rd-1\r\nSUMMARY:Extra date\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RDATE:20240605T110000Z\r\nEND:VEVENT'
    );
    check('RDATE adds an occurrence',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 10, 0, 0), 'UTC'),
        ['2024-06-01 09:00', '2024-06-05 11:00']);
}

print('\nall-day events');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:ad-1\r\nSUMMARY:Public holiday\r\n' +
        'DTSTART;VALUE=DATE:20240615\r\nDTEND;VALUE=DATE:20240616\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 15, 23, 59), null);
    check('all-day events are flagged', result.occurrences[0].allDay, true);
}

print('\nnested components');
{
    let text = ics(
        'BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\n' +
        'BEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nEND:DAYLIGHT\r\n' +
        'END:VTIMEZONE\r\n' +
        'BEGIN:VEVENT\r\nUID:n-1\r\nSUMMARY:Real event\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\n' +
        'BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:Alarm noise\r\nEND:VALARM\r\n' +
        'END:VEVENT'
    );
    check('VTIMEZONE and VALARM contents never become events',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 15, 23, 59)),
        ['Real event']);
}

print('\nmalformed input');
{
    check('empty input yields nothing', summaries('', 0, 1), []);
    check('garbage input yields nothing', summaries('not a calendar at all', 0, 1), []);
    let text = ics('BEGIN:VEVENT\r\nUID:bad\r\nSUMMARY:No start\r\nEND:VEVENT');
    check('events without DTSTART are dropped', summaries(text, 0, 1e13), []);
}

print('\nperformance');
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:p-1\r\nSUMMARY:Ancient daily\r\n' +
        'DTSTART:19950101T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY\r\nEND:VEVENT'
    );
    let began = GLib.get_monotonic_time();
    let out = startsIn(text, ms('UTC', 2035, 6, 15, 0, 0), ms('UTC', 2035, 6, 15, 23, 59), 'UTC');
    let elapsed = (GLib.get_monotonic_time() - began) / 1000;
    check('a 40 year old daily rule still resolves', out, ['2035-06-15 09:00']);
    print('       (' + elapsed.toFixed(1) + ' ms)');
    if (elapsed > 250) {
        failed++;
        print('  FAIL expansion took too long');
    } else {
        passed++;
        print('  ok   expansion stays under 250 ms');
    }
}

print('\nmalformed recurrence rules');
{
    // COUNT=0 means a rule that produces nothing. Treating the falsy zero
    // as "no limit" would instead repeat the event forever.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:c0\r\nSUMMARY:None\r\n' +
        'DTSTART:20200101T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY;COUNT=0\r\nEND:VEVENT'
    );
    check('COUNT=0 produces nothing rather than everything',
        startsIn(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), 'UTC'),
        []);
}
{
    // A frequency this reader cannot expand must not make the whole
    // appointment vanish; the first instance still matters.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:hr\r\nSUMMARY:Medication\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT10M\r\n' +
        'RRULE:FREQ=HOURLY\r\nEND:VEVENT'
    );
    check('an unsupported FREQ still shows the event itself',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0)),
        ['Medication']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:ty\r\nSUMMARY:Typo\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT30M\r\n' +
        'RRULE:FREQ=WEEKLYY\r\nEND:VEVENT'
    );
    check('a misspelled FREQ does not hide the event',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0)),
        ['Typo']);
}
{
    // An impossible UNTIL parses by shape but yields NaN, and every
    // comparison against NaN is false, which would quietly disable the
    // loop's termination guards.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:Bad until\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=DAILY;UNTIL=20240230T000000Z\r\nEND:VEVENT'
    );
    let began = GLib.get_monotonic_time();
    let out = startsIn(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), 'UTC');
    let elapsed = (GLib.get_monotonic_time() - began) / 1000;
    check('an impossible UNTIL is ignored rather than breaking the guards',
        out, ['2024-06-15 09:00']);
    check('and it resolves promptly', elapsed < 200, true);
}
{
    // Sunday is zero, and a falsy-zero fallback would silently rewrite
    // the commonest WKST value in the world to Monday.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:wk\r\nSUMMARY:Fortnightly\r\n' +
        'DTSTART:20240603T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=MO\r\nEND:VEVENT'
    );
    check('WKST=SU is honoured',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 7, 2, 0, 0), 'UTC'),
        ['2024-06-03 09:00', '2024-06-17 09:00', '2024-07-01 09:00']);
}
{
    // BYDAY without an ordinal probes 1st through 5th plus last, and in a
    // month with four of that weekday the 4th and the last are the same
    // day. The duplicate would shift every BYSETPOS index.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:sp\r\nSUMMARY:Second to last Monday\r\n' +
        'DTSTART:20240101T090000Z\r\nDURATION:PT1H\r\n' +
        'RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-2\r\nEND:VEVENT'
    );
    check('BYSETPOS counts distinct days only',
        startsIn(text, ms('UTC', 2024, 6, 1, 0, 0), ms('UTC', 2024, 6, 30, 0, 0), 'UTC'),
        ['2024-06-17 09:00']);
}

print('\nstructurally broken calendars');
{
    // A stray END would pop VCALENDAR off the stack, after which no
    // further event is recognised and the rest of the file is lost.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:s1\r\nSUMMARY:First\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\n' +
        'END:VTIMEZONE\r\n' +
        'BEGIN:VEVENT\r\nUID:s2\r\nSUMMARY:Second\r\n' +
        'DTSTART:20240615T110000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
    );
    check('a mismatched END does not discard the rest of the calendar',
        summaries(text, ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0)),
        ['First', 'Second']);
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:nd\r\nSUMMARY:Backwards\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:-PT1H\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), null);
    check('a negative duration never puts the end before the start',
        result.occurrences[0].endMs >= result.occurrences[0].startMs, true);
}

print('\nescaping');
{
    // Expanding "\\n" before collapsing "\\\\" consumes the second
    // backslash of an escaped pair, turning a Windows path into a newline.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:esc\r\nSUMMARY:Paths\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\n' +
        'DESCRIPTION:C:\\\\new folder\\nsecond line\r\nEND:VEVENT'
    );
    check('an escaped backslash is not mistaken for a newline',
        ICal.parse(text).events[0].description,
        'C:\\new folder\nsecond line');
}

print('\nhostile input');
{
    // Desklets draw inside the Cinnamon process, so an unbounded title
    // does not just break this widget, it hangs the desktop.
    let huge = 'A'.repeat(200000);
    let text = ics(
        'BEGIN:VEVENT\r\nUID:big\r\nSUMMARY:' + huge + '\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), null);
    check('an enormous title is capped before it reaches the toolkit',
        result.occurrences[0].summary.length < 400, true);
}
{
    // A right-to-left override reverses the rendering of everything after
    // it, which is exactly how a hostile link is made to look familiar.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:bidi\r\nSUMMARY:Innocent\u202etitle\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), null);
    check('bidirectional overrides are stripped from titles',
        /[\u202a-\u202e]/.test(result.occurrences[0].summary), false);
}
{
    // One pathological rule must not starve every other event, and the
    // document as a whole must stay within a sane time budget.
    let body = '';
    for (let i = 0; i < 200; i++) {
        body += 'BEGIN:VEVENT\r\nUID:h' + i + '\r\nSUMMARY:Heavy ' + i + '\r\n' +
            'DTSTART:19900101T090000Z\r\nDURATION:PT1H\r\n' +
            'RRULE:FREQ=MONTHLY;COUNT=99999999;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n' +
            'END:VEVENT\r\n';
    }
    let began = GLib.get_monotonic_time();
    ICal.parseOccurrences(ics(body),
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0), null);
    let elapsed = (GLib.get_monotonic_time() - began) / 1000;
    check('a deliberately expensive calendar stays bounded',
        elapsed < 1500, true);
    print('       (' + elapsed.toFixed(0) + ' ms for 200 hostile rules)');
}
{
    // The realistic case must not be collateral damage of that bound.
    let body = '';
    let freqs = ['DAILY', 'WEEKLY;BYDAY=MO,WE,FR', 'MONTHLY;BYDAY=2TU', 'YEARLY'];
    for (let i = 0; i < 200; i++) {
        body += 'BEGIN:VEVENT\r\nUID:r' + i + '\r\nSUMMARY:Meeting ' + i + '\r\n' +
            'DTSTART:20150301T090000Z\r\nDURATION:PT30M\r\n' +
            'RRULE:FREQ=' + freqs[i % 4] + '\r\nEND:VEVENT\r\n';
    }
    let result = ICal.parseOccurrences(ics(body),
        ms('UTC', 2024, 6, 17, 0, 0), ms('UTC', 2024, 6, 18, 0, 0), null);
    check('a heavy but genuine calendar keeps all of its events',
        result.occurrences.length, 100);
}

print('\ncalendar names');
{
    function named(props) {
        return ICal.parse(ics(
            props +
            'BEGIN:VEVENT\r\nUID:n1\r\nSUMMARY:Ev\r\n' +
            'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
        )).calendarName;
    }

    check('the widely used X-WR-CALNAME is read',
        named('X-WR-CALNAME:Work Calendar\r\n'), 'Work Calendar');
    check('the RFC 7986 NAME property is read',
        named('NAME:Team Schedule\r\n'), 'Team Schedule');
    check('the standard property wins when a feed publishes both',
        named('X-WR-CALNAME:Old\r\nNAME:New\r\n'), 'New');
    check('regardless of the order they appear in',
        named('NAME:New\r\nX-WR-CALNAME:Old\r\n'), 'New');
    check('a feed that publishes no name reports none', named(''), null);
    check('escaped punctuation is decoded',
        named('X-WR-CALNAME:Ada\\, Bob and Eve\r\n'), 'Ada, Bob and Eve');
    check('a folded name is rejoined',
        named('X-WR-CALNAME:A calendar with a rather long\r\n  name\r\n'),
        'A calendar with a rather long name');

    // The name is shown on screen, so it gets the same treatment as any
    // other untrusted feed text.
    check('an absurdly long name is capped',
        named('X-WR-CALNAME:' + 'N'.repeat(500) + '\r\n').length < 60, true);
    check('bidirectional overrides are stripped',
        /[\u202a-\u202e]/.test(named('X-WR-CALNAME:Team\u202eName\r\n')), false);

    // A name declared inside a component belongs to that component.
    check('a name nested in a VEVENT is not taken for the calendar',
        ICal.parse(ics(
            'BEGIN:VEVENT\r\nUID:n2\r\nSUMMARY:Ev\r\nNAME:Not the calendar\r\n' +
            'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
        )).calendarName, null);
}
{
    // The name a person typed in front of the URL is a deliberate choice
    // and outranks whatever the feed calls itself.
    let text = ics(
        'X-WR-CALNAME:Published Name\r\n' +
        'BEGIN:VEVENT\r\nUID:n3\r\nSUMMARY:Ev\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT1H\r\nEND:VEVENT'
    );
    let withUserName = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0),
        { index: 0, name: 'My Name' });
    check('a name typed by the user takes precedence',
        withUserName.occurrences[0].calendarName, 'My Name');

    let detected = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0),
        { index: 0, name: '' });
    check('otherwise the published name is used',
        detected.occurrences[0].calendarName, 'Published Name');
    check('and it is reported alongside the occurrences',
        detected.calendarName, 'Published Name');
}
{
    // Each occurrence has to carry its own calendar, or a merged agenda
    // could not tell you which feed a given event came from.
    let text = ics(
        'X-WR-CALNAME:Shared\r\n' +
        'BEGIN:VEVENT\r\nUID:n4\r\nSUMMARY:Daily\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT'
    );
    let result = ICal.parseOccurrences(text,
        ms('UTC', 2024, 6, 15, 0, 0), ms('UTC', 2024, 6, 16, 0, 0),
        { index: 3, name: '' });
    check('every occurrence knows its calendar',
        [result.occurrences[0].calendarName, result.occurrences[0].calendarIndex],
        ['Shared', 3]);
}

print('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0)
    imports.system.exit(1);
