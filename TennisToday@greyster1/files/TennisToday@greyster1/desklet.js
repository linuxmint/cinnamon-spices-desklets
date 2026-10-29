// TennisToday desklet — TennisToday@greyster1
// Desktop scores for ATP and WTA.
//
// Copyright (C) 2026 Graham Ferguson
// SPDX-License-Identifier: GPL-3.0-or-later

const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;

const UUID = "TennisToday@greyster1";
const ESPN_URL = "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=tennis";
const ESPN_PAGE = "https://www.espn.com/tennis/scoreboard";
// ESPN carries no tournament level or game points; LiveScore's public feed does.
const LIVESCORE_URL = "https://prod-public-api.livescore.com/v1/api/app";
const USER_AGENT = "TennisToday-desklet (Cinnamon; +https://github.com/greyster1/TennisToday)";
const IS_SOUP_2 = Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2;
const SET_COL_PX = 28;
const POINTS_COL_PX = 36;
const POINTS_GAP_PX = 6;
const RENDER_DEBOUNCE_MS = 250;
const SERVE_COL_PX = 22;
const SCORE_FIT_BASE_PX = 400;
const CHROME_PX = 36;
const SCORE_GUTTER_PX = 16;
// Header, desklet padding and frame above and below the scroll area.
const DESKLET_CHROME_V_PX = 96;
const MIN_SCROLL_PX = 160;
const RECENT_FINISHED_MS = 24 * 3600 * 1000;
const UPCOMING_WINDOW_MS = 24 * 3600 * 1000;
const LIST_INTERVAL_MS = 180000;
const FETCH_WATCHDOG_MS = 120000;
const MIN_REFRESH_SECONDS = 30;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

let _etFormatter;

function _etYmd(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) {
        return "";
    }
    try {
        if (!_etFormatter) {
            _etFormatter = new Intl.DateTimeFormat("en-US", {
                timeZone: "America/New_York",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            });
        }
        let parts = _etFormatter.formatToParts(new Date(ms));
        let y = "", mo = "", d = "";
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].type === "year") {
                y = parts[i].value;
            } else if (parts[i].type === "month") {
                mo = parts[i].value;
            } else if (parts[i].type === "day") {
                d = parts[i].value;
            }
        }
        return y + "-" + mo + "-" + d;
    } catch (e) {
        let dt = new Date(ms);
        return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
    }
}

function _localYmd(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) {
        return "";
    }
    let dt = new Date(ms);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

function _recentlyFinished(startMs, now) {
    return isNaN(startMs) || now - startMs <= RECENT_FINISHED_MS;
}

// ESPN's slate flips at ET midnight, which is mid-evening further west, so
// upcoming is a rolling window rather than a calendar day.
function _upcomingSoon(startMs, now) {
    return isNaN(startMs) || Math.abs(startMs - now) <= UPCOMING_WINDOW_MS;
}

function _formatMatchTime(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) {
        return "";
    }
    try {
        return new Date(ms).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short"
        });
    } catch (e) {
        try {
            return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        } catch (e2) {
            return "";
        }
    }
}

function _safeLink(url) {
    let s = String(url || "");
    return /^https?:\/\//i.test(s) ? s : "";
}

function _formatPoints(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return "";
    }
    let s = String(raw).trim().toUpperCase();
    if (s === "LOVE") {
        return "0";
    }
    if (s === "A" || s === "AD" || s === "ADV" || s === "ADVANTAGE" || s === "50") {
        return "AD";
    }
    if (s === "0" || s === "00") {
        return "0";
    }
    if (s === "15" || s === "30" || s === "40") {
        return s;
    }
    if (/^\d{1,2}$/.test(s)) {
        let n = parseInt(s, 10);
        if (n >= 0 && n <= 20) {
            return String(n);
        }
    }
    return "";
}

function _matchKey(m) {
    if (m.compId) {
        return "compId::" + m.compId;
    }
    let names = (m.teams || []).map(function (t) { return t.name || ""; });
    names.sort();
    return (m.tournament || "") + "::" + names.join("|");
}

function _nameKey(name) {
    let n = String(name || "");
    try {
        n = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
    }
    return n.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// LiveScore names a tournament's level ("ATP 500", "WTA Finals"); reduce it to
// the short code shown in the tag and used by the level filters.
function _tierFromLevel(level) {
    let l = String(level || "").trim();
    // WTA's own name for its 125 tier is "Challenger".
    if (/^wta.*challenger/i.test(l)) {
        return "125";
    }
    if (/challenger/i.test(l)) {
        return "CH";
    }
    if (/finals/i.test(l)) {
        return "Finals";
    }
    let m = l.match(/\b(1000|500|250|125)\b/);
    if (m) {
        return m[1];
    }
    // LiveScore files WTA 125 events under a bare "WTA".
    if (/^wta$/i.test(l)) {
        return "125";
    }
    return "";
}

function _tierGroup(tier) {
    if (tier === "1000" || tier === "Finals") {
        return "1000";
    }
    if (tier === "500" || tier === "250") {
        return tier;
    }
    return "other";
}

function _utcCompact(ms) {
    let dt = new Date(ms);
    return dt.getUTCFullYear() + String(dt.getUTCMonth() + 1).padStart(2, "0") + String(dt.getUTCDate()).padStart(2, "0");
}

// ESPN fills draws it has not published yet with "Bye" vs "Bye" (athlete
// id 0) and "TBD" vs "TBD" slots; nobody will play those as listed.
function _isPlaceholderMatch(players) {
    let known = 0;
    for (let i = 0; i < (players || []).length; i++) {
        let name = String(players[i].name || "").trim();
        if (/^bye$/i.test(name) || String(players[i].id) === "0") {
            return true;
        }
        if (name && !/^tbd$/i.test(name) && name !== _("TBD")) {
            known += 1;
        }
    }
    return known === 0;
}

function _pairKeyFromNames(names) {
    let keys = (names || []).map(_nameKey);
    keys.sort();
    return keys.join("|");
}

function _ordinalSet(period) {
    let n = parseInt(period, 10);
    if (!n || n < 1) {
        return "";
    }
    // Translators: %d is the set number, e.g. "Set 3".
    return _("Set %d").format(n);
}

function _liveSummary(detail, period) {
    let setLabel = _ordinalSet(period);
    if (setLabel) {
        return setLabel;
    }
    let raw = String(detail || "");
    if (!raw || /suspend|delay/i.test(raw)) {
        return "";
    }
    return raw;
}

function _isGrandSlam(name) {
    let n = String(name || "").toLowerCase();
    return n.indexOf("us open") !== -1
        || n.indexOf("u.s. open") !== -1
        || n.indexOf("u.s.open") !== -1
        || n.indexOf("australian open") !== -1
        || n.indexOf("french open") !== -1
        || n.indexOf("roland garros") !== -1
        || n.indexOf("wimbledon") !== -1;
}

function _countryFromLogo(url) {
    if (!url) {
        return "";
    }
    let m = String(url).match(/\/([a-z]{3})\.png(?:\?|$)/i);
    return m ? m[1].toUpperCase() : "";
}

function _setIsComplete(a, b) {
    let va = Number(a);
    let vb = Number(b);
    if (isNaN(va) || isNaN(vb)) {
        return false;
    }
    let hi = Math.max(va, vb);
    let lo = Math.min(va, vb);
    return hi >= 7 || (hi >= 6 && hi - lo >= 2);
}

function _markSetWinners(teams) {
    if (!teams || teams.length < 2) {
        return;
    }
    let a = teams[0].linescores || [];
    let b = teams[1].linescores || [];
    let n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        let la = a[i];
        let lb = b[i];
        if (!la || !lb || la.value == null || la.value === "" || lb.value == null || lb.value === "") {
            continue;
        }
        if (!_setIsComplete(la.value, lb.value)) {
            la.winner = false;
            lb.winner = false;
            continue;
        }
        let va = Number(la.value);
        let vb = Number(lb.value);
        if (va === vb) {
            let ta = Number(la.tiebreak);
            let tb = Number(lb.tiebreak);
            if (!isNaN(ta) && !isNaN(tb) && ta !== tb) {
                la.winner = ta > tb;
                lb.winner = tb > ta;
            } else {
                la.winner = false;
                lb.winner = false;
            }
        } else {
            la.winner = va > vb;
            lb.winner = vb > va;
        }
    }
}

function _parseEvent(event, tour) {
    let notes = event.notes || [];
    let roundName = "";
    let courtName = "";
    let leadText = "";
    if (notes.length) {
        leadText = notes[0].text || "";
        let typeText = notes[0].type || "";
        let dash = typeText.indexOf(" - ");
        if (dash >= 0) {
            roundName = typeText.substring(0, dash);
            courtName = typeText.substring(dash + 3);
        } else {
            roundName = typeText;
        }
    }

    let ctype = event.competitionType || {};
    let competitors = (event.competitors || []).slice();
    competitors.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
    });

    let teams = competitors.map(function (c) {
        let lines = (c.linescores || []).map(function (ls) {
            return {
                value: ls.setScore != null ? ls.setScore : ls.value,
                tiebreak: ls.tieBreakScore || ls.tiebreak || null,
                winner: !!ls.winner
            };
        });
        return {
            name: c.displayName || c.name || c.abbreviation || _("TBD"),
            seed: c.tournamentSeed || null,
            athleteId: String(c.id || ""),
            country: _countryFromLogo(c.logo),
            score: c.score || "",
            points: _formatPoints(c.score),
            linescores: lines,
            serving: !!c.possession,
            winner: !!c.winner,
            isDoubles: c.type === "team"
        };
    });

    let eventType = ctype.text || "";
    let isDoubles = teams.some(function (t) {
            return t.isDoubles || (t.name && t.name.indexOf(" / ") !== -1);
        })
        || /doubles/i.test(eventType)
        || /doubles/i.test(ctype.slug || "");

    let status = "Upcoming";
    if (event.status === "in") {
        status = "Live";
    } else if (event.status === "post") {
        status = "Finished";
    }

    let link = _safeLink(event.link);
    if (!link && event.links && event.links.length) {
        link = _safeLink(event.links[0].href);
    }

    let tournamentName = event.name || event.shortName || "";
    let tourCode = String(tour || "").toUpperCase();
    let slam = _isGrandSlam(tournamentName);
    return {
        id: String(event.id || event.competitionId || event.uid || ""),
        compId: String(event.competitionId || event.id || ""),
        tour: tourCode,
        isGrandSlam: slam,
        badge: slam ? "Grand Slam" : tourCode,
        tournament: tournamentName,
        location: event.location || "",
        roundName: roundName,
        courtName: courtName,
        eventType: eventType,
        status: status,
        statusCode: event.status,
        summary: event.summary || "",
        leadText: leadText,
        teams: teams,
        isDoubles: isDoubles,
        recent: !!event.recent,
        link: link,
        start: event.date || "",
        startMs: event.date ? Date.parse(event.date) : NaN,
        isToday: _etYmd(event.date ? Date.parse(event.date) : NaN) === _etYmd(Date.now())
    };
}

function parseEspnHeader(json) {
    let matches = [];
    let sports = (json && json.sports) || [];
    for (let s = 0; s < sports.length; s++) {
        let leagues = sports[s].leagues || [];
        for (let i = 0; i < leagues.length; i++) {
            let league = leagues[i];
            let tour = league.abbreviation || league.name || "";
            let events = league.events || [];
            for (let j = 0; j < events.length; j++) {
                matches.push(_parseEvent(events[j], tour));
            }
        }
    }
    return matches;
}

function _lsTime(esd) {
    let m = String(esd || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (!m) {
        return NaN;
    }
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function _slug(name) {
    let n = String(name || "");
    try {
        n = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
    }
    return n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function _surnameKey(name) {
    let parts = String(name || "").trim().split(/\s+/);
    return _nameKey(parts[parts.length - 1]);
}

// Doubles teams read "A / B" on ESPN and are two players on LiveScore; both
// reduce to the sorted player keys, a lone player being a team of one.
function _teamKey(names) {
    return (names || []).map(_nameKey).sort().join("+");
}

function _pairKey(teamKeys) {
    return teamKeys.slice().sort().join("|");
}

const LS_SLAM_RE = /^(wimbledon|australian open|us open|french open|roland garros)$/i;
const LS_KEEP_EVENT_KEY_RE = /^(Eid|Eps|Esd|Esrv|Ewt|Tr[12]G|Tr[12]S\d+T?)$/;
const LS_SKIP_STAGE_RE = /qualif|junior|wheelchair|legends/i;
// LiveScore marks games in progress "S1".."S5"; "ToFi" is a suspended match.
const LS_LIVE_RE = /^(S\d|ToFi)$/;
const LS_DONE_RE = /^(FT|Ret\.|W\.O\.)$/;
const LS_STALE_UPCOMING_MS = 6 * 3600 * 1000;

// Which tour a LiveScore stage belongs to, or null when the desklet does not
// show it (Challengers, ITF, qualifying, juniors, team events, unknown tours).
function _lsStageInfo(stage) {
    let level = String(stage.Cnm || "");
    let stageName = String(stage.Snm || "");
    if (LS_SKIP_STAGE_RE.test(stageName)) {
        return null;
    }
    if (LS_SLAM_RE.test(level)) {
        return {
            slam: true,
            tour: /^women/i.test(stageName) ? "WTA" : (/^men/i.test(stageName) ? "ATP" : "")
        };
    }
    if (/^ATP/i.test(level) && !/challenger/i.test(level)) {
        return { slam: false, tour: "ATP" };
    }
    if (/^WTA/i.test(level)) {
        return { slam: false, tour: "WTA" };
    }
    return null;
}

// A day feed is ~60 KB of mostly Challenger and ITF matches plus media and
// betting ids. Keep only what is shown so the cached feeds stay small.
function _slimLivescore(json) {
    let stages = [];
    let src = (json && json.Stages) || [];
    for (let s = 0; s < src.length; s++) {
        if (!_lsStageInfo(src[s])) {
            continue;
        }
        let events = [];
        let evs = src[s].Events || [];
        for (let e = 0; e < evs.length; e++) {
            let ev = {};
            for (let k in evs[e]) {
                if (LS_KEEP_EVENT_KEY_RE.test(k)) {
                    ev[k] = evs[e][k];
                }
            }
            for (let side = 1; side <= 2; side++) {
                ev["T" + side] = (evs[e]["T" + side] || []).map(function (pl) {
                    return { Nm: pl.Nm, ID: pl.ID };
                });
            }
            events.push(ev);
        }
        stages.push({
            Sid: src[s].Sid, Snm: src[s].Snm, Scd: src[s].Scd,
            Cnm: src[s].Cnm, Ccd: src[s].Ccd, Events: events
        });
    }
    return { Stages: stages };
}

function TennisTodayDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

TennisTodayDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.metadata = metadata;
        this.enableAtp = true;
        this.enableWta = true;
        this.enableGrandSlam = true;
        this.showDoubles = true;
        this.showTier1000 = true;
        this.showTier500 = true;
        this.showTier250 = true;
        this.showTierOther = true;
        this.refreshSeconds = 60;
        this.showCompleted = true;
        this.maxCompleted = 40;
        this.showUpcoming = true;
        this.maxUpcoming = 40;
        this.maxLive = 40;
        this.deskletWidth = 420;
        this.maxHeight = 720;

        this._matches = [];
        this._error = null;
        this._updatedAt = null;
        this._timer = null;
        this._httpSession = null;
        this._cancellable = null;
        this._destroyed = false;
        this._serveGicon = undefined;
        this._fetching = false;
        this._fetchStartedAt = 0;
        this._lastSnapshot = "";
        this._lsDays = {};
        this._lsDayAt = {};
        this._lsLive = null;
        this._lsLiveKey = null;
        this._enrichByEid = {};
        this._tourInfo = {};
        this._seedByKey = {};
        this._playerCountry = {};
        this._scrollHeight = 0;
        this._scrollView = null;
        this._scrollRestoreId = 0;
        this._actorSignals = [];
        this._moveTimer = null;
        this._renderTimer = null;
        this._dragging = false;
        this._dragSignals = [];
        this._matchActors = {};
        this._matchUsed = {};
        this._headerCache = [];
        this._headerAt = 0;
        this._pointsSeen = false;
        this._showPoints = false;

        this._initHttp();
        this._bindSettings(deskletId);
        this._buildChrome();
        this.setHeader(_("TennisToday"));
        this._populateContextMenu();
        if (this.actor) {
            this._actorSignals.push(this.actor.connect("notify::y", () => this._onMoved()));
            this._actorSignals.push(this.actor.connect("notify::mapped", () => this._onMoved()));
        }
        this._watchDrag();
        this._render();
        this._fetch();
        this._schedule();
    },

    _initHttp: function () {
        this._cancellable = new Gio.Cancellable();
        if (IS_SOUP_2) {
            this._httpSession = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());
            try {
                Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ContentDecoder());
            } catch (e) {
                global.logWarning(UUID + " gzip unavailable: " + e);
            }
        } else {
            this._httpSession = new Soup.Session();
        }
        this._httpSession.timeout = 45;
        this._httpSession.idle_timeout = 45;
    },

    _bindSettings: function (deskletId) {
        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-atp", "enableAtp", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-wta", "enableWta", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-grand-slam", "enableGrandSlam", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-doubles", "showDoubles", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-tier-1000", "showTier1000", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-tier-500", "showTier500", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-tier-250", "showTier250", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-tier-other", "showTierOther", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-seconds", "refreshSeconds", this._onRefreshSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-completed", "showCompleted", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-completed", "maxCompleted", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-upcoming", "showUpcoming", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-upcoming", "maxUpcoming", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-live", "maxLive", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-height", "maxHeight", this._onSettingsChanged, null);
    },

    // Rebuilding the list while the desklet is being dragged destroys the actor
    // under the pointer, the drop is lost and the desklet keeps following the
    // mouse. Hold renders until the drag ends, then redraw (and re-measure the
    // room left on screen at the new position).
    _watchDrag: function () {
        let drag = this._draggable;
        if (!drag || !drag.connect) {
            return;
        }
        let begin = () => {
            this._dragging = true;
        };
        let end = () => {
            this._dragging = false;
            this._onSettingsChanged();
        };
        this._dragSignals.push(drag.connect("drag-begin", begin));
        this._dragSignals.push(drag.connect("drag-end", end));
        this._dragSignals.push(drag.connect("drag-cancelled", end));
    },

    // A slider or spin button fires on every step; rebuilding the whole list
    // each time made the desklet flicker while its settings were open.
    _onSettingsChanged: function () {
        if (this._renderTimer) {
            Mainloop.source_remove(this._renderTimer);
        }
        this._renderTimer = Mainloop.timeout_add(RENDER_DEBOUNCE_MS, () => {
            this._renderTimer = null;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    },

    _onMoved: function () {
        if (this._dragging) {
            return;
        }
        if (this._moveTimer) {
            Mainloop.source_remove(this._moveTimer);
        }
        this._moveTimer = Mainloop.timeout_add(300, () => {
            this._moveTimer = null;
            if (this._availableHeight() !== this._scrollHeight) {
                this._render();
            }
            return GLib.SOURCE_REMOVE;
        });
    },

    // Keep the list on screen: a desklet placed low on the monitor would
    // otherwise push the bottom of the scroll area past the screen edge.
    _availableHeight: function () {
        let maxH = this.maxHeight || 720;
        if (!this.actor || !this.actor.mapped) {
            return maxH;
        }
        try {
            let monitor = Main.layoutManager.findMonitorForActor(this.actor);
            let [, y] = this.actor.get_transformed_position();
            if (monitor && y >= monitor.y) {
                let room = monitor.y + monitor.height - y - DESKLET_CHROME_V_PX;
                maxH = Math.min(maxH, Math.max(MIN_SCROLL_PX, Math.floor(room)));
            }
        } catch (e) {
        }
        return maxH;
    },

    _onRefreshSettingChanged: function () {
        this._schedule();
    },

    _populateContextMenu: function () {
        let refresh = new PopupMenu.PopupMenuItem(_("Refresh now"));
        refresh.connect("activate", () => this._fetch(true));
        this._menu.addMenuItem(refresh);

        let open = new PopupMenu.PopupMenuItem(_("Open ESPN scoreboard"));
        open.connect("activate", () => this._openUrl(ESPN_PAGE));
        this._menu.addMenuItem(open);
    },

    _openUrl: function (url) {
        url = _safeLink(url);
        if (!url) {
            return;
        }
        try {
            Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
        } catch (e) {
            global.logError(UUID + " failed to open URL: " + e);
        }
    },

    _buildChrome: function () {
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: "lt-desklet"
        });
        this._root.clip_to_allocation = false;
        this.setContent(this._root);
        if (this.content) {
            this.content.clip_to_allocation = false;
        }
        if (this.actor) {
            this.actor.clip_to_allocation = false;
        }
    },

    _escapeMarkup: function (value) {
        return GLib.markup_escape_text(String(value), -1);
    },

    _tiebreakMarkup: function (games, tiebreak) {
        let gamesText = this._escapeMarkup(games);
        if (tiebreak === undefined || tiebreak === null || tiebreak === "") {
            return gamesText;
        }
        return gamesText + '<span size="xx-small" rise="6000">(' + this._escapeMarkup(tiebreak) + ")</span>";
    },

    _scoreLineMarkup: function (score) {
        return this._escapeMarkup(score).replace(/\((\d+(?:-\d+)?)\)/g, '<span size="xx-small" rise="6000">($1)</span>');
    },

    _label: function (text, styleClass, wrap, noEllipsize, markup) {
        let label = new St.Label({
            style_class: styleClass || ""
        });
        if (markup) {
            label.clutter_text.set_markup(text || "");
        } else {
            label.set_text(text || "");
        }
        if (label.clutter_text) {
            label.clutter_text.ellipsize = (wrap || noEllipsize) ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
            if (wrap) {
                label.clutter_text.line_wrap = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            }
        }
        return label;
    },

    _selectedMatches: function () {
        let live = [];
        let finished = [];
        let upcoming = [];

        for (let i = 0; i < this._matches.length; i++) {
            let m = this._matches[i];
            if (m.isGrandSlam) {
                if (!this.enableGrandSlam) {
                    continue;
                }
            } else if (m.tour === "ATP") {
                if (!this.enableAtp) {
                    continue;
                }
            } else if (m.tour === "WTA") {
                if (!this.enableWta) {
                    continue;
                }
            } else {
                continue;
            }
            if (m.isDoubles && !this.showDoubles) {
                continue;
            }
            if (!m.isGrandSlam && !this._tierEnabled(m.tier)) {
                continue;
            }
            let now = Date.now();
            let startMs = m.startMs;

            if (m.status === "Finished") {
                if (_recentlyFinished(startMs, now)) {
                    finished.push(m);
                }
            } else if (m.status === "Live") {
                live.push(m);
            } else if (m.status === "Upcoming" && _upcomingSoon(startMs, now)) {
                upcoming.push(m);
            }
        }

        finished.sort(function (a, b) {
            let am = a.startMs;
            let bm = b.startMs;
            if (isNaN(am) && isNaN(bm)) {
                return 0;
            }
            if (isNaN(am)) {
                return 1;
            }
            if (isNaN(bm)) {
                return -1;
            }
            return bm - am;
        });

        upcoming.sort(function (a, b) {
            let am = a.startMs;
            let bm = b.startMs;
            if (isNaN(am) && isNaN(bm)) {
                return 0;
            }
            if (isNaN(am)) {
                return 1;
            }
            if (isNaN(bm)) {
                return -1;
            }
            return am - bm;
        });

        live = live.slice(0, this.maxLive || 40);
        if (this.showCompleted) {
            finished = finished.slice(0, this.maxCompleted || 0);
        } else {
            finished = [];
        }
        if (this.showUpcoming) {
            upcoming = upcoming.slice(0, this.maxUpcoming || 40);
        } else {
            upcoming = [];
        }
        return { live: live, finished: finished, upcoming: upcoming };
    },

    _tierEnabled: function (tier) {
        let group = _tierGroup(tier);
        if (group === "1000") {
            return !!this.showTier1000;
        }
        if (group === "500") {
            return !!this.showTier500;
        }
        if (group === "250") {
            return !!this.showTier250;
        }
        return !!this.showTierOther;
    },

    _maxSetColumns: function (matches) {
        let n = 0;
        for (let i = 0; i < matches.length; i++) {
            let teams = matches[i].teams || [];
            for (let t = 0; t < teams.length; t++) {
                let cols = (teams[t].linescores || []).length;
                if (cols > n) {
                    n = cols;
                }
            }
        }
        return n;
    },

    _fittedWidth: function (setCols, withPoints) {
        let needed = SCORE_FIT_BASE_PX + Math.max(setCols, 1) * SET_COL_PX + CHROME_PX
            + (withPoints ? POINTS_COL_PX + POINTS_GAP_PX : 0);
        return Math.max(this.deskletWidth || 420, needed);
    },

    _render: function () {
        if (this._destroyed || !this._root || this._dragging) {
            return;
        }
        // Every score change rebuilds the list; keep the reader's place in it.
        let keepScroll = this._scrollView ? this._scrollView.vscroll.adjustment.value : 0;
        this._dropScrollRestore();
        this._scrollView = null;
        // Match rows are reused when nothing about them changed. Detach them so
        // clearing the list does not destroy them: tearing down thousands of
        // actors on every refresh stalled Cinnamon for seconds at a time.
        this._detachMatchActors();
        this._root.destroy_all_children();

        let groups = this._selectedMatches();
        let visible = groups.live.concat(groups.upcoming, groups.finished);
        let liveRows = visible.filter(function (m) { return m.status === "Live"; });
        if (liveRows.some(function (m) { return m.teams.some(function (t) { return !!t.points; }); })) {
            this._pointsSeen = true;
        }
        // Reserve the column for every live match once points have been seen,
        // so the list does not widen and narrow between games.
        this._showPoints = this._pointsSeen && liveRows.length > 0;
        let widthPx = this._fittedWidth(this._maxSetColumns(visible), this._showPoints);
        this._root.style = "min-width: " + widthPx + "px; width: " + widthPx + "px;";
        this._root.clip_to_allocation = false;

        this._root.add_child(this._buildHeader());

        if (this._error && this._matches.length === 0) {
            this._root.add_child(this._label(this._error, "lt-error", true));
            this._pruneMatchActors();
            return;
        }

        this._scrollHeight = this._availableHeight();
        let scroll = new St.ScrollView({
            style: "max-height: " + this._scrollHeight + "px;",
            x_expand: true
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.overlay_scrollbars = true;
        // Unclipped, rows scrolled above the list stay clickable over the
        // header, so the refresh button opened a match on ESPN instead.
        scroll.clip_to_allocation = true;

        let inner = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: "padding-right: " + SCORE_GUTTER_PX + "px;"
        });
        let any = false;

        if (groups.live.length) {
            inner.add_child(this._label(_("LIVE"), "lt-section-label"));
            this._appendGroupedMatches(inner, groups.live);
            any = true;
        }
        if (groups.upcoming.length) {
            if (any) {
                inner.add_child(this._sectionRule());
            }
            inner.add_child(this._label(_("Upcoming"), "lt-section-label"));
            this._appendGroupedMatches(inner, groups.upcoming);
            any = true;
        }
        if (groups.finished.length) {
            if (any) {
                inner.add_child(this._sectionRule());
            }
            inner.add_child(this._label(_("Recently finished"), "lt-section-label"));
            this._appendGroupedMatches(inner, groups.finished);
            any = true;
        }

        if (!any) {
            inner.add_child(this._label(_("No matches to show"), "lt-empty", true));
        }

        if (scroll.add_actor) {
            scroll.add_actor(inner);
        } else {
            scroll.add_child(inner);
        }
        this._root.add_child(scroll);
        this._scrollView = scroll;
        this._pruneMatchActors();
        this._restoreScroll(scroll, keepScroll);
    },

    _restoreScroll: function (scroll, value) {
        if (!(value > 0)) {
            return;
        }
        let adj = scroll.vscroll.adjustment;
        // The adjustment's range is only known once the new list is laid out.
        this._scrollRestoreId = adj.connect("changed", () => {
            if (adj.upper <= adj.page_size) {
                return;
            }
            this._dropScrollRestore();
            adj.value = Math.min(value, adj.upper - adj.page_size);
        });
    },

    _dropScrollRestore: function () {
        if (this._scrollRestoreId && this._scrollView) {
            this._scrollView.vscroll.adjustment.disconnect(this._scrollRestoreId);
        }
        this._scrollRestoreId = 0;
    },

    _sectionRule: function () {
        return new St.Widget({
            style_class: "lt-section-rule",
            x_expand: true,
            height: 1
        });
    },

    _buildHeader: function () {
        let header = new St.BoxLayout({
            vertical: false,
            style_class: "lt-header"
        });

        let titleBox = new St.BoxLayout({ vertical: true, x_expand: true });
        titleBox.add_child(this._label(_("TennisToday"), "lt-title"));
        let stamp = this._fetching
            ? _("Updating…")
            : (this._updatedAt ? _("Updated %s").format(this._updatedAt) : _("Waiting for scores"));
        titleBox.add_child(this._label(stamp, "lt-updated"));
        header.add_child(titleBox);

        let refresh = new St.Button({
            style_class: "lt-refresh-button",
            label: "↺"
        });
        refresh.connect("clicked", () => this._fetch(true));
        header.add_child(refresh);

        let settingsBtn = new St.Button({ style_class: "lt-refresh-button" });
        settingsBtn.set_child(new St.Icon({
            icon_name: "preferences-system-symbolic",
            icon_size: 16,
            style_class: "lt-header-icon"
        }));
        settingsBtn.connect("clicked", () => this.configureDesklet());
        header.add_child(settingsBtn);
        return header;
    },

    _matchSignature: function (m) {
        let parts = [m.id, m.status, m.summary || "", m.endNote || "", m.link || "", m.eventType || "",
            m.roundName || "", m.courtName || "", m.status === "Live" && this._showPoints ? "p" : ""];
        if (m.status === "Upcoming") {
            // The time reads "Tomorrow · ..." depending on today's date.
            parts.push(String(m.startMs), _localYmd(Date.now()));
        }
        for (let t = 0; t < (m.teams || []).length; t++) {
            let tm = m.teams[t];
            parts.push(tm.name || "", String(tm.seed || ""), tm.country || "", tm.serving ? "1" : "0",
                tm.winner ? "1" : "0", tm.points || "", tm.score || "");
            let lines = tm.linescores || [];
            for (let k = 0; k < lines.length; k++) {
                parts.push(String(lines[k].value), String(lines[k].tiebreak || ""));
            }
        }
        return parts.join("\t");
    },

    _matchActor: function (m) {
        let sig = this._matchSignature(m);
        let actor = this._matchActors[sig];
        if (!actor) {
            actor = this._buildMatch(m);
            this._matchActors[sig] = actor;
        }
        this._matchUsed[sig] = true;
        return actor;
    },

    _detachMatchActors: function () {
        this._matchUsed = {};
        for (let sig in this._matchActors) {
            let actor = this._matchActors[sig];
            let parent = actor.get_parent();
            if (parent) {
                parent.remove_child(actor);
            }
        }
    },

    _pruneMatchActors: function () {
        for (let sig in this._matchActors) {
            if (!this._matchUsed[sig]) {
                this._matchActors[sig].destroy();
                delete this._matchActors[sig];
            }
        }
    },

    _appendGroupedMatches: function (parent, matches) {
        let lastKey = null;
        for (let i = 0; i < matches.length; i++) {
            let m = matches[i];
            let key = m.tour + "|" + m.tournament;
            if (key !== lastKey) {
                parent.add_child(this._buildTournamentHeader(m));
                lastKey = key;
            }
            parent.add_child(this._matchActor(m));
        }
    },

    _buildTournamentHeader: function (match) {
        let row = new St.BoxLayout({
            vertical: false,
            style_class: "lt-tournament-row"
        });
        let badge = match.badge || match.tour;
        let badgeText = badge;
        let tourClass = "lt-tour-other";
        if (badge === "Grand Slam") {
            tourClass = "lt-tour-slam";
            badgeText = _("Grand Slam");
        } else if (match.tour === "ATP") {
            tourClass = "lt-tour-atp";
        } else if (match.tour === "WTA") {
            tourClass = "lt-tour-wta";
        }
        if (match.tier && badge !== "Grand Slam") {
            // "ATP500" rather than "ATP 500": the tag is the cheapest place for the level.
            badgeText = match.tour + (/^\d+$/.test(match.tier) ? "" : " ") + match.tier;
        }
        row.add_child(this._label(badgeText, "lt-tour-badge " + tourClass));
        let name = match.tournament;
        if (match.location) {
            name += "  ·  " + match.location;
        }
        let nameLabel = this._label(name, "lt-tournament-name");
        nameLabel.x_expand = true;
        row.add_child(nameLabel);
        return row;
    },

    _buildMatch: function (match) {
        let box = new St.BoxLayout({
            vertical: true,
            style_class: "lt-match",
            reactive: true
        });

        let metaBits = [];
        if (match.eventType) {
            metaBits.push(match.eventType);
        }
        if (match.roundName) {
            metaBits.push(match.roundName);
        }
        if (match.courtName) {
            metaBits.push(match.courtName);
        }
        if (metaBits.length) {
            box.add_child(this._label(metaBits.join("  ·  "), "lt-match-meta"));
        }

        _markSetWinners(match.teams);
        let maxSets = 0;
        for (let i = 0; i < match.teams.length; i++) {
            maxSets = Math.max(maxSets, (match.teams[i].linescores || []).length);
        }

        let live = match.status === "Live";
        let showPoints = live && this._showPoints;
        for (let i = 0; i < match.teams.length; i++) {
            box.add_child(this._buildTeamRow(match.teams[i], maxSets, live, showPoints));
        }

        let statusClass = "lt-status-upcoming";
        if (match.status === "Live") {
            statusClass = "lt-status-live";
        } else if (match.status === "Finished") {
            statusClass = "lt-status-finished";
        }
        let statusText = match.endNote
            // Translators: %s is how the match ended, e.g. "Finished · Retired".
            ? _("Finished · %s").format(match.endNote)
            : _("Finished");
        if (match.status === "Live") {
            let liveBit = _liveSummary(match.summary, maxSets);
            // Translators: %s is the current set, e.g. "LIVE · Set 3".
            statusText = liveBit ? _("LIVE · %s").format(liveBit) : _("LIVE");
        } else if (match.status === "Upcoming") {
            statusText = _formatMatchTime(match.startMs) || match.summary || _("Upcoming");
            if (!isNaN(match.startMs) && _localYmd(match.startMs) !== _localYmd(Date.now()) && match.startMs > Date.now()) {
                // Translators: %s is a start time, e.g. "Tomorrow · 6:30 AM EDT".
                statusText = _("Tomorrow · %s").format(statusText);
            }
        }
        box.add_child(this._label(statusText, statusClass));

        if (match.link) {
            box.connect("button-press-event", (actor, event) => {
                if (event.get_button() === 1) {
                    this._openUrl(match.link);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
        return box;
    },

    _serveIcon: function () {
        if (this._serveGicon === undefined) {
            this._serveGicon = null;
            try {
                this._serveGicon = new Gio.FileIcon({
                    file: Gio.File.new_for_path(this.metadata.path + "/icon.png")
                });
            } catch (e) {
                global.logError(UUID + " serve icon error: " + e);
            }
        }
        return this._serveGicon;
    },

    _serveMarker: function (serving) {
        let wrap = new St.Bin({
            style_class: "lt-serve-wrap",
            x_expand: false
        });
        wrap.set_width(SERVE_COL_PX);
        if (serving) {
            let gicon = this._serveIcon();
            wrap.set_child(gicon
                ? new St.Icon({ gicon: gicon, icon_size: 14, style_class: "lt-serve-ball" })
                : this._label("●", "lt-serve", false, true));
        }
        return wrap;
    },

    _buildTeamRow: function (team, maxSets, live, showPoints) {
        let row = new St.BoxLayout({ vertical: false });

        row.add_child(this._serveMarker(!!(live && team.serving)));

        let name = team.name;
        let nameClass = team.winner ? "lt-player-winner" : "lt-player-name";
        let nameCluster = new St.BoxLayout({ vertical: false, x_expand: false });
        nameCluster.add_child(this._label(name, nameClass, false, true));
        if (team.seed) {
            nameCluster.add_child(this._label("(" + team.seed + ")", "lt-player-seed", false, true));
        }
        if (team.country) {
            nameCluster.add_child(this._label(team.country, "lt-country", false, true));
        }
        row.add_child(nameCluster);
        row.add_child(new St.Bin({ x_expand: true }));

        let scoreBox = new St.BoxLayout({
            vertical: false,
            style_class: "lt-score-box",
            x_expand: false
        });
        if (maxSets > 0) {
            let lines = team.linescores || [];
            for (let i = 0; i < maxSets; i++) {
                let ls = lines[i];
                let text = " ";
                let cls = "lt-set";
                let markup = false;
                if (ls && ls.value != null && ls.value !== "") {
                    if (ls.tiebreak && Number(ls.value) >= 6) {
                        text = this._tiebreakMarkup(ls.value, ls.tiebreak);
                        markup = true;
                    } else {
                        let num = Number(ls.value);
                        text = isNaN(num) ? String(ls.value) : String(Math.round(num));
                    }
                    if (ls.winner) {
                        cls += " lt-set-win";
                    }
                }
                let cell = new St.Bin({
                    style_class: "lt-set-cell",
                    x_expand: false
                });
                cell.set_width(SET_COL_PX);
                cell.set_child(this._label(text, cls, false, true, markup));
                scoreBox.add_child(cell);
            }
        } else if (team.score) {
            scoreBox.add_child(this._label(this._scoreLineMarkup(team.score), "lt-score-line", false, true, true));
        }
        if (showPoints) {
            let pt = team.points || "";
            let ptCell = new St.Bin({
                style_class: "lt-points-cell",
                x_expand: false
            });
            ptCell.set_width(POINTS_COL_PX);
            ptCell.set_child(this._label(pt, "lt-points", false, true));
            scoreBox.add_child(ptCell);
        }
        row.add_child(scoreBox);
        row.add_child(new St.Bin({
            width: SCORE_GUTTER_PX,
            x_expand: false
        }));
        return row;
    },

    _schedule: function () {
        if (this._timer) {
            Mainloop.source_remove(this._timer);
            this._timer = null;
        }
        let seconds = Math.max(MIN_REFRESH_SECONDS, parseInt(this.refreshSeconds, 10) || 60);
        this._timer = Mainloop.timeout_add_seconds(seconds, () => {
            if (this._fetching && this._fetchStartedAt && (Date.now() - this._fetchStartedAt > FETCH_WATCHDOG_MS)) {
                global.logError(UUID + " fetch stuck for " + Math.round((Date.now() - this._fetchStartedAt) / 1000) + "s, resetting");
                this._fetching = false;
            }
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _headerUrls: function () {
        // ESPN's header feed is only used to enrich LiveScore matches with
        // seeds, rounds, courts and countries, so both tours are always read.
        return [ESPN_URL, ESPN_URL + "&league=atp"];
    },

    _fetchHeaders: function (done) {
        let urls = this._headerUrls();
        if (!urls.length) {
            done([]);
            return;
        }
        let left = urls.length;
        let all = [];
        for (let i = 0; i < urls.length; i++) {
            this._fetchJson(urls[i], (json) => {
                if (json) {
                    all = all.concat(parseEspnHeader(json));
                }
                left -= 1;
                if (left <= 0) {
                    done(all);
                }
            });
        }
    },

    _matchTourEnabled: function (league, tournament) {
        if (_isGrandSlam(tournament) && this.enableGrandSlam) {
            return true;
        }
        if (league === "wta") {
            return !!this.enableWta;
        }
        return !!this.enableAtp;
    },

    _fetchLivescore: function (force, done) {
        let now = Date.now();
        let todayKey = _utcCompact(now);
        let days = [-1, 0, 1].map(function (d) {
            return _utcCompact(now + d * 24 * 3600 * 1000);
        });
        for (let k in this._lsDays) {
            if (days.indexOf(k) === -1) {
                delete this._lsDays[k];
                delete this._lsDayAt[k];
            }
        }
        // The live feed is tiny and carries every score and point, so it is read
        // each refresh. The ~60 KB day feeds only matter when a match starts or
        // finishes (the live set changes) or a schedule shifts (they age).
        this._fetchJson(LIVESCORE_URL + "/live/tennis/0?MD=1", (json) => {
            let ok = !!(json && json.Stages);
            this._lsLive = ok ? _slimLivescore(json) : null;
            let key = "";
            if (ok) {
                this._lsLive.Stages.forEach(function (st) {
                    st.Events.forEach(function (ev) {
                        key += ev.Eid + ",";
                    });
                });
            }
            let liveChanged = !ok || key !== this._lsLiveKey;
            this._lsLiveKey = key;
            let jobs = [];
            for (let i = 0; i < days.length; i++) {
                let day = days[i];
                let aged = !this._lsDays[day] || now - this._lsDayAt[day] > LIST_INTERVAL_MS;
                if (force || aged || (liveChanged && day === todayKey)) {
                    jobs.push(day);
                }
            }
            if (!jobs.length) {
                done();
                return;
            }
            let left = jobs.length;
            for (let j = 0; j < jobs.length; j++) {
                let day = jobs[j];
                this._fetchJson(LIVESCORE_URL + "/date/tennis/" + day + "/0?MD=1", (dayJson) => {
                    if (dayJson && dayJson.Stages) {
                        this._lsDays[day] = _slimLivescore(dayJson);
                        this._lsDayAt[day] = Date.now();
                    }
                    left -= 1;
                    if (left <= 0) {
                        done();
                    }
                }, true);
            }
        }, true);
    },

    _lsLink: function (stage, ev) {
        let base = "https://www.livescore.com/en/tennis/" + stage.Ccd + "/" + stage.Scd + "/";
        let t1 = ev.T1 || [];
        let t2 = ev.T2 || [];
        if (t1.length !== 1 || t2.length !== 1) {
            return base;
        }
        return base + _slug(t1[0].Nm) + "-vs-" + _slug(t2[0].Nm) + "/" + ev.Eid + "/";
    },

    _lsTeams: function (ev, status) {
        let sets = 0;
        while (ev["Tr1S" + (sets + 1)] !== undefined && ev["Tr2S" + (sets + 1)] !== undefined) {
            sets += 1;
        }
        let serverSide = parseInt(ev.Esrv, 10) || 0;
        let winSide = parseInt(ev.Ewt, 10) || 0;
        let teams = [];
        for (let side = 1; side <= 2; side++) {
            let players = ev["T" + side] || [];
            let lines = [];
            for (let n = 1; n <= sets; n++) {
                lines.push({
                    value: Number(ev["Tr" + side + "S" + n]),
                    tiebreak: ev["Tr" + side + "S" + n + "T"] || null,
                    winner: false
                });
            }
            teams.push({
                name: players.map(function (pl) { return pl.Nm; }).join(" / ") || _("TBD"),
                names: players.map(function (pl) { return pl.Nm; }),
                seed: null,
                athleteId: players.map(function (pl) { return pl.ID; }).join("|"),
                country: "",
                score: "",
                points: status === "Live" ? _formatPoints(ev["Tr" + side + "G"]) : "",
                linescores: lines,
                serving: status === "Live" && serverSide === side,
                winner: status === "Finished" && winSide === side,
                isDoubles: players.length > 1
            });
        }
        return teams;
    },

    _lsMatch: function (stage, ev, now) {
        let level = String(stage.Cnm || "");
        let stageName = String(stage.Snm || "");
        let info = _lsStageInfo(stage);
        if (!info) {
            return null;
        }
        let slam = info.slam;
        let tour = info.tour;

        let eps = String(ev.Eps || "");
        let status;
        if (LS_LIVE_RE.test(eps)) {
            status = "Live";
        } else if (LS_DONE_RE.test(eps)) {
            status = "Finished";
        } else if (eps === "NS") {
            status = "Upcoming";
        } else {
            return null;
        }
        let startMs = _lsTime(ev.Esd);
        if (status === "Upcoming" && !isNaN(startMs) && now - startMs > LS_STALE_UPCOMING_MS) {
            return null;
        }
        let t1 = ev.T1 || [];
        let t2 = ev.T2 || [];
        if (!t1.length || !t2.length) {
            return null;
        }
        let teams = this._lsTeams(ev, status);
        let isDoubles = t1.length > 1;
        let name = slam ? level : stageName;
        let sets = teams[0].linescores.length;
        let period = /^S\d$/.test(eps) ? parseInt(eps.substring(1), 10) : sets;
        let endNote = "";
        if (eps === "Ret.") {
            endNote = _("Retired");
        } else if (eps === "W.O.") {
            endNote = _("Walkover");
        }
        let eventType = slam
            ? stageName
            : ((tour === "WTA" ? _("Women's") : _("Men's")) + " " + (isDoubles ? _("Doubles") : _("Singles")));
        return {
            id: "ls" + ev.Eid,
            compId: "ls" + ev.Eid,
            sid: String(stage.Sid || ""),
            tour: tour,
            tier: slam ? "" : _tierFromLevel(level),
            isGrandSlam: slam,
            badge: slam ? "Grand Slam" : tour,
            tournament: name,
            location: "",
            roundName: "",
            courtName: "",
            eventType: eventType,
            status: status,
            statusCode: status === "Live" ? "in" : (status === "Finished" ? "post" : "pre"),
            summary: status === "Live" && eps !== "ToFi" ? _liveSummary("", period) : "",
            endNote: endNote,
            leadText: "",
            teams: teams,
            isDoubles: isDoubles,
            recent: status !== "Upcoming",
            link: this._lsLink(stage, ev),
            start: isNaN(startMs) ? "" : new Date(startMs).toISOString(),
            startMs: startMs,
            isToday: _etYmd(startMs) === _etYmd(now)
        };
    },

    _lsMatches: function (now) {
        let byEid = {};
        let order = [];
        let feeds = Object.keys(this._lsDays).sort().map((k) => this._lsDays[k]);
        // The live feed goes last so its fresher rows replace the day feeds'.
        if (this._lsLive) {
            feeds.push(this._lsLive);
        }
        for (let f = 0; f < feeds.length; f++) {
            let stages = feeds[f].Stages || [];
            for (let s = 0; s < stages.length; s++) {
                let events = stages[s].Events || [];
                for (let e = 0; e < events.length; e++) {
                    let m = this._lsMatch(stages[s], events[e], now);
                    let eid = events[e].Eid;
                    if (m) {
                        if (!byEid[eid]) {
                            order.push(eid);
                        }
                        byEid[eid] = m;
                    } else if (byEid[eid]) {
                        delete byEid[eid];
                    }
                }
            }
        }
        return order.filter(function (eid) { return !!byEid[eid]; }).map(function (eid) {
            return byEid[eid];
        });
    },

    // ESPN knows the seeds, rounds, courts and countries LiveScore lacks. Read
    // them from its header feed, remembering what each match once had because
    // ESPN drops finished matches from the feed sooner than we stop showing them.
    _enrich: function (matches, header) {
        let byPair = {};
        let bySurnames = {};
        for (let i = 0; i < (header || []).length; i++) {
            let h = header[i];
            if (_isPlaceholderMatch((h.teams || []).map(function (t) { return { name: t.name, id: t.athleteId }; }))) {
                continue;
            }
            let teams = h.teams || [];
            let info = {
                tournament: h.tournament,
                location: h.location,
                roundName: h.roundName,
                courtName: h.courtName,
                players: []
            };
            if (!h.isDoubles) {
                for (let t = 0; t < teams.length; t++) {
                    info.players.push({
                        key: _nameKey(teams[t].name),
                        sur: _surnameKey(teams[t].name),
                        seed: teams[t].seed,
                        country: teams[t].country
                    });
                }
            }
            let keys = teams.map(function (t) { return _teamKey(String(t.name || "").split("/")); });
            byPair[_pairKey(keys)] = info;
            if (!h.isDoubles) {
                bySurnames[_pairKey(teams.map(function (t) { return _surnameKey(t.name); }))] = info;
            }
        }

        let seen = {};
        for (let i = 0; i < matches.length; i++) {
            let m = matches[i];
            seen[m.id] = true;
            let keys = m.teams.map(function (t) { return _teamKey(t.names); });
            let info = byPair[_pairKey(keys)];
            if (!info && !m.isDoubles) {
                info = bySurnames[_pairKey(m.teams.map(function (t) { return _surnameKey(t.names[0]); }))];
            }
            if (info) {
                this._enrichByEid[m.id] = info;
                if (info.tournament) {
                    this._tourInfo[m.sid] = { name: info.tournament, location: info.location };
                }
                for (let p = 0; p < info.players.length; p++) {
                    let pl = info.players[p];
                    if (pl.country) {
                        this._playerCountry[pl.key] = pl.country;
                    }
                    if (pl.seed) {
                        this._seedByKey[m.sid + "|" + pl.key] = pl.seed;
                    }
                }
            } else {
                info = this._enrichByEid[m.id];
            }
            if (info) {
                m.roundName = info.roundName || "";
                m.courtName = info.courtName || "";
            }
        }
        for (let eid in this._enrichByEid) {
            if (!seen[eid]) {
                delete this._enrichByEid[eid];
            }
        }
        // Forget tournaments no longer on screen; keep the country cache bounded.
        let sids = {};
        matches.forEach(function (m) { sids[m.sid] = true; });
        for (let k in this._seedByKey) {
            if (!sids[k.substring(0, k.indexOf("|"))]) {
                delete this._seedByKey[k];
            }
        }
        for (let sid in this._tourInfo) {
            if (!sids[sid]) {
                delete this._tourInfo[sid];
            }
        }
        if (Object.keys(this._playerCountry).length > 2000) {
            this._playerCountry = {};
        }
        for (let i = 0; i < matches.length; i++) {
            let m = matches[i];
            let tour = this._tourInfo[m.sid];
            if (tour) {
                m.tournament = tour.name;
                m.location = tour.location || "";
            }
            if (m.isDoubles) {
                continue;
            }
            for (let t = 0; t < m.teams.length; t++) {
                let key = _nameKey(m.teams[t].name);
                m.teams[t].seed = this._seedByKey[m.sid + "|" + key] || null;
                m.teams[t].country = this._playerCountry[key] || "";
            }
        }
    },

    // Without LiveScore, fall back to what ESPN's header alone can show.
    _fromHeader: function (header) {
        let kept = (header || []).filter((m) => {
            let league = m.tour === "WTA" ? "wta" : "atp";
            if (!this._matchTourEnabled(league, m.tournament)) {
                return false;
            }
            let players = (m.teams || []).map(function (t) {
                return { name: t.name, id: t.athleteId };
            });
            return !_isPlaceholderMatch(players);
        });
        let seen = {};
        let out = [];
        for (let i = 0; i < kept.length; i++) {
            let key = _matchKey(kept[i]);
            if (!seen[key]) {
                seen[key] = true;
                out.push(kept[i]);
            }
        }
        return out;
    },

    _fetch: function (force) {
        if (this._fetching || !this._httpSession) {
            return;
        }
        this._fetching = true;
        this._fetchStartedAt = Date.now();

        let left = 2;
        let tick = () => {
            left -= 1;
            if (left <= 0) {
                this._finishFetch(this._headerCache);
            }
        };
        this._fetchLivescore(force, tick);
        // Seeds, rounds and courts barely change, so ESPN's ~80 KB header is
        // read every few minutes while scores refresh every interval.
        if (!force && this._headerAt && Date.now() - this._headerAt < LIST_INTERVAL_MS) {
            tick();
        } else {
            this._fetchHeaders((matches) => {
                if (matches && matches.length) {
                    this._headerCache = matches;
                    this._headerAt = Date.now();
                }
                tick();
            });
        }
    },

    _finishFetch: function (header) {
        this._fetching = false;
        try {
            let next = this._lsMatches(Date.now());
            if (next.length) {
                this._enrich(next, header);
            } else {
                next = this._fromHeader(header);
            }
            this._applyMatches(next);
            return;
        } catch (e) {
            this._error = _("Invalid score data");
            global.logError(UUID + " merge error: " + e);
        }
        this._render();
    },

    _fetchJson: function (url, callback, live) {
        let message = Soup.Message.new("GET", url);
        try {
            message.request_headers.replace("User-Agent", USER_AGENT);
            message.request_headers.append("Accept", "application/json");
            if (live) {
                message.request_headers.replace("Cache-Control", "no-cache");
            }
        } catch (e) {
            global.logError(UUID + " header error: " + e);
        }
        if (IS_SOUP_2) {
            this._httpSession.queue_message(message, (session, msg) => {
                let json = null;
                try {
                    if (msg && msg.status_code === 200 && msg.response_body) {
                        json = JSON.parse(msg.response_body.data);
                    }
                } catch (e) {
                    global.logError(UUID + " parse error: " + e);
                }
                if (!this._destroyed) {
                    callback(json);
                }
            });
        } else {
            this._httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, this._cancellable, (session, result) => {
                let json = null;
                try {
                    if (message.get_status() === 200) {
                        let bytes = this._httpSession.send_and_read_finish(result);
                        json = JSON.parse(ByteArray.toString(bytes.get_data()));
                    }
                } catch (e) {
                    // A cancelled request during teardown is expected, not an error.
                    if (!this._destroyed) {
                        global.logError(UUID + " fetch error: " + e);
                    }
                }
                if (!this._destroyed) {
                    callback(json);
                }
            });
        }
    },

    _snapshotMatches: function (matches) {
        let parts = [];
        for (let i = 0; i < matches.length; i++) {
            let m = matches[i];
            parts.push(m.status, m.summary || "", m.tournament || "", m.roundName || "", m.tier || "", m.courtName || "", m.link || "", m.endNote || "");
            let teams = m.teams || [];
            for (let t = 0; t < teams.length; t++) {
                let tm = teams[t];
                parts.push(tm.name || "", tm.seed || "", tm.serving ? "1" : "0", tm.winner ? "1" : "0", tm.score || "", tm.points || "", tm.country || "");
                let lines = tm.linescores || [];
                for (let k = 0; k < lines.length; k++) {
                    parts.push(String(lines[k].value), String(lines[k].tiebreak || ""));
                }
            }
        }
        return parts.join("\t");
    },

    _applyMatches: function (next) {
        try {
            let error = next.length ? null : _("Could not fetch scores");
            let snap = this._snapshotMatches(next);
            if (snap === this._lastSnapshot && error === this._error) {
                return;
            }
            this._lastSnapshot = snap;
            this._matches = next;
            this._error = error;
            this._updatedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } catch (e) {
            this._error = _("Invalid score data");
            global.logError(UUID + " apply error: " + e);
        }
        this._render();
    },

    on_desklet_removed: function () {
        this._destroyed = true;
        this._dropScrollRestore();
        if (this.actor) {
            for (let i = 0; i < this._actorSignals.length; i++) {
                this.actor.disconnect(this._actorSignals[i]);
            }
        }
        this._actorSignals = [];
        if (this._draggable) {
            for (let i = 0; i < this._dragSignals.length; i++) {
                this._draggable.disconnect(this._dragSignals[i]);
            }
        }
        this._dragSignals = [];
        if (this._moveTimer) {
            Mainloop.source_remove(this._moveTimer);
            this._moveTimer = null;
        }
        if (this._renderTimer) {
            Mainloop.source_remove(this._renderTimer);
            this._renderTimer = null;
        }
        if (this._timer) {
            Mainloop.source_remove(this._timer);
            this._timer = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._httpSession) {
            try {
                this._httpSession.abort();
            } catch (e) {
            }
            this._httpSession = null;
        }
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
        this._matchActors = {};
        this._root = null;
    }
};

function main(metadata, deskletId) {
    return new TennisTodayDesklet(metadata, deskletId);
}
