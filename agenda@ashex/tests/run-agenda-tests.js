#!/usr/bin/env cjs-console
/*
 * Tests for the agenda decision layer, the formatter and the palette.
 * Run with: cjs-console tests/run-agenda-tests.js
 */

const GLib = imports.gi.GLib;
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

/*
 * Cinnamon installs this on startup (js/ui/environment.js); the shipped
 * code relies on it, so stand it up the same way rather than faking it.
 */
if (typeof String.prototype.format !== 'function')
    String.prototype.format = imports.format.format;



const Agenda = imports.lib.agenda;
const Format = imports.lib.format;
const ThemeLib = imports.lib.theme;
const Feeds = imports.lib.feeds;

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

function at(hour, minute) {
    let now = GLib.DateTime.new_now_local();
    return GLib.DateTime.new_local(now.get_year(), now.get_month(),
        now.get_day_of_month(), hour, minute || 0, 0).to_unix() * 1000;
}

function event(summary, startHour, startMinute, durationMinutes, extra) {
    let startMs = at(startHour, startMinute);
    let occurrence = {
        uid: summary,
        summary: summary,
        location: '',
        description: '',
        status: '',
        transparency: '',
        partstat: '',
        allDay: false,
        start: new Date(startMs),
        end: new Date(startMs + durationMinutes * 60000),
        startMs: startMs,
        endMs: startMs + durationMinutes * 60000,
        calendarIndex: 0,
        calendarName: '',
    };
    for (let key in (extra || {}))
        occurrence[key] = extra[key];
    return occurrence;
}

function allDayEvent(summary, extra) {
    let startMs = at(0, 0);
    let occurrence = event(summary, 0, 0, 1440, extra);
    occurrence.allDay = true;
    occurrence.startMs = startMs;
    occurrence.endMs = startMs + 86400000;
    occurrence.start = new Date(occurrence.startMs);
    occurrence.end = new Date(occurrence.endMs);
    return occurrence;
}

const DEFAULTS = {
    maxUpcoming: 4,
    keepOngoing: true,
    showAllDay: true,
    hideDeclined: true,
    hideTransparent: false,
    imminentMinutes: 15,
};

function model(events, nowMs, overrides) {
    let options = {};
    for (let key in DEFAULTS)
        options[key] = DEFAULTS[key];
    for (let key in (overrides || {}))
        options[key] = overrides[key];
    return Agenda.buildModel(events, nowMs, options);
}

print('\nchoosing the focused event');
{
    let events = [
        event('Standup', 9, 30, 15),
        event('Design review', 11, 0, 60),
        event('Lunch', 12, 30, 45),
    ];
    let m = model(events, at(9, 0));
    check('the soonest future event takes the spotlight', m.focus.summary, 'Standup');
    check('focus state is next', m.focusState, 'next');
    check('the rest queue up behind it',
        m.upcoming.map(function (o) { return o.summary; }),
        ['Design review', 'Lunch']);
}
{
    let events = [
        event('Standup', 9, 30, 60),
        event('Design review', 11, 0, 60),
    ];
    let m = model(events, at(9, 45));
    check('an event in progress holds the spotlight', m.focus.summary, 'Standup');
    check('focus state is now', m.focusState, 'now');
    check('progress is measured through the event', Math.round(m.progress * 100), 25);
    check('it is not repeated in the list below',
        m.upcoming.map(function (o) { return o.summary; }), ['Design review']);
}
{
    let events = [event('Standup', 9, 30, 60), event('Design review', 11, 0, 60)];
    let m = model(events, at(9, 45), { keepOngoing: false });
    check('with the option off, the spotlight skips ahead', m.focus.summary, 'Design review');
}
{
    let events = [
        event('All hands', 9, 0, 180),
        event('Quick sync', 10, 0, 15),
    ];
    let m = model(events, at(9, 50));
    check('among overlapping events the one ending soonest wins',
        m.focus.summary, 'All hands');
}
{
    let m = model([event('Breakfast', 7, 0, 30)], at(12, 0));
    check('a finished day has no focus', m.focus, null);
    check('and reports itself as done', m.isDayDone, true);
    check('but remembers the day was not empty', m.doneCount, 1);
    check('so the day still counts as having had events', m.totalToday, 1);
}
{
    let m = model([], at(12, 0));
    check('a genuinely empty day counts nothing', m.totalToday, 0);
    check('and nothing is marked as done', m.doneCount, 0);
}
{
    let m = model([allDayEvent('Public holiday')], at(12, 0));
    check('an all-day only day is not mistaken for empty', m.totalToday, 1);
}

print('\nstaying inside today');
{
    let tomorrowMs = at(9, 0) + 86400000;
    let tomorrow = event('Tomorrow thing', 9, 0, 60);
    tomorrow.startMs = tomorrowMs;
    tomorrow.endMs = tomorrowMs + 3600000;
    tomorrow.start = new Date(tomorrow.startMs);
    tomorrow.end = new Date(tomorrow.endMs);

    let m = model([event('Today thing', 15, 0, 60), tomorrow], at(9, 0));
    check('tomorrow never enters the list',
        m.upcoming.map(function (o) { return o.summary; }), []);
    check('but is offered as a hint', m.tomorrowFirst.summary, 'Tomorrow thing');
}
{
    let m = model([event('Late one', 23, 30, 60)], at(23, 50));
    check('an event straddling midnight still counts as today',
        m.focus.summary, 'Late one');
    check('and is recognised as in progress', m.focusState, 'now');
}

print('\nfiltering');
{
    let events = [
        event('Cancelled thing', 10, 0, 60, { status: 'CANCELLED' }),
        event('Declined thing', 11, 0, 60, { partstat: 'DECLINED' }),
        event('Real thing', 12, 0, 60),
    ];
    let m = model(events, at(9, 0));
    check('cancelled and declined events are dropped', m.focus.summary, 'Real thing');
    check('and nothing else is left', m.upcoming.length, 0);
}
{
    let events = [
        event('Cancelled thing', 10, 0, 60, { status: 'CANCELLED' }),
        event('Real thing', 12, 0, 60),
    ];
    let m = model(events, at(9, 0), { hideDeclined: false });
    check('the filter can be switched off', m.focus.summary, 'Cancelled thing');
}
{
    let events = [
        event('Focus block', 10, 0, 60, { transparency: 'TRANSPARENT' }),
        event('Real meeting', 12, 0, 60),
    ];
    check('free time is kept by default',
        model(events, at(9, 0)).focus.summary, 'Focus block');
    check('and can be hidden',
        model(events, at(9, 0), { hideTransparent: true }).focus.summary, 'Real meeting');
}
{
    let events = [allDayEvent('Public holiday'), event('Meeting', 14, 0, 60)];
    let m = model(events, at(9, 0));
    check('all-day events live in their own strip',
        m.allDay.map(function (o) { return o.summary; }), ['Public holiday']);
    check('and never steal the spotlight', m.focus.summary, 'Meeting');
    check('all-day events can be hidden entirely',
        model(events, at(9, 0), { showAllDay: false }).allDay.length, 0);
}

print('\nlist limits');
{
    let events = [];
    for (let hour = 10; hour < 18; hour++)
        events.push(event('Meeting ' + hour, hour, 0, 30));

    let m = model(events, at(9, 0), { maxUpcoming: 3 });
    check('the list honours the configured maximum', m.upcoming.length, 3);
    check('and reports what it held back', m.hiddenCount, 4);

    let none = model(events, at(9, 0), { maxUpcoming: 0 });
    check('a maximum of zero shows only the focused event', none.upcoming.length, 0);
    check('while still counting the remainder', none.hiddenCount, 7);
}

print('\nurgency');
{
    let events = [event('Interview', 10, 0, 60)];
    check('a distant event is calm',
        model(events, at(8, 0)).urgency, 0);
    check('urgency climbs as it approaches',
        Math.round(model(events, at(9, 50)).urgency * 100) / 100, 0.33);
    check('and peaks at the start',
        Math.round(model(events, at(9, 59)).urgency * 100) / 100, 0.93);
    check('an event in progress is always fully urgent',
        model(events, at(10, 30)).urgency, 1);
    check('the highlight can be disabled',
        model(events, at(9, 55), { imminentMinutes: 0 }).urgency, 0);
}

print('\nredraw scheduling');
{
    let events = [event('Interview', 10, 0, 60)];
    check('hours away, redraw sparingly',
        Agenda.nextTickDelaySeconds(model(events, at(6, 0)), at(6, 0)), 60);
    check('within the hour, redraw often',
        Agenda.nextTickDelaySeconds(model(events, at(9, 30)), at(9, 30)), 20);
    check('in the final minutes, redraw every ten seconds',
        Agenda.nextTickDelaySeconds(model(events, at(9, 59)), at(9, 59)), 10);
    check('an empty day barely redraws at all',
        Agenda.nextTickDelaySeconds(model([], at(9, 0)), at(9, 0)), 300);
}

print('\nfeed list parsing');
{
    let feeds = Feeds.parseFeedList(
        '# my calendars\n' +
        'https://example.com/a.ics\n' +
        '\n' +
        'Work | https://example.com/b.ics\n' +
        'webcal://example.com/c.ics\n' +
        '   \n' +
        'not-a-url\n' +
        'https://example.com/a.ics\n'
    );
    check('comments, blanks and junk are ignored', feeds.length, 3);
    check('names are separated from URLs', feeds[1].name, 'Work');
    check('webcal is rewritten to https', feeds[2].url, 'https://example.com/c.ics');
    check('duplicates are collapsed',
        feeds.map(function (f) { return f.url; }),
        ['https://example.com/a.ics', 'https://example.com/b.ics', 'https://example.com/c.ics']);
    check('feeds are indexed for stable colouring',
        feeds.map(function (f) { return f.index; }), [0, 1, 2]);
}
{
    let many = [];
    for (let i = 0; i < 25; i++)
        many.push('https://example.com/' + i + '.ics');
    check('the feed list is capped at ten', Feeds.parseFeedList(many.join('\n')).length, 10);
}

print('\ntime formatting');
{
    let twelve = new Format.Formatter('12h');
    let twentyFour = new Format.Formatter('24h');
    let morning = new Date(2024, 5, 15, 9, 5, 0);
    let evening = new Date(2024, 5, 15, 17, 30, 0);

    check('24 hour times are zero padded', twentyFour.time(morning), '09:05');
    check('24 hour ranges keep both ends', twentyFour.range(morning, evening), '09:05 - 17:30');
    check('12 hour times carry a meridiem', /9:05\s?AM/i.test(twelve.time(morning)), true);
    check('12 hour ranges drop the repeated meridiem',
        /^9:05 - 11:05\s?AM$/i.test(twelve.range(morning, new Date(2024, 5, 15, 11, 5, 0))), true);
}
{
    let f = new Format.Formatter('24h');
    check('zero countdown reads as now', f.countdown(0), 'now');
    check('sub-minute countdown', f.countdown(30000), 'in under a minute');
    check('single minute is singular', f.countdown(60000), 'in 1 minute');
    check('minutes stay minutes', f.countdown(25 * 60000), 'in 25 minutes');
    check('round hours drop the minutes', f.countdown(120 * 60000), 'in 2 hours');
    check('ragged hours keep them', f.countdown(150 * 60000), 'in 2h 30m');
    check('elapsed time reads naturally', f.elapsed(10 * 60000), 'started 10 minutes ago');
    check('remaining time reads naturally', f.remaining(5 * 60000), '5 minutes left');
    check('durations are compact', f.duration(90 * 60000), '1h 30m');
    check('round durations are compact', f.duration(120 * 60000), '2 h');
}

print('\npalette');
{
    let a = { calendarIndex: 0, start: new Date(2024, 5, 15, 9, 0) };
    let b = { calendarIndex: 1, start: new Date(2024, 5, 15, 9, 0) };

    check('calendar mode keeps a feed on one colour',
        ThemeLib.accentFor('calendar', a, 7).name,
        ThemeLib.accentFor('calendar', a, 3).name);
    check('different feeds get different colours',
        ThemeLib.accentFor('calendar', a, 0).name !== ThemeLib.accentFor('calendar', b, 0).name,
        true);
    check('position mode walks the rainbow',
        [0, 1, 2].map(function (i) { return ThemeLib.accentFor('position', a, i).name; }),
        ['rose', 'coral', 'amber']);
    check('the rainbow wraps around rather than running out',
        ThemeLib.accentFor('position', a, ThemeLib.RAINBOW.length).name, 'rose');

    let morning = { calendarIndex: 0, start: new Date(2024, 5, 15, 7, 0) };
    let evening = { calendarIndex: 0, start: new Date(2024, 5, 15, 20, 0) };
    check('clock mode separates morning from evening',
        ThemeLib.accentFor('clock', morning, 0).name !== ThemeLib.accentFor('clock', evening, 0).name,
        true);
    check('times outside the mapped day stay in range',
        typeof ThemeLib.accentFor('clock', { calendarIndex: 0, start: new Date(2024, 5, 15, 3, 0) }, 0).name,
        'string');
}

print('\nstyle generation');
{
    let theme = new ThemeLib.Theme({
        scale: 1, dark: true, opacity: 0.72, glow: true,
        tint: true, density: 'comfortable', width: 380,
    });
    let accent = ThemeLib.RAINBOW[0];

    check('the root style pins the configured width',
        /width: 380px;/.test(theme.rootStyle()), true);
    check('glow appears on the focused card',
        /box-shadow/.test(theme.focusCardStyle(accent, 1)), true);

    theme.update({ scale: 1, dark: true, opacity: 0.72, glow: false,
        tint: true, density: 'comfortable', width: 380 });
    check('and disappears when switched off',
        /box-shadow/.test(theme.focusCardStyle(accent, 1)), false);

    theme.update({ scale: 2, dark: true, opacity: 0.72, glow: true,
        tint: true, density: 'comfortable', width: 380 });
    check('scaling doubles the type size', theme.pt(8), 16);
    check('density and scale compound', theme.gap(10), 20);

    theme.update({ scale: 1, dark: true, opacity: 0.72, glow: true,
        tint: true, density: 'compact', width: 380 });
    let compactGap = theme.gap(10);
    theme.update({ scale: 1, dark: true, opacity: 0.72, glow: true,
        tint: true, density: 'spacious', width: 380 });
    check('spacious layouts breathe more than compact ones',
        theme.gap(10) > compactGap, true);

    let light = new ThemeLib.Theme({ scale: 1, dark: false, opacity: 0.72,
        glow: true, tint: true, density: 'comfortable', width: 380 });
    check('light surfaces use dark text',
        /rgba\(16,16,24/.test(light.rootStyle()), true);
}

print('\ncontrast');
{
    function colourOf(style) {
        let match = /color: rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(style);
        return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }

    let dark = new ThemeLib.Theme({ scale: 1, dark: true, opacity: 0.72,
        glow: true, tint: true, density: 'comfortable', width: 380 });
    let light = new ThemeLib.Theme({ scale: 1, dark: false, opacity: 0.85,
        glow: true, tint: true, density: 'comfortable', width: 380 });

    let worstDark = 99;
    let worstLight = 99;
    ThemeLib.RAINBOW.forEach(function (accent) {
        worstDark = Math.min(worstDark,
            ThemeLib.contrastRatio(colourOf(dark.upcomingTimeStyle(accent)), [18, 18, 26]));
        worstLight = Math.min(worstLight,
            ThemeLib.contrastRatio(colourOf(light.upcomingTimeStyle(accent)), [246, 246, 250]));
    });

    check('every accent is readable on a dark surface', worstDark >= 4.5, true);
    check('every accent is readable on a light surface', worstLight >= 4.5, true);
    check('a colour already contrasting enough is left alone',
        colourOf(dark.upcomingTimeStyle(ThemeLib.RAINBOW[2])),
        ThemeLib.RAINBOW[2].rgb);
}

print('\nevents already in progress');
{
    // Minutes relative to now, so the model sees a genuinely running event.
    function relativeEvent(summary, startOffsetMinutes, durationMinutes) {
        let startMs = Date.now() + startOffsetMinutes * 60000;
        return {
            uid: summary, summary: summary, location: '', description: '',
            status: '', transparency: '', partstat: '', allDay: false,
            start: new Date(startMs),
            end: new Date(startMs + durationMinutes * 60000),
            startMs: startMs, endMs: startMs + durationMinutes * 60000,
            calendarIndex: 0, calendarName: '',
        };
    }

    let events = [
        relativeEvent('Running meeting', -20, 60),
        relativeEvent('Later thing', 90, 30),
    ];

    /*
     * "Keep ongoing" chooses which event gets the spotlight. It must not
     * decide whether a meeting you are currently sitting in is mentioned
     * at all: dropping it silently loses a real appointment.
     */
    let on = model(events, Date.now(), { keepOngoing: true });
    let off = model(events, Date.now(), { keepOngoing: false });

    check('with the option on it takes the spotlight',
        on.focus.summary, 'Running meeting');
    check('with the option off the spotlight moves on',
        off.focus.summary, 'Later thing');
    check('but the running meeting is still listed',
        off.upcoming.map(function (o) { return o.summary; }), ['Running meeting']);
    check('and is still counted', off.remainingCount, 1);
}

print('\ntime format detection');
{
    /*
     * The probe must reflect the locale, not the machine's timezone.
     * Formatting a fixed UTC instant renders it in local time, so an
     * 18:00 UTC sample reads as 10:00 in California and a "is the hour
     * small" heuristic then misreads a 24-hour locale as 12-hour.
     */
    let explicit12 = new Format.Formatter('12h');
    let explicit24 = new Format.Formatter('24h');
    check('an explicit 12-hour setting is honoured', explicit12.hour12, true);
    check('an explicit 24-hour setting is honoured', explicit24.hour12, false);

    let auto = new Format.Formatter('auto');
    check('auto resolves to a boolean rather than guessing',
        typeof auto.hour12, 'boolean');
    check('and agrees with what the formatter actually renders',
        /[AaPp][Mm]/.test(auto.time(new Date(2024, 5, 15, 17, 30))),
        auto.hour12);
}

print('\nnegative and malformed durations');
{
    let now = Date.now();
    let backwards = {
        uid: 'b', summary: 'Backwards', location: '', description: '',
        status: '', transparency: '', partstat: '', allDay: false,
        start: new Date(now + 60000), end: new Date(now + 60000),
        startMs: now + 60000, endMs: now + 60000,
        calendarIndex: 0, calendarName: '',
    };
    let m = model([backwards], now);
    check('a zero-length event still appears', m.focus.summary, 'Backwards');

    let f = new Format.Formatter('24h');
    check('a negative span never renders as negative time',
        f.duration(-3600000), '0 min');
}

print('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0)
    imports.system.exit(1);
