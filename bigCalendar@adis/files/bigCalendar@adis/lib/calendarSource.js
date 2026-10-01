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

/* Reading calendar events from evolution-data-server.
 *
 * This desklet owns no Google credential. It reads events the same way
 * Cinnamon's own calendar applet, GNOME Calendar and Evolution do: from
 * evolution-data-server (EDS), which holds the account the user connected
 * once in Online Accounts. EDS is what talks to Google, refreshes the OAuth
 * token, resolves timezones and caches everything for offline use. All this
 * module does is ask it questions and turn the answers into plain objects.
 *
 * It does *not* expand recurring events, despite the name of the option that
 * suggests it. A repeating event arrives as one component carrying its rule,
 * and the occurrences are worked out below.
 *
 * Cinnamon depends directly on gir1.2-ecal-2.0 and gir1.2-edataserver-1.2, so
 * these imports are safe on any Cinnamon 6.x system.
 *
 * Two rules govern everything here, because this code runs inside the
 * Cinnamon process, on the same main loop that draws the desktop:
 *
 *   1. Never block. A synchronous EDS call stops the compositor, which freezes
 *      the panel, the window manager and every other desklet with it. So there
 *      is no `_sync` call anywhere below: the registry is built and every
 *      calendar is read through the async API.
 *
 *      The registry is the one that reads wrongly at first glance. GJS exposes
 *      EDataServer.SourceRegistry with a `new_sync` and, apparently, no async
 *      counterpart -- there is no `new_async` to call. The async constructor
 *      does exist, but EDS names it `eds_source_registry_new` rather than the
 *      `*_new_async` that introspection would rename, so it arrives as plain
 *      `new(cancellable, callback)` with `new_finish()` to collect it. See
 *      openRegistry(). It was called synchronously here for a while on the
 *      strength of that missing `new_async`, which put a call that waits on a
 *      D-Bus service back on the compositor's thread.
 *
 *      It runs once when the feed is opened and again on each re-open -- see
 *      open(). Re-opening is what lets a calendar that was unreachable at
 *      startup connect later without restarting Cinnamon, and it is
 *      deliberately cheap: calendars that are already open are skipped before
 *      any real work.
 *
 *   2. Never leak a callback into a dead object. A query in flight when the
 *      desklet is removed must not write into destroyed actors, hence the
 *      Cancellable and the `destroyed` guard.
 */

import Gio from 'gi://Gio';
import ICalGLib from 'gi://ICalGLib?version=3.0';
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';

const pad2 = (n) => (n < 10 ? "0" : "") + n;

/**
 * An iCalendar date/time as a millisecond instant.
 *
 * Takes either an ECal.ComponentDateTime (the wrapper component.get_dtstart()
 * returns) or a bare ICalGLib.Time, and has to be given the wrapper wherever
 * one is available. The zone usually lives on the wrapper, not on the value:
 * a component written as
 *
 *     DTSTART;TZID=Europe/Bucharest:20260214T080000
 *
 * comes back as a *floating* time with `tzid` set on the wrapper and no zone
 * on the value at all. `as_timet()` reads a floating time's civil fields as if
 * they were UTC, so reading it directly puts the event at 08:00Z instead of
 * 06:00Z -- two hours late, three in summer, and on the wrong day when the
 * offset carries it past midnight.
 *
 * Some backends instead normalise to UTC first (Google's does: the same event
 * from a Google calendar arrives as 20260214T060000Z with the zone already
 * applied). Both shapes have to work, so the zone is looked for on the value,
 * then on the wrapper.
 *
 * A TZID that is not a builtin zone -- Google writes some as
 * `/freeassociation.sourceforge.net/Tzfile/Europe/Bucharest` -- falls back to
 * the trailing zone name, and failing that to reading the time as UTC, which
 * is what this did before any of it was handled. So an unknown zone is no
 * worse off than it used to be; a known one is now right.
 */
function toMillis(datetime) {
    const value = datetime.get_value ? datetime.get_value() : datetime;

    const zone = value.get_timezone ? value.get_timezone() : null;
    if (zone && value.as_timet_with_zone) return value.as_timet_with_zone(zone) * 1000;

    const tzid = datetime.get_tzid ? datetime.get_tzid() : null;
    if (tzid && value.as_timet_with_zone) {
        const builtin = builtinZone(tzid);
        if (builtin) return value.as_timet_with_zone(builtin) * 1000;
    }

    return value.as_timet() * 1000;
}

/**
 * The builtin timezone for a TZID, however the backend has spelled it.
 *
 * Tries the name as given, then just its last two path segments, which is what
 * turns the long `/freeassociation.sourceforge.net/Tzfile/Europe/Bucharest`
 * form into `Europe/Bucharest`. Null when neither is a zone this system knows;
 * the caller then falls back rather than guessing an offset.
 */
function builtinZone(tzid) {
    const name = String(tzid);
    let zone = ICalGLib.Timezone.get_builtin_timezone(name);
    if (zone) return zone;

    const parts = name.split("/");
    if (parts.length > 2) {
        zone = ICalGLib.Timezone.get_builtin_timezone(parts.slice(-2).join("/"));
        if (zone) return zone;
    }
    return null;
}

/* ---- Recurring events ------------------------------------------------ *
 *
 * The expansion of RRULEs is done here, not by evolution-data-server.
 *
 * The query used above -- get_object_list_as_comps -- returns the *stored*
 * components. A weekly meeting written as one VEVENT with an RRULE arrives as
 * one component carrying that rule, not as fifty-two components, so taking its
 * DTSTART draws it once on the day the series began and never again. A yearly
 * birthday is worse: it is drawn on a date years in the past, which is never
 * on screen, so it disappears entirely.
 *
 * EDS has calls that would do this properly -- generate_instances and
 * generate_instances_for_object_sync -- but the introspection binding in this
 * environment mangles both. Each takes a callback argument where the C
 * function has none, none of them exposes the matching _finish, and calling
 * them with the arguments their names imply raises type errors. Building on a
 * signature that cannot be stated confidently would be worse than not using
 * it, so the rule is expanded here instead, with ICalGLib.RecurIterator --
 * libical's own recurrence engine, the same one EDS expands with, driven
 * without blocking.
 *
 * What is handled: RRULE, COUNT and UNTIL, EXDATE, and the detached overrides
 * Google writes when a single occurrence of a series is edited (those arrive
 * as their own components with a RECURRENCE-ID, and are drawn as they come).
 * RDATE is not handled; a component that carries one is expanded by its RRULE
 * only, which can only under-report dates, never invent them.
 */

// A rule with no end generates forever. The window bounds the loop in normal
// use; this is the backstop for a rule that generates nothing but past dates
// before the window, which would otherwise spin.
const MAX_OCCURRENCES = 5000;

/** The instant an ICalGLib.Time names, given the zone its component uses. */
function instantOf(time, zone) {
    if (zone && time.as_timet_with_zone) return time.as_timet_with_zone(zone) * 1000;
    return time.as_timet() * 1000;
}

/**
 * The zone a component's times are written in, or null.
 *
 * Read from the wrapper, where it lives; see toMillis(). All-day events have
 * none, which is right -- their dates are civil and must not be shifted.
 */
function zoneOf(wrapper) {
    const tzid = wrapper && wrapper.get_tzid ? wrapper.get_tzid() : null;
    return tzid ? builtinZone(tzid) : null;
}

/** Whether a component repeats. */
function repeats(component) {
    try {
        return !!(component.has_rrules && component.has_rrules());
    } catch (e) {
        return false;
    }
}

/** The RRULE as an ICalGLib.Recurrence, or null. */
function ruleOf(component) {
    try {
        const property = component.get_icalcomponent()
            .get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY);
        return property ? property.get_rrule() : null;
    } catch (e) {
        return null;
    }
}

/**
 * The dates an EXDATE excludes, as the iCalendar text of each.
 *
 * Compared as text rather than as instants because that is what the two sides
 * have in common: the exception and the occurrence are both written by libical
 * from the same calendar, so the same date is spelled the same way. Comparing
 * instants would mean resolving a zone on the exception too, which is more
 * moving parts for no more certainty.
 */
function exdatesOf(component) {
    const out = new Set();
    let property = null;
    try {
        const ical = component.get_icalcomponent();
        property = ical.get_first_property(ICalGLib.PropertyKind.EXDATE_PROPERTY);
        while (property) {
            for (const text of exdateTexts(property)) out.add(text);
            property = ical.get_next_property(property);
        }
    } catch (e) {
        // An unreadable exception list means nothing is excluded, which draws
        // an event that was cancelled. Annoying, and better than throwing the
        // whole calendar away.
    }
    return out;
}

/** The individual times inside one EXDATE property, as iCalendar text. */
function exdateTexts(property) {
    const out = [];
    try {
        const value = property.get_value();
        // One EXDATE line can hold several dates, and libical hands those back
        // as an array; a single date comes back as the value itself.
        const times = Array.isArray(value) ? value : [value];
        for (const time of times) {
            if (time && time.as_ical_string) out.push(String(time.as_ical_string()));
        }
    } catch (e) {
        // Fall back to the property's own text, which covers the single-date
        // case that is by far the common one.
        const text = String(property.get_value_as_string ? property.get_value_as_string() : "");
        for (const part of text.split(",")) {
            const cleaned = part.trim();
            if (cleaned) out.push(cleaned);
        }
    }
    return out;
}

/**
 * Every occurrence of a repeating component inside [startMs, endMs).
 *
 * Each occurrence keeps the master's duration, and is resolved through the
 * component's zone individually -- which is what makes a 09:00 meeting stay at
 * 09:00 across a daylight-saving change instead of drifting by an hour.
 */
function occurrencesOf(component, wrapper, startMs, endMs) {
    const rule = ruleOf(component);
    if (!rule) return null;

    const masterMs = toMillis(wrapper);
    const end = component.get_dtend();
    const duration = end ? Math.max(0, toMillis(end) - masterMs) : 0;
    const zone = zoneOf(wrapper);
    const excluded = exdatesOf(component);

    let iterator;
    try {
        // The rule expands from the component's own DTSTART, which has to be
        // the ICalGLib.Time -- the ECal wrapper is not what libical iterates.
        iterator = ICalGLib.RecurIterator.new(rule, component.get_icalcomponent().get_dtstart());
    } catch (e) {
        return null;
    }

    const out = [];
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
        let time;
        try {
            time = iterator.next();
        } catch (e) {
            break;
        }
        if (!time || (time.is_null_time && time.is_null_time())) break;

        const ms = instantOf(time, zone);

        // Occurrences come in order, so the first one past the window ends it.
        if (ms >= endMs) break;
        if (ms + duration <= startMs) continue;

        const text = time.as_ical_string ? String(time.as_ical_string()) : "";
        if (text && excluded.has(text)) continue;

        out.push({ start: ms, end: ms + duration });
    }
    return out;
}

/** Whether a component is marked cancelled and should not be drawn. */
function isCancelled(component) {
    const status = component.get_status();
    if (status === null || status === undefined) return false;

    // ECal hands this back as a bare enum number, not as a Property, so there
    // is no get_value() to call -- an object-shaped check silently never
    // matches and cancelled events keep appearing on the desktop.
    if (typeof status === "number") return status === ICalGLib.PropertyStatus.CANCELLED;

    if (status.get_value) {
        const value = status.get_value();
        if (typeof value === "number") return value === ICalGLib.PropertyStatus.CANCELLED;
        return String(value).toUpperCase() === "CANCELLED";
    }

    return String(status).toUpperCase() === "CANCELLED";
}

/**
 * A property's text value, or the empty string when it has none.
 *
 * libecal is not consistent about the shape: get_summary() hands back a
 * Property that has to be unwrapped with get_value(), while get_uid() returns
 * a bare string. Reading only the first shape left every event with an empty
 * uid -- harmless until two events have to be told apart, which is what the
 * recurrence overrides above need.
 */
function valueOf(property) {
    if (property === null || property === undefined) return "";
    if (typeof property === "string") return property;
    if (property.get_value) {
        const value = property.get_value();
        return value === null || value === undefined ? "" : String(value);
    }
    return String(property);
}

/**
 * The instant a component's RECURRENCE-ID names, or null when it has none.
 *
 * A component carrying one is a single occurrence of a series that was edited
 * on its own -- moved, retitled, or given a different room -- and delivered
 * separately from the master it came from. Its own DTSTART is the occurrence's
 * real time, so it needs no expanding; it only has to stop the master from
 * drawing that same occurrence at the time it used to be.
 */
function recuridMillis(component) {
    try {
        const recurid = component.get_recurid();
        if (!recurid) return null;

        const value = recurid.get_value ? recurid.get_value() : null;
        if (!value || (value.is_null_time && value.is_null_time())) return null;

        return toMillis(recurid);
    } catch (e) {
        return null;
    }
}

/** An instant as an iCalendar UTC stamp: 20260930T120000Z. */
function toIcalUtc(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
        "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
}

/**
 * Connect to one calendar, as a promise.
 *
 * Written by hand rather than with Gio._promisify, because that helper is
 * wrong for methods with more than one out-parameter -- it silently drops
 * every out-value except the last (see fetchComponents below).
 */
function connectClient(source, cancellable) {
    return new Promise((resolve, reject) => {
        ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, 10, cancellable,
            (obj, result) => {
                try {
                    resolve(ECal.Client.connect_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/**
 * Run a view query, as a promise.
 *
 * `get_object_list_as_comps_finish()` returns a two-element array of
 * `[success, components]`. `Gio._promisify` would resolve to `[components]`
 * -- the success flag discarded -- so awaiting it and destructuring naively
 * yields nothing at all. Unwrapping by hand is the only correct option.
 */
function fetchComponents(client, sexp, cancellable) {
    return new Promise((resolve, reject) => {
        client.get_object_list_as_comps(sexp, cancellable, (obj, result) => {
            try {
                const out = client.get_object_list_as_comps_finish(result);
                const ok = out[0];
                const components = out[1];
                resolve(ok && components ? components : []);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * The EDS source registry, built without blocking the main loop.
 *
 * The async constructor is `eds_source_registry_new(cancellable, callback)`,
 * and because it is not named `*_new_async` GJS does not rename it -- it is
 * simply `new`, with `new_finish()` for the result. That is the whole trick,
 * and it is why the absence of a `new_async` on the binding is not the absence
 * of an async route: writing `new_sync` here would put a wait on D-Bus back on
 * the compositor's thread. See rule 1 at the top of the file.
 *
 * Rejects if the registry cannot be reached; callers decide whether that is
 * worth reporting or worth trying again.
 */
export function openRegistry(cancellable) {
    return new Promise((resolve, reject) => {
        EDataServer.SourceRegistry.new(cancellable || null, (source, result) => {
            try {
                resolve(EDataServer.SourceRegistry.new_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Every calendar EDS knows about, as plain `{uid, name, color}` records.
 *
 * This includes calendars that are not Google's -- local ones, birthdays and
 * subscribed holiday calendars all live here too, which is usually what
 * someone wants on a desktop calendar. Rejects if the registry is unreachable.
 *
 * Used by the test harness rather than by the desklet, which opens a feed
 * instead.
 */
export async function listCalendars(cancellable) {
    const registry = await openRegistry(cancellable);
    return registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR).map((source) => ({
        uid: source.get_uid(),
        name: source.get_display_name(),
        color: colorOf(source)
    }));
}

/** A calendar's colour, or a neutral default when it has none. */
function colorOf(source) {
    try {
        const ext = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
        const color = ext && ext.get_color ? ext.get_color() : null;
        if (color) return color;
    } catch (e) {
        // A source without a Calendar extension simply has no colour.
    }
    return "#9a9cff";
}

/**
 * One entry per occurrence, dropping copies of an event that arrived from more
 * than one calendar.
 *
 * An event is not owned by a calendar: a meeting you are invited to sits in
 * yours and in the organiser's shared one, and the same holiday calendar can
 * be subscribed twice by accident. Both copies come back from a query and,
 * without this, each draws its own dot -- the bug that prompted this was two
 * green dots on one day from a single calendar name.
 *
 * Told apart by UID, which RFC 5545 requires to be globally unique per event,
 * and by start, because every occurrence of a repeating event carries its
 * series' UID. Equal UID and equal instant is the same thing happening once.
 *
 * The first copy wins. Which one that is depends on the order the calendars
 * are registered in, so it is stable across a session but not chosen for any
 * reason -- if the same event is drawn in two colours, one of them is simply
 * the one that got there first.
 *
 * An entry with no UID is kept as it is: two of them at the same instant are
 * not evidence of anything, and dropping one would lose a real event.
 */
export function dedupeOccurrences(events) {
    const seen = new Set();
    const out = [];

    for (const event of events) {
        if (!event.uid) {
            out.push(event);
            continue;
        }

        const key = event.uid + "@" + event.start;
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(event);
    }
    return out;
}

/**
 * A live connection to the user's calendars.
 *
 * Lifecycle: `open()` once, then `query()` as often as needed, then
 * `destroy()` when the desklet goes away.
 */
export class CalendarFeed {
    constructor() {
        this._entries = [];       // [{uid, name, color, client}]
        this._cancellable = null;
        this._destroyed = false;
        this._openPromise = null;
    }

    get isOpen() {
        return this._entries.length > 0;
    }

    /** The calendars currently connected, as plain records. */
    get calendars() {
        return this._entries.map(({ uid, name, color }) => ({ uid, name, color }));
    }

    /**
     * Connect to every calendar that is not connected already.
     *
     * Safe to call at any time and cheap to call again: calendars that are open
     * are left alone, and only the ones that are missing are attempted. Calling
     * it twice at once returns the same promise rather than opening twice.
     *
     * The repeat is the point. A calendar fails to connect for reasons that
     * pass -- the machine booted before its network came up, an OAuth token had
     * expired and has since been renewed, the account was added after the
     * desklet started. Connecting once at startup and never again would leave
     * the desklet showing nothing for the rest of the session, because the
     * periodic refresh only re-queries the connections it already has. Nothing
     * here reaches the network on its own: list_sources() is a local call to
     * evolution-data-server, and a source that is already open is skipped
     * before any connection is attempted.
     *
     * A calendar that cannot be connected is skipped rather than fatal, so one
     * unreachable account cannot blank the desklet, and the next call tries it
     * again.
     */
    open() {
        if (this._openPromise) return this._openPromise;

        // Cleared once settled, so a later call is a fresh attempt rather than
        // a replay of the first failure.
        this._openPromise = this._openAll().finally(() => {
            this._openPromise = null;
        });
        return this._openPromise;
    }

    /**
     * `registry` is the seam the tests use; it defaults to the real one. It is
     * a parameter rather than a call buried below because the merge below --
     * which calendars survive a reconnect and which are dropped -- is the part
     * worth testing, and reaching it otherwise needs a live desktop with a real
     * account on it.
     */
    async _openAll(registry) {
        if (this._destroyed) return;

        // Made before the registry is opened, not after: building the registry
        // is now itself cancellable, so the cancellable has to exist first.
        if (!this._cancellable) this._cancellable = new Gio.Cancellable();

        // A local call to evolution-data-server, no network -- see rule 1 at
        // the top of the file for why it is the async one.
        //
        // Being async, this is now also the one thing here that a removal can
        // interrupt: cancelling the registry open makes it reject, and that is
        // not a failure to report, so a cancelled build returns quietly rather
        // than reaching the caller's error log.
        let built;
        try {
            built = registry || await openRegistry(this._cancellable);
        } catch (e) {
            if (this._destroyed) return;
            throw e;
        }

        const sources = built.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);

        if (this._destroyed) return;

        const present = new Set(sources.map((source) => source.get_uid()));

        // A calendar whose account was removed in Online Accounts is dropped
        // here. Its entry would otherwise be queried forever: the query fails,
        // the failure is caught per-calendar, and the desklet goes on asking.
        this._entries = this._entries.filter((entry) => present.has(entry.uid));
        const have = new Set(this._entries.map((entry) => entry.uid));

        const connected = await Promise.all(sources.map(async (source) => {
            const uid = source.get_uid();
            if (have.has(uid)) return null;   // already open; leave it running

            try {
                const client = await connectClient(source, this._cancellable);
                if (this._destroyed) return null;
                return {
                    uid,
                    name: source.get_display_name(),
                    color: colorOf(source),
                    client
                };
            } catch (e) {
                // Account offline, removed mid-connect, or cancelled.
                return null;
            }
        }));

        if (this._destroyed) return;
        this._entries = this._entries.concat(connected.filter(Boolean));
    }

    /**
     * Every event overlapping `[startMs, endMs)`.
     *
     * Returns a flat array of `{start, end, allDay, summary, color, calendar}`,
     * with start/end in milliseconds.
     *
     * A recurring event comes back as *one* component carrying its rule, not as
     * one component per occurrence, so `_collect` expands it locally. (EDS does
     * have a server-side expander, `generate_instances`, but its introspection
     * is wrong: the binding asks for a callback the C function does not take,
     * and the matching `_finish` is not exposed at all. libical's own
     * RecurIterator is used instead -- the same engine EDS would run, in
     * process, without a round trip.)
     *
     * The window is widened by a day at each end. All-day events travel as
     * midnight UTC, so in a negative-offset timezone an event on the first
     * day of the window would otherwise fall just outside it.
     */
    async query(startMs, endMs) {
        if (this._destroyed || !this._entries.length) return [];

        const sexp = '(occur-in-time-range? (make-time "' + toIcalUtc(startMs - 86400000) +
            '") (make-time "' + toIcalUtc(endMs + 86400000) + '"))';

        const results = await Promise.all(this._entries.map(async (entry) => {
            try {
                const components = await fetchComponents(entry.client, sexp, this._cancellable);
                return this._collect(components, entry, startMs, endMs);
            } catch (e) {
                // A calendar that errors contributes nothing; the rest stand.
                return [];
            }
        }));

        if (this._destroyed) return [];

        // The calendars are asked in parallel and each answers for itself, so
        // this is the first point at which one event can be seen to have
        // arrived twice. See dedupeOccurrences().
        return dedupeOccurrences(results.flat());
    }

    /**
     * Every event a calendar's components contribute to [startMs, endMs).
     *
     * Split in two because a repeating event needs to know when an occurrence
     * of it was edited on its own. Google delivers such an occurrence as a
     * separate component carrying a RECURRENCE-ID, and it is drawn as it
     * comes -- so the master's expansion has to skip that time, or the day
     * shows the meeting twice, once at the new hour and once at the old.
     */
    _collect(components, entry, startMs, endMs) {
        const overridden = new Map();   // uid -> Set of occurrence starts

        for (const component of components) {
            const recurid = recuridMillis(component);
            if (recurid === null) continue;
            const uid = valueOf(component.get_uid());
            if (!overridden.has(uid)) overridden.set(uid, new Set());
            overridden.get(uid).add(recurid);
        }

        const out = [];
        for (const component of components) {
            for (const event of this._toEvents(component, entry, startMs, endMs, overridden)) {
                out.push(event);
            }
        }
        return out;
    }

    /**
     * The events one component contributes. Usually one; none when it is
     * cancelled, several when it repeats and the window holds several
     * occurrences.
     */
    _toEvents(component, entry, startMs, endMs, overridden) {
        try {
            // Cancelled events are still delivered; they should not be drawn.
            if (isCancelled(component)) return [];

            const uid = valueOf(component.get_uid());
            const summary = valueOf(component.get_summary());

            // An occurrence that was edited on its own: one event, already at
            // the time it was moved to. Expanding it again would put it back.
            if (recuridMillis(component) !== null) {
                const one = this._single(component, entry, uid, summary);
                return one ? [one] : [];
            }

            if (repeats(component)) {
                const wrapper = component.get_dtstart();
                const occurrences = occurrencesOf(component, wrapper, startMs, endMs);

                // Null means the rule could not be read or iterated. Falling
                // through draws the series once at its start, which is what
                // this did before repeats were expanded at all.
                if (occurrences) {
                    const skip = overridden.get(uid);
                    const allDay = wrapper.get_value().is_date();
                    return occurrences
                        .filter(({ start }) => !(skip && skip.has(start)))
                        .map(({ start, end }) => ({
                            start, end, allDay, summary, uid,
                            color: entry.color, calendar: entry.name
                        }));
                }
            }

            const one = this._single(component, entry, uid, summary);
            return one ? [one] : [];
        } catch (e) {
            return [];   // an unreadable component is skipped, not fatal
        }
    }

    /** One component as one event, taking its start and end as written. */
    _single(component, entry, uid, summary) {
        // The wrappers, not their values: the timezone is a property of the
        // wrapper. See toMillis().
        const startWrapper = component.get_dtstart();
        const startValue = startWrapper.get_value();
        const startMs = toMillis(startWrapper);

        let endMs = startMs;
        const end = component.get_dtend();
        if (end) endMs = toMillis(end);

        return {
            start: startMs,
            end: endMs,
            allDay: startValue.is_date(),
            summary,
            uid,
            color: entry.color,
            calendar: entry.name
        };
    }

    /**
     * Release everything. Safe to call more than once.
     *
     * Cancelling matters: without it, a query in flight when the desklet is
     * removed would call back into a destroyed object.
     */
    destroy() {
        this._destroyed = true;
        this._entries = [];
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }
}
