const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;

function launchDesktop(item) {
    if (!item || item.type !== "app") {
        return false;
    }

    try {
        if (item.appInfo) {
            item.appInfo.launch([], null);
            return true;
        }
        const appInfo = newDesktopAppInfo(item.path);
        if (appInfo) {
            appInfo.launch([], null);
            return true;
        }
    } catch (e) {
        global.logError(e, "TheLauncher: failed to launch " + item.path);
    }

    return false;
}

function newDesktopAppInfo(filePath) {
    try {
        const GioUnix = imports.gi.GioUnix;
        if (GioUnix && GioUnix.DesktopAppInfo) {
            return GioUnix.DesktopAppInfo.new_from_filename(filePath);
        }
    } catch (e) {
        // Fall back to Gio below.
    }
    return Gio.DesktopAppInfo.new_from_filename(filePath);
}

function getDocumentIcon(filePath) {
    try {
        const filename = GLib.path_get_basename(filePath || "");
        const [contentType] = Gio.content_type_guess(filename, null);
        if (contentType) {
            const appInfo = Gio.AppInfo.get_default_for_type(contentType, true);
            if (appInfo) {
                const icon = appInfo.get_icon();
                if (icon) {
                    return icon;
                }
            }
            return Gio.content_type_get_icon(contentType);
        }
    } catch (e) {
        global.logError(e, "TheLauncher: failed to get document icon for " + filePath);
    }

    return Gio.ThemedIcon.new("text-x-generic");
}

function openDocument(path) {
    try {
        const uri = Gio.File.new_for_path(path).get_uri();
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return true;
    } catch (e) {
        global.logError(e, "TheLauncher: failed to open document " + path);
    }

    try {
        Util.spawn(["xdg-open", path]);
        return true;
    } catch (e2) {
        global.logError(e2, "TheLauncher: xdg-open fallback failed for " + path);
    }

    return false;
}

function openFolder(path) {
    try {
        const uri = Gio.File.new_for_path(path).get_uri();
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return true;
    } catch (e) {
        global.logError(e, "TheLauncher: failed to open folder " + path);
    }

    try {
        Util.spawn(["xdg-open", path]);
        return true;
    } catch (e2) {
        global.logError(e2, "TheLauncher: xdg-open fallback failed for " + path);
    }

    return false;
}

