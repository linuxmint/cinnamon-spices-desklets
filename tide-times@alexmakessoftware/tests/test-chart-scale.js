imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const GLib = imports.gi.GLib;
const { test, assertEqual, assertClose, finish } = imports.testing;
const ChartScale = imports["chart-scale"];

const LONDON = GLib.TimeZone.new("Europe/London");
const KATHMANDU = GLib.TimeZone.new("Asia/Kathmandu");
const HOUR_MS = 60 * 60 * 1000;
const FRACTION_TOLERANCE = 0.0001;

function labelsBetween(startMs, endMs, timeZone) {
    return ChartScale.hourTicks(startMs, endMs, timeZone).map((tick) => tick.label);
}

test("the height axis spans the data on round numbers", () => {
    const axis = ChartScale.heightAxis([1.8, 2.6, 4.8]);
    assertEqual(axis, { min: 1, max: 5, ticks: [1, 2, 3, 4, 5] });
});

test("a small tidal range gets finer height ticks", () => {
    const axis = ChartScale.heightAxis([0.32, 0.61, 1.12]);
    assertEqual(axis, { min: 0, max: 1.5, ticks: [0, 0.5, 1, 1.5] });
});

test("a large tidal range gets coarser height ticks", () => {
    const axis = ChartScale.heightAxis([0.4, 6, 12.2]);
    assertEqual(axis, { min: 0, max: 15, ticks: [0, 5, 10, 15] });
});

test("levels below the datum keep the axis below zero", () => {
    const axis = ChartScale.heightAxis([-0.4, 1.2]);
    assertEqual(axis, { min: -0.5, max: 1.5, ticks: [-0.5, 0, 0.5, 1, 1.5] });
});

test("perfectly flat data still gets an axis with some height", () => {
    const axis = ChartScale.heightAxis([2, 2, 2]);
    assertEqual(axis.min < 2 && axis.max > 2, true, "axis surrounds the level");
});

test("summer hour labels are in British Summer Time", () => {
    const nowMs = Date.UTC(2026, 6, 1, 12, 0);
    assertEqual(labelsBetween(nowMs - 6 * HOUR_MS, nowMs + 6 * HOUR_MS, LONDON), ["09:00", "12:00", "15:00", "18:00"]);
});

test("winter hour labels are in Greenwich Mean Time", () => {
    const nowMs = Date.UTC(2026, 0, 15, 12, 0);
    assertEqual(labelsBetween(nowMs - 6 * HOUR_MS, nowMs + 6 * HOUR_MS, LONDON), ["06:00", "09:00", "12:00", "15:00", "18:00"]);
});

test("hour labels stay truthful on the night the clocks go back", () => {
    const startMs = Date.UTC(2026, 9, 24, 23, 0);
    const ticks = ChartScale.hourTicks(startMs, startMs + 12 * HOUR_MS, LONDON);
    assertEqual(ticks.map((tick) => tick.label), ["00:00", "03:00", "06:00", "09:00"]);
    assertEqual(ticks[1].timeMs - ticks[0].timeMs, 4 * HOUR_MS, "the repeated hour widens the first gap");
});

test("hour labels stay on the hour in a time zone with a 45-minute offset", () => {
    const nowMs = Date.UTC(2026, 6, 1, 12, 0);
    const ticks = ChartScale.hourTicks(nowMs - 6 * HOUR_MS, nowMs + 6 * HOUR_MS, KATHMANDU);
    assertEqual(ticks.map((tick) => tick.label), ["12:00", "15:00", "18:00", "21:00"]);
});

test("the next high or low water time is shown in local time", () => {
    assertEqual(ChartScale.formatLocalTime(Date.UTC(2026, 6, 1, 12, 34), LONDON), "13:34", "summer");
    assertEqual(ChartScale.formatLocalTime(Date.UTC(2026, 0, 15, 12, 34), LONDON), "12:34", "winter");
});

test("the time window is centred on now, so the marker sits halfway across", () => {
    const nowMs = Date.UTC(2026, 6, 1, 12, 0);
    const window = ChartScale.timeWindow(nowMs);
    assertEqual(window, { startMs: nowMs - 6 * HOUR_MS, endMs: nowMs + 6 * HOUR_MS });
    assertClose(ChartScale.fractionWithin(nowMs, window.startMs, window.endMs), 0.5, FRACTION_TOLERANCE);
});

test("positions run from zero at the low end to one at the high end", () => {
    assertClose(ChartScale.fractionWithin(1, 1, 5), 0, FRACTION_TOLERANCE, "low end");
    assertClose(ChartScale.fractionWithin(2, 1, 5), 0.25, FRACTION_TOLERANCE, "part way");
    assertClose(ChartScale.fractionWithin(5, 1, 5), 1, FRACTION_TOLERANCE, "high end");
});

finish();
