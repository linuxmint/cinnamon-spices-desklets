/*
 * meeting.js - finds the "join" link for an appointment.
 *
 * Calendar services are maddeningly inconsistent about where they put a
 * video call link. Google sets a private X-GOOGLE-CONFERENCE property and
 * also buries the link in the description; Outlook uses its own Teams
 * property; standards-compliant producers use RFC 7986 CONFERENCE; plenty
 * of people simply paste a Zoom link into the location field.
 *
 * This module looks in all of those places, in order of how much we can
 * trust them, and reports back a single URL plus the service it belongs
 * to so the desklet can label the button properly.
 */

const GLib = imports.gi.GLib;

/*
 * Recognised conferencing services. Matching on host rather than on a
 * substring of the whole URL avoids the obvious trap where a link like
 * https://notes.example.com/zoom-retro would be mistaken for a call.
 */
const PROVIDERS = [
    {
        id: 'meet',
        name: 'Google Meet',
        short: 'Meet',
        hosts: [/^meet\.google\.com$/i, /^stream\.meet\.google\.com$/i],
    },
    {
        id: 'zoom',
        name: 'Zoom',
        short: 'Zoom',
        hosts: [/(^|\.)zoom\.us$/i, /(^|\.)zoomgov\.com$/i],
    },
    {
        id: 'teams',
        name: 'Microsoft Teams',
        short: 'Teams',
        hosts: [/(^|\.)teams\.microsoft\.com$/i, /(^|\.)teams\.live\.com$/i,
                /(^|\.)teams\.microsoft\.us$/i],
    },
    {
        id: 'webex',
        name: 'Webex',
        short: 'Webex',
        hosts: [/(^|\.)webex\.com$/i, /(^|\.)webex\.com\.cn$/i],
    },
    {
        id: 'jitsi',
        name: 'Jitsi Meet',
        short: 'Jitsi',
        hosts: [/^meet\.jit\.si$/i, /(^|\.)jitsi\.net$/i],
    },
    {
        id: 'protonmeet',
        name: 'Proton Meet',
        short: 'Proton',
        // Only the meet subdomain: mail, drive and account all live on
        // proton.me too, and none of them are a call.
        hosts: [/^meet\.proton\.me$/i],
    },
    {
        id: 'kmeet',
        name: 'kMeet',
        short: 'kMeet',
        // Infomaniak runs mail, drive and the rest of kSuite on the same
        // domain, so pin this to the meeting subdomain alone.
        hosts: [/^kmeet\.infomaniak\.com$/i],
    },
    {
        id: 'whereby',
        name: 'Whereby',
        short: 'Whereby',
        hosts: [/(^|\.)whereby\.com$/i, /(^|\.)appear\.in$/i],
    },
    {
        id: 'bluejeans',
        name: 'BlueJeans',
        short: 'BlueJeans',
        hosts: [/(^|\.)bluejeans\.com$/i],
    },
    {
        id: 'goto',
        name: 'GoTo Meeting',
        short: 'GoTo',
        hosts: [/(^|\.)gotomeeting\.com$/i, /(^|\.)goto\.com$/i,
                /(^|\.)gotomeet\.me$/i],
    },
    {
        id: 'chime',
        name: 'Amazon Chime',
        short: 'Chime',
        hosts: [/(^|\.)chime\.aws$/i],
    },
    {
        id: 'meetecho',
        name: 'Meetecho',
        short: 'Meetecho',
        hosts: [/(^|\.)meetecho\.com$/i],
    },
    {
        id: 'discord',
        name: 'Discord',
        short: 'Discord',
        hosts: [/(^|\.)discord\.gg$/i, /(^|\.)discord\.com$/i],
    },
    {
        id: 'slack',
        name: 'Slack',
        short: 'Slack',
        hosts: [/(^|\.)slack\.com$/i],
    },
    {
        id: 'jami',
        name: 'Jami',
        short: 'Jami',
        hosts: [/(^|\.)jami\.net$/i],
    },
    {
        id: 'bbb',
        name: 'BigBlueButton',
        short: 'BBB',
        hosts: [/(^|\.)bigbluebutton\.org$/i],
    },
];

const GENERIC = { id: 'generic', name: 'meeting', short: 'meeting' };

/*
 * Returns the hostname a browser would actually connect to, or null if
 * the URL is not one we are willing to touch.
 *
 * This must never be done with a hand-rolled regex. A pattern that stops
 * at the first ":" reads "meet.google.com" out of
 * "https://meet.google.com:x@evil.com/", because everything before the
 * "@" is userinfo, not the host. A hostile calendar invite could then
 * put a trusted brand on a button pointing at an attacker's site.
 *
 * So: parse properly, then refuse anything ambiguous.
 */
function hostOf(url) {
    let text = String(url);

    // Backslashes are treated as separators by browsers but as ordinary
    // host characters by most parsers, so the two disagree about where
    // the host ends. Never resolve that disagreement, just refuse.
    if (text.indexOf('\\') !== -1)
        return null;

    // Control characters and whitespace can hide the real authority.
    if (/[\u0000-\u0020\u007f]/.test(text))
        return null;

    let uri;
    try {
        uri = GLib.Uri.parse(text, GLib.UriFlags.NONE);
    } catch (e) {
        return null;
    }
    if (!uri)
        return null;

    let scheme = (uri.get_scheme() || '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https')
        return null;

    // Credentials in a meeting link are never legitimate here, and they
    // are the classic way to disguise the real destination.
    if (uri.get_userinfo())
        return null;

    let host = uri.get_host();
    if (!host)
        return null;

    return host.toLowerCase();
}

function providerFor(url) {
    let host = hostOf(url);
    if (!host)
        return null;

    for (let i = 0; i < PROVIDERS.length; i++) {
        let provider = PROVIDERS[i];
        for (let h = 0; h < provider.hosts.length; h++) {
            if (provider.hosts[h].test(host))
                return provider;
        }
    }
    return null;
}

/*
 * Descriptions arrive as HTML often enough that the entities have to go,
 * or half the Zoom links in the world would carry a literal "&amp;" in
 * their query string and fail to open the right meeting.
 */
function decodeEntities(text) {
    return String(text)
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&#x0*27;/gi, "'")
        .replace(/&nbsp;/gi, ' ');
}

/*
 * Links are usually embedded in prose or markup, so the surrounding
 * punctuation has to be peeled off without damaging URLs that genuinely
 * end in a bracket or a slash.
 */
function tidyUrl(raw) {
    let url = decodeEntities(String(raw).trim());

    url = url.replace(/^[<("']+/, '');
    url = url.replace(/[>"']+$/, '');
    // Sentence punctuation clinging to the end of a link.
    url = url.replace(/[.,;:!?]+$/, '');
    // Markup that survived a naive HTML-to-text conversion.
    url = url.replace(/&(amp|lt|gt|quot);?$/i, '');

    // Closing brackets are only surplus if the link does not open them
    // itself, so count rather than strip. This keeps a wrapped link like
    // "(see https://example.com/a_(b))" intact while still discarding the
    // prose bracket around it.
    let opens = (url.match(/\(/g) || []).length;
    let closes = (url.match(/\)/g) || []).length;
    while (closes > opens && /\)$/.test(url)) {
        url = url.slice(0, -1);
        closes--;
    }

    return url;
}

// A meeting URL long enough to be a denial-of-service is not a meeting URL.
const MAX_URL_LENGTH = 2048;

/*
 * Only ever hand a browser a plain web address. This defers to the same
 * parser the provider check uses, so nothing can pass validation here
 * that would be understood differently there.
 */
function isSafeUrl(url) {
    if (!url || url.length > MAX_URL_LENGTH)
        return false;
    if (!/^https?:\/\/[^\s<>"']+$/i.test(url))
        return false;
    return hostOf(url) !== null;
}

/*
 * Scanning is capped because this runs on the desktop's main loop and the
 * text comes from a remote feed. A join link that a person was actually
 * meant to find is never buried a hundred kilobytes into a description.
 */
const MAX_SCAN_CHARS = 100000;

function findUrls(text) {
    if (!text)
        return [];

    let source = String(text);
    if (source.length > MAX_SCAN_CHARS)
        source = source.substring(0, MAX_SCAN_CHARS);

    let matches = decodeEntities(source).match(/https?:\/\/[^\s<>"']+/gi);
    if (!matches)
        return [];
    return matches.map(tidyUrl).filter(isSafeUrl);
}

/*
 * Picks the join link for an event.
 *
 * Sources are consulted in descending order of trust. A dedicated
 * conference property means the organiser's software explicitly declared
 * this to be the meeting, so any web address there is accepted. Location
 * and description are guesses by comparison, so only links belonging to a
 * recognised conferencing service are taken from them; otherwise a link
 * to the agenda doc in the description would masquerade as the call.
 */
function detect(fields) {
    let explicit = [];

    // RFC 7986 CONFERENCE, preferring an entry that claims to carry video.
    (fields.conferences || []).forEach(function (entry) {
        let url = tidyUrl(entry.value);
        if (!isSafeUrl(url))
            return;
        let features = String(entry.feature || '').toUpperCase();
        let rank = 3;
        if (features.indexOf('VIDEO') !== -1)
            rank = 1;
        else if (features.indexOf('AUDIO') !== -1)
            rank = 2;
        explicit.push({ url: url, rank: rank, label: entry.label || '' });
    });

    // Vendor properties. Both are unambiguous statements of intent.
    [fields.googleConference, fields.teamsUrl].forEach(function (value) {
        if (!value)
            return;
        let url = tidyUrl(value);
        if (isSafeUrl(url))
            explicit.push({ url: url, rank: 0, label: '' });
    });

    if (explicit.length) {
        explicit.sort(function (a, b) { return a.rank - b.rank; });
        let chosen = explicit[0];
        let provider = providerFor(chosen.url) || GENERIC;
        return {
            url: chosen.url,
            provider: provider.id,
            providerName: provider.name,
            label: provider.short,
            source: 'conference',
        };
    }

    // Fall back to sniffing the human-facing fields, accepting only links
    // that belong to a service we actually recognise.
    let sniffOrder = [
        { text: fields.location, source: 'location' },
        { text: fields.url, source: 'url' },
        { text: fields.description, source: 'description' },
    ];

    for (let i = 0; i < sniffOrder.length; i++) {
        let candidates = findUrls(sniffOrder[i].text);
        for (let c = 0; c < candidates.length; c++) {
            let provider = providerFor(candidates[c]);
            if (provider) {
                return {
                    url: candidates[c],
                    provider: provider.id,
                    providerName: provider.name,
                    label: provider.short,
                    source: sniffOrder[i].source,
                };
            }
        }
    }

    return null;
}
