const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

var COLOR_TOKEN_KEYS = [
    "link-bg-color",
    "document-bg-color",
    "border-color",
    "text-color",
    "folder-bg-color",
    "folder-border-color",
    "folder-icon-tint",
    "desklet-bg-color",
    "title-color",
    "hover-bg-color",
    "pressed-bg-color",
    "tooltip-bg-color",
    "tooltip-text-color"
];

var LIGHT_PRESETS = ["light-default", "light-soft", "light-contrast"];
var DARK_PRESETS = ["dark-default", "dark-midnight", "dark-graphite"];

const COLOR_MODE_ALIASES = {
    "System": "system",
    "Light": "light",
    "Dark": "dark",
    "Custom": "custom"
};

const PRESET_ALIASES = {
    "Light default": "light-default",
    "Light soft": "light-soft",
    "Light contrast": "light-contrast",
    "Dark default": "dark-default",
    "Dark midnight": "dark-midnight",
    "Dark graphite": "dark-graphite"
};

function normalizeColorMode(value) {
    if (!value) {
        return "system";
    }

    const text = String(value);
    const lower = text.toLowerCase();
    if (lower === "system" || lower === "light" || lower === "dark" || lower === "custom") {
        return lower;
    }

    return COLOR_MODE_ALIASES[text] || lower;
}

function normalizePresetId(value, fallback) {
    if (!value) {
        return fallback;
    }

    const text = String(value);
    if (PRESET_ALIASES[text]) {
        return PRESET_ALIASES[text];
    }

    if (LIGHT_PRESETS.indexOf(text) !== -1 || DARK_PRESETS.indexOf(text) !== -1) {
        return text;
    }

    return fallback;
}

function isCustomColorMode(colorMode) {
    return normalizeColorMode(colorMode) === "custom";
}

function hexToColorString(hex) {
    if (!hex) {
        return "rgb(0,0,0)";
    }

    let value = hex.replace("#", "");
    if (value.length === 8) {
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        const a = parseInt(value.slice(6, 8), 16) / 255;
        return "rgba(%d,%d,%d,%.2f)".format(r, g, b, a);
    }

    if (value.length === 6) {
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        return "rgb(%d,%d,%d)".format(r, g, b);
    }

    return hex;
}

function loadPreset(metadata, presetId) {
    const presetPath = GLib.build_filenamev([
        metadata.path,
        "themes",
        "presets",
        presetId + ".json"
    ]);

    try {
        const [, contents] = GLib.file_get_contents(presetPath);
        return JSON.parse(contents);
    } catch (e) {
        // Missing or unreadable preset.
        return null;
    }
}

function isSystemDarkTheme() {
    try {
        const gtkSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
        if (gtkSettings.list_keys().indexOf("color-scheme") !== -1) {
            const scheme = gtkSettings.get_string("color-scheme");
            if (scheme === "prefer-dark") {
                return true;
            }
            if (scheme === "prefer-light") {
                return false;
            }
        }

        const themeName = gtkSettings.get_string("gtk-theme").toLowerCase();
        return themeName.indexOf("dark") !== -1;
    } catch (e) {
        return true;
    }
}

function resolvePresetId(colorMode, lightPreset, darkPreset) {
    const mode = normalizeColorMode(colorMode);
    const light = normalizePresetId(lightPreset, "light-default");
    const dark = normalizePresetId(darkPreset, "dark-default");

    if (mode === "light") {
        return light;
    }
    if (mode === "dark") {
        return dark;
    }
    if (mode === "system") {
        return isSystemDarkTheme() ? dark : light;
    }
    return null;
}

function applyPresetTokens(settings, metadata, presetId) {
    const preset = loadPreset(metadata, presetId);
    if (!preset || !preset.tokens) {
        return false;
    }

    COLOR_TOKEN_KEYS.forEach(key => {
        if (preset.tokens[key] !== undefined) {
            settings.setValue(key, hexToColorString(preset.tokens[key]));
        }
    });

    if (preset.tokens["shadow-color"] !== undefined) {
        settings.setValue(
            "text-shadow-color",
            hexToColorString(preset.tokens["shadow-color"])
        );
    }

    if (preset.tokens["disabled-opacity"] !== undefined) {
        settings.setValue("disabled-opacity", preset.tokens["disabled-opacity"]);
    }

    return true;
}

