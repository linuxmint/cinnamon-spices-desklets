/*
 * feeds.js - fetches ICS documents over the network and keeps a copy on
 * disk so the desklet has something to show the instant it starts, long
 * before the first response arrives.
 */

const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const MAX_FEEDS = 10;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

var _session = null;

function session() {
    if (_session)
        return _session;

    if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
        _session = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(_session, new Soup.ProxyResolverDefault());
    } else {
        _session = new Soup.Session();
    }
    _session.user_agent = 'agenda-desklet/1.0';
    return _session;
}

/*
 * Reads the feed list as typed into the settings box. Each line is either
 * a bare URL or "Name | URL"; blanks and comments are ignored.
 */
function parseFeedList(raw) {
    let feeds = [];
    let seen = Object.create(null);

    String(raw || '').split(/[\r\n]+/).forEach(function (line) {
        let trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#')
            return;
        if (feeds.length >= MAX_FEEDS)
            return;

        let name = '';
        let url = trimmed;

        let separator = trimmed.indexOf('|');
        if (separator !== -1) {
            name = trimmed.substring(0, separator).trim();
            url = trimmed.substring(separator + 1).trim();
        }

        url = url.replace(/^webcal:\/\//i, 'https://');
        if (!/^https?:\/\//i.test(url))
            return;
        if (seen[url])
            return;
        seen[url] = true;

        feeds.push({ index: feeds.length, name: name, url: url });
    });

    return feeds;
}

function cacheDirectory() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'agenda@ashex']);
}

function cachePathFor(url) {
    let digest = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
    return GLib.build_filenamev([cacheDirectory(), digest.substring(0, 32) + '.ics']);
}

/*
 * Reads a cached calendar. Asynchronous because a desklet shares the
 * Cinnamon process: a synchronous read here stalls the whole desktop,
 * and this runs for every feed the moment the desklet starts.
 */
function readCache(url, onDone) {
    let file = Gio.File.new_for_path(cachePathFor(url));

    file.load_contents_async(null, function (source, result) {
        let body = null;
        try {
            let [ok, contents] = source.load_contents_finish(result);
            if (ok)
                body = ByteArray.toString(contents);
        } catch (e) {
            // A missing cache file is the normal case on first run.
            body = null;
        }
        onDone(body);
    });
}

function writeCache(url, body) {
    let file = Gio.File.new_for_path(cachePathFor(url));

    // PRIVATE keeps the file readable only by its owner. A cached
    // calendar holds meeting titles, attendees and join links, which is
    // nobody else's business on a shared machine.
    let flags = Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE;

    function write() {
        file.replace_contents_bytes_async(
            GLib.Bytes.new(ByteArray.fromString(body)),
            null, false, flags, null,
            function (source, result) {
                try {
                    source.replace_contents_finish(result);
                } catch (e) {
                    // Deliberately not logging the URL: it is a credential.
                    global.logWarning('agenda: could not cache a calendar: ' + e);
                }
            });
    }

    // Create the directory on first use, then write into it.
    let directory = Gio.File.new_for_path(cacheDirectory());
    directory.make_directory_async(GLib.PRIORITY_DEFAULT, null, function (source, result) {
        try {
            source.make_directory_finish(result);
        } catch (e) {
            // Already there is the usual outcome, and is not an error.
        }
        write();
    });
}

function describeStatus(status) {
    switch (status) {
        // Soup reports zero when the request never reached a server at all.
        case 0: return 'unreachable';
        case 401: return 'needs authentication';
        case 403: return 'access refused';
        case 404: return 'not found';
        case 408: return 'timed out';
        case 429: return 'rate limited';
        default:
            if (status >= 500)
                return 'server error ' + status;
            if (status >= 400)
                return 'rejected (HTTP ' + status + ')';
            return 'HTTP ' + status;
    }
}

function shortHost(url) {
    let match = /^https?:\/\/([^/:]+)/i.exec(url);
    return match ? match[1] : url;
}

// Errors are shown to a person, so name the calendar the way they named it.
function feedLabel(feed) {
    return feed.name || shortHost(feed.url);
}

/*
 * A captive portal, a login page or an error page served with HTTP 200
 * would otherwise be cached over the last good calendar and then parsed
 * into zero events, telling the user their day is empty. Checking for the
 * one line every iCalendar document must start with is enough to tell a
 * calendar from a web page.
 */
function looksLikeCalendar(body) {
    return /BEGIN:VCALENDAR/i.test(String(body).substring(0, 4096));
}

/*
 * Fetches every feed concurrently and calls back exactly once, when the
 * last one has either answered or failed. Failures fall back to the
 * cached copy so a flaky network degrades into stale data rather than an
 * empty screen.
 */
function fetchAll(feeds, timeoutSeconds, cancellable, onComplete) {
    if (!feeds.length) {
        onComplete([]);
        return;
    }

    let http = session();
    http.timeout = timeoutSeconds;
    http.idle_timeout = timeoutSeconds;

    let results = new Array(feeds.length);
    let outstanding = feeds.length;
    let finished = false;

    function settle(position, result) {
        if (finished)
            return;
        results[position] = result;
        outstanding--;
        if (outstanding === 0) {
            finished = true;
            onComplete(results);
        }
    }

    // A failed fetch falls back to the last good copy on disk, so a
    // flaky network degrades into stale data rather than a blank agenda.
    function fallback(feed, position, reason) {
        readCache(feed.url, function (cached) {
            settle(position, {
                feed: feed,
                body: cached,
                stale: cached !== null,
                error: reason,
            });
        });
    }

    feeds.forEach(function (feed, position) {
        let message;
        try {
            message = Soup.Message.new('GET', feed.url);
        } catch (e) {
            message = null;
        }
        if (!message) {
            fallback(feed, position, feedLabel(feed) + ': malformed URL');
            return;
        }

        if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
            http.queue_message(message, function (_session, response) {
                if (response.status_code !== 200) {
                    fallback(feed, position,
                        feedLabel(feed) + ': ' + describeStatus(response.status_code));
                    return;
                }
                let raw = response.response_body ? response.response_body.data : null;
                if (!raw || !raw.length) {
                    fallback(feed, position, feedLabel(feed) + ': empty response');
                    return;
                }
                if (raw.length > MAX_BODY_BYTES) {
                    fallback(feed, position, feedLabel(feed) + ': response too large');
                    return;
                }
                let body = raw.toString();
                if (!looksLikeCalendar(body)) {
                    fallback(feed, position, feedLabel(feed) + ': not a calendar');
                    return;
                }
                writeCache(feed.url, body);
                settle(position, { feed: feed, body: body, stale: false, error: null });
            });
            return;
        }

        http.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable,
            function (httpSession, asyncResult) {
                let status = message.get_status();
                if (status !== 200) {
                    fallback(feed, position, feedLabel(feed) + ': ' + describeStatus(status));
                    return;
                }
                try {
                    let bytes = httpSession.send_and_read_finish(asyncResult);
                    let data = bytes ? bytes.get_data() : null;
                    if (!data || !data.length) {
                        fallback(feed, position, feedLabel(feed) + ': empty response');
                        return;
                    }
                    if (data.length > MAX_BODY_BYTES) {
                        fallback(feed, position, feedLabel(feed) + ': response too large');
                        return;
                    }
                    let body = ByteArray.toString(data);
                    if (!looksLikeCalendar(body)) {
                        fallback(feed, position, feedLabel(feed) + ': not a calendar');
                        return;
                    }
                    writeCache(feed.url, body);
                    settle(position, { feed: feed, body: body, stale: false, error: null });
                } catch (e) {
                    fallback(feed, position, feedLabel(feed) + ': ' + (e.message || 'unreachable'));
                }
            });
    });
}

/*
 * Everything already on disk, so the desklet has something to show the
 * instant it starts rather than an empty box until the network answers.
 */
function loadAllFromCache(feeds, onComplete) {
    if (!feeds.length) {
        onComplete([]);
        return;
    }

    let results = new Array(feeds.length);
    let outstanding = feeds.length;

    feeds.forEach(function (feed, position) {
        readCache(feed.url, function (cached) {
            results[position] = {
                feed: feed,
                body: cached,
                stale: cached !== null,
                error: null,
            };
            outstanding--;
            if (outstanding === 0)
                onComplete(results);
        });
    });
}
