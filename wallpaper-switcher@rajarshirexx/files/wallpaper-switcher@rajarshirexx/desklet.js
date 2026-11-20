const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

class WallpaperSwitcherDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.metadata = metadata;
        this.instance_id = desklet_id;

        this._timerId = 0;
        this._isPaused = false;

        // Cinnamon desktop background GSettings
        this._bgSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.background" });

        // Connect Desklet settings
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bind("wallpaper-dir", "wallpaper_dir", () => this._onConfigChanged());
        this.settings.bind("interval", "interval", () => this._onConfigChanged());
        this.settings.bind("custom-interval", "custom_interval", () => this._onConfigChanged());

        // Build UI: ←  ⏸  →
        this._buildUI();
    }

    _buildUI() {
        this._box = new St.BoxLayout({
            style_class: "wallpaper-switcher-container",
            vertical: false,
            reactive: true
        });

        // Previous button
        this._prevBtn = new St.Button({
            style_class: "wallpaper-switcher-button",
            label: "←",
            reactive: true,
            can_focus: true
        });
        this._prevBtn.connect("clicked", () => this._onPrevClicked());
        this._box.add_actor(this._prevBtn);

        // Pause / Resume button
        this._pauseBtn = new St.Button({
            style_class: "wallpaper-switcher-button",
            label: "⏸",
            reactive: true,
            can_focus: true
        });
        this._pauseBtn.connect("clicked", () => this._togglePause());
        this._box.add_actor(this._pauseBtn);

        // Next button
        this._nextBtn = new St.Button({
            style_class: "wallpaper-switcher-button",
            label: "→",
            reactive: true,
            can_focus: true
        });
        this._nextBtn.connect("clicked", () => this._onNextClicked());
        this._box.add_actor(this._nextBtn);

        this.setContent(this._box);
    }

    on_desklet_added_to_desktop(userEnabled) {
        // Start slideshow using Cinnamon's native placement & persistence
        this._startTimer();
    }

    on_desklet_removed() {
        this._stopTimer();
    }

    _resolvePath(rawPath) {
        if (!rawPath || typeof rawPath !== "string") {
            return GLib.get_home_dir() + "/Pictures/Wallpapers";
        }

        let p = rawPath.trim();
        if (p === "") {
            return GLib.get_home_dir() + "/Pictures/Wallpapers";
        }

        if (p.startsWith("file://")) {
            let [filename] = GLib.filename_from_uri(p);
            if (filename) {
                p = filename;
            }
        }

        if (p === "~" || p.startsWith("~/")) {
            return GLib.get_home_dir() + p.substring(1);
        }

        return p;
    }

    _normalizeUri(uriOrPath) {
        if (!uriOrPath || typeof uriOrPath !== "string") {
            return "";
        }

        let s = uriOrPath.trim();
        if (s === "") return "";

        try {
            let file;
            if (s.startsWith("file://")) {
                file = Gio.File.new_for_uri(s);
            } else {
                if (s === "~" || s.startsWith("~/")) {
                    s = GLib.get_home_dir() + s.substring(1);
                }
                file = Gio.File.new_for_path(s);
            }

            let path = file.get_path();
            if (path) {
                return Gio.File.new_for_path(path).get_uri();
            }
            return file.get_uri();
        } catch (_) {
            return s;
        }
    }

    _getWallpaperList() {
        let folderPath = this._resolvePath(this.wallpaper_dir);
        let list = [];

        try {
            let dir = Gio.File.new_for_path(folderPath);
            if (!dir.query_exists(null)) {
                return list;
            }

            let fileType = dir.query_file_type(Gio.FileQueryInfoFlags.NONE, null);
            if (fileType !== Gio.FileType.DIRECTORY) {
                return list;
            }

            let enumerator = dir.enumerate_children(
                "standard::name,standard::type",
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() === Gio.FileType.REGULAR) {
                    let name = info.get_name();
                    let lower = name.toLowerCase();
                    if (SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
                        let child = dir.get_child(name);
                        list.push(child.get_uri());
                    }
                }
            }
            enumerator.close(null);
        } catch (e) {
            global.logError("wallpaper-switcher: error enumerating directory: " + e.message);
            return [];
        }

        list.sort();
        return list;
    }

    _getCurrentWallpaperUri() {
        try {
            return this._bgSettings.get_string("picture-uri");
        } catch (e) {
            return "";
        }
    }

    _setWallpaperUri(uri) {
        if (!uri) return;
        try {
            let keys = this._bgSettings.list_keys();
            if (keys.includes("picture-uri")) {
                this._bgSettings.set_string("picture-uri", uri);
            }
            // Update picture-uri-dark alongside picture-uri if supported by Cinnamon background schema
            if (keys.includes("picture-uri-dark")) {
                this._bgSettings.set_string("picture-uri-dark", uri);
            }
        } catch (e) {
            global.logError("wallpaper-switcher: error setting wallpaper: " + e.message);
        }
    }

    _navigate(step) {
        let list = this._getWallpaperList();
        if (list.length === 0) {
            return;
        }

        if (list.length === 1) {
            this._setWallpaperUri(list[0]);
            if (!this._isPaused) {
                this._startTimer();
            }
            return;
        }

        let normalizedList = list.map(item => this._normalizeUri(item));
        let currentRaw = this._getCurrentWallpaperUri();
        let currentNormalized = this._normalizeUri(currentRaw);

        let currentIndex = normalizedList.indexOf(currentNormalized);
        if (currentIndex === -1 && currentRaw) {
            // Basename fallback if path encoding or symlink differences occur
            let currentBase = GLib.path_get_basename(currentNormalized || currentRaw);
            currentIndex = normalizedList.findIndex(item => GLib.path_get_basename(item) === currentBase);
        }

        let nextIndex;
        if (currentIndex === -1) {
            nextIndex = step > 0 ? 0 : list.length - 1;
        } else {
            nextIndex = (currentIndex + step + list.length) % list.length;
        }

        this._setWallpaperUri(list[nextIndex]);

        // Reset slideshow interval after manual navigation if not paused
        if (!this._isPaused) {
            this._startTimer();
        }
    }

    _onPrevClicked() {
        this._navigate(-1);
    }

    _onNextClicked() {
        this._navigate(1);
    }

    _togglePause() {
        this._isPaused = !this._isPaused;
        this._pauseBtn.set_label(this._isPaused ? "▶" : "⏸");

        if (this._isPaused) {
            this._stopTimer();
        } else {
            this._startTimer();
        }
    }

    _getEffectiveInterval() {
        let interval = this.interval;
        if (interval === -1) {
            interval = this.custom_interval;
        }

        if (!interval || interval < 5) {
            interval = 600; // default to 10 minutes (600s) if invalid
        }

        return interval;
    }

    _startTimer() {
        this._stopTimer();

        if (this._isPaused) {
            return;
        }

        let intervalSeconds = this._getEffectiveInterval();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
            this._navigate(1);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timerId > 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _onConfigChanged() {
        if (!this._isPaused) {
            this._startTimer();
        }
    }
}

function main(metadata, desklet_id) {
    return new WallpaperSwitcherDesklet(metadata, desklet_id);
}

