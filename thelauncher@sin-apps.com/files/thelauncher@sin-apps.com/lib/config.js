const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), "thelauncher"]);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, "config.json"]);

function getDefaultBaseDirectory() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), "thelauncher"]);
}

function loadConfig() {
    const defaults = {
        version: 1,
        baseDirectory: getDefaultBaseDirectory()
    };

    try {
        const [, contents] = GLib.file_get_contents(CONFIG_FILE);
        const parsed = JSON.parse(contents);
        if (parsed.baseDirectory) {
            defaults.baseDirectory = parsed.baseDirectory;
        }
        if (parsed.version) {
            defaults.version = parsed.version;
        }
    } catch (e) {
        // Missing or unreadable config — use defaults.
    }

    return defaults;
}

function saveConfig(config) {
    try {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        const payload = JSON.stringify({
            version: config.version || 1,
            baseDirectory: config.baseDirectory || getDefaultBaseDirectory()
        }, null, 2);
        GLib.file_set_contents(CONFIG_FILE, payload);
    } catch (e) {
        global.logError(e, "TheLauncher: failed to write config.json");
    }
}

function getResolvedPath(subdirectory) {
    const config = loadConfig();
    const base = config.baseDirectory || getDefaultBaseDirectory();
    const sub = (subdirectory || "default").replace(/^\/+|\/+$/g, "");
    const parts = [base].concat(sub.split("/").filter(Boolean));
    return GLib.build_filenamev(parts);
}

function ensureLinkDirectory(subdirectory) {
    const config = loadConfig();
    const base = config.baseDirectory || getDefaultBaseDirectory();

    try {
        GLib.mkdir_with_parents(base, 0o755);
    } catch (e) {
        global.logError(e, "TheLauncher: failed to create base directory");
    }

    if (!config.baseDirectory || config.baseDirectory !== base) {
        saveConfig({ version: 1, baseDirectory: base });
    }

    const resolved = getResolvedPath(subdirectory);
    try {
        GLib.mkdir_with_parents(resolved, 0o755);
    } catch (e) {
        global.logError(e, "TheLauncher: failed to create link directory");
    }

    return resolved;
}

