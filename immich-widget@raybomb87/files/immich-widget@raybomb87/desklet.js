const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Soup = imports.gi.Soup;
const Gettext = imports.gettext;

const UUID = "immich-widget@raybomb87";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const FETCH_KEYS = ["server-url", "api-key", "source", "source-name", "include-screenshots", "smart-crop", "count"];
const LOOK_KEYS = ["delay", "radius", "shadow", "fade", "date-format", "place", "caption-size"];
const SIZE_KEYS = ["width", "height"];

// Runs an async GIO-style method and returns a Promise for its _finish result.
function asyncCall(obj, method, finish, ...args) {
    return new Promise((resolve, reject) => {
        obj[method](...args, (source, res) => {
            try {
                resolve(obj[finish](res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

class ImmichWidget extends Desklet.Desklet {
    constructor(metadata, id) {
        super(metadata, id);
        this._dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, String(id)]));
        this._session = new Soup.Session({ timeout: 30 });
        this._cancellable = new Gio.Cancellable();

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, id);
        let bind = (key, cb) => this.settings.bind(key, key.replace(/-/g, "_"), cb);
        FETCH_KEYS.forEach(k => bind(k, () => this._scheduleFetch(2)));
        LOOK_KEYS.forEach(k => bind(k, () => this._build()));
        SIZE_KEYS.forEach(k => bind(k, () => { this._build(); this._scheduleFetch(2); }));
        bind("refresh-hours", () => this._startRefreshTimer());

        this._photos = [];
        this._captions = {};
        this._index = 0;
        this._slideTimer = 0;
        this._refreshTimer = 0;
        this._fetchTimer = 0;
        this._fetching = false;
        this._removed = false;
        this._message = "";

        this._build();
        this._startRefreshTimer();
        // wait a little after login so the network is up; cached photos show meanwhile
        this._scheduleFetch(15);
    }

    // ---- layout -------------------------------------------------------------

    _build() {
        this._stopSlides();
        let size = `width: ${this.width}px; height: ${this.height}px; border-radius: ${this.radius}px;`;
        this._box = new St.Widget({
            style_class: "immich-widget" + (this.shadow ? " immich-widget-shadow" : ""),
            style: size, layout_manager: new Clutter.BinLayout(), reactive: true });
        this._layers = [0, 1].map(() => {
            let layer = new St.Widget({ style: size, opacity: 0 });
            this._box.add_child(layer);
            return layer;
        });
        this._active = 0;
        this._caption = new St.Label({
            style_class: "immich-widget-caption", style: `font-size: ${this.caption_size}pt;`,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true });
        this._box.add_child(this._caption);
        this._messageLabel = new St.Label({
            style_class: "immich-widget-message",
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true });
        this._messageLabel.clutter_text.line_wrap = true;
        this._box.add_child(this._messageLabel);
        this.setContent(this._box);
        this._scan();
    }

    _configured() {
        return this.server_url.trim() != "" && this.api_key.trim() != "";
    }

    _showMessage() {
        let text = "";
        if (!this._photos.length) {
            if (!this._configured())
                text = _("Right-click and choose Configure to connect to your Immich server.");
            else if (this._fetching)
                text = _("Fetching photos…");
            else
                text = this._message || _("No photos yet.");
        }
        this._messageLabel.text = text;
        this._messageLabel.visible = text != "";
    }

    // ---- slideshow ----------------------------------------------------------

    async _scan() {
        let photos, captions;
        try {
            [photos, captions] = await Promise.all([this._listPhotos(), this._readCaptions()]);
        } catch (e) {
            return;
        }
        if (this._removed) return;
        photos = [...photos];
        for (let i = photos.length - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            [photos[i], photos[j]] = [photos[j], photos[i]];
        }
        this._photos = photos;
        this._captions = captions;
        this._index = 0;
        this._showMessage();
        this._stopSlides();
        if (!photos.length) return;
        this._next();
        this._slideTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.delay, () => {
            this._next();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _next() {
        if (!this._photos.length) return;
        let name = this._photos[this._index++ % this._photos.length];
        this._current = name;
        let uri = this._dir.get_child(name).get_uri();
        let incoming = this._layers[1 - this._active], outgoing = this._layers[this._active];
        incoming.style = `width: ${this.width}px; height: ${this.height}px; border-radius: ${this.radius}px;` +
            ` background-image: url("${uri}"); background-size: cover;`;
        this._box.set_child_above_sibling(incoming, outgoing);
        this._box.set_child_above_sibling(this._caption, null);
        this._box.set_child_above_sibling(this._messageLabel, null);
        let mode = Clutter.AnimationMode.EASE_IN_OUT_QUAD;
        incoming.ease({ opacity: 255, duration: this.fade, mode });
        outgoing.ease({ opacity: 0, duration: this.fade, mode });
        this._active = 1 - this._active;
        this._caption.text = this._captionFor(this._captions[name] || {});
    }

    _captionFor(c) {
        let parts = [];
        if (this.date_format && /^\d{4}-\d{2}-\d{2}$/.test(c.date || "")) {
            let [y, m, d] = c.date.split("-").map(Number);
            let dt = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
            if (dt) parts.push(dt.format(this.date_format));
        }
        if (this.place && c.city)
            parts.push(this.place == "city-country" && c.country ? `${c.city}, ${c.country}` : c.city);
        return parts.join(" · ");
    }

    _stopSlides() {
        if (this._slideTimer) {
            GLib.source_remove(this._slideTimer);
            this._slideTimer = 0;
        }
    }

    // ---- cache folder -------------------------------------------------------

    async _listPhotos() {
        let names = new Set();
        let enumerator;
        try {
            enumerator = await asyncCall(this._dir, "enumerate_children_async", "enumerate_children_finish",
                "standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._cancellable);
        } catch (e) {
            return names; // folder does not exist yet
        }
        while (true) {
            let infos = await asyncCall(enumerator, "next_files_async", "next_files_finish",
                50, GLib.PRIORITY_LOW, this._cancellable);
            if (!infos.length) break;
            for (let info of infos)
                if (info.get_name().endsWith(".jpg")) names.add(info.get_name());
        }
        await asyncCall(enumerator, "close_async", "close_finish", GLib.PRIORITY_LOW, null);
        return names;
    }

    async _readCaptions() {
        try {
            let [, contents] = await asyncCall(this._dir.get_child("captions.json"),
                "load_contents_async", "load_contents_finish", this._cancellable);
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (e) {
            return {};
        }
    }

    async _write(name, bytes) {
        await asyncCall(this._dir.get_child(name), "replace_contents_bytes_async", "replace_contents_finish",
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable);
    }

    async _ensureDir() {
        for (let dir of [this._dir.get_parent(), this._dir]) {
            try {
                await asyncCall(dir, "make_directory_async", "make_directory_finish", GLib.PRIORITY_LOW, this._cancellable);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw e;
            }
        }
    }

    // ---- Immich API ---------------------------------------------------------

    _serverUrl() {
        let server = this.server_url.trim().replace(/\/+$/, "");
        return /^https?:\/\//.test(server) ? server : "http://" + server;
    }

    async _api(method, path, body = null, raw = false) {
        let message = Soup.Message.new(method, this._serverUrl() + "/api" + path);
        if (!message) throw new Error(_("The server address is not valid."));
        message.get_request_headers().append("x-api-key", this.api_key.trim());
        message.get_request_headers().append("Accept", raw ? "*/*" : "application/json");
        if (body)
            message.set_request_body_from_bytes("application/json",
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        let bytes;
        try {
            bytes = await asyncCall(this._session, "send_and_read_async", "send_and_read_finish",
                message, GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) throw e;
            throw new Error(_("Cannot reach Immich: %s").format(e.message));
        }
        let status = message.get_status();
        if (status != Soup.Status.OK) {
            if (status == Soup.Status.UNAUTHORIZED) throw new Error(_("Immich rejected the API key."));
            let detail = "";
            try {
                detail = JSON.parse(new TextDecoder().decode(bytes.get_data())).message || "";
            } catch (e) { }
            throw new Error(_("Immich: %s").format(detail || status));
        }
        return raw ? bytes : JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _searchFilter() {
        let name = this.source_name.trim().toLowerCase();
        if (this.source == "favorites")
            return { isFavorite: true };
        if (this.source == "album") {
            let album = (await this._api("GET", "/albums")).find(a => a.albumName.trim().toLowerCase() == name);
            if (!album) throw new Error(_("Album not found: %s").format(this.source_name));
            return { albumIds: [album.id] };
        }
        if (this.source == "person") {
            let people = await this._api("GET", "/search/person?name=" + encodeURIComponent(this.source_name.trim()));
            if (!people.length) throw new Error(_("Person not found: %s").format(this.source_name));
            return { personIds: [people[0].id] };
        }
        return {};
    }

    // Face boxes scaled to (w, h); empty when unknown or the key lacks face.read.
    async _faces(id, w, h) {
        try {
            return (await this._api("GET", "/faces?id=" + id)).map(f => {
                let sx = w / f.imageWidth, sy = h / f.imageHeight;
                return [f.boundingBoxX1 * sx, f.boundingBoxY1 * sy, f.boundingBoxX2 * sx, f.boundingBoxY2 * sy];
            });
        } catch (e) {
            if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) throw e;
            return [];
        }
    }

    // ---- cropping -----------------------------------------------------------

    // Start of a `window` within `length` that keeps [low, high] in view if possible.
    _windowStart(length, window, low, high, margin, noFaceBias) {
        let start;
        if (low === null)
            start = (length - window) * noFaceBias;
        else if (high - low + 2 * margin <= window)
            start = Math.min(Math.max((low + high) / 2 - window / 2, high + margin - window), low - margin);
        else // not all faces fit: keep the top, where the heads are
            start = low - margin;
        return Math.round(Math.max(0, Math.min(start, length - window)));
    }

    async _crop(bytes, id) {
        let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
        let pixbuf = await new Promise((resolve, reject) => {
            GdkPixbuf.Pixbuf.new_from_stream_async(stream, this._cancellable, (source, res) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        pixbuf = pixbuf.apply_embedded_orientation() || pixbuf;
        let w = pixbuf.get_width(), h = pixbuf.get_height();
        let rw = this.width, rh = this.height;
        let boxes = this.smart_crop ? await this._faces(id, w, h) : [];
        let x1 = null, y1 = null, x2 = null, y2 = null, margin = 0;
        if (boxes.length) {
            x1 = Math.min(...boxes.map(b => b[0]));
            y1 = Math.min(...boxes.map(b => b[1]));
            x2 = Math.max(...boxes.map(b => b[2]));
            y2 = Math.max(...boxes.map(b => b[3]));
            margin = Math.max(...boxes.map(b => b[3] - b[1])) * 0.5; // room for hair and chin
        }
        let x = 0, y = 0, cw = w, ch = h;
        if (w / h > rw / rh) { // too wide: cut the sides
            cw = Math.min(w, Math.round(h * rw / rh));
            x = this._windowStart(w, cw, x1, x2, margin, 0.5);
        } else { // too tall: cut top and bottom, slightly above centre without faces
            ch = Math.min(h, Math.round(w * rh / rw));
            y = this._windowStart(h, ch, y1, y2, margin, 0.3);
        }
        let scale = Math.min(2, cw / rw);
        let out = pixbuf.new_subpixbuf(x, y, cw, ch)
            .scale_simple(Math.round(rw * scale), Math.round(rh * scale), GdkPixbuf.InterpType.BILINEAR);
        let [, buffer] = out.save_to_bufferv("jpeg", ["quality"], ["88"]);
        return new GLib.Bytes(buffer);
    }

    // ---- fetching -----------------------------------------------------------

    _startRefreshTimer() {
        if (this._refreshTimer) GLib.source_remove(this._refreshTimer);
        this._refreshTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, this.refresh_hours * 3600, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _scheduleFetch(seconds) {
        if (this._fetchTimer) GLib.source_remove(this._fetchTimer);
        this._fetchTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._fetchTimer = 0;
            this._fetch();
            return GLib.SOURCE_REMOVE;
        });
    }

    on_fetch_now() {
        this._fetch();
    }

    async _fetch() {
        if (this._fetching || !this._configured()) {
            this._showMessage();
            return;
        }
        this._fetching = true;
        this._showMessage();
        try {
            await this._download();
            this._message = "";
        } catch (e) {
            if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            this._message = e.message;
            global.logWarning(`${UUID}: ${e.message}`);
        } finally {
            this._fetching = false;
        }
        if (!this._removed) this._scan();
    }

    async _download() {
        let query = { size: this.count * 3, type: "IMAGE", withExif: true, ...(await this._searchFilter()) };
        let photos = await this._api("POST", "/search/random", query);
        if (!this.include_screenshots) // screenshots and saved images have no camera make
            photos = photos.filter(p => p.exifInfo && p.exifInfo.make);
        photos = photos.slice(0, this.count);
        if (!photos.length) throw new Error(_("No photos found."));

        await this._ensureDir();
        let sizeKey = `${this.width}x${this.height} faces=${this.smart_crop}`;
        let [existing, old] = await Promise.all([this._listPhotos(), this._readCaptions()]);
        let recrop = old._size != sizeKey;
        let captions = { _size: sizeKey };
        for (let p of photos) {
            let name = p.id + ".jpg";
            if (recrop || !existing.has(name)) {
                try {
                    let bytes = await this._api("GET", `/assets/${p.id}/thumbnail?size=preview`, null, true);
                    await this._write(name, await this._crop(bytes, p.id));
                } catch (e) {
                    if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) throw e;
                    continue;
                }
            }
            let exif = p.exifInfo || {};
            captions[name] = { date: (p.localDateTime || p.fileCreatedAt || "").slice(0, 10),
                city: exif.city || "", country: exif.country || "" };
        }
        if (Object.keys(captions).length == 1) throw new Error(_("No photos could be downloaded."));
        await this._write("captions.json", new GLib.Bytes(new TextEncoder().encode(JSON.stringify(captions))));
        for (let name of existing) // drop the previous batch only once the new one is in place
            if (!(name in captions))
                await asyncCall(this._dir.get_child(name), "delete_async", "delete_finish",
                    GLib.PRIORITY_LOW, this._cancellable).catch(() => {});
    }

    // ---- events -------------------------------------------------------------

    on_desklet_clicked(event) {
        if (event.get_button() == 1) {
            this._next();
        } else if (event.get_button() == 2 && this._current) {
            let url = `${this._serverUrl()}/photos/${this._current.replace(/\.jpg$/, "")}`;
            Gio.AppInfo.launch_default_for_uri_async(url, null, null, null);
        }
    }

    on_desklet_removed() {
        this._removed = true;
        this._cancellable.cancel();
        this._session.abort();
        this._stopSlides();
        for (let t of [this._refreshTimer, this._fetchTimer])
            if (t) GLib.source_remove(t);
        this._refreshTimer = this._fetchTimer = 0;
    }
}

function main(metadata, id) {
    return new ImmichWidget(metadata, id);
}
