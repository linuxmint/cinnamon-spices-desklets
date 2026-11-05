// Three times the API's 10-minute interval: a wider gap means data is missing,
// and interpolating across it would show a level nobody predicted.
const MAX_SAMPLE_GAP_MS = 30 * 60 * 1000;

function readTide(samples, extremes, nowMs) {
    const afterIndex = samples.findIndex((sample, index) => index > 0 && sample.timeMs >= nowMs);
    if (afterIndex === -1) {
        return null;
    }
    const before = samples[afterIndex - 1];
    const after = samples[afterIndex];
    if (nowMs < before.timeMs || after.timeMs - before.timeMs > MAX_SAMPLE_GAP_MS) {
        return null;
    }

    const progress = (nowMs - before.timeMs) / (after.timeMs - before.timeMs);
    const nextExtreme = _findNextExtreme(extremes, nowMs);
    return {
        level: before.level + progress * (after.level - before.level),
        isRising: nextExtreme ? nextExtreme.isHigh : after.level >= before.level,
        nextExtreme,
    };
}

function _findNextExtreme(extremes, nowMs) {
    const upcoming = extremes.filter((extreme) => extreme.timeMs > nowMs);
    if (upcoming.length === 0) {
        return null;
    }
    return upcoming.reduce((earliest, extreme) => (extreme.timeMs < earliest.timeMs ? extreme : earliest));
}
