const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const CONFIG_DIR = GLib.build_filenamev([GLib.get_home_dir(), ".config", "thelauncher"]);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, "config.json"]);

function getDefaultBaseDirectory() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "thelauncher"]);
}

function loadConfig() {
    const defaults = {
        version: 1,
        baseDirectory: getDefaultBaseDirectory()
    };

    if (!GLib.file_test(CONFIG_FILE, GLib.FileTest.EXISTS)) {
        return defaults;
    }

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
        global.logError(e, "TheLauncher: failed to read config.json");
    }

    return defaults;
}

function saveConfig(config) {
    try {
        if (!GLib.file_test(CONFIG_DIR, GLib.FileTest.IS_DIR)) {
            GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        }
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
    return GLib.build_filenamev([base, sub]);
}

function ensureLinkDirectory(subdirectory) {
    const config = loadConfig();
    const base = config.baseDirectory || getDefaultBaseDirectory();

    if (!GLib.file_test(base, GLib.FileTest.IS_DIR)) {
        GLib.mkdir_with_parents(base, 0o755);
    }

    if (!config.baseDirectory || config.baseDirectory !== base) {
        saveConfig({ version: 1, baseDirectory: base });
    }

    const resolved = getResolvedPath(subdirectory);
    if (!GLib.file_test(resolved, GLib.FileTest.IS_DIR)) {
        GLib.mkdir_with_parents(resolved, 0o755);
    }

    return resolved;
}

if (typeof module !== "undefined") {
    module.exports = {
        loadConfig,
        saveConfig,
        getResolvedPath,
        ensureLinkDirectory,
        getDefaultBaseDirectory
    };
}
