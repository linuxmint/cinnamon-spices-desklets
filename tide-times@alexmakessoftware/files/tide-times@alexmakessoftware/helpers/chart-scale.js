const GLib = imports.gi.GLib;

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 60 * 60 * MILLISECONDS_PER_SECOND;

var HOURS_EITHER_SIDE_OF_NOW = 6;

const HEIGHT_TICK_STEPS = [0.5, 1, 2, 5, 10];

const MAX_HEIGHT_INTERVALS = 4;

const HOURS_BETWEEN_LABELS = 3;

// Every real time zone offset is a multiple of 15 minutes, so stepping by this
// finds each local whole hour, even in zones such as Nepal's.
const TICK_SEARCH_STEP_MS = 15 * 60 * MILLISECONDS_PER_SECOND;

const LOCAL_TIME_FORMAT = "%H:%M";

function timeWindow(nowMs) {
    const halfWidthMs = HOURS_EITHER_SIDE_OF_NOW * MILLISECONDS_PER_HOUR;
    return { startMs: nowMs - halfWidthMs, endMs: nowMs + halfWidthMs };
}

function fractionWithin(value, low, high) {
    return (value - low) / (high - low);
}

function heightAxis(levels) {
    const lowest = Math.min(...levels);
    const highest = Math.max(...levels);
    const step = _chooseHeightStep(highest - lowest);

    let min = Math.floor(lowest / step) * step;
    let max = Math.ceil(highest / step) * step;
    if (min === max) {
        min -= step;
        max += step;
    }

    const ticks = [];
    for (let tickIndex = 0; min + tickIndex * step <= max; tickIndex++) {
        ticks.push(min + tickIndex * step);
    }
    return { min, max, ticks };
}

function hourTicks(startMs, endMs, timeZone) {
    const ticks = [];
    const firstCandidateMs = Math.ceil(startMs / TICK_SEARCH_STEP_MS) * TICK_SEARCH_STEP_MS;
    for (let timeMs = firstCandidateMs; timeMs <= endMs; timeMs += TICK_SEARCH_STEP_MS) {
        const local = _toLocal(timeMs, timeZone);
        if (local.get_minute() === 0 && local.get_hour() % HOURS_BETWEEN_LABELS === 0) {
            ticks.push({ timeMs, label: local.format(LOCAL_TIME_FORMAT) });
        }
    }
    return ticks;
}

function formatLocalTime(timeMs, timeZone) {
    return _toLocal(timeMs, timeZone).format(LOCAL_TIME_FORMAT);
}

function _chooseHeightStep(range) {
    const step = HEIGHT_TICK_STEPS.find((candidate) => range / candidate <= MAX_HEIGHT_INTERVALS);
    return step ?? HEIGHT_TICK_STEPS[HEIGHT_TICK_STEPS.length - 1];
}

function _toLocal(timeMs, timeZone) {
    const unixSeconds = Math.floor(timeMs / MILLISECONDS_PER_SECOND);
    return GLib.DateTime.new_from_unix_utc(unixSeconds).to_timezone(timeZone);
}
