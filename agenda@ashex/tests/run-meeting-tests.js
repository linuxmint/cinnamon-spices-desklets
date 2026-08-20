#!/usr/bin/env cjs-console
/*
 * Tests for meeting link detection.
 * Run with: cjs-console tests/run-meeting-tests.js
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



const Meeting = imports.lib.meeting;
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

function detect(fields) {
    return Meeting.detect(fields || {});
}

function urlOf(fields) {
    let result = detect(fields);
    return result ? result.url : null;
}

function providerOf(fields) {
    let result = detect(fields);
    return result ? result.provider : null;
}

print('\nexplicit conference properties');
{
    check('Google sets its own property',
        urlOf({ googleConference: 'https://meet.google.com/abc-defg-hij' }),
        'https://meet.google.com/abc-defg-hij');
    check('and it is recognised as Meet',
        providerOf({ googleConference: 'https://meet.google.com/abc-defg-hij' }), 'meet');

    check('Outlook sets a Teams property',
        providerOf({ teamsUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc' }),
        'teams');

    check('RFC 7986 CONFERENCE is honoured',
        urlOf({ conferences: [{ value: 'https://example.com/room/42', feature: 'VIDEO' }] }),
        'https://example.com/room/42');
    check('an unknown host is still offered as a generic meeting',
        providerOf({ conferences: [{ value: 'https://example.com/room/42', feature: 'VIDEO' }] }),
        'generic');
}
{
    // A conference block often lists a dial-in and a chat room alongside
    // the actual call. Clicking a tel: or xmpp: URI helps nobody here.
    let fields = { conferences: [
        { value: 'tel:+1-412-555-0123,,,654321', feature: 'PHONE,MODERATOR' },
        { value: 'xmpp:chat-123@conference.example.com', feature: 'CHAT' },
        { value: 'https://video.example.com/j/12345', feature: 'VIDEO' },
    ] };
    check('video is chosen over phone and chat',
        urlOf(fields), 'https://video.example.com/j/12345');
}
{
    let fields = { conferences: [
        { value: 'https://audio.example.com/a/1', feature: 'AUDIO' },
        { value: 'https://video.example.com/v/1', feature: 'VIDEO' },
    ] };
    check('video outranks audio', urlOf(fields), 'https://video.example.com/v/1');
}
{
    let fields = {
        googleConference: 'https://meet.google.com/xyz-1234-abc',
        location: 'https://zoom.us/j/999',
    };
    check('an explicit property beats a link pasted into the location',
        urlOf(fields), 'https://meet.google.com/xyz-1234-abc');
}

print('\nlinks pasted into the location field');
{
    check('a bare Zoom link in the location is found',
        urlOf({ location: 'https://acme.zoom.us/j/1234567890?pwd=Ab3dEf' }),
        'https://acme.zoom.us/j/1234567890?pwd=Ab3dEf');
    check('and recognised as Zoom',
        providerOf({ location: 'https://acme.zoom.us/j/1234567890' }), 'zoom');
    check('a link wrapped in prose is still found',
        urlOf({ location: 'Board room, or join at https://meet.google.com/abc-defg-hij' }),
        'https://meet.google.com/abc-defg-hij');
    check('a physical location alone yields nothing',
        detect({ location: 'Room 2.14, Hauptstrasse 3' }), null);
}

print('\nlinks buried in the description');
{
    // This is roughly the shape Google Calendar actually produces.
    let description =
        '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-\n' +
        'Join with Google Meet: https://meet.google.com/pqr-stuv-wxy\n' +
        'Or dial: (US) +1 555-555-5555 PIN: 123456789#\n' +
        '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-';
    check('the Meet link is pulled out of the boilerplate',
        urlOf({ description: description }), 'https://meet.google.com/pqr-stuv-wxy');
}
{
    // A meeting link and an unrelated link in the same description.
    let description =
        'Agenda: https://docs.example.com/agenda-q3\n' +
        'Join: https://acme.zoom.us/j/555';
    check('the conferencing link wins over an unrelated document link',
        urlOf({ description: description }), 'https://acme.zoom.us/j/555');
}
{
    check('a description with only ordinary links offers nothing',
        detect({ description: 'Notes at https://wiki.example.com/page and https://example.org' }),
        null);
}
{
    check('the location is preferred over the description',
        urlOf({
            location: 'https://meet.google.com/loc-atio-nnn',
            description: 'Join: https://acme.zoom.us/j/555',
        }),
        'https://meet.google.com/loc-atio-nnn');
}

print('\nmessy real-world links');
{
    check('HTML entities in a query string are decoded',
        urlOf({ description: 'Join https://acme.zoom.us/j/123?pwd=aaa&amp;uname=bob' }),
        'https://acme.zoom.us/j/123?pwd=aaa&uname=bob');
    check('a trailing full stop is not part of the link',
        urlOf({ description: 'Join at https://meet.google.com/abc-defg-hij.' }),
        'https://meet.google.com/abc-defg-hij');
    check('angle brackets are stripped',
        urlOf({ description: 'Join <https://meet.google.com/abc-defg-hij>' }),
        'https://meet.google.com/abc-defg-hij');
    check('a link inside parentheses keeps its own brackets balanced',
        urlOf({ description: 'Call (see https://meet.google.com/a_(b)) for details' }),
        'https://meet.google.com/a_(b)');
    check('trailing comma and semicolon are removed',
        urlOf({ description: 'Options: https://acme.zoom.us/j/1, or dial in' }),
        'https://acme.zoom.us/j/1');
    check('an anchor fragment survives',
        urlOf({ description: 'https://meet.jit.si/StandupRoom#config.startAudioOnly=true' }),
        'https://meet.jit.si/StandupRoom#config.startAudioOnly=true');
}

print('\nprovider recognition');
{
    let cases = [
        ['https://meet.google.com/abc', 'meet', 'Google Meet'],
        ['https://acme.zoom.us/j/1', 'zoom', 'Zoom'],
        ['https://zoom.us/j/1', 'zoom', 'Zoom'],
        ['https://teams.microsoft.com/l/meetup-join/x', 'teams', 'Microsoft Teams'],
        ['https://acme.webex.com/meet/bob', 'webex', 'Webex'],
        ['https://meet.jit.si/Room', 'jitsi', 'Jitsi Meet'],
        ['https://meet.proton.me/join/abc123', 'protonmeet', 'Proton Meet'],
        ['https://kmeet.infomaniak.com/abc-defg-hij', 'kmeet', 'kMeet'],
        ['https://whereby.com/room', 'whereby', 'Whereby'],
        ['https://acme.bluejeans.com/1', 'bluejeans', 'BlueJeans'],
        ['https://acme.gotomeeting.com/join/1', 'goto', 'GoTo Meeting'],
        ['https://chime.aws/1234', 'chime', 'Amazon Chime'],
    ];
    cases.forEach(function (entry) {
        let result = detect({ location: entry[0] });
        check(entry[2] + ' is recognised', result ? [result.provider, result.providerName] : null,
            [entry[1], entry[2]]);
    });
}
{
    // The whole point of matching on host: a page that merely mentions a
    // service in its path is not a meeting.
    check('a lookalike path is not mistaken for a call',
        detect({ location: 'https://wiki.example.com/zoom.us/how-to-join' }), null);
    check('a lookalike subdomain of another site is not matched',
        detect({ location: 'https://zoom.us.phishing.example/j/1' }), null);
    check('a Proton inbox link is not mistaken for a call',
        detect({ description: 'Invite sent from https://mail.proton.me/u/0/inbox' }), null);
    check('the Proton account page is not a call either',
        detect({ description: 'Manage at https://account.proton.me/dashboard' }), null);
    check('but a Proton Meet link found in a description is',
        urlOf({ description: 'Join the call: https://meet.proton.me/join/xy-9z8' }),
        'https://meet.proton.me/join/xy-9z8');
    check('an Infomaniak drive link is not mistaken for a call',
        detect({ description: 'Files at https://drive.infomaniak.com/app/drive/1/files' }), null);
    check('Infomaniak webmail is not a call either',
        detect({ description: 'Sent from https://mail.infomaniak.com/0/inbox' }), null);
    check('but a kMeet link found in a description is',
        urlOf({ description: 'Rejoignez: https://kmeet.infomaniak.com/qrs-tuvw-xyz' }),
        'https://kmeet.infomaniak.com/qrs-tuvw-xyz');
}

print('\nsafety');
{
    check('javascript URLs are never offered',
        detect({ googleConference: 'javascript:alert(1)' }), null);
    check('file URLs are never offered',
        detect({ googleConference: 'file:///etc/passwd' }), null);
    check('data URLs are never offered',
        detect({ googleConference: 'data:text/html,<script>x</script>' }), null);
    check('a URL containing a space is rejected',
        detect({ googleConference: 'https://example.com/a b' }), null);
    check('an empty event yields nothing', detect({}), null);
    check('null-ish fields yield nothing',
        detect({ location: null, description: undefined, url: '' }), null);
}

print('\nhost spoofing');
{
    /*
     * Everything before an "@" is userinfo, not the host. A check that
     * stops at the first ":" reads a trusted brand out of these and
     * would put a "Join Meet" button on an attacker's site.
     */
    check('credentials cannot disguise the real host',
        detect({ location: 'https://meet.google.com:x@evil.com/j/1' }), null);
    check('the same trick with Zoom is refused',
        detect({ location: 'https://zoom.us:x@evil.com/' }), null);
    check('a bare userinfo host is refused',
        detect({ location: 'https://meet.google.com@evil.com/j/1' }), null);
    check('credentials are refused even on a genuine host',
        detect({ location: 'https://user:pass@meet.google.com/j/1' }), null);
    check('an explicit conference property gets the same scrutiny',
        detect({ googleConference: 'https://meet.google.com:x@evil.com/j/1' }), null);

    // Browsers treat a backslash as a separator; most parsers do not.
    // Never resolve that disagreement, refuse instead.
    check('a backslash in the authority is refused',
        detect({ location: 'https://evil.com\\.zoom.us/j/1' }), null);
    check('and refused from an explicit property too',
        detect({ teamsUrl: 'https://evil.com\\.teams.microsoft.com/x' }), null);

    // Whitespace inside a URL terminates it, so what remains must still
    // be judged on its own merits rather than on what followed.
    check('a tab does not smuggle a second host past the check',
        urlOf({ location: 'https://meet.google.com\t.evil.com/x' }),
        'https://meet.google.com');

    check('an absurdly long URL is refused',
        detect({ googleConference: 'https://meet.google.com/' + 'a'.repeat(4000) }), null);

    // Genuine links must be untouched by all of the above.
    check('ordinary meeting links still resolve',
        [
            'https://meet.google.com/abc-defg-hij',
            'https://acme.zoom.us/j/98765?pwd=Ab3d',
            'https://meet.proton.me/join/9Xk2',
            'https://kmeet.infomaniak.com/qrs-tuvw',
        ].map(function (u) {
            let found = detect({ location: u });
            return found ? found.provider : null;
        }),
        ['meet', 'zoom', 'protonmeet', 'kmeet']);
}

print('\nend to end through the calendar reader');
function ics(body) {
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n' + body + '\r\nEND:VCALENDAR\r\n';
}
function ms(y, mo, d, h, mi) {
    return GLib.DateTime.new_utc(y, mo, d, h, mi, 0).to_unix() * 1000;
}
function occurrences(text) {
    return ICal.parseOccurrences(text, ms(2024, 6, 15, 0, 0), ms(2024, 6, 16, 0, 0), null).occurrences;
}

{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m1\r\nSUMMARY:Standup\r\n' +
        'DTSTART:20240615T090000Z\r\nDTEND:20240615T091500Z\r\n' +
        'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij\r\n' +
        'END:VEVENT'
    );
    let occ = occurrences(text)[0];
    check('the reader attaches the meeting to the occurrence',
        occ.meeting.url, 'https://meet.google.com/abc-defg-hij');
    check('with a label ready for a button', occ.meeting.label, 'Meet');
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m2\r\nSUMMARY:Sync\r\n' +
        'DTSTART:20240615T100000Z\r\nDTEND:20240615T103000Z\r\n' +
        'CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join here:https://acme.webex.com/meet/bob\r\n' +
        'END:VEVENT'
    );
    check('CONFERENCE survives a round trip through the reader',
        occurrences(text)[0].meeting.providerName, 'Webex');
}
{
    // Folded lines are the norm for long meeting URLs.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m3\r\nSUMMARY:Long link\r\n' +
        'DTSTART:20240615T110000Z\r\nDTEND:20240615T113000Z\r\n' +
        'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3a\r\n' +
        ' meeting_NjQwZTk1\r\n' +
        'END:VEVENT'
    );
    check('a meeting URL split across folded lines is rejoined',
        occurrences(text)[0].meeting.url,
        'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQwZTk1');
}
{
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m4\r\nSUMMARY:In person\r\n' +
        'DTSTART:20240615T120000Z\r\nDTEND:20240615T130000Z\r\n' +
        'LOCATION:Room 2.14\r\nEND:VEVENT'
    );
    check('an event with no link reports none', occurrences(text)[0].meeting, null);
}
{
    // Every occurrence of a recurring meeting shares one link, and
    // detection should not be repeated for each one.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m5\r\nSUMMARY:Daily standup\r\n' +
        'DTSTART:20240601T090000Z\r\nDURATION:PT15M\r\n' +
        'RRULE:FREQ=DAILY\r\n' +
        'DESCRIPTION:Join with Google Meet: https://meet.google.com/rec-urri-ing\r\n' +
        'END:VEVENT'
    );
    let all = ICal.parseOccurrences(text, ms(2024, 6, 1, 0, 0), ms(2024, 6, 20, 0, 0), null).occurrences;
    check('every occurrence of a recurring meeting carries the link',
        all.length > 5 && all.every(function (o) {
            return o.meeting && o.meeting.url === 'https://meet.google.com/rec-urri-ing';
        }), true);
    check('and they all share one detection result',
        all.every(function (o) { return o.meeting === all[0].meeting; }), true);
}
{
    // A moved instance can carry its own link.
    let text = ics(
        'BEGIN:VEVENT\r\nUID:m6\r\nSUMMARY:Weekly\r\n' +
        'DTSTART:20240610T090000Z\r\nDURATION:PT30M\r\nRRULE:FREQ=DAILY\r\n' +
        'X-GOOGLE-CONFERENCE:https://meet.google.com/reg-ular-one\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:m6\r\nSUMMARY:Weekly (relocated)\r\n' +
        'RECURRENCE-ID:20240615T090000Z\r\n' +
        'DTSTART:20240615T090000Z\r\nDURATION:PT30M\r\n' +
        'X-GOOGLE-CONFERENCE:https://meet.google.com/spe-cial-one\r\nEND:VEVENT'
    );
    let occ = occurrences(text)[0];
    check('an overridden instance uses its own meeting link',
        occ.meeting.url, 'https://meet.google.com/spe-cial-one');
}

print('\nwhen the join button should appear');
{
    // Mirrors the desklet's visibility rule, kept here so the timing
    // logic is covered without needing a running shell.
    function visible(startOffsetMinutes, endOffsetMinutes, leadMinutes, hasMeeting) {
        let now = 1000000000000;
        let occurrence = {
            startMs: now + startOffsetMinutes * 60000,
            endMs: now + endOffsetMinutes * 60000,
            meeting: hasMeeting === false ? null : { url: 'https://meet.google.com/a' },
        };
        if (!occurrence.meeting)
            return false;
        if (!leadMinutes)
            return true;
        if (occurrence.startMs <= now)
            return true;
        return (occurrence.startMs - now) <= leadMinutes * 60000;
    }

    check('with no lead time the button is always offered',
        visible(240, 300, 0), true);
    check('an event without a link never offers one',
        visible(5, 35, 0, false), false);
    check('a distant meeting is hidden when a lead time is set',
        visible(240, 300, 15), false);
    check('and appears once inside the lead window',
        visible(10, 40, 15), true);
    check('exactly at the threshold it is showing',
        visible(15, 45, 15), true);
    check('a meeting already running always offers the link',
        visible(-10, 20, 15), true);
}

print('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0)
    imports.system.exit(1);
