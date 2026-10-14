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
 *      The registry is retained after opening. Re-opening the feed is what
 *      lets a calendar that was unreachable at
 *      startup connect later without restarting Cinnamon, and it is
 *      deliberately cheap: calendars that are already open are skipped before
 *      any real work.
 *
 *   2. Never leak a callback into a dead object. A query in flight when the
 *      desklet is removed must not write into destroyed actors, hence the
 *      Cancellable and the `destroyed` guard.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import ICalGLib from 'gi://ICalGLib?version=3.0';
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';

const pad2 = (n) => (n < 10 ? "0" : "") + n;

/** Bound a calendar operation without waiting on Cinnamon's main thread.
 * Even a service that never replies must release the refresh queue. */
export function calendarCall(parent, invoke, finish, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        let settled = false, timer = 0;
        const cancelId = parent ? parent.connect(() => cancellable.cancel()) : 0;
        const settle = (error, value) => {
            if (settled) return;
            settled = true;
            if (timer) GLib.source_remove(timer);
            if (cancelId) parent.disconnect(cancelId);
            if (error) reject(error);
            else resolve(value);
        };
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            timer = 0;
            cancellable.cancel();
            settle(new Error("Calendar operation timed out"));
            return GLib.SOURCE_REMOVE;
        });
        try {
            invoke(cancellable, (object, result) => {
                try { settle(null, finish(object, result)); }
                catch (e) { settle(e); }
            });
        } catch (e) { settle(e); }
    });
}

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
    if (value.is_date()) return civilMillis(value);

    const zone = value.get_timezone ? value.get_timezone() : null;
    if (zone && value.as_timet_with_zone) return value.as_timet_with_zone(zone) * 1000;

    const tzid = datetime.get_tzid ? datetime.get_tzid() : null;
    if (tzid && value.as_timet_with_zone) {
        const builtin = builtinZone(tzid);
        if (builtin) return value.as_timet_with_zone(builtin) * 1000;
    }

    // RFC 5545 floating times follow the viewer's local clock. An unknown
    // explicit TZID keeps the existing UTC fallback instead of guessing.
    return tzid ? value.as_timet() * 1000 : localMillis(value);
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
 * libical's own recurrence engine, the same one EDS expands with. Expansion
 * is CPU work on the main thread, so queries are coalesced and clean results
 * reused rather than repeatedly expanded.
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
function civilMillis(time) {
    const date = new Date(0);
    date.setUTCFullYear(time.get_year(), time.get_month() - 1, time.get_day());
    return date.getTime();
}

function localMillis(time) {
    const date = new Date(0);
    date.setFullYear(time.get_year(), time.get_month() - 1, time.get_day());
    date.setHours(time.get_hour(), time.get_minute(), time.get_second(), 0);
    return date.getTime();
}

function instantOf(time, zone) {
    if (time.is_date()) return civilMillis(time);
    zone = time.get_timezone() || zone;
    if (zone && time.as_timet_with_zone) return time.as_timet_with_zone(zone) * 1000;
    return localMillis(time);
}

/**
 * The zone a component's times are written in, or null.
 *
 * Read from the wrapper, where it lives; see toMillis(). All-day events have
 * none, which is right -- their dates are civil and must not be shifted.
 */
function zoneOf(wrapper) {
    const tzid = wrapper && wrapper.get_tzid ? wrapper.get_tzid() : null;
    return tzid ? builtinZone(tzid) || ICalGLib.Timezone.get_utc_timezone() : null;
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

/** Exceptions compared as instants: UTC and zoned values can name the same
 * occurrence with different text. Date-only exceptions remain civil dates. */
function exdatesOf(component, defaultZone) {
    const out = new Set();
    const ical = component.get_icalcomponent();
    let property = ical.get_first_property(ICalGLib.PropertyKind.EXDATE_PROPERTY);
    while (property) {
        try {
            const parameter = property.get_first_parameter(ICalGLib.ParameterKind.TZID_PARAMETER);
            const zone = parameter ? builtinZone(parameter.get_tzid()) : defaultZone;
            for (const text of String(property.get_value_as_string()).split(",")) {
                const time = ICalGLib.Time.new_from_string(text);
                if (time && !time.is_null_time()) out.add(instantOf(time, time.get_timezone() || zone));
            }
        } catch (e) {
            // A malformed exception must not hide the other valid exceptions.
        }
        property = ical.get_next_property(ICalGLib.PropertyKind.EXDATE_PROPERTY);
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
    const duration = end ? Math.max(0, toMillis(end) - masterMs)
        : wrapper.get_value().is_date() ? 86400000 : 0;
    const zone = zoneOf(wrapper);
    const excluded = exdatesOf(component, zone);

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
        if (ms + Math.max(duration, 1) <= startMs) continue;

        if (excluded.has(ms)) continue;

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

        // ECal returns ComponentRange, whose datetime is another wrapper.
        const datetime = recurid.get_datetime ? recurid.get_datetime() : recurid;
        const value = datetime && datetime.get_value ? datetime.get_value() : null;
        if (!value || (value.is_null_time && value.is_null_time())) return null;

        return toMillis(datetime);
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
    return calendarCall(cancellable,
        (cancel, callback) => ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, 10, cancel, callback),
        (object, result) => ECal.Client.connect_finish(result));
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
    return calendarCall(cancellable,
        (cancel, callback) => client.get_object_list_as_comps(sexp, cancel, callback),
        (obj, result) => {
                const out = client.get_object_list_as_comps_finish(result);
                const ok = out[0];
                const components = out[1];
                // EDS 3.52 returns false without GError for an empty list.
                // Actual errors throw from finish(); false alone is not an
                // outage (in particular after deleting the last event).
                return ok && components ? components : [];
        });
}

function fetchSeries(client, uid, cancellable) {
    return calendarCall(cancellable,
        (cancel, callback) => client.get_objects_for_uid(uid, cancel, callback),
        (object, result) => {
            const [ok, components] = client.get_objects_for_uid_finish(result);
            return ok && components ? components : [];
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
    return calendarCall(cancellable,
        (cancel, callback) => EDataServer.SourceRegistry.new(cancel, callback),
        (source, result) => EDataServer.SourceRegistry.new_finish(result));
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
    constructor(onChanged = null, onError = null) {
        this._entries = [];       // [{uid, name, color, client}]
        this._cancellable = null;
        this._destroyed = false;
        this._openPromise = null;
        this._registry = null;
        this._registrySignals = [];
        this._onChanged = onChanged;
        this._onError = onError;
        this._refreshPromise = null;
        this._lastRemoteRefresh = -Infinity;
    }

    _changed() {
        if (!this._destroyed && this._onChanged) this._onChanged();
    }

    _report(entry, error) {
        if (this._destroyed) return;
        const message = String(error.message || error);
        if (entry.error !== message && this._onError) this._onError(error);
        entry.error = message;
    }

    _watchEntry(entry) {
        entry.version = 0;
        entry.dirty = true;
        entry.signals = [
            entry.client.connect("backend-property-changed", (client, name) => {
                if (name !== "revision" && name !== "online") return;
                entry.version++;
                entry.dirty = true;
                this._changed();
            }),
            entry.client.connect("backend-died", () => {
                entry.dead = true;
                entry.dirty = true;
                this._changed();
            })
        ];
    }

    _disconnectEntry(entry) {
        for (const id of entry.signals || []) entry.client.disconnect(id);
        entry.signals = [];
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
            built = registry || this._registry || await openRegistry(this._cancellable);
        } catch (e) {
            if (this._destroyed) return;
            throw e;
        }

        const sources = built.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);

        if (this._destroyed) return;

        if (!registry && !this._registry) {
            this._registry = built;
            this._registrySignals = ["source-added", "source-removed", "source-changed"].map(
                name => built.connect(name, () => {
                    for (const entry of this._entries) {
                        entry.version++;
                        entry.dirty = true;
                    }
                    this._changed();
                }));
        }

        const present = new Set(sources.map((source) => source.get_uid()));

        // A calendar whose account was removed in Online Accounts is dropped
        // here. Its entry would otherwise be queried forever: the query fails,
        // the failure is caught per-calendar, and the desklet goes on asking.
        this._entries = this._entries.filter((entry) => {
            if (present.has(entry.uid)) return true;
            this._disconnectEntry(entry);
            return false;
        });
        const have = new Set(this._entries.filter(entry => !entry.dead).map(entry => entry.uid));

        for (const source of sources) {
            const entry = this._entries.find(item => item.uid === source.get_uid());
            if (entry && source.get_display_name) {
                const name = source.get_display_name(), color = colorOf(source);
                if (entry.name !== name || entry.color !== color) entry.dirty = true;
                entry.name = name;
                entry.color = color;
            }
        }

        const connected = await Promise.all(sources.map(async (source) => {
            const uid = source.get_uid();
            if (have.has(uid)) return null;   // already open; leave it running

            try {
                const client = await connectClient(source, this._cancellable);
                if (this._destroyed) return null;
                const entry = {
                    uid,
                    name: source.get_display_name(),
                    color: colorOf(source),
                    client
                };
                this._watchEntry(entry);
                return entry;
            } catch (e) {
                // Account offline, removed mid-connect, or cancelled.
                return null;
            }
        }));

        if (this._destroyed) {
            for (const entry of connected.filter(Boolean)) this._disconnectEntry(entry);
            return;
        }
        for (const entry of connected.filter(Boolean)) {
            const previous = this._entries.find(item => item.uid === entry.uid);
            if (previous) {
                entry.cached = previous.cached;
                this._disconnectEntry(previous);
                this._entries = this._entries.filter(item => item !== previous);
            }
            this._entries.push(entry);
        }
    }

    /** Request EDS's online sync. Completion means requested, not downloaded.
     * Revision notifications tell us when new data actually arrives. */
    refreshRemote() {
        if (this._destroyed) return Promise.resolve();
        if (this._refreshPromise) return this._refreshPromise;
        const now = GLib.get_monotonic_time();
        if (now - this._lastRemoteRefresh < 30 * 1000000) return Promise.resolve({ cooldown: true });
        this._lastRemoteRefresh = now;
        this._refreshPromise = this._requestRemoteRefresh().finally(() => {
            this._refreshPromise = null;
        });
        return this._refreshPromise;
    }

    async _requestRemoteRefresh() {
        await this.open();
        if (this._destroyed) return;
        const status = { requested: 0, failed: 0 };
        await Promise.all(this._entries.map(async entry => {
            if (entry.dead) { status.failed++; return; }
            if (!entry.client.check_refresh_supported()) return;
            try {
                await calendarCall(this._cancellable,
                    (cancel, callback) => entry.client.refresh(cancel, callback),
                    (client, result) => client.refresh_finish(result));
                status.requested++;
            } catch (e) {
                status.failed++;
                this._report(entry, e);
            }
        }));
        return status;
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
     * process.)
     *
     * The window is widened by a day at each end. All-day events travel as
     * midnight UTC, so in a negative-offset timezone an event on the first
     * day of the window would otherwise fall just outside it.
     */
    async query(startMs, endMs, force = true) {
        if (this._destroyed || !this._entries.length) return [];

        const sexp = '(occur-in-time-range? (make-time "' + toIcalUtc(startMs - 86400000) +
            '") (make-time "' + toIcalUtc(endMs + 86400000) + '"))';

        const results = await Promise.all(this._entries.map(async (entry) => {
            const cached = entry.cached;
            const sameRange = cached && cached.start === startMs && cached.end === endMs;
            if (sameRange && !force && !entry.dirty) return cached.events;
            const version = entry.version;
            try {
                if (entry.dead) throw new Error("Calendar service disconnected");
                const components = await fetchComponents(entry.client, sexp, this._cancellable);
                if (this._destroyed) return [];
                // A moved exception can be outside the range query, while its
                // master still generates the old slot inside it. Load complete
                // families only for recurring masters that matched this range.
                // Two local requests at most in parallel, reused until dirty.
                const uids = [...new Set(components.filter(repeats).map(c => valueOf(c.get_uid())))];
                const families = new Map();
                for (let i = 0; i < uids.length; i += 2) {
                    await Promise.all(uids.slice(i, i + 2).map(async uid => {
                        const family = await fetchSeries(entry.client, uid, this._cancellable);
                        families.set(uid, family);
                    }));
                    if (this._destroyed) return [];
                }
                const complete = families.size
                    ? components.filter(c => !families.has(valueOf(c.get_uid()))) : components.slice();
                for (const family of families.values()) complete.push(...family);
                const events = this._collect(complete, entry, startMs - 86400000, endMs + 86400000).filter(event =>
                    event.start < endMs + 86400000 && Math.max(event.end, event.start + 1) > startMs - 86400000);
                entry.cached = { start: startMs, end: endMs, events };
                entry.dirty = entry.version !== version;
                entry.error = null;
                return events;
            } catch (e) {
                entry.dirty = true;
                this._report(entry, e);
                // An outage is not an empty calendar. Keep the last successful
                // result for this range; never reuse a different month's data.
                return sameRange ? cached.events : [];
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

        let endMs = startMs + (startValue.is_date() ? 86400000 : 0);
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
        this._onChanged = null;
        this._onError = null;
        for (const entry of this._entries) this._disconnectEntry(entry);
        if (this._registry) {
            for (const id of this._registrySignals) this._registry.disconnect(id);
        }
        this._registrySignals = [];
        this._registry = null;
        this._entries = [];
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }
}
