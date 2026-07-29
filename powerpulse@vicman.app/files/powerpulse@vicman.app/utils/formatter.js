/**
 * PowerPulse — formatting helpers (pure JS, testable without GJS).
 */

function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "—";
    }
    return Math.round(Math.max(0, Math.min(100, value))) + "%";
}

function formatDurationSeconds(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) {
        return null;
    }
    let seconds = Math.floor(Number(totalSeconds));
    if (!isFinite(seconds) || seconds < 0) {
        return null;
    }
    // UPower uses 0 or negative for unknown in some versions; treat tiny as unknown.
    if (seconds === 0) {
        return null;
    }

    const days = Math.floor(seconds / 86400);
    seconds -= days * 86400;
    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60);

    const parts = [];
    if (days > 0) {
        parts.push(days + " d");
    }
    if (hours > 0 || days > 0) {
        parts.push(hours + " h");
    }
    parts.push(minutes + " min");
    return parts.join(" ");
}

function formatDurationMinutes(totalMinutes) {
    if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes)) {
        return null;
    }
    return formatDurationSeconds(Number(totalMinutes) * 60);
}

function formatVoltage(millivoltsOrVolts) {
    if (millivoltsOrVolts === null || millivoltsOrVolts === undefined || isNaN(millivoltsOrVolts)) {
        return null;
    }
    let value = Number(millivoltsOrVolts);
    // HeadsetControl reports mV; UPower reports V.
    if (value > 100) {
        return Math.round(value) + " mV";
    }
    return value.toFixed(2) + " V";
}

function formatState(state, chargingGlyph) {
    const glyph = chargingGlyph || "⚡";
    switch (state) {
        case "charging":
            return glyph;
        case "pending-charge":
        case "fully-charged":
            return "🔌";
        case "discharging":
        case "pending-discharge":
            return "";
        case "empty":
            return "!";
        case "disconnected":
        case "unavailable":
            return "✕";
        default:
            return "";
    }
}

function formatUpdated(epochSeconds) {
    if (!epochSeconds) {
        return "unknown";
    }
    try {
        const date = new Date(Number(epochSeconds) * 1000);
        if (isNaN(date.getTime())) {
            return "unknown";
        }
        return date.toLocaleString();
    } catch (e) {
        return "unknown";
    }
}

function formatClockTime(epochSeconds) {
    if (!epochSeconds) {
        return "";
    }
    try {
        const date = new Date(Number(epochSeconds) * 1000);
        if (isNaN(date.getTime())) {
            return "";
        }
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
        return "";
    }
}

function formatAge(ageSeconds) {
    const age = Math.max(0, Math.floor(Number(ageSeconds) || 0));
    if (age < 60) {
        return age + " s";
    }
    if (age < 3600) {
        return Math.floor(age / 60) + " min";
    }
    if (age < 86400) {
        const hours = Math.floor(age / 3600);
        const minutes = Math.floor((age % 3600) / 60);
        return minutes > 0 ? (hours + " h " + minutes + " min") : (hours + " h");
    }
    const days = Math.floor(age / 86400);
    const hours = Math.floor((age % 86400) / 3600);
    return hours > 0 ? (days + " d " + hours + " h") : (days + " d");
}

function formatRelativeAge(ageSeconds) {
    return formatAge(ageSeconds);
}

function buildSummaryLine(device, friendlyNameFn) {
    const name = friendlyNameFn ? friendlyNameFn(device) : (device.name || "Device");
    const percent = formatPercent(device.connected ? device.percentage : null);
    const state = device.connected ? (device.state || "") : "disconnected";
    return name + "\t" + percent + "\t" + state;
}

function buildClipboardSummary(devices, friendlyNameFn, options) {
    const opts = options || {};
    const lines = [opts.title || "PowerPulse", ""];
    (devices || []).forEach((device) => {
        const name = friendlyNameFn ? friendlyNameFn(device) : (device.name || "Device");
        lines.push(name);
        lines.push(device.connected ? formatPercent(device.percentage) : "—");
        if (device.connected && device.timeToEmpty) {
            const remaining = formatDurationSeconds(device.timeToEmpty);
            if (remaining) {
                lines.push(remaining.replace(" min", "min").replace(" h ", "h ") + " restantes");
            }
        }
        lines.push("");
    });
    if (opts.updatedLabel) {
        lines.push("Actualizado:");
        lines.push(opts.updatedLabel);
    }
    return lines.join("\n").trim() + "\n";
}

function buildTooltip(device, options) {
    const opts = options || {};
    const lines = [];
    lines.push(opts.displayName || device.name || device.model || "Device");
    if (device.model && opts.displayName && device.model !== opts.displayName) {
        lines.push("Model: " + device.model);
    }
    if (device.path) {
        lines.push("Path: " + device.path);
    }
    lines.push("State: " + (device.state || "unknown"));
    if (device.percentage !== null && device.percentage !== undefined) {
        lines.push("Battery: " + formatPercent(device.percentage));
    }
    if (device.voltage !== null && device.voltage !== undefined) {
        const voltage = formatVoltage(device.voltage);
        if (voltage) {
            lines.push("Voltage: " + voltage);
        }
    }
    if (device.timeToEmpty) {
        const remaining = formatDurationSeconds(device.timeToEmpty);
        if (remaining) {
            lines.push("Time to empty: " + remaining);
        }
    }
    if (device.timeToFull) {
        const toFull = formatDurationSeconds(device.timeToFull);
        if (toFull) {
            lines.push("Time to full: " + toFull);
        }
    }
    if (device.updated) {
        lines.push("Last device update: " + formatUpdated(device.updated));
    }
    if (device.source === "upower" && device.ageSeconds > 0) {
        lines.push("Age: " + formatAge(device.ageSeconds));
    }
    if (opts.freshnessNote) {
        lines.push(opts.freshnessNote);
    }
    return lines.join("\n");
}

/**
 * Parse HeadsetControl `-b` text output into structured device data.
 * Exported for unit tests.
 */
function parseHeadsetControlOutput(text) {
    const result = {
        found: false,
        devices: [],
        error: null
    };

    if (!text || typeof text !== "string") {
        result.error = "empty-output";
        return result;
    }

    if (/Could not open device/i.test(text) || /BATTERY_UNAVAILABLE/i.test(text)) {
        // Still try to extract the device name for disconnected display.
        result.error = "unavailable";
    }

    const deviceBlocks = [];
    const lines = text.split(/\r?\n/);
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const foundMatch = line.match(/Found\s+(\d+)\s+supported device/i);
        if (foundMatch) {
            result.found = Number(foundMatch[1]) > 0;
            continue;
        }

        // Device header lines look like:
        //  Logitech G633/... (Logitech G933 ...) [0x046d:0x0a5b]
        if (/^\s+\S/.test(line) && /\[0x[0-9a-f]+:0x[0-9a-f]+\]/i.test(line)) {
            if (current) {
                deviceBlocks.push(current);
            }
            current = {
                name: line.trim().replace(/\s*\[[^\]]+\]\s*$/, "").trim(),
                status: null,
                percentage: null,
                voltageMv: null,
                timeToEmptyMinutes: null,
                connected: false
            };
            continue;
        }

        if (!current) {
            continue;
        }

        const statusMatch = line.match(/Status:\s*(\S+)/i);
        if (statusMatch) {
            current.status = statusMatch[1].trim();
            current.connected = /BATTERY_AVAILABLE/i.test(current.status);
            continue;
        }

        // Percentage MUST come from Level only — never derive it from Voltage.
        const levelMatch = line.match(/Level:\s*(-?\d+)\s*%/i);
        if (levelMatch) {
            current.percentage = Number(levelMatch[1]);
            continue;
        }

        const voltageMatch = line.match(/Voltage:\s*(-?\d+)\s*mV/i);
        if (voltageMatch) {
            current.voltageMv = Number(voltageMatch[1]);
            // Intentionally do not touch current.percentage here.
            continue;
        }

        const tteMatch = line.match(/Time to Empty:\s*(-?\d+)\s*minutes/i);
        if (tteMatch) {
            current.timeToEmptyMinutes = Number(tteMatch[1]);
        }
    }

    if (current) {
        deviceBlocks.push(current);
    }

    // Fallback: single anonymous device if percentages exist without a header.
    if (deviceBlocks.length === 0) {
        const levelMatch = text.match(/Level:\s*(-?\d+)\s*%/i);
        if (levelMatch) {
            const statusMatch = text.match(/Status:\s*(\S+)/i);
            const voltageMatch = text.match(/Voltage:\s*(-?\d+)\s*mV/i);
            const tteMatch = text.match(/Time to Empty:\s*(-?\d+)\s*minutes/i);
            const status = statusMatch ? statusMatch[1] : null;
            deviceBlocks.push({
                name: "Headset",
                status: status,
                percentage: Number(levelMatch[1]),
                voltageMv: voltageMatch ? Number(voltageMatch[1]) : null,
                timeToEmptyMinutes: tteMatch ? Number(tteMatch[1]) : null,
                connected: status ? /BATTERY_AVAILABLE/i.test(status) : true
            });
        }
    }

    result.devices = deviceBlocks;
    if (result.devices.length > 0) {
        result.found = true;
    }
    return result;
}

module.exports = {
    formatPercent,
    formatDurationSeconds,
    formatDurationMinutes,
    formatVoltage,
    formatState,
    formatUpdated,
    formatClockTime,
    formatAge,
    formatRelativeAge,
    buildSummaryLine,
    buildClipboardSummary,
    buildTooltip,
    parseHeadsetControlOutput
};
