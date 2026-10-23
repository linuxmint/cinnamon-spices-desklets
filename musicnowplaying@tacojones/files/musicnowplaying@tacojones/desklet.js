const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Slider = imports.ui.slider;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Pango = imports.gi.Pango;
const Soup = imports.gi.Soup; // 3.0: Cinnamon picks the version at startup
const Gettext = imports.gettext;

const UUID = "musicnowplaying@tacojones";
const USER_AGENT = "Cinnamon music now playing desklet";
const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";
const MPRIS_PATH = "/org/mpris/MediaPlayer2";
const PLAYER_INTERFACE = "org.mpris.MediaPlayer2.Player";
const ART_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), UUID]);
const ART_PIXELS = 800; // art is saved this size: the default 284 px at up to 2.8× scale
const MAX_ART_BYTES = 20 * 1024 * 1024;
const MAX_ART_FILES = 50; // the most album covers kept, the most recently saved
const PADDING = 8; // .nowplaying-box's, which the art fills the width inside

// Only what the desklet uses. The proxies check what players send against these.
const PLAYER_INFO = Gio.DBusNodeInfo.new_for_xml(`
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="PlayPause"/>
    <method name="Seek"><arg type="x" direction="in"/></method>
    <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <signal name="Seeked"><arg type="x"/></signal>
  </interface>
</node>`).lookup_interface(PLAYER_INTERFACE);
const ROOT_INFO = Gio.DBusNodeInfo.new_for_xml(`
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="Identity" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
  </interface>
</node>`).lookup_interface("org.mpris.MediaPlayer2");

Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));

function _(text) {
    return Gettext.dgettext(UUID, text);
}

class NowPlayingDesklet extends Desklet.Desklet {
    _init(metadata, deskletId) {
        super._init(metadata, deskletId);
        this.setHeader(_("Music Now Playing"));

        this.player = "audacious";
        this.width = 300;
        this.backgroundOpacity = 90;
        this.cornerRadius = 12;
        this._settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        this._settings.bind("player", "player", () => this._choose());
        this._settings.bind("width", "width", () => this._layout());
        this._settings.bind("background-opacity", "backgroundOpacity", () => this._applyBackground());
        this._settings.bind("corner-radius", "cornerRadius", () => this._applyBackground());
        this._decorationsId = global.settings.connect("changed::desklet-decorations", () => this._applyBackground());
        // Wait until St has restyled everything for the new theme: read now, the colours come from
        // widgets still styled by the old one, and setting their style keeps them on it
        this._themeIdleId = 0;
        this._themeId = St.ThemeContext.get_for_stage(global.stage).connect("changed", () => {
            if (!this._themeIdleId)
                this._themeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._themeIdleId = 0;
                    this._applyBackground();
                    return GLib.SOURCE_REMOVE;
                });
        });

        this._session = new Soup.Session({ user_agent: USER_AGENT, timeout: 30 });
        this._lifetime = new Gio.Cancellable(); // everything the desklet starts
        this._players = new Map(); // D-Bus name -> { busName, player, root, ids }
        this._active = null; // the entry shown
        this._position = 0; // seconds into the track, as the player last said
        this._length = 0; // seconds, or 0 when unknown
        this._tickId = 0;
        this._artKey = null; // what the art shown, or being loaded, is for
        this._artFile = null; // the scaled copy of the art shown, or null for the placeholder
        this._artCancellable = null;
        this._accent = null; // the theme's accent colour, as CSS
        this._text = null; // the theme's text colour, a Clutter.Color
        this._background = null; // the desklet's background colour, opaque, as CSS

        this.connect("destroy", () => this._teardown());
        this._raiseItem = this._menu.addAction("", () => this._raise());
        this._buildUi();
        this._layout();
        this._watchPlayers();
    }

    _buildUi() {
        this._box = new St.BoxLayout({ vertical: true, style_class: "nowplaying-box" });

        this._placeholder = new St.Icon({ icon_name: "audio-x-generic-symbolic", icon_type: St.IconType.SYMBOLIC, style_class: "nowplaying-placeholder-icon", opacity: 120 });
        this._art = new St.Button({ child: this._placeholder, style_class: "nowplaying-art", reactive: true });
        this._art.connect("clicked", () => this._raise());
        this._box.add(this._art, { x_fill: false, x_align: St.Align.MIDDLE });

        this._title = this._centred("nowplaying-title");
        this._artist = this._centred("nowplaying-details");
        this._artist.opacity = 200;
        this._album = this._centred("nowplaying-details");
        this._album.opacity = 160;
        for (const label of [this._title, this._artist, this._album])
            this._box.add(label, { x_fill: false, x_align: St.Align.MIDDLE });

        this._progress = new Slider.Slider(0);
        this._progress.actor.add_style_class_name("nowplaying-progress");
        this._progress.connect("value-changed", (slider, value) => this._progressMoved(value));
        this._progress.connect("drag-end", () => this._seekTo(this._progress._value));
        // Keep the press from reaching the desklet, which would start dragging it about
        this._progress.actor.connect("button-press-event", () => Clutter.EVENT_STOP);
        this._box.add_child(this._progress.actor);
        this._times = new St.BoxLayout();
        this._elapsed = new St.Label({ style_class: "nowplaying-time", opacity: 150 });
        this._times.add(this._elapsed, { expand: true });
        this._total = new St.Label({ style_class: "nowplaying-time", opacity: 150 });
        this._times.add(this._total);
        this._box.add_child(this._times);

        this._controls = new St.BoxLayout({ style_class: "nowplaying-controls" });
        this._shuffle = this._iconButton("media-playlist-shuffle-symbolic", _("Shuffle"), () => this._toggleShuffle());
        this._previous = this._iconButton("media-skip-backward-symbolic", _("Previous"), () => this._call("Previous"));
        const playIcon = new St.Icon({ icon_name: "media-playback-start-symbolic", icon_type: St.IconType.SYMBOLIC, style_class: "nowplaying-play-icon" });
        this._play = { icon: playIcon, button: new St.Button({ child: playIcon, style_class: "nowplaying-play", reactive: true, accessible_name: _("Play") }) };
        this._play.button.connect("clicked", () => this._call("PlayPause"));
        this._play.button.connect("notify::hover", () => this._play.button.opacity = this._play.button.hover ? 220 : 255);
        this._next = this._iconButton("media-skip-forward-symbolic", _("Next"), () => this._call("Next"));
        this._loop = this._iconButton("media-playlist-repeat-symbolic", _("Repeat"), () => this._cycleLoop());
        for (const control of [this._shuffle, this._previous, this._play, this._next, this._loop])
            this._controls.add(control.button, { y_fill: false, y_align: St.Align.MIDDLE });
        this._box.add(this._controls, { x_fill: false, x_align: St.Align.MIDDLE });

        this.setContent(this._box);
    }

    _layout() {
        this._box.style = `width: ${this.width}px;`;
        this._styleArt();
    }

    on_desklet_added_to_desktop() {
        this._applyBackground();
    }

    // Labels

    // Wrapped, with each line centred; the box centres the label itself.
    _centred(styleClass) {
        const label = new St.Label({ style_class: styleClass });
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        label.clutter_text.line_alignment = Pango.Alignment.CENTER;
        return label;
    }

    // { button, icon }, so the icon can change with what the button does.
    _iconButton(iconName, text, onClick) {
        const icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: "nowplaying-icon" });
        const button = new St.Button({ child: icon, style_class: "nowplaying-icon-button", reactive: true, accessible_name: text });
        button.connect("clicked", onClick);
        this._hoverTint(button, 0.15);
        return { button, icon };
    }

    // Theme

    // The theme's background and border, at the opacity and with the corner radius from the
    // settings. The header is only shown when the desklet decorations include it. This hides the
    // highlight Cinnamon gives the desklet while it's being configured, which only matters for
    // telling several instances apart, and there's only one.
    _applyBackground() {
        if (!this.content.get_stage())
            return; // the theme's colours are only known on the stage
        const radius = this.cornerRadius;
        this._fade(this._header, `${radius}px ${radius}px 0 0`);
        // Themes often pad the bottom more than the sides, which leaves a gap under the controls
        this._fade(this.content, this._header.visible ? `0 0 ${radius}px ${radius}px` : `${radius}px`, true);
        this._text = this.content.get_theme_node().get_foreground_color();
        // The theme's trough is often its background colour, which wouldn't show on it
        this._progress.actor.style = `-slider-background-color: ${this._tint(0.15)};`;
        this._readAccent();
        this._styleArt();
        this._styleControls();
    }

    // The theme's text colour, faint, as CSS.
    _tint(alpha) {
        const color = this._text;
        return color ? `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})` : "transparent";
    }

    // St's CSS can't fade the theme's text colour into a hover background, so set it here.
    _hoverTint(button, alpha) {
        button.connect("notify::hover", () => {
            button.style = button.hover ? `background-color: ${this._tint(alpha)};` : null;
        });
    }

    // The theme's style for a widget of this class, read from a new one: St doesn't restyle hidden
    // widgets when the theme changes, so a hidden one may still have the old theme's.
    _themeNode(styleClass) {
        const probe = new St.Widget({ style_class: styleClass, visible: false });
        this._box.add_child(probe);
        const node = probe.get_theme_node();
        probe.destroy();
        return node;
    }

    // Themes don't name an accent colour, but every one fills the active part of a slider with
    // it, so take it from a slider's.
    _readAccent() {
        const [found, color] = this._themeNode("slider").lookup_color("-slider-active-background-color", false);
        this._accent = found && color.alpha > 0 ? `rgb(${color.red}, ${color.green}, ${color.blue})` : null;
    }

    _fade(actor, radius, evenBottom = false) {
        // Read the theme's own colours: without this style, and without the highlight Cinnamon
        // adds while the Configure dialog is open
        const highlighted = actor.has_style_pseudo_class("highlight");
        actor.style = null;
        actor.remove_style_pseudo_class("highlight");
        const node = actor.get_theme_node();
        if (highlighted)
            actor.add_style_pseudo_class("highlight");
        // Some themes (Dracula, for one) draw desklets with an image and give them no colour,
        // which leaves nothing to fade; their menus always have one
        const image = node.get_background_color().alpha === 0 && node.get_border_image();
        const colors = image ? this._themeNode("menu") : node;
        const background = colors.get_background_color();
        if (actor === this.content)
            this._background = `rgb(${background.red}, ${background.green}, ${background.blue})`;
        const opacity = Math.max(0, Math.min(100, this.backgroundOpacity)) / 100;
        const rgba = color => `rgba(${color.red}, ${color.green}, ${color.blue}, ${(color.alpha / 255 * opacity).toFixed(3)})`;
        actor.style = `background-color: ${rgba(background)}; `
            + `border-color: ${rgba(colors.get_border_color(St.Side.TOP))}; border-radius: ${radius};`
            + (image ? " border-image: none;" : "")
            + (evenBottom ? ` padding-bottom: ${node.get_padding(St.Side.LEFT)}px;` : "");
    }

    // The play button in the accent colour, its icon in the background's; shuffle and repeat in
    // the accent colour while they're on.
    _styleControls() {
        this._play.button.style = this._accent ? `background-color: ${this._accent};` : `background-color: ${this._tint(0.2)};`;
        this._play.icon.style = this._accent && this._background ? `color: ${this._background};` : null;
        const player = this._active?.player;
        const shuffle = player?.get_cached_property("Shuffle")?.unpack();
        const loop = player?.get_cached_property("LoopStatus")?.unpack();
        this._shuffle.icon.style = shuffle && this._accent ? `color: ${this._accent};` : null;
        this._loop.icon.style = loop && loop !== "None" && this._accent ? `color: ${this._accent};` : null;
    }

    _styleArt() {
        const size = this.width - 2 * PADDING;
        const radius = Math.round(this.cornerRadius / 2);
        let style = `width: ${size}px; height: ${size}px; border-radius: ${radius}px;`;
        if (this._artFile)
            style += ` background-image: url("${this._artFile.get_uri()}");`;
        else
            style += ` background-color: ${this._tint(0.08)};`;
        this._art.style = style;
        this._placeholder.visible = !this._artFile;
    }

    // Players

    // Follows the MPRIS players on the session bus as they start and quit.
    _watchPlayers() {
        const bus = Gio.DBus.session;
        this._nameWatchId = bus.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged",
            "/org/freedesktop/DBus", "org.mpris.MediaPlayer2", Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (oldOwner)
                    this._removePlayer(name);
                if (newOwner)
                    this._addPlayer(name);
            });
        bus.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames", null,
            new GLib.VariantType("(as)"), Gio.DBusCallFlags.NONE, -1, this._lifetime, (connection, result) => {
                let names;
                try {
                    [names] = connection.call_finish(result).deep_unpack();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        global.logWarning(`[${UUID}] listing players: ${e.message}`);
                    return;
                }
                for (const name of names)
                    if (name.startsWith(MPRIS_PREFIX))
                        this._addPlayer(name);
                this._choose(); // "Nothing playing" when there are none
            });
    }

    _addPlayer(busName) {
        if (this._players.has(busName))
            return;
        const entry = { busName, player: null, root: null, ids: [] };
        this._players.set(busName, entry);
        let pending = 2;
        const made = () => {
            if (--pending === 0 && this._players.get(busName) === entry)
                this._choose();
        };
        newProxy(PLAYER_INFO, busName, this._lifetime, proxy => {
            if (proxy && this._players.get(busName) === entry) {
                entry.player = proxy;
                entry.ids.push(proxy.connect("g-properties-changed", () => this._choose()));
                entry.ids.push(proxy.connect("g-signal", (p, sender, signal, params) => {
                    if (signal === "Seeked" && entry === this._active) {
                        this._position = params.deep_unpack()[0] / 1e6;
                        this._showTime();
                    }
                }));
            }
            made();
        });
        newProxy(ROOT_INFO, busName, this._lifetime, proxy => {
            entry.root = proxy;
            made();
        });
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        for (const id of entry.ids)
            entry.player.disconnect(id);
        this._players.delete(busName);
        if (entry === this._active)
            this._choose();
    }

    // Whether busName is the player chosen in the settings (or one of its instances).
    _isPreferred(busName) {
        const preferred = (this.player || "").trim().toLowerCase();
        const name = busName.slice(MPRIS_PREFIX.length).toLowerCase();
        return preferred !== "" && (name === preferred || name.startsWith(`${preferred}.`));
    }

    // Shows the player that's playing, the chosen one first; when none is, the chosen one, or
    // else one that's paused.
    _choose() {
        const entries = [...this._players.values()].filter(entry => entry.player);
        const status = entry => entry.player.get_cached_property("PlaybackStatus")?.unpack();
        const preferred = entry => this._isPreferred(entry.busName);
        const playing = entry => status(entry) === "Playing";
        this._active = entries.find(entry => playing(entry) && preferred(entry)) ?? entries.find(playing)
            ?? entries.find(preferred) ?? entries.find(entry => status(entry) === "Paused") ?? entries[0] ?? null;
        this._update();
    }

    // The player's name, or the chosen one's when none is running.
    _playerName() {
        const identity = this._active?.root?.get_cached_property("Identity")?.unpack();
        if (identity)
            return identity;
        const preferred = (this.player || "").trim();
        const app = preferred && Gio.DesktopAppInfo.new(`${preferred.toLowerCase()}.desktop`);
        return app ? app.get_name() : preferred;
    }

    _update() {
        const player = this._active?.player;
        const name = this._playerName();
        this._raiseItem.label.text = player ? _("Show %s").format(name) : _("Open %s").format(name);
        this._raiseItem.actor.visible = Boolean(name);
        if (!player) {
            this._title.text = _("Nothing playing");
            this._artist.text = name ? _("%s isn't running").format(name) : "";
            this._album.text = "";
            this._artist.visible = Boolean(this._artist.text);
            this._album.visible = false;
            for (const actor of [this._progress.actor, this._times, this._controls])
                actor.hide();
            this._length = 0;
            this._showArt(null, null);
            this._syncTick();
            return;
        }

        const metadata = player.get_cached_property("Metadata")?.recursiveUnpack() ?? {};
        const status = player.get_cached_property("PlaybackStatus")?.unpack() ?? "Stopped";
        const can = property => player.get_cached_property(property)?.unpack() ?? false;
        const title = metadata["xesam:title"] || fileTitle(metadata["xesam:url"]);
        const artist = [].concat(metadata["xesam:artist"] ?? []).join(", ");
        const year = String(metadata["xesam:contentCreated"] ?? "").slice(0, 4);
        const album = [metadata["xesam:album"], year].filter(part => part).join(" · ");
        this._title.text = title || name;
        this._artist.text = title ? artist : (status === "Stopped" ? _("Stopped") : "");
        this._album.text = title ? album : "";
        this._artist.visible = Boolean(this._artist.text);
        this._album.visible = Boolean(this._album.text);
        this._trackId = metadata["mpris:trackid"] ?? null;
        this._length = (metadata["mpris:length"] ?? 0) / 1e6;
        this._canSeek = can("CanSeek");

        const hasTrack = Boolean(title);
        this._progress.actor.visible = hasTrack;
        this._times.visible = hasTrack;
        this._progress.actor.reactive = this._canSeek && this._length > 0;
        this._controls.show();
        const playing = status === "Playing";
        this._play.icon.icon_name = playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";
        this._play.button.accessible_name = playing ? _("Pause") : _("Play");
        enable(this._play.button, playing ? can("CanPause") : can("CanPlay"));
        enable(this._previous.button, can("CanGoPrevious"));
        enable(this._next.button, can("CanGoNext"));
        // Not every player has shuffle and repeat
        this._shuffle.button.visible = player.get_cached_property("Shuffle") !== null;
        this._loop.button.visible = player.get_cached_property("LoopStatus") !== null;
        const loop = player.get_cached_property("LoopStatus")?.unpack();
        this._loop.icon.icon_name = loop === "Track" ? "media-playlist-repeat-song-symbolic" : "media-playlist-repeat-symbolic";
        this._loop.button.accessible_name = loop === "Track" ? _("Repeat this track") : loop === "Playlist" ? _("Repeat the playlist") : _("Repeat");
        this._styleControls();

        this._showArt(metadata["mpris:artUrl"], [this._active.busName, title, metadata["xesam:album"]].join("\n"));
        this._syncTick();
    }

    // Asks for where the player is every second while it plays, as players don't say; once when
    // it's paused or a new track starts.
    _syncTick() {
        const playing = this._active?.player?.get_cached_property("PlaybackStatus")?.unpack() === "Playing";
        if (playing && !this._tickId)
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._readPosition();
                return GLib.SOURCE_CONTINUE;
            });
        else if (!playing && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._active)
            this._readPosition();
    }

    _readPosition() {
        const player = this._active?.player;
        if (!player)
            return;
        player.call("org.freedesktop.DBus.Properties.Get", new GLib.Variant("(ss)", [PLAYER_INTERFACE, "Position"]),
            Gio.DBusCallFlags.NONE, 2000, this._lifetime, (proxy, result) => {
                let position;
                try {
                    [position] = proxy.call_finish(result).recursiveUnpack();
                } catch (e) {
                    return; // quit, or has no position
                }
                if (proxy === this._active?.player) {
                    this._position = position / 1e6;
                    this._showTime();
                }
            });
    }

    _showTime() {
        this._elapsed.text = clock(Math.floor(this._position));
        this._total.text = this._length ? clock(Math.floor(this._length)) : "";
        if (!this._progress._dragging)
            this._progress.setValue(this._length ? Math.min(1, this._position / this._length) : 0);
    }

    // Controls

    _call(method, params = null) {
        const player = this._active?.player;
        if (!player)
            return;
        player.call(method, params, Gio.DBusCallFlags.NONE, 5000, this._lifetime, (proxy, result) => {
            try {
                proxy.call_finish(result);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    global.logWarning(`[${UUID}] ${method}: ${e.message}`);
            }
        });
    }

    _setProperty(name, value) {
        this._call("org.freedesktop.DBus.Properties.Set", new GLib.Variant("(ssv)", [PLAYER_INTERFACE, name, value]));
    }

    _toggleShuffle() {
        const shuffle = this._active?.player?.get_cached_property("Shuffle")?.unpack();
        this._setProperty("Shuffle", new GLib.Variant("b", !shuffle));
    }

    // Off, then the playlist, then this track.
    _cycleLoop() {
        const loop = this._active?.player?.get_cached_property("LoopStatus")?.unpack();
        const next = { None: "Playlist", Playlist: "Track" }[loop] ?? "None";
        this._setProperty("LoopStatus", new GLib.Variant("s", next));
    }

    // value is where the progress bar now is, from 0 to 1.
    _progressMoved(value) {
        if (!this._length)
            return;
        if (this._progress._dragging) {
            this._elapsed.text = clock(Math.floor(value * this._length)); // seek when it's let go
        } else {
            this._seekTo(value); // scrolled
        }
    }

    _seekTo(value) {
        if (!this._length || !this._canSeek)
            return;
        const to = Math.max(0, Math.min(value * this._length, this._length - 1));
        if (this._trackId)
            this._call("SetPosition", new GLib.Variant("(ox)", [this._trackId, Math.round(to * 1e6)]));
        else
            this._call("Seek", new GLib.Variant("(x)", [Math.round((to - this._position) * 1e6)]));
        this._position = to;
        this._showTime();
    }

    // Brings the player's window up, or starts the chosen player when none is running.
    _raise() {
        const root = this._active?.root;
        if (root) {
            if (root.get_cached_property("CanRaise")?.unpack())
                root.call("Raise", null, Gio.DBusCallFlags.NONE, 5000, this._lifetime, (proxy, result) => {
                    try {
                        proxy.call_finish(result);
                    } catch (e) {
                        // it quit meanwhile
                    }
                });
            return;
        }
        const preferred = (this.player || "").trim().toLowerCase();
        const app = preferred && Gio.DesktopAppInfo.new(`${preferred}.desktop`);
        if (!app)
            return;
        try {
            app.launch([], null);
        } catch (e) {
            global.logWarning(`[${UUID}] starting ${preferred}: ${e.message}`);
        }
    }

    // Album art

    // Shows the art at url, for the track key names, scaled down and saved first; or the
    // placeholder when there's none. The art stays until the new one is ready.
    _showArt(url, key) {
        if (key === this._artKey && key !== null)
            return;
        this._artKey = key;
        this._artCancellable?.cancel();
        this._artCancellable = null;
        if (!url) {
            this._setArt(null);
            return;
        }
        const cancellable = this._artCancellable = new Gio.Cancellable();
        const done = file => {
            if (key === this._artKey)
                this._setArt(file);
        };
        const failed = e => {
            if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            global.logWarning(`[${UUID}] album art ${url}: ${e?.message ?? "not an image"}`);
            done(null);
        };
        this._loadArt(url, cancellable, (bytes, e) => {
            if (!bytes) {
                failed(e);
                return;
            }
            // Named by what's in it: players often reuse one temporary file for every track's art
            const file = Gio.File.new_for_path(GLib.build_filenamev([ART_DIR,
                `${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA1, bytes)}.png`]));
            file.query_info_async("standard::size", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable, (source, result) => {
                try {
                    source.query_info_finish(result);
                    done(file); // scaled before
                    return;
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                }
                this._saveArt(bytes, file, cancellable, error => error ? failed(error) : done(file));
            });
        });
    }

    _setArt(file) {
        this._artFile = file;
        this._styleArt();
    }

    // Calls done(GLib.Bytes) with what's at url (a file, or on the web), or done(null, error).
    _loadArt(url, cancellable, done) {
        if (/^file:/i.test(url)) {
            Gio.File.new_for_uri(url).load_bytes_async(cancellable, (source, result) => {
                let bytes;
                try {
                    [bytes] = source.load_bytes_finish(result);
                } catch (e) {
                    done(null, e);
                    return;
                }
                if (bytes.get_size() > MAX_ART_BYTES)
                    done(null, new Error("over 20 MB"));
                else
                    done(bytes);
            });
            return;
        }
        if (!/^https?:/i.test(url)) {
            done(null, new Error("not a file or web address"));
            return;
        }
        let message;
        try {
            message = Soup.Message.new("GET", url);
        } catch (e) {
            message = null;
        }
        if (!message) {
            done(null, new Error("not a valid address"));
            return;
        }
        this._session.send_async(message, GLib.PRIORITY_LOW, cancellable, (session, result) => {
            let stream;
            try {
                stream = session.send_finish(result);
            } catch (e) {
                done(null, e);
                return;
            }
            const status = message.get_status();
            if (status < 200 || status >= 300) {
                closeQuietly(stream);
                done(null, new Error(`HTTP ${status}`));
                return;
            }
            readAll(stream, MAX_ART_BYTES, cancellable, (bytes, e) => {
                if (bytes)
                    done(new GLib.Bytes(bytes));
                else
                    done(null, e ?? new Error("over 20 MB"));
            });
        });
    }

    // Album art is often 1000 px or more, and St loads a background image all at once, so keep
    // a smaller copy. Calls done(null) once it's saved, or done(error).
    _saveArt(bytes, file, cancellable, done) {
        const input = Gio.MemoryInputStream.new_from_bytes(bytes);
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(input, ART_PIXELS, ART_PIXELS, true, cancellable, (s, scaled) => {
            let png;
            try {
                [, png] = GdkPixbuf.Pixbuf.new_from_stream_finish(scaled).save_to_bufferv("png", [], []);
            } catch (e) {
                done(e);
                return;
            }
            makeDirectory(file.get_parent(), error => {
                if (error) {
                    done(error);
                    return;
                }
                // replace_contents writes a temporary file and renames it, so art is never half there
                file.replace_contents_bytes_async(new GLib.Bytes(png), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable, (source, written) => {
                        try {
                            source.replace_contents_finish(written);
                        } catch (e) {
                            done(e);
                            return;
                        }
                        done(null);
                        this._pruneArt();
                    });
            });
        });
    }

    // Keeps the MAX_ART_FILES most recently saved covers, and deletes the rest.
    _pruneArt() {
        const dir = Gio.File.new_for_path(ART_DIR);
        dir.enumerate_children_async("standard::name,time::modified", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._lifetime, (source, result) => {
            let children;
            try {
                children = source.enumerate_children_finish(result);
            } catch (e) {
                return;
            }
            const all = [];
            const next = () => children.next_files_async(50, GLib.PRIORITY_LOW, this._lifetime, (enumerator, listed) => {
                let infos;
                try {
                    infos = enumerator.next_files_finish(listed);
                } catch (e) {
                    infos = [];
                }
                if (infos.length > 0) {
                    all.push(...infos);
                    next();
                    return;
                }
                children.close_async(GLib.PRIORITY_LOW, null, (enumerator, closed) => {
                    try {
                        enumerator.close_finish(closed);
                    } catch (e) {
                        // nothing to do
                    }
                });
                all.sort((a, b) => b.get_attribute_uint64("time::modified") - a.get_attribute_uint64("time::modified"));
                for (const info of all.slice(MAX_ART_FILES)) {
                    const gone = dir.get_child(info.get_name());
                    if (this._artFile?.equal(gone))
                        continue;
                    gone.delete_async(GLib.PRIORITY_LOW, null, (f, deleted) => {
                        try {
                            f.delete_finish(deleted);
                        } catch (e) {
                            // already gone
                        }
                    });
                }
            });
            next();
        });
    }

    on_desklet_removed() {
        this._teardown();
    }

    _teardown() {
        if (this._tornDown)
            return;
        this._tornDown = true;
        this._lifetime.cancel();
        this._artCancellable?.cancel();
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
        for (const entry of this._players.values())
            for (const id of entry.ids)
                entry.player.disconnect(id);
        this._players.clear();
        this._session.abort();
        global.settings.disconnect(this._decorationsId);
        St.ThemeContext.get_for_stage(global.stage).disconnect(this._themeId);
        if (this._themeIdleId)
            GLib.source_remove(this._themeIdleId);
        // Done as destroy() starts, before a reloaded or re-added desklet registers its settings
        // under the same id (the UUID, as there is one instance): any later, and this would
        // unregister those, leaving the Configure dialog failing on every change.
        this._settings.finalize();
    }
}

// Makes a proxy for the object at MPRIS_PATH on busName, without starting the player, then calls
// done(proxy), or done(null) when it can't be made.
function newProxy(info, busName, cancellable, done) {
    Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, info, busName,
        MPRIS_PATH, info.name, cancellable, (source, result) => {
            let proxy;
            try {
                proxy = Gio.DBusProxy.new_for_bus_finish(result);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    global.logWarning(`[${UUID}] ${busName}: ${e.message}`);
                proxy = null;
            }
            done(proxy);
        });
}

// Greys out a button that does nothing now.
function enable(button, enabled) {
    button.reactive = enabled;
    button.opacity = enabled ? 255 : 100;
}

// A track's title from its file name, for files without tags.
function fileTitle(url) {
    if (!url)
        return "";
    try {
        return decodeURIComponent(url.split("/").pop()).replace(/\.[^.]+$/, "");
    } catch (e) {
        return "";
    }
}

// Reads stream to its end and closes it, then calls done(bytes) with a Uint8Array, done(null)
// when there are more than limit bytes, or done(null, error).
function readAll(stream, limit, cancellable, done) {
    const chunks = [];
    let size = 0;
    const finish = (bytes, error) => {
        closeQuietly(stream);
        done(bytes, error ?? null);
    };
    const next = () => stream.read_bytes_async(64 * 1024, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
        let chunk;
        try {
            chunk = source.read_bytes_finish(result).toArray();
        } catch (e) {
            finish(null, e);
            return;
        }
        if (chunk.length === 0) {
            const bytes = new Uint8Array(size);
            let at = 0;
            for (const part of chunks) {
                bytes.set(part, at);
                at += part.length;
            }
            finish(bytes);
            return;
        }
        size += chunk.length;
        if (size > limit) {
            finish(null);
            return;
        }
        chunks.push(chunk);
        next();
    });
    next();
}

// Makes the directory file and any parents it lacks, then calls done(null) or done(error).
function makeDirectory(file, done) {
    file.make_directory_async(GLib.PRIORITY_LOW, null, (source, result) => {
        try {
            source.make_directory_finish(result);
            done(null);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                done(null);
            else if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) && source.get_parent())
                makeDirectory(source.get_parent(), error => error ? done(error) : makeDirectory(source, done));
            else
                done(e);
        }
    });
}

function closeQuietly(stream) {
    stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.close_finish(result);
        } catch (e) {
            // already closed or the connection dropped: nothing to do
        }
    });
}

// "1:02:03" from seconds.
function clock(total) {
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function main(metadata, deskletId) {
    return new NowPlayingDesklet(metadata, deskletId);
}
