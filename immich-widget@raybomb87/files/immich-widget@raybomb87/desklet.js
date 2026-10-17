const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Soup = imports.gi.Soup;
const Gettext = imports.gettext;

const UUID = "immich-widget@raybomb87";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

function ngettext(one, many, n) {
    return Gettext.dngettext(UUID, one, many, n);
}

const FETCH_KEYS = ["server-url", "api-key", "people", "albums", "tags", "on-this-day", "favorites", "min-rating",
    "period", "year-from", "year-to", "places", "query", "include-screenshots", "smart-crop", "count"];
const CAPTION_KEYS = ["caption", "show-date", "date-format", "show-years-ago", "show-place", "place", "show-names",
    "show-description", "caption-position", "caption-size", "caption-shadow", "caption-bg", "caption-bg-opacity",
    "caption-bg-radius"];
const LOOK_KEYS = ["delay", "radius"];
const SIZE_KEYS = ["width", "height"];
const TRANSITIONS = ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "flip"];
const OTHER_KEYS = ["ken-burns", "trans-order", "fade", "hidden-photos",
    ...TRANSITIONS.map(t => "t-" + t)];

// English country names Immich may use that differ from ICU's.
const COUNTRY_ALIASES = { "United States of America": "US", "Russian Federation": "RU", "Turkey": "TR",
    "Czech Republic": "CZ", "Korea, Republic of": "KR", "Viet Nam": "VN", "Macedonia": "MK" };

// Masks the whole frame to rounded corners, so sliding and zooming photos stay inside them.
const ROUND_SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;
void main() {
    vec2 p = cogl_tex_coord_in[0].xy * vec2(width, height);
    vec2 c = clamp(p, vec2(radius), vec2(width, height) - vec2(radius));
    float a = clamp(radius + 0.5 - distance(p, c), 0.0, 1.0);
    cogl_color_out = texture2D(tex, cogl_tex_coord_in[0].st) * a;
}`;

function uniform(type, value) {
    let v = new GObject.Value();
    v.init(type);
    if (type == GObject.TYPE_INT) v.set_int(value);
    else v.set_float(value);
    return v;
}

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

function cancelled(e) {
    return e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function ticked(rows) {
    return (rows || []).filter(r => r.use).map(r => r.name);
}

class ImmichWidget extends Desklet.Desklet {
    constructor(metadata, id) {
        super(metadata, id);
        this._dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, String(id)]));
        this._session = new Soup.Session({ timeout: 30 });
        this._cancellable = new Gio.Cancellable();

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, id);
        let bind = (key, cb) => this.settings.bind(key, key.replace(/-/g, "_"), cb);
        FETCH_KEYS.forEach(k => bind(k, () => { this._updatePermissions(); this._scheduleFetch(2); }));
        CAPTION_KEYS.forEach(k => bind(k, () => { this._updatePermissions(); this._styleCaption(); this._updateCaption(); }));
        LOOK_KEYS.forEach(k => bind(k, () => this._build()));
        SIZE_KEYS.forEach(k => bind(k, () => { this._build(); this._scheduleFetch(2); }));
        OTHER_KEYS.forEach(k => bind(k, () => this._updatePermissions()));
        this.settings.bind("refresh-hours", "refresh_hours", () => this._startRefreshTimer());

        this._photos = [];
        this._captions = {};
        this._index = 0;
        this._transIndex = 0;
        this._slideTimer = 0;
        this._refreshTimer = 0;
        this._fetchTimer = 0;
        this._midnightTimer = 0;
        this._fetching = false;
        this._removed = false;
        this._message = "";

        this._buildMenu();
        this._build();
        this._updatePermissions();
        this._startRefreshTimer();
        this._startMidnightTimer();
        // wait a little after login so the network is up; cached photos show meanwhile
        this._scheduleFetch(15);
    }

    // ---- layout -------------------------------------------------------------

    _build() {
        this._stopSlides();
        let size = `width: ${this.width}px; height: ${this.height}px;`;
        this._box = new St.Widget({
            style_class: "immich-widget", style: size + ` border-radius: ${this.radius}px;`,
            layout_manager: new Clutter.BinLayout(), reactive: true, track_hover: true, clip_to_allocation: true });
        this._rounded = this._roundCorners();
        this._layerStyle = size + (this._rounded ? "" : ` border-radius: ${this.radius}px;`);
        this._layers = [0, 1].map(() => {
            let layer = new St.Widget({ style: this._layerStyle, opacity: 0 });
            this._box.add_child(layer);
            return layer;
        });
        this._active = 0;
        this._caption = new St.Label({ style_class: "immich-widget-caption", x_expand: true, y_expand: true });
        this._box.add_child(this._caption);
        this._styleCaption();
        this._messageLabel = new St.Label({
            style_class: "immich-widget-message",
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true });
        this._messageLabel.clutter_text.line_wrap = true;
        this._box.add_child(this._messageLabel);
        this.setContent(this._box);
        this._scan();
    }

    _roundCorners() {
        if (this.radius <= 0) return true;
        try {
            let effect = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
            effect.set_shader_source(ROUND_SHADER);
            effect.set_uniform_value("tex", uniform(GObject.TYPE_INT, 0));
            effect.set_uniform_value("width", uniform(GObject.TYPE_FLOAT, this.width));
            effect.set_uniform_value("height", uniform(GObject.TYPE_FLOAT, this.height));
            effect.set_uniform_value("radius", uniform(GObject.TYPE_FLOAT, Math.min(this.radius, this.width / 2, this.height / 2)));
            this._box.add_effect(effect);
            return true;
        } catch (e) {
            global.logWarning(`${UUID}: rounded corners per photo only: ${e.message}`);
            return false;
        }
    }

    _styleCaption() {
        if (!this._caption) return;
        let [v, h] = this.caption_position.split("-");
        let align = { left: Clutter.ActorAlign.START, center: Clutter.ActorAlign.CENTER, right: Clutter.ActorAlign.END };
        this._caption.x_align = align[h] || Clutter.ActorAlign.START;
        this._caption.y_align = v == "top" ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
        let style = `font-size: ${this.caption_size}pt; text-align: ${h || "left"};`;
        if (!this.caption_shadow) style += " text-shadow: none;";
        if (this.caption_bg)
            style += ` background-color: rgba(0, 0, 0, ${this.caption_bg_opacity / 100});` +
                ` border-radius: ${this.caption_bg_radius}px; padding: 4px 10px;`;
        this._caption.style = style + ` margin: 10px ${this.caption_bg ? 10 : 14}px;`;
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

    // ---- menu ---------------------------------------------------------------

    _buildMenu() {
        this._favItem = new PopupMenu.PopupMenuItem(_("Mark as favorite"));
        this._favItem.connect("activate", () => this._toggleFavorite());
        this._hideItem = new PopupMenu.PopupMenuItem(_("Don't show this photo again"));
        this._hideItem.connect("activate", () => this._hideCurrent());
        this._menu.addMenuItem(this._favItem, 0);
        this._menu.addMenuItem(this._hideItem, 1);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 2);
        this._updateMenu();
    }

    _updateMenu() {
        let c = this._current && this._captions[this._current];
        this._favItem.label.text = c && c.favorite ? _("Remove from favorites") : _("Mark as favorite");
        this._favItem.setSensitive(!!c);
        this._hideItem.setSensitive(!!this._current);
    }

    async _toggleFavorite() {
        let name = this._current, c = name && this._captions[name];
        if (!c) return;
        try {
            await this._api("PUT", "/assets/" + name.replace(/\.jpg$/, ""), { isFavorite: !c.favorite });
            c.favorite = !c.favorite;
            this._updateMenu();
        } catch (e) {
            if (!cancelled(e)) Main.notify(_("Immich Widget"), e.message);
        }
    }

    _hideCurrent() {
        let name = this._current;
        if (!name) return;
        this.settings.setValue("hidden-photos", [...this.hidden_photos, name.replace(/\.jpg$/, "")]);
        this._photos = this._photos.filter(p => p != name);
        this._dir.get_child(name).delete_async(GLib.PRIORITY_LOW, null, () => {});
        this._index = Math.max(0, this._index - 1);
        this._current = null;
        this._next();
    }

    // ---- permissions --------------------------------------------------------

    // One line per group (album, asset, face, ...), in alphabetical order.
    _neededPermissions() {
        let needed = ["asset.read", "asset.view", "asset.update"];
        if (this._needFaces()) needed.push("face.read");
        // a fetched list means the lists are in use, so keep the key able to fetch and count them
        if ((this.people || []).length) needed.push("person.read", "asset.statistics");
        if ((this.albums || []).length) needed.push("album.read");
        if ((this.tags || []).length) needed.push("tag.read", "asset.statistics");
        if (this.on_this_day) needed.push("memory.read");
        let groups = new Map();
        for (let p of [...new Set(needed)].sort()) {
            let group = p.split(".")[0];
            groups.set(group, [...(groups.get(group) || []), p]);
        }
        return [...groups.values()].map(g => g.join(", ")).join("\n");
    }

    _updatePermissions() {
        let text = this._neededPermissions();
        if (this.settings.getValue("permissions") != text)
            this.settings.setValue("permissions", text);
    }

    _needFaces() {
        return this.smart_crop || this.ken_burns || (this.caption && this.show_names);
    }

    on_open_keys() {
        if (this.server_url.trim())
            Gio.AppInfo.launch_default_for_uri_async(this._serverUrl() + "/user-settings?isOpen=api-keys", null, null, null);
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
        this._photos = shuffle([...photos]);
        this._captions = captions;
        this._index = 0;
        this._showMessage();
        this._stopSlides();
        if (!this._photos.length) return;
        this._next(true);
        this._slideTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.delay, () => {
            if (!this._box.hover) this._next();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pickTransition() {
        let chosen = TRANSITIONS.filter(t => this["t_" + t.replace(/-/g, "_")]);
        if (!chosen.length) return "fade";
        if (this.trans_order == "in-turn")
            return chosen[this._transIndex++ % chosen.length];
        return chosen[Math.floor(Math.random() * chosen.length)];
    }

    _next(first = false) {
        if (!this._photos.length) {
            this._current = null;
            this._layers.forEach(l => l.opacity = 0);
            this._updateCaption();
            this._showMessage();
            return;
        }
        let name = this._photos[this._index++ % this._photos.length];
        this._current = name;
        let incoming = this._layers[1 - this._active], outgoing = this._layers[this._active];
        for (let layer of this._layers) layer.remove_all_transitions();
        incoming.style = this._layerStyle +
            ` background-image: url("${this._dir.get_child(name).get_uri()}"); background-size: cover;`;
        Object.assign(incoming, { translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1, rotation_angle_y: 0 });
        incoming.set_pivot_point(0.5, 0.5);
        this._box.set_child_above_sibling(incoming, outgoing);
        this._box.set_child_above_sibling(this._caption, null);
        this._box.set_child_above_sibling(this._messageLabel, null);
        this._active = 1 - this._active;
        this._updateCaption();
        this._updateMenu();
        this._animate(first ? "fade" : this._pickTransition(), incoming, outgoing,
            () => this._kenBurns(incoming, this._captions[name] || {}));
    }

    _animate(kind, incoming, outgoing, done) {
        let duration = this.fade, w = this.width, h = this.height;
        let mode = Clutter.AnimationMode.EASE_IN_OUT_CUBIC;
        let hideOutgoing = () => { outgoing.opacity = 0; };
        if (duration <= 0) {
            incoming.opacity = 255;
            hideOutgoing();
            done();
            return;
        }
        let slide = { "slide-left": [w, 0], "slide-right": [-w, 0], "slide-up": [0, h], "slide-down": [0, -h] }[kind];
        if (slide) {
            Object.assign(incoming, { opacity: 255, translation_x: slide[0], translation_y: slide[1] });
            outgoing.ease({ translation_x: -slide[0], translation_y: -slide[1], duration, mode, onComplete: hideOutgoing });
            incoming.ease({ translation_x: 0, translation_y: 0, duration, mode, onComplete: done });
        } else if (kind == "zoom") {
            Object.assign(incoming, { opacity: 0, scale_x: 1.3, scale_y: 1.3 });
            outgoing.ease({ opacity: 0, duration, mode });
            incoming.ease({ opacity: 255, scale_x: 1, scale_y: 1, duration, mode, onComplete: done });
        } else if (kind == "flip") {
            Object.assign(incoming, { opacity: 0, rotation_angle_y: -90 });
            outgoing.ease({ rotation_angle_y: 90, duration: duration / 2, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    hideOutgoing();
                    incoming.opacity = 255;
                    incoming.ease({ rotation_angle_y: 0, duration: duration / 2,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: done });
                } });
        } else {
            incoming.ease({ opacity: 255, duration, mode, onComplete: done });
            outgoing.ease({ opacity: 0, duration, mode });
        }
    }

    // Slowly zooms towards the faces (or a random point) until the next photo.
    _kenBurns(layer, c) {
        if (!this.ken_burns || this._layers[this._active] !== layer) return;
        let fx = c.fx !== undefined ? c.fx : 0.3 + Math.random() * 0.4;
        let fy = c.fy !== undefined ? c.fy : 0.3 + Math.random() * 0.4;
        layer.set_pivot_point(fx, fy);
        layer.ease({ scale_x: 1.15, scale_y: 1.15, duration: (this.delay + 2) * 1000, mode: Clutter.AnimationMode.LINEAR });
    }

    _updateCaption() {
        if (!this._caption) return;
        let c = (this._current && this._captions[this._current]) || {};
        this._caption.text = this.caption ? this._captionFor(c) : "";
        this._caption.visible = this._caption.text != "";
    }

    _captionFor(c) {
        let first = [];
        let date = /^\d{4}-\d{2}-\d{2}$/.test(c.date || "") ? c.date.split("-").map(Number) : null;
        if (date && this.show_date && this.date_format) {
            let dt = GLib.DateTime.new_local(date[0], date[1], date[2], 12, 0, 0);
            if (dt) first.push(dt.format(this.date_format));
        }
        if (date && this.show_years_ago) {
            let now = GLib.DateTime.new_now_local();
            let years = now.get_year() - date[0];
            if (now.get_month() < date[1] || (now.get_month() == date[1] && now.get_day_of_month() < date[2])) years--;
            if (years > 0) first.push(ngettext("%d year ago", "%d years ago", years).format(years));
        }
        if (this.show_place) {
            let country = this._country(c.country);
            let place = this.place == "country" ? country :
                this.place == "city-country" && c.city && country ? `${c.city}, ${country}` : c.city;
            if (place) first.push(place);
        }
        let lines = [first.join(" · ")];
        if (this.show_names && c.names && c.names.length) lines.push(c.names.join(", "));
        if (this.show_description && c.description) lines.push(c.description);
        return lines.filter(l => l).join("\n");
    }

    // Immich names countries in English; show them in the desktop's language when ICU knows the name.
    _country(name) {
        if (!name) return "";
        if (!this._countries) {
            this._countries = new Map();
            this._englishCountries = new Map();
            try {
                let lang = GLib.get_language_names()[0].split(/[._@]/)[0].replace("_", "-");
                let en = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
                let local = new Intl.DisplayNames([lang, "en"], { type: "region", fallback: "none" });
                let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                for (let a of letters)
                    for (let b of letters) {
                        let english = en.of(a + b);
                        if (!english) continue;
                        this._countries.set(english.toLowerCase(), local.of(a + b) || english);
                        this._englishCountries.set((local.of(a + b) || english).toLowerCase(), english);
                    }
                for (let [alias, code] of Object.entries(COUNTRY_ALIASES))
                    this._countries.set(alias.toLowerCase(), local.of(code) || alias);
            } catch (e) {
                global.logWarning(`${UUID}: country names stay in English: ${e.message}`);
            }
        }
        return this._countries.get(name.toLowerCase()) || name;
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
            if (cancelled(e)) throw e;
            throw new Error(_("Cannot reach Immich: %s").format(e.message));
        }
        let status = message.get_status();
        if (status != Soup.Status.OK) {
            if (status == Soup.Status.UNAUTHORIZED) throw new Error(_("Immich rejected the API key."));
            let detail = "";
            try {
                detail = JSON.parse(new TextDecoder().decode(bytes.get_data())).message || "";
            } catch (e) { }
            if (status == Soup.Status.FORBIDDEN) {
                let permission = (/permission:?\s*([\w.]+)/i.exec(detail) || [])[1];
                throw new Error(_("The API key is missing the permission %s.").format(permission || detail));
            }
            throw new Error(_("Immich: %s").format(detail || status));
        }
        return raw ? bytes : JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _allPeople() {
        let people = [];
        for (let page = 1; page < 50; page++) {
            let res = await this._api("GET", `/people?withHidden=false&size=500&page=${page}`);
            people.push(...res.people);
            if (!res.hasNextPage) break;
        }
        return people.filter(p => p.name && p.name.trim());
    }

    // Looks up the ids of the ticked names; throws when none of them exist any more.
    async _ids(rows, list, nameOf, what) {
        let names = ticked(rows);
        if (!names.length) return null;
        let wanted = new Set(names.map(n => n.trim().toLowerCase()));
        let ids = (await list()).filter(x => wanted.has(nameOf(x).trim().toLowerCase())).map(x => x.id);
        if (!ids.length) throw new Error(_("Not found in Immich: %s").format(`${what} ${names.join(", ")}`));
        return ids;
    }

    async _searchFilter() {
        let filter = { type: { eq: "IMAGE" }, visibility: { eq: "timeline" } };
        let people = await this._ids(this.people, () => this._allPeople(), p => p.name, _("people"));
        if (people) filter.personIds = { any: people };
        let albums = await this._ids(this.albums, () => this._api("GET", "/albums"), a => a.albumName, _("albums"));
        if (albums) filter.albumIds = { any: albums };
        let tags = await this._ids(this.tags, () => this._api("GET", "/tags"), t => t.value, _("tags"));
        if (tags) filter.tagIds = { any: tags };
        if (this.favorites) filter.isFavorite = { eq: true };
        if (this.min_rating > 0) filter.rating = { gte: this.min_rating };
        let now = GLib.DateTime.new_now_utc();
        let from = { "last-year": now.add_years(-1), "last-5-years": now.add_years(-5),
            "years": GLib.DateTime.new_utc(this.year_from, 1, 1, 0, 0, 0) }[this.period];
        if (from) {
            filter.takenAt = { gte: from.format_iso8601() };
            if (this.period == "years")
                filter.takenAt.lte = GLib.DateTime.new_utc(this.year_to, 12, 31, 23, 59, 59).format_iso8601();
        }
        this._country("x"); // fills the country name maps
        let places = this.places.split(",").map(p => p.trim()).filter(p => p);
        places = [...new Set(places.flatMap(p => [p, this._englishCountries.get(p.toLowerCase()) || p]))];
        if (places.length) filter.or = [{ city: { in: places } }, { country: { in: places } }];
        if (!this.include_screenshots) filter.make = { ne: null }; // screenshots have no camera make
        return filter;
    }

    async _onThisDay() {
        let today = GLib.DateTime.new_now_local().format("%Y-%m-%d");
        let memories = await this._api("GET", `/memories?for=${today}&type=on_this_day`);
        let photos = [];
        for (let m of memories)
            for (let a of m.assets || [])
                if (a.type == "IMAGE" && (this.include_screenshots || !a.exifInfo || a.exifInfo.make))
                    photos.push(a);
        return photos;
    }

    async _findPhotos() {
        let hidden = new Set(this.hidden_photos);
        let keep = photos => photos.filter(p => !hidden.has(p.id));
        if (this.on_this_day) {
            let photos = keep(await this._onThisDay());
            if (photos.length) return shuffle(photos).slice(0, this.count);
        }
        let filter = await this._searchFilter();
        let size = Math.min(1000, this.count * 2 + hidden.size);
        let photos;
        if (this.query.trim()) {
            let res = await this._api("POST", "/search/smart",
                { query: this.query.trim(), size: Math.max(size, 100), withExif: true, filter });
            photos = shuffle(res.assets.items);
        } else {
            photos = await this._api("POST", "/search/random", { size, withExif: true, filter });
        }
        return keep(photos).slice(0, this.count);
    }

    // Face boxes scaled to (w, h) plus the names of the people; empty when unknown or the key lacks face.read.
    async _faces(id, w, h) {
        try {
            let faces = await this._api("GET", "/faces?id=" + id);
            let names = [];
            for (let f of faces) {
                let p = f.person;
                if (p && p.name && !p.isHidden && !names.includes(p.name)) names.push(p.name);
            }
            let boxes = faces.map(f => {
                let sx = w / f.imageWidth, sy = h / f.imageHeight;
                return [f.boundingBoxX1 * sx, f.boundingBoxY1 * sy, f.boundingBoxX2 * sx, f.boundingBoxY2 * sy];
            });
            return { boxes, names };
        } catch (e) {
            if (cancelled(e)) throw e;
            return { boxes: [], names: [] };
        }
    }

    on_fetch_lists() {
        this._fetchLists();
    }

    // Rows with the number of photos of each person or tag; the count is left empty without asset.statistics.
    async _withCounts(items, nameOf, idsKey) {
        let rows = [], counting = true;
        for (let item of items) {
            let count = "";
            if (counting) {
                try {
                    let filter = { type: { eq: "IMAGE" }, visibility: { eq: "timeline" }, [idsKey]: { any: [item.id] } };
                    count = String((await this._api("POST", "/search/statistics", { filter })).total);
                } catch (e) {
                    if (cancelled(e)) throw e;
                    counting = false; // most likely the key lacks asset.statistics: skip the rest
                }
            }
            rows.push({ name: nameOf(item), count });
        }
        return rows;
    }

    async _fetchLists() {
        if (!this._configured()) return;
        // items are names, or rows with a name and extra columns (such as the album's photo count)
        let merge = (key, items) => {
            let use = new Set(ticked(this.settings.getValue(key)));
            let rows = new Map();
            for (let item of items) {
                let row = typeof item == "string" ? { name: item } : item;
                if (!rows.has(row.name)) rows.set(row.name, { use: use.has(row.name), ...row });
            }
            let sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
            this.settings.setValue(key, sorted);
            return sorted.length;
        };
        let lists = [
            ["people", async () => this._withCounts(await this._allPeople(), p => p.name, "personIds"), _("%d people")],
            ["albums", async () => (await this._api("GET", "/albums"))
                .map(a => ({ name: a.albumName, count: String(a.assetCount) })), _("%d albums")],
            ["tags", async () => this._withCounts(await this._api("GET", "/tags"), t => t.value, "tagIds"), _("%d tags")],
        ];
        let found = [], problems = [];
        for (let [key, get, label] of lists) {
            try {
                found.push(label.format(merge(key, await get())));
            } catch (e) {
                if (cancelled(e)) return;
                problems.push(e.message);
            }
        }
        this._updatePermissions();
        Main.notify(_("Immich Widget"), [found.length ? _("Fetched %s.").format(found.join(", ")) : "", ...problems]
            .filter(t => t).join("\n"));
    }

    // ---- cropping -----------------------------------------------------------

    // Start of a `window` within `length` that keeps [low, high] in view if possible.
    // When the faces do not fit, `focus` (0..1) picks the part of them to keep, e.g. the eyes.
    _windowStart(length, window, low, high, margin, noFaceBias, focus) {
        let start;
        if (low === null)
            start = (length - window) * noFaceBias;
        else if (high - low + 2 * margin <= window)
            start = Math.min(Math.max((low + high) / 2 - window / 2, high + margin - window), low - margin);
        else if (high - low <= window) // fits, but without the full margin
            start = (low + high) / 2 - window / 2;
        else // close-up or a tall group: keep the eyes rather than the top of the heads
            start = low + (high - low) * focus - window / 2;
        return Math.round(Math.max(0, Math.min(start, length - window)));
    }

    // Returns the cropped JPEG plus the names and the centre of the faces in it (0..1).
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
        let { boxes, names } = this._needFaces() ? await this._faces(id, w, h) : { boxes: [], names: [] };
        let x1 = null, y1 = null, x2 = null, y2 = null, margin = 0;
        if (boxes.length) {
            x1 = Math.min(...boxes.map(b => b[0]));
            y1 = Math.min(...boxes.map(b => b[1]));
            x2 = Math.max(...boxes.map(b => b[2]));
            y2 = Math.max(...boxes.map(b => b[3]));
            margin = Math.max(...boxes.map(b => b[3] - b[1])) * 0.5; // room for hair and chin
        }
        let x = 0, y = 0, cw = w, ch = h;
        let crop = this.smart_crop && boxes.length;
        if (w / h > rw / rh) { // too wide: cut the sides
            cw = Math.min(w, Math.round(h * rw / rh));
            x = this._windowStart(w, cw, crop ? x1 : null, x2, margin, 0.5, 0.5);
        } else { // too tall: cut top and bottom, slightly above centre without faces
            ch = Math.min(h, Math.round(w * rh / rw));
            y = this._windowStart(h, ch, crop ? y1 : null, y2, margin, 0.3, 0.4);
        }
        let scale = Math.min(2, cw / rw);
        let out = pixbuf.new_subpixbuf(x, y, cw, ch)
            .scale_simple(Math.round(rw * scale), Math.round(rh * scale), GdkPixbuf.InterpType.BILINEAR);
        let [, buffer] = out.save_to_bufferv("jpeg", ["quality"], ["88"]);
        let focus = {};
        if (boxes.length) {
            let clamp = v => Math.max(0, Math.min(1, v));
            focus = { fx: clamp(((x1 + x2) / 2 - x) / cw), fy: clamp(((y1 + y2) / 2 - y) / ch) };
        }
        return { bytes: new GLib.Bytes(buffer), names, ...focus };
    }

    // ---- fetching -----------------------------------------------------------

    _startRefreshTimer() {
        if (this._refreshTimer) GLib.source_remove(this._refreshTimer);
        this._refreshTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, this.refresh_hours * 3600, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // "On this day" changes at midnight, so fetch again a few minutes after it.
    _startMidnightTimer() {
        let now = GLib.DateTime.new_now_local();
        let next = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 5, 0).add_days(1);
        let seconds = Math.max(60, Math.round(next.difference(now) / 1000000));
        this._midnightTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._midnightTimer = 0;
            if (this.on_this_day) this._fetch();
            this._startMidnightTimer();
            return GLib.SOURCE_REMOVE;
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
            if (cancelled(e)) return;
            this._message = e.message;
            global.logWarning(`${UUID}: ${e.message}`);
        } finally {
            this._fetching = false;
        }
        if (!this._removed) this._scan();
    }

    async _download() {
        let photos = await this._findPhotos();
        if (!photos.length) throw new Error(_("No photos found."));

        await this._ensureDir();
        let sizeKey = `${this.width}x${this.height} crop=${this.smart_crop} faces=${this._needFaces()}`;
        let [existing, old] = await Promise.all([this._listPhotos(), this._readCaptions()]);
        let recrop = old._size != sizeKey;
        let captions = { _size: sizeKey };
        for (let p of photos) {
            let name = p.id + ".jpg";
            let extra = old[name] || {};
            if (recrop || !existing.has(name)) {
                try {
                    let bytes = await this._api("GET", `/assets/${p.id}/thumbnail?size=preview`, null, true);
                    let cropped = await this._crop(bytes, p.id);
                    await this._write(name, cropped.bytes);
                    extra = { names: cropped.names, fx: cropped.fx, fy: cropped.fy };
                } catch (e) {
                    if (cancelled(e)) throw e;
                    continue;
                }
            }
            let exif = p.exifInfo || {};
            captions[name] = { date: (p.localDateTime || p.fileCreatedAt || "").slice(0, 10),
                city: exif.city || "", country: exif.country || "", description: (exif.description || "").trim(),
                favorite: !!p.isFavorite, names: extra.names || [], fx: extra.fx, fy: extra.fy };
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
        for (let t of [this._refreshTimer, this._fetchTimer, this._midnightTimer])
            if (t) GLib.source_remove(t);
        this._refreshTimer = this._fetchTimer = this._midnightTimer = 0;
    }
}

function main(metadata, id) {
    return new ImmichWidget(metadata, id);
}
