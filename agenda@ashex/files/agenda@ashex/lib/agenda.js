/*
 * agenda.js - the decision layer. Given every occurrence in a two day
 * window, it works out what belongs on screen right now: which single
 * appointment deserves the spotlight, what follows it, and what to say
 * when the day is done.
 *
 * Deliberately free of any toolkit code so it can be reasoned about and
 * tested on its own.
 */

const GLib = imports.gi.GLib;

function startOfLocalDay(nowMs, dayOffset) {
    let now = GLib.DateTime.new_from_unix_local(Math.floor(nowMs / 1000));
    let midnight = GLib.DateTime.new_local(
        now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
    if (dayOffset)
        midnight = midnight.add_days(dayOffset);
    return midnight.to_unix() * 1000;
}

function isDeclined(occurrence) {
    if (occurrence.status === 'CANCELLED')
        return true;
    return occurrence.partstat === 'DECLINED';
}

function isFree(occurrence) {
    return occurrence.transparency === 'TRANSPARENT';
}

/*
 * Applies the user's inclusion rules once, up front, so every later stage
 * works from the same set.
 */
function filterOccurrences(occurrences, options) {
    return occurrences.filter(function (occurrence) {
        if (options.hideDeclined && isDeclined(occurrence))
            return false;
        if (options.hideTransparent && isFree(occurrence))
            return false;
        if (!options.showAllDay && occurrence.allDay)
            return false;
        return true;
    });
}

function buildModel(occurrences, nowMs, options) {
    let opts = options || {};
    let dayStart = startOfLocalDay(nowMs, 0);
    let dayEnd = startOfLocalDay(nowMs, 1);
    let visible = filterOccurrences(occurrences, opts);

    let allDay = [];
    let today = [];
    let tomorrow = [];
    let doneCount = 0;

    visible.forEach(function (occurrence) {
        if (occurrence.allDay) {
            // An all-day entry counts for today if its span covers any
            // part of today, which also catches multi-day holidays.
            if (occurrence.startMs < dayEnd && occurrence.endMs > dayStart)
                allDay.push(occurrence);
            return;
        }
        if (occurrence.startMs < dayEnd && occurrence.endMs > nowMs)
            today.push(occurrence);
        else if (occurrence.startMs >= dayEnd)
            tomorrow.push(occurrence);
        else if (occurrence.endMs > dayStart)
            // Already over, but it still means the day was not empty.
            doneCount++;
    });

    let byStart = function (a, b) { return a.startMs - b.startMs; };
    allDay.sort(byStart);
    today.sort(byStart);
    tomorrow.sort(byStart);

    let ongoing = today.filter(function (occurrence) {
        return occurrence.startMs <= nowMs && occurrence.endMs > nowMs;
    });
    let future = today.filter(function (occurrence) {
        return occurrence.startMs > nowMs;
    });

    let focus = null;
    let focusState = 'none';

    if (opts.keepOngoing && ongoing.length) {
        // When several overlap, the one finishing soonest is the one that
        // actually needs attention.
        ongoing.sort(function (a, b) { return a.endMs - b.endMs; });
        focus = ongoing[0];
        focusState = 'now';
    } else if (future.length) {
        focus = future[0];
        focusState = 'next';
    }

    /*
     * Everything still relevant that is not the focused event. Events in
     * progress belong here whatever the "keep ongoing" setting says: that
     * option chooses which event gets the spotlight, not whether a
     * meeting you are currently in is worth mentioning at all.
     */
    let remaining = [];
    ongoing.forEach(function (occurrence) {
        if (occurrence !== focus)
            remaining.push(occurrence);
    });
    future.forEach(function (occurrence) {
        if (occurrence !== focus)
            remaining.push(occurrence);
    });
    remaining.sort(byStart);

    let limit = Math.max(0, opts.maxUpcoming === undefined ? 4 : opts.maxUpcoming);
    let upcoming = remaining.slice(0, limit);

    let urgency = 0;
    if (focus && focusState === 'next' && opts.imminentMinutes > 0) {
        let leadMs = opts.imminentMinutes * 60000;
        let untilStart = focus.startMs - nowMs;
        urgency = Math.max(0, Math.min(1, 1 - (untilStart / leadMs)));
    } else if (focusState === 'now') {
        urgency = 1;
    }

    let progress = 0;
    if (focusState === 'now' && focus.endMs > focus.startMs)
        progress = Math.max(0, Math.min(1, (nowMs - focus.startMs) / (focus.endMs - focus.startMs)));

    return {
        nowMs: nowMs,
        dayStart: dayStart,
        dayEnd: dayEnd,
        allDay: allDay,
        focus: focus,
        focusState: focusState,
        urgency: urgency,
        progress: progress,
        upcoming: upcoming,
        remainingCount: remaining.length,
        hiddenCount: Math.max(0, remaining.length - upcoming.length),
        doneCount: doneCount,
        totalToday: today.length + allDay.length + doneCount,
        tomorrowFirst: tomorrow.length ? tomorrow[0] : null,
        isDayDone: focus === null,
    };
}

/*
 * How often the display needs to change. Sitting three hours from the
 * next appointment there is nothing to redraw minute by minute, but in
 * the last few minutes the countdown should tick.
 */
function nextTickDelaySeconds(model, nowMs) {
    if (!model.focus)
        return 300;

    let deltaMs = model.focusState === 'now'
        ? model.focus.endMs - nowMs
        : model.focus.startMs - nowMs;

    if (deltaMs <= 2 * 60000)
        return 10;
    if (deltaMs <= 60 * 60000)
        return 20;
    return 60;
}
