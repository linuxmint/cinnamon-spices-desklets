const Desklet = imports.ui.desklet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Slider = imports.ui.slider;
const Tooltips = imports.ui.tooltips;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Pango = imports.gi.Pango;
const Soup = imports.gi.Soup; // 3.0: Cinnamon picks the version at startup
imports.gi.versions.Gst = "1.0";
const Gst = imports.gi.Gst;
const Gettext = imports.gettext;

const Rss = require("./rss");

const UUID = "podcasts@tacojones";
const USER_AGENT = "Cinnamon podcasts desklet";
const MAX_FEED_BYTES = 64 * 1024 * 1024;
const MAX_EPISODES = 20; // the most settings-schema.json lets you show per feed
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const COVER_PIXELS = 96; // covers are saved this size: .podcasts-cover's 32 px at up to 3× scale
const COVER_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), UUID]);
const POSITIONS_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), UUID, "positions.json"]);
const MAX_POSITIONS = 1000; // the most recently played episodes whose place is remembered
const SKIP_SECONDS = 10;
const RESUME_BACK_SECONDS = 3; // resume a little before where you stopped, to pick up the thread
const FINISHED_SECONDS = 30; // stopping this close to the end counts as finishing

Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));

function _(text) {
    return Gettext.dgettext(UUID, text);
}

function ngettext(singular, plural, count) {
    return Gettext.dngettext(UUID, singular, plural, count);
}

class PodcastDesklet extends Desklet.Desklet {
    _init(metadata, deskletId) {
        super._init(metadata, deskletId);
        this.setHeader(_("Podcasts"));

        this.feeds = [];
        this.episodesPerFeed = 2;
        this.refreshMinutes = 60;
        this.width = 380;
        this.height = 420;
        this.backgroundOpacity = 90;
        this.cornerRadius = 4;
        this.showCovers = true;
        this._settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        this._settings.bind("feeds", "feeds", () => this._feedsChanged());
        this._settings.bind("episodes-per-feed", "episodesPerFeed", () => this._render());
        this._settings.bind("refresh-minutes", "refreshMinutes", () => this._schedule());
        this._settings.bind("width", "width", () => this._layout());
        this._settings.bind("height", "height", () => this._layout());
        this._settings.bind("background-opacity", "backgroundOpacity", () => this._applyBackground());
        this._settings.bind("corner-radius", "cornerRadius", () => this._applyBackground());
        this._settings.bind("show-covers", "showCovers", () => this._render());
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
        this._cancellable = new Gio.Cancellable(); // the current refresh's fetches
        this._results = new Map(); // feed URL -> { feed } or { error }
        this._generation = 0;
        this._fetchedUrls = ""; // the feed URLs the last refresh fetched, one per line
        this._lifetime = new Gio.Cancellable(); // cover downloads, which outlive a refresh
        this._covers = new Map(); // image URL -> Gio.File of the cover on disk
        this._coverFetches = new Set(); // image URLs being looked up or downloaded
        this._refreshId = 0;
        this._tickId = 0;
        // Redraw now and then so "3 hours ago" keeps up between refreshes
        this._ageId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 10 * 60, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
        this._player = null;
        this._playing = null; // the episode loaded in the player
        this._resumeAt = 0; // seconds to seek to once the player has started
        this._positions = {}; // episode guid -> { position, duration, saved } in seconds and ms
        this._savePositionsId = 0;
        this._accent = null; // the theme's accent colour, as CSS, for podcast titles
        this._text = null; // the theme's text colour, a Clutter.Color, for lines and highlights
        this._loadPositions();

        this._statusItem = new PopupMenu.PopupMenuItem("", { reactive: false });
        this._menu.addMenuItem(this._statusItem);
        this.connect("destroy", () => this._teardown());
        this._menu.addAction(_("Refresh"), () => this._refresh());
        this._buildUi();
        this._layout();
        this._refresh();
        this._schedule();
    }

    _buildUi() {
        this._box = new St.BoxLayout({ vertical: true, style_class: "podcasts-box" });

        this._list = new St.BoxLayout({ vertical: true });
        this._scroll = new St.ScrollView({ x_fill: true, style_class: "podcasts-scroll" });
        // No scrollbar, only the mouse wheel: St asserts if its scrollbar is pressed while it
        // still thinks it's being dragged (its release went elsewhere), which aborts Cinnamon
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        this._scroll.add_actor(this._list);
        this._box.add_child(this._scroll);

        this._playerBar = new St.BoxLayout({ vertical: true, style_class: "podcasts-player" });
        this._nowPlaying = this._wrapped("", "");
        this._playerBar.add_child(this._nowPlaying);
        this._playError = this._wrapped("", "podcasts-error"); // stays until the next play or Close
        this._playError.hide();
        this._playerBar.add_child(this._playError);
        this._progress = new Slider.Slider(0);
        this._progress.actor.add_style_class_name("podcasts-progress");
        this._progress.connect("value-changed", (slider, value) => this._progressMoved(value));
        this._progress.connect("drag-end", () => this._seekTo(this._progress._value));
        // Keep the press from reaching the desklet, which would start dragging it about
        this._progress.actor.connect("button-press-event", () => Clutter.EVENT_STOP);
        // One line: the buttons, then the progress bar taking what room is left, then the time
        const controls = new St.BoxLayout({ style: "spacing: 2px;" });
        controls.add(this._iconButton("media-seek-backward-symbolic", _("Back 10 seconds"), () => this._skip(-SKIP_SECONDS)).button);
        this._playPause = this._iconButton("media-playback-pause-symbolic", _("Pause"), () => this._togglePause());
        controls.add(this._playPause.button);
        controls.add(this._iconButton("media-seek-forward-symbolic", _("Forward 10 seconds"), () => this._skip(SKIP_SECONDS)).button);
        this._stopButton = this._iconButton("media-playback-stop-symbolic", _("Stop"), () => this._stop());
        controls.add(this._stopButton.button);
        this._skipButtons = [controls.get_child_at_index(0), controls.get_child_at_index(2)];
        controls.add(this._progress.actor, { expand: true, y_fill: false });
        this._time = new St.Label({ style_class: "podcasts-status", opacity: 150 });
        controls.add(this._time, { y_fill: false });
        this._playerBar.add_child(controls);
        this._playerBar.hide();
        this._box.add_child(this._playerBar);

        this.setContent(this._box);
    }

    _layout() {
        this._box.style = `width: ${this.width}px;`;
        this._scroll.style = `height: ${this.height}px;`;
    }

    on_desklet_added_to_desktop() {
        this._applyBackground();
    }

    // The theme's background and border, at the opacity and with the corner radius from the
    // settings. The header is only shown when the desklet decorations include it. This hides the
    // highlight Cinnamon gives the desklet while it's being configured, which only matters for
    // telling several instances apart, and there's only one.
    _applyBackground() {
        if (!this.content.get_stage())
            return; // the theme's colours are only known on the stage
        const radius = this.cornerRadius;
        this._fade(this._header, `${radius}px ${radius}px 0 0`);
        // Themes often pad the bottom more than the sides, which leaves a gap under the player
        this._fade(this.content, this._header.visible ? `0 0 ${radius}px ${radius}px` : `${radius}px`, true);
        this._text = this.content.get_theme_node().get_foreground_color();
        this._playerBar.style = `border-top-color: ${this._tint(0.15)};`;
        // The theme's trough is often its background colour, which wouldn't show on it
        this._progress.actor.style = `-slider-background-color: ${this._tint(0.15)};`;
        this._readAccent();
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
    // widgets when the theme changes, so the progress bar, say, may still have the old theme's.
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
        const accent = found && color.alpha > 0 ? `rgb(${color.red}, ${color.green}, ${color.blue})` : null;
        if (accent !== this._accent) {
            this._accent = accent;
            this._render();
        }
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
        const opacity = Math.max(0, Math.min(100, this.backgroundOpacity)) / 100;
        const rgba = color => `rgba(${color.red}, ${color.green}, ${color.blue}, ${(color.alpha / 255 * opacity).toFixed(3)})`;
        actor.style = `background-color: ${rgba(colors.get_background_color())}; `
            + `border-color: ${rgba(colors.get_border_color(St.Side.TOP))}; border-radius: ${radius};`
            + (image ? " border-image: none;" : "")
            + (evenBottom ? ` padding-bottom: ${node.get_padding(St.Side.LEFT)}px;` : "");
    }

    // { button, icon, tooltip }, so the icon and tooltip can change with what the button does.
    _iconButton(iconName, text, onClick) {
        const icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: "podcasts-icon" });
        const button = new St.Button({ child: icon, style_class: "podcasts-icon-button", reactive: true, accessible_name: text });
        button.connect("clicked", onClick);
        this._hoverTint(button, 0.15);
        return { button, icon, tooltip: new Tooltips.Tooltip(button, text) };
    }

    _setIconButton(control, iconName, text) {
        control.icon.icon_name = iconName;
        control.button.accessible_name = text;
        control.tooltip.set_text(text);
    }

    // The first line of the right-click menu.
    _setStatus(text) {
        this._statusItem.label.text = text;
    }

    _wrapped(text, styleClass) {
        const label = new St.Label({ text, style_class: styleClass });
        if (styleClass === "podcasts-status")
            label.opacity = 150; // the theme's text colour, faded, as for episode dates
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        return label;
    }

    // Feeds

    _schedule() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(5, this.refreshMinutes) * 60, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _feedUrls() {
        return (this.feeds || []).map(feed => (feed.url || "").trim()).filter(url => url);
    }

    // Cinnamon calls this whenever any setting changes, as it never finds two lists equal, so
    // only fetch when the URLs did change; a renamed feed just needs drawing again.
    _feedsChanged() {
        if (this._feedUrls().join("\n") !== this._fetchedUrls)
            this._refresh();
        else
            this._render();
    }

    _refresh() {
        const urls = this._feedUrls();
        const generation = ++this._generation;
        this._fetchedUrls = urls.join("\n");
        this._cancellable.cancel(); // drop any fetches still running from the last refresh
        this._cancellable = new Gio.Cancellable();
        for (const url of [...this._results.keys()])
            if (!urls.includes(url))
                this._results.delete(url);
        if (urls.length === 0) {
            this._setStatus(_("No feeds yet"));
            this._render();
            return;
        }
        let pending = urls.length;
        this._setStatus(_("Checking feeds…"));
        for (const url of urls) {
            this._fetch(url, this._cancellable, result => {
                if (generation !== this._generation)
                    return; // the feed list changed meanwhile
                this._results.set(url, result);
                if (result.feed?.image)
                    this._cover(result.feed.image);
                pending--;
                this._setStatus(pending > 0 ? _("Checking feeds…")
                    : _("Checked %s").format(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
                if (pending === 0 && [...this._results.values()].every(r => r.feed))
                    this._pruneCovers(); // only when every feed loaded, or covers in use would go
                this._render();
            });
        }
    }

    _fetch(url, cancellable, done) {
        let message;
        try {
            message = Soup.Message.new("GET", url);
        } catch (e) {
            message = null;
        }
        if (!message) {
            done({ error: _("not a valid address") });
            return;
        }
        const failed = e => {
            if (!e.matches || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                done({ error: e.message });
        };
        this._session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
            let stream;
            try {
                stream = session.send_finish(result);
            } catch (e) {
                failed(e);
                return;
            }
            const status = message.get_status();
            const [type, params] = message.get_response_headers().get_content_type();
            let error = null;
            if (status < 200 || status >= 300)
                error = `HTTP ${status}`;
            else if (/^(audio|video)\//i.test(type || ""))
                error = _("this is an episode's address, not a feed's");
            if (error) {
                closeQuietly(stream);
                done({ error });
                return;
            }
            readAll(stream, MAX_FEED_BYTES, cancellable, (bytes, e) => {
                if (e) {
                    failed(e);
                    return;
                }
                if (!bytes) {
                    done({ error: _("the feed is over %d MB").format(MAX_FEED_BYTES / 1024 / 1024) });
                    return;
                }
                try {
                    const text = Rss.decodeBytes(bytes, params?.charset);
                    if (!/<(rss|channel)[\s>]/.test(text))
                        done({ error: _("not a podcast feed") });
                    else
                        done({ feed: Rss.parse(text, MAX_EPISODES) });
                } catch (e) {
                    done({ error: e.message });
                }
            });
        });
    }

    _render() {
        this._list.destroy_all_children();
        const names = new Map((this.feeds || []).map(feed => [(feed.url || "").trim(), (feed.name || "").trim()]));
        if (this._feedUrls().length === 0)
            this._list.add_child(this._wrapped(_("No feeds yet: right-click → Configure"), "podcasts-status"));
        for (const url of this._feedUrls()) {
            const result = this._results.get(url);
            if (!result)
                continue;
            const title = names.get(url) || result.feed?.title || url;
            const header = new St.BoxLayout({ style_class: "podcasts-feed-header" });
            const cover = this.showCovers && this._covers.get(result.feed?.image);
            if (cover)
                header.add(new St.Bin({ style_class: "podcasts-cover", style: `background-image: url("${cover.get_uri()}");` }), { y_fill: false });
            const titleLabel = this._wrapped(title, "podcasts-feed");
            if (this._accent)
                titleLabel.style = `color: ${this._accent};`;
            header.add(titleLabel, { expand: true, y_fill: false });
            this._list.add_child(header);
            if (result.error) {
                this._list.add_child(this._wrapped(_("Couldn't load: %s").format(result.error), "podcasts-status"));
                continue;
            }
            for (const episode of result.feed.episodes.slice(0, this.episodesPerFeed))
                this._list.add_child(this._episodeRow(title, episode));
        }
    }

    // Cover art

    // Makes sure the cover at url is on disk, then draws the list again to show it.
    _cover(url) {
        if (this._covers.has(url) || this._coverFetches.has(url))
            return;
        this._coverFetches.add(url);
        const file = Gio.File.new_for_path(GLib.build_filenamev([COVER_DIR, coverName(url)]));
        const ready = () => {
            this._coverFetches.delete(url);
            this._covers.set(url, file);
            this._render();
        };
        const failed = e => {
            this._coverFetches.delete(url); // tried again at the next refresh
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                global.logWarning(`[${UUID}] cover ${url}: ${e?.message ?? "not an image"}`);
        };
        file.query_info_async("standard::size", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._lifetime, (source, result) => {
            try {
                source.query_info_finish(result);
                ready();
                return;
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
            }
            this._downloadCover(url, file, ready, failed);
        });
    }

    _downloadCover(url, file, ready, failed) {
        let message;
        try {
            message = Soup.Message.new("GET", url);
        } catch (e) {
            message = null;
        }
        if (!message) {
            failed(new Error("not a valid address"));
            return;
        }
        this._session.send_async(message, GLib.PRIORITY_LOW, this._lifetime, (session, result) => {
            let stream;
            try {
                stream = session.send_finish(result);
            } catch (e) {
                failed(e);
                return;
            }
            const status = message.get_status();
            const [type] = message.get_response_headers().get_content_type();
            if (status < 200 || status >= 300 || !/^image\//i.test(type || "")) {
                closeQuietly(stream);
                failed(new Error(status < 200 || status >= 300 ? `HTTP ${status}` : `not an image (${type})`));
                return;
            }
            readAll(stream, MAX_COVER_BYTES, this._lifetime, (bytes, e) => {
                if (!bytes) {
                    failed(e ?? new Error("over 10 MB"));
                    return;
                }
                // Podcast artwork is often 3000 px square, and St loads a background image all at
                // once, so keep a small copy
                const input = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(input, COVER_PIXELS, COVER_PIXELS, true, this._lifetime, (s, scaled) => {
                    let png;
                    try {
                        [, png] = GdkPixbuf.Pixbuf.new_from_stream_finish(scaled).save_to_bufferv("png", [], []);
                    } catch (e) {
                        failed(e);
                        return;
                    }
                    makeDirectory(file.get_parent(), error => {
                        if (error) {
                            failed(error);
                            return;
                        }
                        // replace_contents writes a temporary file and renames it, so a cover is never half there
                        file.replace_contents_bytes_async(new GLib.Bytes(png), null, false,
                            Gio.FileCreateFlags.REPLACE_DESTINATION, this._lifetime, (source, written) => {
                                try {
                                    source.replace_contents_finish(written);
                                    ready();
                                } catch (e) {
                                    failed(e);
                                }
                            });
                    });
                });
            });
        });
    }

    // Deletes covers no feed uses any more.
    _pruneCovers() {
        const keep = new Set([...this._results.values()].map(r => r.feed?.image).filter(u => u).map(coverName));
        const dir = Gio.File.new_for_path(COVER_DIR);
        dir.enumerate_children_async("standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._lifetime, (source, result) => {
            let children;
            try {
                children = source.enumerate_children_finish(result);
            } catch (e) {
                return; // no covers yet
            }
            const next = () => children.next_files_async(50, GLib.PRIORITY_LOW, this._lifetime, (enumerator, listed) => {
                let infos;
                try {
                    infos = enumerator.next_files_finish(listed);
                } catch (e) {
                    infos = [];
                }
                if (infos.length === 0) {
                    children.close_async(GLib.PRIORITY_LOW, null, (enumerator, closed) => {
                        try {
                            enumerator.close_finish(closed);
                        } catch (e) {
                            // nothing to do
                        }
                    });
                    return;
                }
                for (const info of infos) {
                    if (keep.has(info.get_name()))
                        continue;
                    const gone = dir.get_child(info.get_name());
                    gone.delete_async(GLib.PRIORITY_LOW, null, (f, deleted) => {
                        try {
                            f.delete_finish(deleted);
                        } catch (e) {
                            // already gone
                        }
                    });
                    for (const [url, cached] of this._covers)
                        if (cached.equal(gone))
                            this._covers.delete(url);
                }
                next();
            });
            next();
        });
    }

    _episodeRow(show, episode) {
        const box = new St.BoxLayout({ vertical: true });
        box.add_child(this._wrapped(episode.title || _("(untitled)"), ""));
        const place = this._positions[episode.guid];
        const left = place?.duration > 0 ? _("%s left").format(formatDuration(String(place.duration - place.position))) : "";
        const details = [episode.date && ago(episode.date), episode.date?.toLocaleDateString(),
            formatDuration(episode.duration), left].filter(d => d);
        if (details.length)
            box.add_child(new St.Label({ text: details.join(" · "), style_class: "podcasts-episode-date", opacity: 150 }));
        const row = new St.Button({ child: box, style_class: "podcasts-episode", x_fill: true, reactive: true });
        row.connect("clicked", () => this._play(show, episode));
        this._hoverTint(row, 0.1);
        return row;
    }

    // Playback

    _play(show, episode) {
        if (this._playing)
            this._remember();
        this._nowPlaying.text = `${show} — ${episode.title || _("(untitled)")}`;
        if (!this._player) {
            if (!Gst.is_initialized())
                Gst.init(null);
            this._player = Gst.ElementFactory.make("playbin", "podcast-player");
            if (!this._player) {
                this._failed(_("GStreamer's playbin is missing"));
                return;
            }
            const sink = audioSink();
            if (sink)
                this._player.set_property("audio-sink", sink);
            const bus = this._player.get_bus();
            bus.add_signal_watch();
            this._busIds = [
                bus.connect("message::eos", () => this._finished()),
                bus.connect("message::async-done", () => this._resume()),
                bus.connect("message::error", (b, message) => {
                    if (!this._playing)
                        return; // the first error says why; the ones after are its echoes
                    const [error] = message.parse_error();
                    // The HTTP source says only "Internal data stream error" when it can't
                    // reach the server at all
                    const unreachable = message.src.get_name() === "source"
                        && error.matches(Gst.StreamError, Gst.StreamError.FAILED);
                    this._failed(_("Couldn't play: %s").format(
                        unreachable ? _("the episode's server couldn't be reached") : error.message));
                }),
            ];
        }
        this._player.set_state(Gst.State.NULL);
        this._player.set_property("uri", episode.url);
        this._player.set_state(Gst.State.PLAYING);
        this._playing = episode;
        this._paused = false;
        const place = this._positions[episode.guid];
        this._resumeAt = place ? Math.max(0, place.position - RESUME_BACK_SECONDS) : 0;
        this._setIconButton(this._playPause, "media-playback-pause-symbolic", _("Pause"));
        this._setIconButton(this._stopButton, "media-playback-stop-symbolic", _("Stop"));
        for (const control of [this._playPause.button, this._progress.actor, ...this._skipButtons])
            control.show();
        this._progress.setValue(place?.duration > 0 ? place.position / place.duration : 0);
        this._playError.hide();
        this._time.text = "";
        this._playerBar.show();
        this._ticks = 0;
        if (!this._tickId)
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._updateTime();
                if (++this._ticks % 10 === 0 && !this._paused)
                    this._remember();
                return GLib.SOURCE_CONTINUE;
            });
    }

    // Once the player has started (or finished seeking), go to where this episode was left.
    _resume() {
        if (!this._resumeAt || !this._playing)
            return;
        const at = this._resumeAt;
        this._resumeAt = 0;
        this._player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, at * Gst.SECOND);
    }

    _togglePause() {
        if (!this._player || !this._playing)
            return;
        this._paused = !this._paused;
        this._player.set_state(this._paused ? Gst.State.PAUSED : Gst.State.PLAYING);
        if (this._paused)
            this._setIconButton(this._playPause, "media-playback-start-symbolic", _("Play"));
        else
            this._setIconButton(this._playPause, "media-playback-pause-symbolic", _("Pause"));
        this._remember();
    }

    // [position, length] in seconds; length is 0 when it isn't known (yet).
    _times() {
        const [hasPosition, position] = this._player.query_position(Gst.Format.TIME);
        const [hasLength, length] = this._player.query_duration(Gst.Format.TIME);
        if (!hasPosition)
            return null;
        return [position / Gst.SECOND, hasLength && length > 0 ? length / Gst.SECOND : 0];
    }

    _skip(seconds) {
        const times = this._playing && this._times();
        if (!times)
            return;
        const [position, length] = times;
        const to = Math.max(0, length ? Math.min(position + seconds, length - 1) : position + seconds);
        this._player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, to * Gst.SECOND);
        this._showTime(to, length);
        this._remember(to, length);
    }

    // value is where the progress bar now is, from 0 to 1.
    _progressMoved(value) {
        const times = this._playing && this._times();
        if (!times || !times[1])
            return;
        if (this._progress._dragging)
            this._showTime(value * times[1], times[1]); // seek when it's let go
        else
            this._seekTo(value); // scrolled
    }

    _seekTo(value) {
        const times = this._playing && this._times();
        if (!times || !times[1])
            return;
        this._skip(value * times[1] - times[0]);
    }

    _stop() {
        if (this._playing)
            this._remember();
        if (this._player)
            this._player.set_state(Gst.State.NULL);
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        this._playing = null;
        this._resumeAt = 0;
        this._playerBar.hide();
        this._render(); // for the time left on the episode
    }

    _finished() {
        if (this._playing) {
            delete this._positions[this._playing.guid];
            this._savePositions();
            this._playing = null; // so _stop doesn't remember the end
        }
        this._stop();
    }

    // Stops, and leaves the player bar showing what went wrong; a refresh rewriting the status
    // line would otherwise hide it.
    _failed(text) {
        this._playing = null; // so _stop doesn't remember where a failed episode got to
        this._stop();
        this._playError.text = text;
        this._playError.show();
        for (const control of [this._playPause.button, this._progress.actor, ...this._skipButtons])
            control.hide();
        this._setIconButton(this._stopButton, "window-close-symbolic", _("Close"));
        this._time.text = "";
        this._playerBar.show();
    }

    _updateTime() {
        const times = this._times();
        if (times && !this._progress._dragging)
            this._showTime(...times);
    }

    _showTime(position, length) {
        this._time.text = length ? `${clock(Math.floor(position))} / ${clock(Math.floor(length))}` : clock(Math.floor(position));
        if (length && !this._progress._dragging)
            this._progress.setValue(position / length);
    }

    // Resuming

    // Notes where the playing episode is, at position (seconds) of length, or where the player is.
    _remember(position, length) {
        if (!this._playing || !this._player)
            return;
        if (position === undefined) {
            const times = this._times();
            if (!times)
                return;
            [position, length] = times;
        }
        if (this._resumeAt)
            return; // not at the remembered place yet: keep it
        const guid = this._playing.guid;
        if (length && length - position < FINISHED_SECONDS)
            delete this._positions[guid];
        else if (position >= 5)
            this._positions[guid] = { position: Math.floor(position), duration: Math.floor(length), saved: Date.now() };
        this._savePositions();
    }

    _loadPositions() {
        Gio.File.new_for_path(POSITIONS_FILE).load_contents_async(this._lifetime, (file, result) => {
            try {
                const [, contents] = file.load_contents_finish(result);
                // Places noted before the file was read win over the ones in it
                this._positions = Object.assign(JSON.parse(new TextDecoder().decode(contents)), this._positions);
                this._render();
            } catch (e) {
                // no file yet, or not readable: start afresh
            }
        });
    }

    // Writes the places to disk a moment later, so a burst of changes makes one write.
    _savePositions(now = false) {
        if (this._savePositionsId)
            GLib.source_remove(this._savePositionsId);
        this._savePositionsId = 0;
        const write = () => {
            this._savePositionsId = 0;
            const entries = Object.entries(this._positions).sort((a, b) => b[1].saved - a[1].saved);
            this._positions = Object.fromEntries(entries.slice(0, MAX_POSITIONS));
            const file = Gio.File.new_for_path(POSITIONS_FILE);
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._positions)));
            const failed = e => global.logWarning(`[${UUID}] couldn't save where episodes were left: ${e.message}`);
            // Not cancelled with the desklet: the last places should still reach the disk
            makeDirectory(file.get_parent(), error => {
                if (error) {
                    failed(error);
                    return;
                }
                file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
                    try {
                        source.replace_contents_finish(result);
                    } catch (e) {
                        failed(e);
                    }
                });
            });
            return GLib.SOURCE_REMOVE;
        };
        if (now)
            write();
        else
            this._savePositionsId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, write);
    }

    // Cinnamon's destroy() destroys the menu at once, then fades the desklet out and only then
    // calls on_desklet_removed. Settings and fetches answered during the fade would touch what
    // is gone (a fresh config file written then, say), so stop everything when destroy() starts.
    on_desklet_removed() {
        this._teardown();
    }

    _teardown() {
        if (this._tornDown)
            return;
        this._tornDown = true;
        this._cancellable.cancel();
        this._lifetime.cancel();
        GLib.source_remove(this._ageId);
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = 0;
        this._stop();
        if (this._savePositionsId)
            this._savePositions(true);
        if (this._player) {
            const bus = this._player.get_bus();
            for (const id of this._busIds)
                bus.disconnect(id);
            bus.remove_signal_watch();
            this._player = null;
        }
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

// A sound server output that names the stream "Podcasts", or null to let playbin choose one.
// Otherwise it plays as "cinnamon", sharing a remembered volume with all of Cinnamon's sounds.
// The sound server groups remembered volumes by application.id (unless media.role is set,
// which would share one with every music player), so the desklet gets a volume of its own.
function audioSink() {
    const sink = Gst.ElementFactory.make("pulsesink", null); // PulseAudio, or PipeWire's stand-in
    if (!sink)
        return null;
    const props = Gst.Structure.new_empty("props");
    props.set_value("application.name", _("Podcasts"));
    props.set_value("application.id", UUID);
    props.set_value("application.icon_name", "audio-x-generic");
    sink.stream_properties = props;
    return sink;
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

// A cover's file name: from its URL, so a feed whose image changes gets the new one.
function coverName(url) {
    return `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)}.png`;
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

// "3 days ago" from a date.
function ago(date) {
    const minutes = Math.floor((Date.now() - date) / 60000);
    if (minutes < 1)
        return _("just now"); // or a little ahead, as some feeds date episodes
    if (minutes < 60)
        return ngettext("%d minute ago", "%d minutes ago", minutes).format(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return ngettext("%d hour ago", "%d hours ago", hours).format(hours);
    const days = Math.floor(hours / 24);
    if (days < 14)
        return ngettext("%d day ago", "%d days ago", days).format(days);
    if (days < 61)
        return ngettext("%d week ago", "%d weeks ago", Math.floor(days / 7)).format(Math.floor(days / 7));
    if (days < 365)
        return ngettext("%d month ago", "%d months ago", Math.floor(days / 30)).format(Math.floor(days / 30));
    return ngettext("%d year ago", "%d years ago", Math.floor(days / 365)).format(Math.floor(days / 365));
}

// "1:02:03" from seconds.
function clock(total) {
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// itunes:duration is seconds or [H:]MM:SS; shown as "1 h 5 min" or "42 min".
function formatDuration(text) {
    if (!text)
        return "";
    const parts = text.split(":").map(Number);
    if (parts.some(isNaN))
        return "";
    const total = parts.reduce((sum, part) => sum * 60 + part, 0);
    const h = Math.floor(total / 3600), m = Math.round(total / 60) % 60;
    return h > 0 ? _("%d h %d min").format(h, m) : _("%d min").format(Math.max(1, m));
}

function main(metadata, deskletId) {
    return new PodcastDesklet(metadata, deskletId);
}
