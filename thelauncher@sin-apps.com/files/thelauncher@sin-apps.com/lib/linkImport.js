const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

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

function isLaunchableDesktop(filePath) {
    try {
        const appInfo = newDesktopAppInfo(filePath);
        if (appInfo && typeof appInfo.should_show === "function" && appInfo.should_show()) {
            return true;
        }
    } catch (e) {
        // Fall through to manual validation below.
    }

    try {
        const [, contents] = GLib.file_get_contents(filePath);
        const text = imports.byteArray.toString(contents);
        return /^\s*Exec\s*=/m.test(text);
    } catch (e) {
        return false;
    }
}

function resolveSourcePath(sourcePath) {
    if (!sourcePath) {
        return null;
    }

    if (GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) {
        return sourcePath;
    }

    if (!sourcePath.endsWith(".desktop")) {
        const withDesktop = sourcePath + ".desktop";
        if (GLib.file_test(withDesktop, GLib.FileTest.EXISTS)) {
            return withDesktop;
        }
    }

    return sourcePath;
}

function uniqueDestinationPath(destDir, baseName) {
    let candidate = GLib.build_filenamev([destDir, baseName]);
    if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
        return candidate;
    }

    let stem = baseName;
    let suffix = "";
    if (baseName.endsWith(".desktop")) {
        stem = baseName.slice(0, -8);
        suffix = ".desktop";
    }

    for (let i = 1; i < 1000; i++) {
        candidate = GLib.build_filenamev([destDir, stem + "-" + i + suffix]);
        if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
            return candidate;
        }
    }

    throw new Error("Could not find a unique destination name for " + baseName);
}

function copyRegularFile(sourcePath, destPath) {
    const source = Gio.File.new_for_path(sourcePath);
    const dest = Gio.File.new_for_path(destPath);
    source.copy(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
}

function copyDirectoryRecursive(sourcePath, destPath) {
    const source = Gio.File.new_for_path(sourcePath);
    const dest = Gio.File.new_for_path(destPath);
    source.copy(dest, Gio.FileCopyFlags.NONE, null, null);
}

function importPathIntoDirectory(sourcePath, destDir) {
    if (!sourcePath || !destDir) {
        return { ok: false, error: "Invalid path." };
    }

    if (!GLib.file_test(destDir, GLib.FileTest.IS_DIR)) {
        return { ok: false, error: "Link directory not found." };
    }

    sourcePath = resolveSourcePath(sourcePath);
    if (!GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) {
        return { ok: false, error: "File not found." };
    }

    const baseName = GLib.path_get_basename(sourcePath);
    if (baseName.charAt(0) === ".") {
        return { ok: false, error: "Hidden files are not supported." };
    }

    let destPath;
    try {
        destPath = uniqueDestinationPath(destDir, baseName);
    } catch (e) {
        return { ok: false, error: e.message };
    }

    if (GLib.file_test(sourcePath, GLib.FileTest.IS_DIR)) {
        try {
            copyDirectoryRecursive(sourcePath, destPath);
            return { ok: true, path: destPath, type: "folder" };
        } catch (e) {
            global.logError(e, "TheLauncher: folder copy failed");
            return { ok: false, error: "Could not copy folder." };
        }
    }

    if (sourcePath.endsWith(".desktop")) {
        if (!isLaunchableDesktop(sourcePath)) {
            return { ok: false, error: "Not a launchable .desktop file." };
        }

        try {
            copyRegularFile(sourcePath, destPath);
            return { ok: true, path: destPath, type: "app" };
        } catch (e) {
            global.logError(e, "TheLauncher: desktop copy failed");
            return { ok: false, error: "Could not copy .desktop file." };
        }
    }

    try {
        copyRegularFile(sourcePath, destPath);
        return { ok: true, path: destPath, type: "document" };
    } catch (e) {
        global.logError(e, "TheLauncher: document copy failed");
        return { ok: false, error: "Could not copy file." };
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        resolveSourcePath,
        importPathIntoDirectory,
        isLaunchableDesktop
    };
}
