// -*- mode: js; indent-tabs-mode: nil; js-indent-level: 4 -*-
//
// Arena.ai Leaderboard – Cinnamon Desklet
//
// Zeigt das aktuelle Leaderboard von arena.ai auf dem Desktop an.
//
// Datenquelle: offizieller Leaderboard-Datensatz von Arena (Hugging Face,
// Repo "lmarena-ai/leaderboard-dataset"), abrufbar über die öffentliche
// Datasets-Server-API. Die Website arena.ai selbst ist durch Cloudflare
// geschützt (HTTP 403 für alle Nicht-Browser-Clients) und wird daher
// bewusst nicht gescrapt.

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;
const Main = imports.ui.main;

const UUID = "arena-leaderboard@bienwaldcoder";
const _ = Gettext.domain(UUID).gettext;

const LEADERBOARD_URL = "https://arena.ai/leaderboard";
const DEFAULT_API_HOST = "https://datasets-server.huggingface.co";
const DEFAULT_DATASET = "lmarena-ai/leaderboard-dataset";
const CACHE_VERSION = 1;
const MAX_LIMIT = 100;          // Maximum der Datasets-Server-API pro Anfrage
const REFRESH_DEBOUNCE = 30;     // Sekunden, verhindert Doppel-Requests
const REQUEST_TIMEOUT = 25;       // Sekunden pro Anfrage

// Unterstützte Boards: id -> Konfiguration des Hugging-Face-Datensatzes
const BOARDS = [
    {id: "text",          config: "text",          label: "Text",         kind: "rating", gh: "text"},
    {id: "webdev",        config: "webdev",        label: "WebDev",       kind: "rating", gh: "code"},
    {id: "agent",         config: "agent",         label: "Agent",        kind: "score",  gh: "agent"},
    {id: "vision",        config: "vision",        label: "Vision",       kind: "rating", gh: "vision"},
    {id: "document",      config: "document",      label: "Document",     kind: "rating", gh: "document"},
    {id: "search",        config: "search",        label: "Search",       kind: "rating", gh: "search"},
    {id: "text_to_image", config: "text_to_image", label: "Text → Image", kind: "rating", gh: "text-to-image"},
    {id: "image_edit",    config: "image_edit",    label: "Image Edit",   kind: "rating", gh: "image-edit"},
    {id: "text_to_video", config: "text_to_video", label: "Text → Video", kind: "rating", gh: "text-to-video"},
    {id: "image_to_video",config: "image_to_video",label: "Image → Video",kind: "rating", gh: "image-to-video"},
    {id: "video_edit",    config: "video_edit",    label: "Video Edit",   kind: "rating", gh: "video-edit"}
];

// Konfiguration der Datenquellen
const DEFAULT_GITHUB_HOST = "https://raw.githubusercontent.com";
const DEFAULT_GITHUB_REPO = "oolong-tea-2026/arena-ai-leaderboards";

// >>> shared-helpers (wird unverändert in die interaktive Vorschau übernommen)
// Farben der Anbieter (Markenfarben, soweit bekannt). Unbekannte Anbieter
// bekommen eine stabile Farbe aus einem Hash ihrer Kennung.
const PROVIDER_COLORS = {
    anthropic: "#D97757",
    openai: "#10A37F",
    google: "#4285F4",
    meta: "#0866FF",
    xai: "#B9C2CC",
    deepseek: "#4D6BFE",
    alibaba: "#615CED",
    zai: "#8B5CF6",
    moonshot: "#14B8A6",
    mistral: "#FA520F",
    nvidia: "#76B900",
    minimax: "#E5484D",
    bytedance: "#3C8CFF",
    amazon: "#FF9900",
    tencent: "#00A3FF",
    baidu: "#2932E1",
    xiaomi: "#FF6900",
    stepfun: "#F59E0B",
    microsoft: "#00A4EF",
    cohere: "#39594D",
    ai21: "#E0245E",
    recraft: "#F472B6",
    ideogram: "#FF6B6B",
    "black-forest-labs": "#F5D90A",
    stability: "#A78BFA",
    kling: "#22D3EE",
    runway: "#0EA5E9",
    pika: "#EC4899",
    luma: "#FFB020"
};

const MEDALS = ["#FFC94D", "#A9B6C4", "#D08A54"];

const PROVIDER_LABELS = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    meta: "Meta",
    xai: "xAI",
    deepseek: "DeepSeek",
    alibaba: "Alibaba",
    zai: "Z.ai",
    moonshot: "Moonshot",
    mistral: "Mistral",
    nvidia: "NVIDIA",
    minimax: "MiniMax",
    bytedance: "ByteDance",
    amazon: "Amazon",
    tencent: "Tencent",
    baidu: "Baidu",
    xiaomi: "Xiaomi",
    stepfun: "StepFun"
};

// ---------------------------------------------------------------------------
// Reine Hilfsfunktionen (ohne UI, dadurch gut testbar)
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hex2(n) {
    let s = Math.round(clamp(n, 0, 255)).toString(16);
    return s.length < 2 ? "0" + s : s;
}

function hslToHex(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    s = s / 100;
    l = l / 100;
    let hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    let p = 2 * l - q;
    return "#" + hex2(hue2rgb(p, q, h + 1 / 3) * 255) +
                 hex2(hue2rgb(p, q, h) * 255) +
                 hex2(hue2rgb(p, q, h - 1 / 3) * 255);
}

function stringHash(text) {
    let h = 0;
    let s = String(text || "");
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) % 100003;
    }
    return h;
}

function providerColor(org) {
    let key = String(org || "").toLowerCase();
    if (PROVIDER_COLORS[key])
        return PROVIDER_COLORS[key];
    // Stabile, gut unterscheidbare Ersatzfarbe
    return hslToHex(stringHash(key) % 360, 58, 62);
}

function providerLabel(org) {
    let key = String(org || "").toLowerCase();
    if (PROVIDER_LABELS[key])
        return PROVIDER_LABELS[key];
    if (!key)
        return _("Unbekannt");
    return org;
}

function isOpenSource(license) {
    let l = String(license || "").toLowerCase();
    if (!l || l.indexOf("proprietar") === 0)
        return false;
    return true;
}

function formatVotes(votes) {
    if (votes === null || votes === undefined || isNaN(votes))
        return "";
    let v = Number(votes);
    if (v >= 1000000)
        return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + "M";
    if (v >= 1000)
        return Math.round(v / 1000) + "k";
    return String(Math.round(v));
}

function formatScore(kind, value) {
    if (typeof value !== "number" || !isFinite(value))
        return "–";
    if (kind === "score")
        return (value * 100).toFixed(2) + " %";
    return String(Math.round(value));
}

function buildRowsUrl(host, dataset, config, limit) {
    let base = String(host || DEFAULT_API_HOST).replace(/\/+$/, "");
    let count = clamp(Math.round(limit), 1, MAX_LIMIT);
    return base + "/rows" +
        "?dataset=" + encodeURIComponent(dataset || DEFAULT_DATASET) +
        "&config=" + encodeURIComponent(config) +
        "&split=latest&offset=0&length=" + count;
}

function rowToEntry(row, kind) {
    if (!row)
        return null;
    let isScore = kind === "score";
    let value = isScore ? row.score : row.rating;
    if (typeof value !== "number" || !isFinite(value))
        return null;

    let publish = row.leaderboard_publish_date || "";
    return {
        kind: kind,
        rank: (typeof row.rank === "number" && isFinite(row.rank)) ? row.rank : null,
        model: String(row.model_name || row.model || _("Unbekanntes Modell")),
        org: String(row.organization || ""),
        license: row.license ? String(row.license) : "",
        value: value,
        display: formatScore(kind, value),
        votes: isScore ? row.session_count : row.vote_count,
        ciLow: isScore ? row.score_ci_lower : row.rating_lower,
        ciHigh: isScore ? row.score_ci_upper : row.rating_upper,
        cost: isScore ? row.cost_per_task_p50 : null,
        published: String(publish)
    };
}

function parseLeaderboardResponse(text, kind, limit) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(_("Antwort ist kein gültiges JSON"));
    }

    if (!data || !Array.isArray(data.rows)) {
        let msg = data && (data.error || data.detail);
        throw new Error(msg ? String(msg) : _("Unerwartetes Format der API-Antwort"));
    }

    let entries = [];
    for (let i = 0; i < data.rows.length; i++) {
        let raw = data.rows[i] && data.rows[i].row ? data.rows[i].row : data.rows[i];
        let entry = rowToEntry(raw, kind);
        if (entry)
            entries.push(entry);
    }

    entries.sort(function (a, b) {
        let ra = a.rank === null ? 1e9 : a.rank;
        let rb = b.rank === null ? 1e9 : b.rank;
        return ra - rb;
    });

    if (limit > 0)
        entries = entries.slice(0, limit);

    for (let i = 0; i < entries.length; i++) {
        if (entries[i].rank === null)
            entries[i].rank = i + 1;
    }

    return {
        entries: entries,
        published: entries.length ? entries[0].published : "",
        total: typeof data.num_rows_total === "number" ? data.num_rows_total : entries.length
    };
}

function barFraction(value, min, max) {
    if (!isFinite(value))
        return 0;
    if (!isFinite(min) || !isFinite(max) || max <= min)
        return 1;
    return clamp((value - min) / (max - min), 0.04, 1);
}

// --- HTTP ---------------------------------------------------------------
//
// Cinnamon-Desklets bekommen über imports.gi.Soup je nach Distribution
// libsoup 2.4 ODER 3.0. Die APIs unterscheiden sich grundlegend:
//
//   2.4: session.queue_message()        + message.response_body.data
//   3.0: session.send_and_read_async()  (kein queue_message, kein response_body)
//
// createHttpFetcher() kapselt beide Varianten und bekommt die Module
// hineingereicht, damit die Logik ohne GJS testbar bleibt.

function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    let n = bytes.length;
    while (i < n) {
        let b = bytes[i++];
        if (b < 0x80) {
            out += String.fromCharCode(b);
        } else if (b >= 0xC0 && b < 0xE0 && i < n) {
            out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
        } else if (b >= 0xE0 && b < 0xF0 && i + 1 < n) {
            let b2 = bytes[i++];
            let b3 = bytes[i++];
            out += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
        } else if (b >= 0xF0 && i + 2 < n) {
            let b2 = bytes[i++];
            let b3 = bytes[i++];
            let b4 = bytes[i++];
            let cp = ((b & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
            cp -= 0x10000;
            out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        } else {
            out += "\uFFFD";
        }
    }
    return out;
}

function bytesToText(value) {
    // akzeptiert String, Uint8Array/ByteArray, GLib.Bytes und {data: ...}
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string")
        return value;

    if (typeof value === "object") {
        if (typeof value.get_data === "function") {
            try {
                return bytesToText(value.get_data());
            } catch (e) {
                // weiter unten weiterprobieren
            }
        }
        if (typeof value.to_array === "function") {
            try {
                return bytesToText(value.to_array());
            } catch (e) {
                // weiter unten weiterprobieren
            }
        }
        if (value.data !== undefined && value.data !== value)
            return bytesToText(value.data);
    }

    if (typeof value.length === "number" && typeof value !== "function")
        return utf8Decode(value);

    return String(value);
}

function createHttpFetcher(SoupLib, GLibLib) {
    if (!SoupLib || typeof SoupLib.Session !== "function")
        throw new Error("libsoup ist nicht verfügbar");

    let session = new SoupLib.Session();
    let useQueue = typeof session.queue_message === "function";
    let major = (typeof SoupLib.MAJOR_VERSION === "number")
        ? SoupLib.MAJOR_VERSION
        : (useQueue ? 2 : 3);

    function fetch(url, callback) {
        let finished = false;
        let message = null;
        let cancellable = null;

        function done(error, status, text) {
            if (finished)
                return;
            finished = true;
            callback(error || null, {
                status: status || 0,
                text: (text === undefined) ? null : text
            });
        }

        try {
            message = SoupLib.Message.new("GET", url);
        } catch (e) {
            done(e);
            return {cancel: function () {}};
        }
        if (!message) {
            done(new Error("Ungültige URL: " + url));
            return {cancel: function () {}};
        }

        try {
            let headers = message.request_headers ||
                          (typeof message.get_request_headers === "function"
                              ? message.get_request_headers() : null);
            if (headers && typeof headers.append === "function") {
                headers.append("Accept", "application/json");
                headers.append("User-Agent", "Cinnamon-ArenaLeaderboardDesklet/1.1");
            }
        } catch (e) {
            // Header sind optional
        }

        let handle = {
            cancel: function () {
                if (finished)
                    return;
                finished = true;
                try {
                    if (cancellable)
                        cancellable.cancel();
                    else if (typeof session.cancel_message === "function")
                        session.cancel_message(message, 1);
                } catch (e) {
                    // bereits abgeschlossen
                }
            }
        };

        try {
            if (useQueue) {
                // libsoup 2.x
                session.queue_message(message, function (sess, msg) {
                    let status = msg ? msg.status_code : 0;
                    let text = null;
                    try {
                        text = bytesToText(msg && msg.response_body ? msg.response_body.data : null);
                    } catch (e) {
                        text = null;
                    }
                    done(null, status, text);
                });
            } else {
                // libsoup 3.x
                if (GLibLib && typeof GLibLib.Cancellable === "function")
                    cancellable = new GLibLib.Cancellable();

                session.send_and_read_async(message, 0, cancellable, function (sess, res) {
                    let bytes = null;
                    try {
                        bytes = sess.send_and_read_finish(res);
                    } catch (e) {
                        done(e);
                        return;
                    }
                    done(null, message.status_code, bytesToText(bytes));
                });
            }
        } catch (e) {
            done(e);
        }

        return handle;
    }

    return {
        fetch: fetch,
        version: major,
        backend: useQueue ? "libsoup " + major + " (queue_message)"
                          : "libsoup " + major + " (send_and_read_async)"
    };
}

// --- Zweite Quelle: tägliche JSON-Snapshots -----------------------------
//
// Das Projekt "oolong-tea-2026/arena-ai-leaderboards" veröffentlicht tägliche
// Snapshots aller Arena-Boards als JSON auf GitHub (MIT-Lizenz):
//
//   data/latest.json            -> {"date": "2026-09-15", "path": "2026-09-15"}
//   data/<datum>/<board>.json   -> {"meta": {...}, "models": [...]}
//
// Schema je Modell: {rank, model, vendor, license, score, ci, votes}
// Agent-Boards haben statt "score" eine Liste "scores": [{name, score, ci}]

function isoDateOffset(days) {
    let now = new Date();
    now.setUTCDate(now.getUTCDate() - days);
    return now.toISOString().slice(0, 10);
}

function buildGithubLatestUrl(host, repo) {
    let base = String(host || DEFAULT_GITHUB_HOST).replace(/\/+$/, "");
    return base + "/" + (repo || DEFAULT_GITHUB_REPO) + "/main/data/latest.json";
}

function buildGithubBoardUrl(host, repo, date, file) {
    let base = String(host || DEFAULT_GITHUB_HOST).replace(/\/+$/, "");
    return base + "/" + (repo || DEFAULT_GITHUB_REPO) + "/main/data/" +
           encodeURIComponent(date) + "/" + encodeURIComponent(file) + ".json";
}

function githubSnapshotDates(startDate, daysBack) {
    // liefert Datumsstrings, beginnend bei startDate (YYYY-MM-DD) rückwärts
    let dates = [];
    let base = new Date(startDate + "T00:00:00Z");
    if (isNaN(base.getTime()))
        return dates;
    for (let i = 0; i <= daysBack; i++) {
        let d = new Date(base.getTime());
        d.setUTCDate(d.getUTCDate() - i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

function parseGithubLeaderboard(text, kind, limit, date) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(_("Antwort ist kein gültiges JSON"));
    }

    if (!data || !Array.isArray(data.models))
        throw new Error(_("Unerwartetes Format der Snapshot-Antwort"));

    let entries = [];
    for (let i = 0; i < data.models.length; i++) {
        let model = data.models[i];
        if (!model)
            continue;

        let value = model.score;
        let ci = (typeof model.ci === "number") ? model.ci : null;

        if (Array.isArray(model.scores) && model.scores.length) {
            // Agent-Boards: bevorzugt "Confirmed Success", sonst erster Wert
            let chosen = model.scores[0];
            for (let j = 0; j < model.scores.length; j++) {
                if (/confirmed\s+success/i.test(model.scores[j].name || "")) {
                    chosen = model.scores[j];
                    break;
                }
            }
            value = chosen.score;
            if (typeof chosen.ci === "number")
                ci = chosen.ci;
        }

        // Prozentwerte auf 0..1 normieren – Konfidenzintervall im gleichen Maß
        if (kind === "score" && typeof value === "number" && value > 1) {
            value = value / 100;
            if (ci !== null)
                ci = ci / 100;
        }

        if (typeof value !== "number" || !isFinite(value))
            continue;

        let display;
        if (kind === "score")
            display = (value * 100).toFixed(2) + " %";
        else
            display = String(Math.round(value));

        entries.push({
            kind: kind,
            rank: (typeof model.rank === "number") ? model.rank : null,
            model: String(model.model || _("Unbekanntes Modell")),
            org: String(model.vendor || "").toLowerCase().replace(/\s+/g, "-"),
            license: model.license ? String(model.license) : "",
            value: value,
            display: display,
            votes: (typeof model.votes === "number") ? model.votes : null,
            ciLow: ci === null ? null : value - ci,
            ciHigh: ci === null ? null : value + ci,
            cost: null,
            published: date || ""
        });
    }

    entries.sort(function (a, b) {
        let ra = a.rank === null ? 1e9 : a.rank;
        let rb = b.rank === null ? 1e9 : b.rank;
        return ra - rb;
    });

    if (limit > 0)
        entries = entries.slice(0, limit);

    for (let i = 0; i < entries.length; i++) {
        if (entries[i].rank === null)
            entries[i].rank = i + 1;
    }

    return {
        entries: entries,
        published: entries.length ? (entries[0].published || date || "") : (date || ""),
        total: entries.length
    };
}

// <<< shared-helpers

function expandHome(path) {
    let p = String(path || "").trim();
    if (!p)
        return "";
    if (p === "~")
        return GLib.get_home_dir();
    if (p.indexOf("~/") === 0)
        return GLib.get_home_dir() + p.substring(1);
    return p;
}

function formatTimestamp(unixSeconds) {
    if (!unixSeconds)
        return "";
    try {
        let dt = GLib.DateTime.new_from_unix_local(Math.round(unixSeconds));
        return dt.format("%d.%m. %H:%M");
    } catch (e) {
        return "";
    }
}

// ---------------------------------------------------------------------------
// Desklet
// ---------------------------------------------------------------------------

class ArenaLeaderboardDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._metadata = metadata;
        this._bindingKeys = [];
        this._fetcher = null;
        this._fetcherError = "";
        this._fetchHandle = null;
        this._forceCurl = false;
        this._lastUrl = "";
        this._lastStatus = 0;
        this._reqSeq = 0;
        this._timeoutId = 0;
        this._tooltips = [];
        this._payload = null;
        this._status = "loading";      // "loading" | "ok" | "error"
        this._errorText = "";
        this._fetchedAt = 0;
        this._fetchedForBoard = "";
        this._lastFetchAt = 0;
        this._usedBoard = "";
        this._usedHost = "";
        this._usedDataset = "";
        this._usedForceCurl = false;
        this._usedSource = "";
        this._usedGithubRepo = "";
        this._lastSourceLabel = "";
        this._lastGoodSource = "";
        this._bundledLoaded = false;
        this._requestTimer = 0;
        this._cacheData = null;

        this._initSettings();
        this._initUi();
        this._addMenuItems();
        this._applySettings(false);
        this._loadCache();
        this._restartTimer();
        this._refresh(true);
    }

    // -- Einstellungen ------------------------------------------------------

    _initSettings() {
        this._settings = new Settings.DeskletSettings(this, UUID, this.instance_id);

        let bindings = [
            ["board", "cfgBoard"],
            ["entries", "cfgEntries"],
            ["show_bars", "cfgShowBars"],
            ["show_votes", "cfgShowVotes"],
            ["show_dots", "cfgShowDots"],
            ["highlight", "cfgHighlight"],
            ["width", "cfgWidth"],
            ["font_size", "cfgFontSize"],
            ["show_header", "cfgShowHeader"],
            ["header_text", "cfgHeaderText"],
            ["refresh_minutes", "cfgRefreshMinutes"],
            ["api_host", "cfgApiHost"],
            ["dataset", "cfgDataset"],
            ["cache_path", "cfgCachePath"],
            ["force_curl", "cfgForceCurl"],
            ["source", "cfgSource"],
            ["github_host", "cfgGithubHost"],
            ["github_repo", "cfgGithubRepo"]
        ];

        for (let i = 0; i < bindings.length; i++) {
            let key = bindings[i][0];
            let prop = bindings[i][1];
            try {
                if (typeof this._settings.bind === "function") {
                    // Cinnamon >= 5.0
                    this._settings.bind(key, prop, this._onSettingChanged, this);
                } else {
                    // Cinnamon 4.x
                    this._settings.bindProperty(Settings.BindingDirection.IN, key, prop,
                                                this._onSettingChanged, this);
                }
                this._bindingKeys.push(key);
            } catch (e) {
                global.logError(UUID + ": Einstellung '" + key + "' konnte nicht gebunden werden: " + e);
            }
        }
    }

    _get(prop, fallback) {
        let value = this[prop];
        return (value === undefined || value === null) ? fallback : value;
    }

    _currentBoard() {
        let id = this._get("cfgBoard", "text");
        for (let i = 0; i < BOARDS.length; i++) {
            if (BOARDS[i].id === id)
                return BOARDS[i];
        }
        return BOARDS[0];
    }

    _onSettingChanged() {
        this._applySettings(true);
    }

    _applySettings(allowRefetch) {
        this._applyHeader();
        this._applyStyle();

        let board = this._currentBoard();
        let host = String(this._get("cfgApiHost", DEFAULT_API_HOST) || DEFAULT_API_HOST);
        let dataset = String(this._get("cfgDataset", DEFAULT_DATASET) || DEFAULT_DATASET);

        let sourceChanged = (board.id !== this._usedBoard) ||
                            (host !== this._usedHost) ||
                            (dataset !== this._usedDataset) ||
                            (!!this._get("cfgForceCurl", false) !== !!this._usedForceCurl) ||
                            (String(this._get("cfgSource", "auto") || "auto") !== this._usedSource) ||
                            (String(this._get("cfgGithubRepo", DEFAULT_GITHUB_REPO) || "") !== this._usedGithubRepo);

        if (this._payload && !sourceChanged) {
            this._render();

            // Anzeigezahl wurde erhöht: mehr Einträge nachladen
            let want = clamp(Math.round(Number(this._get("cfgEntries", 10)) || 10), 1, 25);
            if (allowRefetch && (this._payload.entries || []).length < want)
                this._refresh(true);
        } else if (allowRefetch) {
            this._payload = null;
            this._status = "loading";
            this._render();
            this._refresh(true);
        }

        if (allowRefetch)
            this._restartTimer();
    }

    _applyHeader() {
        let text = String(this._get("cfgHeaderText", "Arena.ai · Leaderboard") || "");
        let show = !!this._get("cfgShowHeader", true);

        if (show && text.length > 0) {
            this.setHeader(text);
            if (this._header)
                this._header.show();
        } else if (this._header) {
            this._header.hide();
        }
    }

    _applyStyle() {
        let width = clamp(Math.round(Number(this._get("cfgWidth", 300)) || 300), 180, 640);
        let fontSize = Math.round(Number(this._get("cfgFontSize", 0)) || 0);

        this._width = width;

        let style = "padding: 2px 6px 4px 6px;";
        if (fontSize > 0)
            style += " font-size: " + fontSize + "px;";

        this._contentBox.set_style(style);
        try {
            this.actor.set_width(width);
        } catch (e) {
            // nichts tun – Desklet bleibt dann eben inhaltsbreit
        }
    }

    // -- Oberfläche ---------------------------------------------------------

    _initUi() {
        this._contentBox = new St.BoxLayout({vertical: true});
        this._rowsBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._contentBox.add(this._rowsBox, {expand: true});

        this._footerBox = new St.BoxLayout({
            x_expand: true,
            style: "spacing: 6px; padding-top: 4px;"
        });

        this._updatedLabel = new St.Label({text: "", x_expand: true});
        this._updatedLabel.set_opacity(150);
        this._updatedLabel.set_y_align(Clutter.ActorAlign.END);

        this._sourceLabel = new St.Label({text: "arena.ai"});
        this._sourceLabel.set_opacity(190);
        this._sourceLabel.set_reactive(true);
        this._sourceLabel.set_style("font-weight: 600;");
        this._sourceLabel.connect("button-release-event", () => {
            this._openInBrowser();
            return true;
        });

        this._footerBox.add(this._updatedLabel, {expand: true});
        this._footerBox.add(this._sourceLabel);
        this._contentBox.add(this._footerBox);

        this.setContent(this._contentBox);
        this._footerBox.hide();
    }

    _addMenuItems() {
        this._refreshItem = new PopupMenu.PopupMenuItem(_("Jetzt aktualisieren"));
        this._refreshItem.connect("activate", () => this._refresh(true));
        this._menu.addMenuItem(this._refreshItem);

        this._openItem = new PopupMenu.PopupMenuItem(_("arena.ai im Browser öffnen"));
        this._openItem.connect("activate", () => this._openInBrowser());
        this._menu.addMenuItem(this._openItem);

        this._testItem = new PopupMenu.PopupMenuItem(_("Verbindung testen …"));
        this._testItem.connect("activate", () => this._testConnection());
        this._menu.addMenuItem(this._testItem);
    }

    _openInBrowser() {
        try {
            Util.spawn(["xdg-open", LEADERBOARD_URL]);
        } catch (e) {
            global.logError(UUID + ": Browser konnte nicht gestartet werden: " + e);
        }
    }

    on_desklet_clicked(event) {
        this._refresh(true);
    }

    _clearRows() {
        for (let i = 0; i < this._tooltips.length; i++) {
            try {
                this._tooltips[i].destroy();
            } catch (e) {
                // Tooltip wurde eventuell schon mit dem Acktor zerstört
            }
        }
        this._tooltips = [];
        this._rowsBox.destroy_all_children();
    }

    _makeMessageLabel(text) {
        let label = new St.Label({
            text: text,
            x_expand: true,
            style: "padding: 8px 2px; opacity: 0.8;"
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        return label;
    }

    _render() {
        this._clearRows();

        if (!this._payload) {
            if (this._status === "error") {
                let message = _("Daten konnten nicht geladen werden.");
                if (this._errorText)
                    message += "\n" + _("Grund") + ": " + this._shortReason(this._errorText);
                message += "\n" + this._diagnoseHint();
                this._rowsBox.add(this._makeMessageLabel(message), {x_expand: true});
            } else {
                this._rowsBox.add(this._makeMessageLabel(_("Lade Leaderboard …")), {x_expand: true});
            }
            this._updateFooter();
            return;
        }

        let entries = this._payload.entries || [];
        let count = clamp(Math.round(Number(this._get("cfgEntries", 10)) || 10), 1, 25);
        entries = entries.slice(0, count);

        if (entries.length === 0) {
            this._rowsBox.add(this._makeMessageLabel(_("Keine Einträge vorhanden.")), {x_expand: true});
            this._updateFooter();
            return;
        }

        let values = entries.map(function (entry) { return entry.value; });
        let max = Math.max.apply(null, values);
        let min = Math.min.apply(null, values);

        for (let i = 0; i < entries.length; i++) {
            this._rowsBox.add(this._makeRow(entries[i], i, min, max), {x_expand: true});
        }

        if (this._status === "error") {
            let bundled = !!(this._payload && this._payload.bundled);
            let text = bundled
                ? "⚠ " + _("Beispieldaten (mitgelieferter Snapshot) – keine Verbindung")
                : "⚠ " + _("Offline – zeige gespeicherte Daten");
            let warn = new St.Label({text: text, x_expand: true});
            warn.set_opacity(170);
            warn.set_style("padding-top: 4px;");
            this._rowsBox.add(warn);
            try {
                this._tooltips.push(new Tooltips.Tooltip(warn,
                    (this._errorText || _("Keine Verbindung")) + "\n" + this._diagnoseHint()));
            } catch (e) {
                // Tooltips sind optional
            }
        }

        this._updateFooter();
    }

    _makeRow(entry, index, min, max) {
        let highlight = !!this._get("cfgHighlight", true);
        let showDots = !!this._get("cfgShowDots", true);
        let showBars = !!this._get("cfgShowBars", true);
        let showVotes = !!this._get("cfgShowVotes", true);

        let color = providerColor(entry.org);
        let medal = highlight && index < MEDALS.length ? MEDALS[index] : null;

        let rowStyle = "padding: 3px 4px; border-radius: 5px; spacing: 8px;";
        if (medal && index === 0)
            rowStyle += " background-color: rgba(255, 201, 77, 0.10);";

        let row = new St.BoxLayout({vertical: false, style: rowStyle});

        // Rang
        let rankLabel = new St.Label({
            text: "#" + entry.rank,
            style: "font-weight: bold;" + (medal ? " color: " + medal + ";" : "")
        });
        rankLabel.set_width(34);
        rankLabel.set_x_align(Clutter.ActorAlign.END);
        row.add(rankLabel);

        // Inhaltsspalte
        let entryBox = new St.BoxLayout({vertical: true, x_expand: true, style: "spacing: 2px;"});

        // Zeile 1: Anbieterpunkt + Modellname + Wert
        let topLine = new St.BoxLayout({vertical: false, x_expand: true, style: "spacing: 6px;"});

        if (showDots) {
            let dot = new St.Widget({
                style: "width: 8px; height: 8px; border-radius: 4px; background-color: " + color + ";",
                y_align: Clutter.ActorAlign.CENTER
            });
            topLine.add(dot);
        }

        let nameLabel = new St.Label({text: entry.model, x_expand: true});
        nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        topLine.add(nameLabel, {expand: true});

        let scoreLabel = new St.Label({text: entry.display, style: "font-weight: bold;"});
        scoreLabel.set_x_align(Clutter.ActorAlign.END);
        topLine.add(scoreLabel);

        entryBox.add(topLine);

        // Zeile 2: Balken + Stimmen
        if (showBars || showVotes) {
            let bottomLine = new St.BoxLayout({vertical: false, x_expand: true, style: "spacing: 8px;"});

            if (showBars) {
                let track = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: "background-color: rgba(128, 128, 128, 0.22); border-radius: 2px;"
                });
                let fill = new St.Widget({
                    style: "height: 4px; border-radius: 2px; background-color: " + color + ";"
                });
                fill.set_width(2);
                track.add(fill);

                let fraction = barFraction(entry.value, min, max);
                let update = function () {
                    let w = track.get_width();
                    if (w <= 0)
                        return;
                    let target = Math.max(2, Math.round(w * fraction));
                    if (Math.abs(fill.get_width() - target) >= 1)
                        fill.set_width(target);
                };
                track.connect("notify::width", update);
                update();

                bottomLine.add(track, {expand: true});
            } else {
                bottomLine.add(new St.Widget({x_expand: true}), {expand: true});
            }

            if (showVotes) {
                let votesLabel = new St.Label({text: formatVotes(entry.votes)});
                votesLabel.set_opacity(150);
                votesLabel.set_width(36);
                votesLabel.set_x_align(Clutter.ActorAlign.END);
                votesLabel.set_y_align(Clutter.ActorAlign.CENTER);
                bottomLine.add(votesLabel);

                if (entry.votes !== null && entry.votes !== undefined) {
                    try {
                        let exact = String(Math.round(entry.votes)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                        this._tooltips.push(new Tooltips.Tooltip(votesLabel,
                            exact + " " + (entry.kind === "score" ? _("Sessions") : _("Stimmen"))));
                    } catch (e) {
                        // Tooltips sind optional
                    }
                }
            }

            entryBox.add(bottomLine);
        }

        row.add(entryBox, {expand: true});

        // Tooltip mit Details
        let tipLines = [
            entry.model,
            _("Anbieter") + ": " + providerLabel(entry.org),
            _("Lizenz") + ": " + (entry.license || "–")
        ];
        let hasCi = entry.ciLow !== undefined && entry.ciLow !== null &&
                    entry.ciHigh !== undefined && entry.ciHigh !== null;
        if (hasCi) {
            let interval;
            if (entry.kind === "score")
                interval = (entry.ciLow * 100).toFixed(2) + " % – " + (entry.ciHigh * 100).toFixed(2) + " %";
            else
                interval = Math.round(entry.ciLow) + " – " + Math.round(entry.ciHigh);
            tipLines.push((entry.kind === "score" ? _("Score") : _("Rating")) + ": " + entry.display + "  (" + interval + ")");
        }
        let votes = formatVotes(entry.votes);
        if (votes)
            tipLines.push(_("Stimmen") + ": " + votes);
        if (entry.cost !== null && entry.cost !== undefined)
            tipLines.push(_("Kosten pro Task (Median)") + ": " + Number(entry.cost).toFixed(2) + " $");
        if (entry.published)
            tipLines.push(_("Stand des Boards") + ": " + entry.published);

        try {
            this._tooltips.push(new Tooltips.Tooltip(row, tipLines.join("\n")));
        } catch (e) {
            // Tooltips sind optional
        }

        return row;
    }

    _updateFooter() {
        let published = this._payload ? this._payload.published : "";
        let updated = formatTimestamp(this._fetchedAt);

        let text;
        if (this._status === "error" && !this._payload) {
            text = _("Keine Verbindung");
        } else if (updated) {
            text = _("Stand") + ": " + updated;
        } else {
            text = "";
        }

        this._updatedLabel.set_text(text);
        this._footerBox.visible = text.length > 0 || !!this._payload;

        let tip = [];
        if (this._payload) {
            tip.push((this._payload.total || 0) + " " + _("Modelle im Datensatz"));
            if (published)
                tip.push(_("Board veröffentlicht") + ": " + published);
            if (this._payload.bundled)
                tip.push(_("Beispieldaten (mitgelieferter Snapshot)"));
            else if (this._lastGoodSource)
                tip.push(_("Quelle") + ": " + this._lastGoodSource);
            tip.push("Desklet v" + this._version() + " · " + this._backendDescription());
        }
        try {
            if (!this._footerTip) {
                this._footerTip = new Tooltips.Tooltip(this._updatedLabel, tip.join("\n"));
            } else {
                this._footerTip.set_text(tip.join("\n"));
            }
        } catch (e) {
            // ignorieren
        }
    }

    // -- Fehlertexte --------------------------------------------------------

    _version() {
        try {
            if (this._metadata && this._metadata.version)
                return String(this._metadata.version);
        } catch (e) {
            // ignorieren
        }
        return "?";
    }

    _shortReason(text) {
        // Quellen-Ketten können lang werden – auf das Wesentliche kürzen
        let t = String(text || "");
        if (t.length <= 150)
            return t;
        return t.substring(0, 147) + "…";
    }

    _diagnoseHint() {
        return _("Rechtsklick → „Verbindung testen“ zeigt Details") +
               " (v" + this._version() + ", " + this._backendDescription() + ")";
    }

    // -- Netzwerk -----------------------------------------------------------

    _initFetcher(force) {
        if (this._fetcher && !force)
            return true;

        this._fetcher = null;
        this._fetcherError = "";

        try {
            this._fetcher = createHttpFetcher(Soup, GLib);
            global.log(UUID + ": HTTP-Backend " + this._fetcher.backend);
            return true;
        } catch (e) {
            this._fetcherError = (e && e.message) ? e.message : String(e);
            global.logWarning(UUID + ": libsoup nicht nutzbar – " + this._fetcherError);
            return false;
        }
    }

    _backendDescription() {
        if (this._forceCurl)
            return "curl (erzwungen)";
        if (this._fetcher)
            return this._fetcher.backend;
        return "curl (libsoup nicht verfügbar" +
               (this._fetcherError ? ": " + this._fetcherError : "") + ")";
    }

    _request(url, callback, viaCurl) {
        let delivered = false;
        let handle = null;

        let wrapped = (error, response) => {
            if (delivered)
                return;
            delivered = true;
            if (this._requestTimer) {
                Mainloop.source_remove(this._requestTimer);
                this._requestTimer = 0;
            }
            callback(error, response);
        };

        // Hängt das Netz (z. B. kein DNS), soll das Desklet nicht ewig laden
        this._requestTimer = Mainloop.timeout_add_seconds(REQUEST_TIMEOUT, () => {
            this._requestTimer = 0;
            if (handle) {
                try {
                    handle.cancel();
                } catch (e) {
                    // ignorieren
                }
            }
            wrapped(new Error(_("Zeitüberschreitung nach") + " " + REQUEST_TIMEOUT + " s"));
            return false;
        });

        let forceCurl = (viaCurl === true) || !!this._get("cfgForceCurl", false);
        this._forceCurl = forceCurl;

        if (!forceCurl && this._initFetcher()) {
            try {
                handle = this._fetcher.fetch(url, wrapped);
                return handle;
            } catch (e) {
                global.logWarning(UUID + ": libsoup-Aufruf fehlgeschlagen, nutze curl – " + e);
            }
        }

        this._fetcher = forceCurl ? this._fetcher : null;
        handle = this._fetchViaCurl(url, wrapped);
        return handle;
    }

    // Notausgang, falls libsoup fehlt oder zickt (praktisch, um Probleme
    // einzugrenzen, ohne das Desklet neu zu laden).
    _fetchViaCurl(url, callback) {
        let proc = null;
        let finished = false;

        function done(error, status, text) {
            if (finished)
                return;
            finished = true;
            callback(error || null, {status: status || 0, text: (text === undefined ? null : text)});
        }

        try {
            proc = Gio.Subprocess.new(
                ["curl", "-sS", "-L", "--max-time", "20",
                 "-H", "Accept: application/json",
                 "-w", "\n__HTTP_STATUS__%{http_code}", url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            done(new Error("curl konnte nicht gestartet werden: " + ((e && e.message) || e)));
            return {cancel: function () {}};
        }

        proc.communicate_utf8_async(null, null, (p, res) => {
            let out = null;
            let err = null;
            try {
                let result = p.communicate_utf8_finish(res);
                out = result[1];
                err = result[2];
            } catch (e) {
                done(e);
                return;
            }

            let text = out === null ? null : String(out);
            let status = 0;
            if (text !== null) {
                let marker = text.lastIndexOf("__HTTP_STATUS__");
                if (marker !== -1) {
                    status = parseInt(text.substring(marker + 15).trim(), 10) || 0;
                    text = text.substring(0, marker);
                }
            }

            if (status === 0)
                done(new Error("curl: " + String(err || "").trim()));
            else
                done(null, status, text);
        });

        return {
            cancel: function () {
                if (finished)
                    return;
                finished = true;
                try {
                    proc.force_exit();
                } catch (e) {
                    // schon beendet
                }
            }
        };
    }

    // Baut die Liste der Quellen, die nacheinander probiert werden.
    _buildSourcePlan(board, requestCount) {
        let source = String(this._get("cfgSource", "auto") || "auto");
        let host = String(this._get("cfgApiHost", DEFAULT_API_HOST) || DEFAULT_API_HOST);
        let dataset = String(this._get("cfgDataset", DEFAULT_DATASET) || DEFAULT_DATASET);
        let ghHost = String(this._get("cfgGithubHost", DEFAULT_GITHUB_HOST) || DEFAULT_GITHUB_HOST);
        let ghRepo = String(this._get("cfgGithubRepo", DEFAULT_GITHUB_REPO) || DEFAULT_GITHUB_REPO);

        let plan = [];

        if (source === "auto" || source === "hf") {
            plan.push({
                id: "hf",
                label: "Hugging Face",
                url: buildRowsUrl(host, dataset, board.config, requestCount),
                parse: (text) => parseLeaderboardResponse(text, board.kind, requestCount)
            });
        }

        if (source === "auto" || source === "github") {
            // Snapshot-Repo: heutiges Datum und ein paar Tage rückwärts
            let dates = githubSnapshotDates(isoDateOffset(0), 7);
            let target = board.gh || board.config;
            for (let i = 0; i < dates.length; i++) {
                plan.push({
                    id: "github",
                    label: "GitHub-Snapshot " + dates[i],
                    url: buildGithubBoardUrl(ghHost, ghRepo, dates[i], target),
                    parse: (text) => {
                        let parsed = parseGithubLeaderboard(text, board.kind, requestCount, dates[i]);
                        if (!parsed.entries.length)
                            throw new Error(_("Keine Einträge in der Antwort"));
                        return parsed;
                    }
                });
            }
        }

        return plan;
    }

    _refresh(force) {
        let now = Math.floor(Date.now() / 1000);
        if (!force && this._lastFetchAt && (now - this._lastFetchAt) < REFRESH_DEBOUNCE)
            return;

        let board = this._currentBoard();
        let host = String(this._get("cfgApiHost", DEFAULT_API_HOST) || DEFAULT_API_HOST);
        let dataset = String(this._get("cfgDataset", DEFAULT_DATASET) || DEFAULT_DATASET);
        let count = clamp(Math.round(Number(this._get("cfgEntries", 10)) || 10), 1, 25);
        let requestCount = clamp(Math.max(count, 10), 1, MAX_LIMIT);

        this._lastFetchAt = now;

        let plan = this._buildSourcePlan(board, requestCount);
        let seq = ++this._reqSeq;

        if (!this._payload) {
            this._status = "loading";
            this._render();
        }

        if (this._fetchHandle) {
            try {
                this._fetchHandle.cancel();
            } catch (e) {
                // bereits beendet
            }
            this._fetchHandle = null;
        }

        let failures = [];
        let index = 0;
        let retriedWithCurl = false;

        let tryNext = () => {
            if (seq !== this._reqSeq)
                return;

            if (index >= plan.length) {
                // alles durchprobiert
                let summary = failures.length
                    ? failures.map(function (f) { return f.label + ": " + f.reason; }).join(" · ")
                    : _("Keine Quelle konfiguriert");
                this._onError(summary);
                return;
            }

            let source = plan[index];
            this._lastUrl = source.url;
            this._lastSourceLabel = source.label;

            let step = (viaCurl) => {
                this._fetchHandle = this._request(source.url, (error, response) => {
                    if (seq !== this._reqSeq)
                        return;
                    this._fetchHandle = null;

                    if (error) {
                        // Transportfehler in libsoup: einmalig über curl versuchen
                        if (!retriedWithCurl && viaCurl !== true) {
                            retriedWithCurl = true;
                            global.logWarning(UUID + ": libsoup-Transportfehler (" +
                                              ((error && error.message) || error) + "), versuche curl");
                            step(true);
                            return;
                        }
                        failures.push({label: source.label,
                                       reason: (error && error.message) ? error.message : String(error)});
                        index++;
                        tryNext();
                        return;
                    }

                    let status = response ? response.status : 0;
                    this._lastStatus = status;

                    if (status !== 200) {
                        failures.push({label: source.label, reason: "HTTP " + status});
                        index++;
                        tryNext();
                        return;
                    }

                    try {
                        let parsed = source.parse(response.text);
                        if (!parsed.entries.length)
                            throw new Error(_("Keine Einträge in der Antwort"));

                        this._payload = parsed;
                        this._status = "ok";
                        this._errorText = "";
                        this._lastGoodSource = source.label;
                        this._fetchedAt = Math.floor(Date.now() / 1000);
                        this._fetchedForBoard = board.id;
                        this._usedBoard = board.id;
                        this._usedHost = host;
                        this._usedDataset = dataset;
                        this._usedForceCurl = !!this._get("cfgForceCurl", false);
            this._usedSource = String(this._get("cfgSource", "auto") || "auto");
            this._usedGithubRepo = String(this._get("cfgGithubRepo", DEFAULT_GITHUB_REPO) || "");

                        this._writeCache();
                        this._render();
                    } catch (e) {
                        failures.push({label: source.label,
                                       reason: (e && e.message) ? e.message : String(e)});
                        index++;
                        tryNext();
                    }
                }, viaCurl);
            };

            step(false);
        };

        tryNext();
    }

    _onError(text) {
        this._errorText = text;
        this._status = "error";
        global.logWarning(UUID + ": " + text + " [" + this._backendDescription() + "]");
        this._writeDiagnostics(false, text, this._lastUrl);

        // Letzte Rettung: mitgelieferter Beispiel-Snapshot, damit das Desklet
        // nie komplett leer bleibt
        if (!this._payload || this._payload.bundled) {
            let hadPayload = !!this._payload;
            let loaded = this._loadBundled();
            if (loaded)
                global.log(UUID + ": zeige mitgelieferten Beispiel-Snapshot");
            else if (!hadPayload)
                this._payload = null;
        }

        this._render();
    }

    // -- Diagnose -----------------------------------------------------------

    _systemInfo() {
        let info = [];
        try {
            let config = imports.misc.config;
            if (config && config.PACKAGE_VERSION)
                info.push((config.PACKAGE_NAME || "Cinnamon") + " " + config.PACKAGE_VERSION);
        } catch (e) {
            // ignorieren
        }
        try {
            let version = imports.system.version;
            if (version) {
                if (typeof version.major === "number")
                    info.push("GJS " + version.major + "." + version.minor + "." + (version.micro || 0));
                else
                    info.push("GJS " + String(version));
            }
        } catch (e) {
            // ignorieren
        }
        try {
            if (Soup.MAJOR_VERSION !== undefined)
                info.push("libsoup " + Soup.MAJOR_VERSION + "." + Soup.MINOR_VERSION);
        } catch (e) {
            // ignorieren
        }
        return info;
    }

    _diagnosticsPath() {
        return GLib.build_filenamev([GLib.get_home_dir(), ".cache",
                                     UUID, "diagnostics.log"]);
    }

    _writeDiagnostics(ok, detail, url) {
        let path = this._diagnosticsPath();
        let lines = [];

        let stamp = "";
        try {
            stamp = GLib.DateTime.new_now_local().format("%Y-%m-%d %H:%M:%S");
        } catch (e) {
            stamp = String(new Date());
        }

        lines.push("Arena.ai Leaderboard Desklet – Diagnose");
        lines.push("Zeit:          " + stamp);
        lines.push("Ergebnis:      " + (ok ? "OK" : "FEHLER"));
        lines.push("Detail:        " + (detail || "–"));
        lines.push("URL:           " + (url || this._lastUrl || "–"));
        lines.push("HTTP-Status:   " + (this._lastStatus || "–"));
        lines.push("Backend:       " + this._backendDescription());
        lines.push("Desklet:       v" + this._version());
        lines.push("Quelle:        " + String(this._get("cfgSource", "auto") || "auto") +
                   (this._lastSourceLabel ? " (versucht: " + this._lastSourceLabel + ")" : "") +
                   (this._lastGoodSource ? " · zuletzt ok: " + this._lastGoodSource : ""));
        lines.push("Snapshot:      " + (this._bundledLoaded ? "Beispieldaten aktiv" : "nein"));
        lines.push("System:        " + this._systemInfo().join(" · "));
        lines.push("Systemsprache: " + (GLib.get_language_names ? GLib.get_language_names()[0] : "?"));
        lines.push("Board:         " + this._currentBoard().id);
        lines.push("Datensatz:     " + String(this._get("cfgDataset", DEFAULT_DATASET)));
        lines.push("API-Server:    " + String(this._get("cfgApiHost", DEFAULT_API_HOST)));
        let curlPath = "";
        try {
            curlPath = GLib.find_program_in_path("curl") || "";
        } catch (e) {
            curlPath = "";
        }
        lines.push("curl:          " + (curlPath || "nicht gefunden"));
        lines.push("Cache:         " + (this._get("cfgCachePath", "") || "–") +
                   (this._readCache() ? " (vorhanden)" : " (leer)"));

        let text = lines.join("\n") + "\n";

        try {
            let dir = GLib.build_filenamev([GLib.get_home_dir(), ".cache", UUID]);
            if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
                GLib.mkdir_with_parents(dir, 493);   // 0755
            GLib.file_set_contents(path, text);
        } catch (e) {
            global.logWarning(UUID + ": Diagnose konnte nicht geschrieben werden: " + e);
        }

        try {
            global.log(UUID + ": Diagnose\n" + text);
        } catch (e) {
            // ignorieren
        }

        return path;
    }

    _testConnection() {
        let board = this._currentBoard();
        let host = String(this._get("cfgApiHost", DEFAULT_API_HOST) || DEFAULT_API_HOST);
        let dataset = String(this._get("cfgDataset", DEFAULT_DATASET) || DEFAULT_DATASET);
        let url = buildRowsUrl(host, dataset, board.config, 10);

        this._lastUrl = url;
        this._updatedLabel.set_text(_("Teste Verbindung …"));
        this._footerBox.show();

        if (this._testHandle) {
            try {
                this._testHandle.cancel();
            } catch (e) {
                // bereits beendet
            }
        }

        this._testHandle = this._request(url, (error, response) => {
            this._testHandle = null;

            let ok = !error && response && response.status === 200;
            let detail = [];

            if (ok) {
                try {
                    let parsed = parseLeaderboardResponse(response.text, board.kind, 10);
                    if (!parsed.entries.length)
                        throw new Error(_("Keine Einträge in der Antwort"));
                    detail.push(parsed.entries.length + " " + _("Einträge empfangen") + " (" + parsed.entries[0].model + ")");
                } catch (e) {
                    ok = false;
                    detail.push(_("Antwort nicht lesbar") + ": " + ((e && e.message) || e));
                }
            }

            if (response && response.status)
                detail.push("HTTP " + response.status);
            if (error)
                detail.push((error && error.message) ? error.message : String(error));

            this._lastStatus = response ? response.status : 0;
            let report = this._writeDiagnostics(ok, detail.join(" · "), url);

            try {
                Main.notify("Arena.ai Leaderboard",
                    (ok ? _("Verbindung OK") : _("Verbindung fehlgeschlagen")) + "\n" +
                    detail.join("\n") + "\n\n" + _("Protokoll") + ": " + report);
            } catch (e) {
                global.logWarning(UUID + ": Benachrichtigung nicht möglich: " + e);
            }

            this._updatedLabel.set_text(ok ? _("Verbindung OK") : _("Keine Verbindung"));
        });
    }

    // -- Cache --------------------------------------------------------------

    _cacheFile() {
        let path = expandHome(this._get("cfgCachePath", "~/.cache/" + UUID + "/leaderboard.json"));
        if (!path)
            return null;
        return Gio.File.new_for_path(path);
    }

    _readCache() {
        try {
            let file = this._cacheFile();
            if (!file || !file.query_exists(null))
                return null;

            let result = file.load_contents(null);
            if (!result[0])
                return null;

            let data = JSON.parse(ByteArray.toString(result[1]));
            if (!data || data.version !== CACHE_VERSION || !data.boards)
                return null;
            return data;
        } catch (e) {
            global.logWarning(UUID + ": Cache konnte nicht gelesen werden: " + e);
            return null;
        }
    }

    _loadCache() {
        let data = this._readCache();
        if (!data)
            return;

        this._cacheData = data;

        let board = this._currentBoard();
        let cached = data.boards[board.id];
        if (!cached || !cached.entries || !cached.entries.length)
            return;

        let entries = [];
        for (let i = 0; i < cached.entries.length; i++) {
            let entry = cached.entries[i];
            if (entry && typeof entry.value === "number") {
                if (!entry.display)
                    entry.display = formatScore(board.kind, entry.value);
                entries.push(entry);
            }
        }
        if (!entries.length)
            return;

        this._payload = {
            entries: entries,
            published: cached.published || "",
            total: cached.total || entries.length
        };
        this._fetchedAt = cached.fetched_at || 0;
        this._usedBoard = board.id;
        this._usedHost = String(this._get("cfgApiHost", DEFAULT_API_HOST) || DEFAULT_API_HOST);
        this._usedDataset = String(this._get("cfgDataset", DEFAULT_DATASET) || DEFAULT_DATASET);
        this._status = "ok";
        this._render();
    }

    // Mitgelieferter Beispiel-Snapshot (data/fallback.json im Desklet-Ordner).
    // Damit zeigt das Desklet auch ohne Netz und ohne Cache etwas Sinnvolles an.
    _loadBundled() {
        try {
            if (!this._metadata || !this._metadata.path)
                return false;

            let path = GLib.build_filenamev([this._metadata.path, "data", "fallback.json"]);
            let file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                return false;

            let result = file.load_contents(null);
            if (!result[0])
                return false;

            let data = JSON.parse(ByteArray.toString(result[1]));
            let board = this._currentBoard();
            let cached = data && data.boards ? data.boards[board.id] : null;
            if (!cached || !cached.entries || !cached.entries.length)
                return false;

            let entries = [];
            for (let i = 0; i < cached.entries.length; i++) {
                let entry = cached.entries[i];
                if (entry && typeof entry.value === "number") {
                    if (!entry.display)
                        entry.display = formatScore(board.kind, entry.value);
                    entry.kind = board.kind;
                    entries.push(entry);
                }
            }
            if (!entries.length)
                return false;

            this._payload = {
                entries: entries,
                published: cached.published || "",
                total: cached.total || entries.length,
                bundled: true
            };
            this._fetchedAt = cached.fetched_at || 0;
            this._bundledLoaded = true;
            this._status = "error";
            this._usedBoard = board.id;
            return true;
        } catch (e) {
            global.logWarning(UUID + ": Beispiel-Snapshot nicht lesbar: " + e);
            return false;
        }
    }

    _writeCache() {
        if (!this._payload || !this._fetchedForBoard)
            return;

        try {
            let file = this._cacheFile();
            if (!file)
                return;

            let data = this._cacheData;
            if (!data || data.version !== CACHE_VERSION || !data.boards)
                data = {version: CACHE_VERSION, boards: {}};

            data.boards[this._fetchedForBoard] = {
                fetched_at: this._fetchedAt,
                published: this._payload.published || "",
                total: this._payload.total || 0,
                entries: this._payload.entries
            };

            // Nur die jüngsten 8 Boards behalten
            let keys = Object.keys(data.boards);
            if (keys.length > 8) {
                keys.sort(function (a, b) {
                    return (data.boards[b].fetched_at || 0) - (data.boards[a].fetched_at || 0);
                });
                for (let i = 8; i < keys.length; i++)
                    delete data.boards[keys[i]];
            }

            let parent = file.get_parent();
            if (parent && !parent.query_exists(null)) {
                try {
                    parent.make_directory_with_parents(null);
                } catch (e) {
                    if (!parent.query_exists(null))
                        throw e;
                }
            }

            GLib.file_set_contents(file.get_path(), JSON.stringify(data));
            this._cacheData = data;
        } catch (e) {
            global.logWarning(UUID + ": Cache konnte nicht geschrieben werden: " + e);
        }
    }

    // -- Timer / Aufräumen --------------------------------------------------

    _restartTimer() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        let minutes = Number(this._get("cfgRefreshMinutes", 30));
        if (!isFinite(minutes) || minutes <= 0)
            return;

        minutes = clamp(minutes, 1, 1440);
        this._timeoutId = Mainloop.timeout_add_seconds(Math.round(minutes * 60), () => {
            this._timeoutId = 0;
            this._refresh(true);
            this._restartTimer();
            return false;
        });
    }

    on_desklet_removed(deleteConfig) {
        this._reqSeq++;   // laufende Antworten verwerfen

        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (this._fetchHandle) {
            try {
                this._fetchHandle.cancel();
            } catch (e) {
                // ignorieren
            }
            this._fetchHandle = null;
        }

        if (this._requestTimer) {
            Mainloop.source_remove(this._requestTimer);
            this._requestTimer = 0;
        }

        for (let i = 0; i < this._tooltips.length; i++) {
            try {
                this._tooltips[i].destroy();
            } catch (e) {
                // ignorieren
            }
        }
        this._tooltips = [];

        if (this._footerTip) {
            try {
                this._footerTip.destroy();
            } catch (e) {
                // ignorieren
            }
            this._footerTip = null;
        }

        for (let i = 0; i < this._bindingKeys.length; i++) {
            let key = this._bindingKeys[i];
            try {
                if (typeof this._settings.unbindAll === "function")
                    this._settings.unbindAll(key);
                else
                    this._settings.unbindProperty(key);
            } catch (e) {
                // ignorieren
            }
        }
        this._bindingKeys = [];

        if (this._settings) {
            try {
                this._settings.finalize();
            } catch (e) {
                // ignorieren
            }
        }
    }
}

function main(metadata, desklet_id) {
    Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

    try {
        let soup = "";
        if (Soup.MAJOR_VERSION !== undefined)
            soup = "libsoup " + Soup.MAJOR_VERSION + "." + Soup.MINOR_VERSION;
        else
            soup = "libsoup (Version unbekannt)";
        global.log(UUID + ": Start · " + soup + " · Cinnamon " +
                   (imports.misc.config.PACKAGE_VERSION || "?"));
    } catch (e) {
        // Logging ist optional
    }

    return new ArenaLeaderboardDesklet(metadata, desklet_id);
}
