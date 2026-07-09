var SETTING_DEFAULTS = {
    "subdirectory": "default",
    "launch-mode": "single-click",
    "folder-click-mode": "navigate",
    "folder-sort": "mixed",
    "color-mode": "system",
    "light-preset": "light-default",
    "dark-preset": "dark-default",
    "layout-style": "tile",
    "columns": 8,
    "row-spacing": 5,
    "col-spacing": 5,
    "scale": 1.0,
    "text-align": "center",
    "icon-size": 50,
    "text-width-padding": 16,
    "border-width": 2,
    "disabled-opacity": 0.35,
    "max-width": 0,
    "max-height": 0,
    "content-fit": "auto"
};

const COMBOBOX_KEYS = {
    "launch-mode": ["single-click", "double-click"],
    "folder-click-mode": ["navigate", "open-file-manager"],
    "folder-sort": ["mixed", "folders-first", "folders-last"],
    "color-mode": ["system", "light", "dark", "custom"],
    "light-preset": ["light-default", "light-soft", "light-contrast"],
    "dark-preset": ["dark-default", "dark-midnight", "dark-graphite"],
    "layout-style": ["tile", "list"],
    "text-align": ["left", "center", "right"],
    "content-fit": ["auto", "fixed"]
};

function isBlank(value) {
    if (value === null || value === undefined) {
        return true;
    }

    if (typeof value === "string" && value.trim() === "") {
        return true;
    }

    return false;
}

function isInvalidNumber(value) {
    if (value === null || value === undefined) {
        return true;
    }

    if (typeof value === "number") {
        return Number.isNaN(value);
    }

    if (typeof value === "string" && value.trim() === "") {
        return true;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed);
}

function isInvalidCombobox(value, allowed) {
    if (isBlank(value)) {
        return true;
    }

    return allowed.indexOf(String(value)) < 0;
}

function needsDefaultReset(key, current) {
    const defaultValue = SETTING_DEFAULTS[key];
    if (defaultValue === undefined) {
        return false;
    }

    if (COMBOBOX_KEYS[key]) {
        return isInvalidCombobox(current, COMBOBOX_KEYS[key]);
    }

    if (typeof defaultValue === "number") {
        return isInvalidNumber(current);
    }

    return isBlank(current);
}

function ensureSettingsDefaults(settings) {
    if (!settings) {
        return;
    }

    Object.keys(SETTING_DEFAULTS).forEach(key => {
        let current;
        try {
            current = settings.getValue(key);
        } catch (e) {
            current = null;
        }

        if (needsDefaultReset(key, current)) {
            settings.setValue(key, SETTING_DEFAULTS[key]);
        }
    });
}

