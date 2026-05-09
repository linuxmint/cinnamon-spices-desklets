// Pure CSV parsers. No imports.gi dependencies — runnable under bare cjs.

var _num = function(s) {
    const t = String(s).trim();
    if (t === "" || t === "[N/A]" || t === "[Not Supported]") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

var parseGpuCsv = function(text) {
    if (!text) return [];
    const rows = [];
    for (const rawLine of String(text).split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const f = line.split(",").map(s => s.trim());
        // Expected fields: index,name,uuid,temp,util,memUsed,memTotal,power,powerLimit,fan
        if (f.length < 10) continue;
        rows.push({
            index: _num(f[0]),
            name: f[1],
            uuid: f[2],
            tempC: _num(f[3]),
            utilPct: _num(f[4]),
            memUsedMb: _num(f[5]),
            memTotalMb: _num(f[6]),
            powerW: _num(f[7]),
            powerLimitW: _num(f[8]),
            fanPct: _num(f[9]),
        });
    }
    return rows;
};

// parseProcessCsv added in Task 5.
var parseProcessCsv = function(text) {
    const counts = new Map();
    if (!text) return counts;
    for (const rawLine of String(text).split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const f = line.split(",").map(s => s.trim());
        if (f.length < 2) continue;
        const uuid = f[0];
        if (!uuid.startsWith("GPU-")) continue;  // skip header / malformed
        counts.set(uuid, (counts.get(uuid) || 0) + 1);
    }
    return counts;
};
