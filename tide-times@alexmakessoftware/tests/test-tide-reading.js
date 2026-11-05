imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const { test, assertEqual, assertClose, finish } = imports.testing;
const TideReading = imports["tide-reading"];

const TEN_MINUTES_MS = 10 * 60 * 1000;
const START_MS = Date.UTC(2026, 10, 5, 9, 0);
const LEVEL_TOLERANCE = 0.0001;

function samplesFrom(startMs, levels) {
    return levels.map((level, index) => ({ timeMs: startMs + index * TEN_MINUTES_MS, level }));
}

test("the current level is interpolated between the samples either side of now", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0]);
    const reading = TideReading.readTide(samples, [], START_MS + TEN_MINUTES_MS / 4);
    assertClose(reading.level, 2.25, LEVEL_TOLERANCE, "level");
});

test("the tide is rising when the level is going up, and falling when it is going down", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0, 2.5]);
    assertEqual(TideReading.readTide(samples, [], START_MS + TEN_MINUTES_MS / 2).isRising, true, "going up");
    assertEqual(TideReading.readTide(samples, [], START_MS + TEN_MINUTES_MS * 1.5).isRising, false, "going down");
});

test("the next high or low sets the direction just after the tide turns, when the samples still disagree", () => {
    const justAfterTurnMs = START_MS + 6 * 60 * 1000;
    const nextTurnMs = START_MS + 6 * 60 * 60 * 1000;

    const samplesStillRising = samplesFrom(START_MS, [4.70, 4.72]);
    const nextLow = { timeMs: nextTurnMs, isHigh: false };
    const afterHighWater = TideReading.readTide(samplesStillRising, [nextLow], justAfterTurnMs);
    assertEqual(afterHighWater.isRising, false, "falling towards the low");

    const samplesStillFalling = samplesFrom(START_MS, [0.72, 0.70]);
    const nextHigh = { timeMs: nextTurnMs, isHigh: true };
    const afterLowWater = TideReading.readTide(samplesStillFalling, [nextHigh], justAfterTurnMs);
    assertEqual(afterLowWater.isRising, true, "rising towards the high");
});

test("a reading exactly on the final sample still gives a level and direction", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0]);
    const reading = TideReading.readTide(samples, [], START_MS + TEN_MINUTES_MS);
    assertClose(reading.level, 3.0, LEVEL_TOLERANCE, "level");
    assertEqual(reading.isRising, true, "direction");
});

test("no reading is invented when now falls outside the predictions", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0]);
    assertEqual(TideReading.readTide(samples, [], START_MS - 1), null, "before the data");
    assertEqual(TideReading.readTide(samples, [], START_MS + TEN_MINUTES_MS + 1), null, "after the data");
});

test("no reading is invented with too little data or across a gap in the data", () => {
    assertEqual(TideReading.readTide(samplesFrom(START_MS, [2.0]), [], START_MS), null, "one sample");
    const twoHoursMs = 12 * TEN_MINUTES_MS;
    const gappedSamples = [
        { timeMs: START_MS, level: 2.0 },
        { timeMs: START_MS + twoHoursMs, level: 3.0 },
    ];
    assertEqual(TideReading.readTide(gappedSamples, [], START_MS + TEN_MINUTES_MS), null, "gap");
});

test("the next extreme is the first one after now", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0]);
    const past = { timeMs: START_MS - TEN_MINUTES_MS, isHigh: false };
    const next = { timeMs: START_MS + 3 * TEN_MINUTES_MS, isHigh: true };
    const later = { timeMs: START_MS + 40 * TEN_MINUTES_MS, isHigh: false };
    const reading = TideReading.readTide(samples, [past, later, next], START_MS);
    assertEqual(reading.nextExtreme, next);
});

test("there is no next extreme when none is known", () => {
    const samples = samplesFrom(START_MS, [2.0, 3.0]);
    assertEqual(TideReading.readTide(samples, [], START_MS).nextExtreme, null);
});

test("readings work across the clocks changing, because they use absolute time", () => {
    const clocksGoBackMs = Date.UTC(2026, 9, 25, 1, 0);
    const samples = samplesFrom(clocksGoBackMs - TEN_MINUTES_MS, [2.0, 3.0, 4.0]);
    const next = { timeMs: clocksGoBackMs + 60 * 60 * 1000, isHigh: true };
    const reading = TideReading.readTide(samples, [next], clocksGoBackMs);
    assertClose(reading.level, 3.0, LEVEL_TOLERANCE, "level");
    assertEqual(reading.nextExtreme, next, "next extreme");
});

finish();
