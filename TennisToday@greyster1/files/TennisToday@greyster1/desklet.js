// TennisToday desklet — TennisToday@greyster1
// Desktop scores for ATP and WTA.
//
// Copyright (C) 2026 Graham Ferguson
// SPDX-License-Identifier: GPL-3.0-or-later

const Desklet = imports.ui.desklet;
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
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/tennis/leagues";
const ESPN_PAGE = "https://www.espn.com/tennis/scoreboard";
const USER_AGENT = "TennisToday-desklet (Cinnamon; +https://github.com/greyster1/TennisToday)";
const IS_SOUP_2 = Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2;
const SET_COL_PX = 28;
const POINTS_COL_PX = 36;
const SERVE_COL_PX = 22;
const SCORE_FIT_BASE_PX = 400;
const CHROME_PX = 36;
const SCORE_GUTTER_PX = 16;
const MAX_BOARD_FINISHED = 16;
const LIST_INTERVAL_MS = 180000;
const MIN_REFRESH_SECONDS = 30;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function _etYmd(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) {
        return "";
    }
    try {
        let parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date(ms));
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

function _etCompact(ms) {
    return _etYmd(ms).replace(/-/g, "");
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

function _httpsRef(ref) {
    return String(ref || "").replace(/^http:\/\//, "https://");
}

function _safeLink(url) {
    let s = String(url || "");
    return /^https?:\/\//i.test(s) ? s : "";
}

function _eventIdFromRef(ref) {
    let m = String(ref || "").match(/\/events\/([^/?]+)/);
    return m ? m[1] : "";
}

function _athleteIdFromRef(ref) {
    let m = String(ref || "").match(/\/athletes\/([^/?]+)/);
    return m ? m[1] : "";
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
    let names = (m.teams || []).map(function (t) { return t.name || ""; });
    names.sort();
    return (m.tournament || "") + "::" + names.join("|");
}

function _nameKey(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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

function _noteParts(c) {
    let notes = (c && c.notes) || [];
    let typeText = (notes[0] && notes[0].type) || "";
    let dash = typeText.indexOf(" - ");
    if (dash >= 0) {
        return {
            roundName: typeText.substring(0, dash),
            courtName: typeText.substring(dash + 3)
        };
    }
    return { roundName: typeText, courtName: "" };
}

function _courtFromComp(c) {
    let court = (c && c.court) || {};
    let name = court.description || court.name || court.displayName || "";
    if (name) {
        return name;
    }
    return _noteParts(c).courtName;
}

function _roundFromComp(c) {
    let round = (c && c.round) || {};
    let name = round.displayName || round.description || "";
    if (name) {
        return name;
    }
    return _noteParts(c).roundName;
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
        this.refreshSeconds = 60;
        this.showCompleted = true;
        this.maxCompleted = 4;
        this.showUpcoming = true;
        this.maxUpcoming = 12;
        this.maxLive = 12;
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
        this._boardCache = [];
        this._lastBoardAt = 0;
        this._lastSnapshot = "";
        this._stubCache = [];
        this._stubLoc = {};
        this._stubEvents = {};
        this._lastListAt = 0;
        this._finishedById = {};
        this._countryById = {};
        this._countryPending = {};

        this._initHttp();
        this._bindSettings(deskletId);
        this._buildChrome();
        this.setHeader(_("TennisToday"));
        this._populateContextMenu();
        this._render();
        this._fetch();
        this._schedule();
    },

    _initHttp: function () {
        this._cancellable = new Gio.Cancellable();
        if (IS_SOUP_2) {
            this._httpSession = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());
        } else {
            this._httpSession = new Soup.Session();
        }
        this._httpSession.timeout = 45;
        this._httpSession.idle_timeout = 45;
    },

    _bindSettings: function (deskletId) {
        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-atp", "enableAtp", this._onToursChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-wta", "enableWta", this._onToursChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enable-grand-slam", "enableGrandSlam", this._onToursChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-doubles", "showDoubles", this._onToursChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-seconds", "refreshSeconds", this._onRefreshSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-completed", "showCompleted", this._onToursChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-completed", "maxCompleted", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-upcoming", "showUpcoming", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-upcoming", "maxUpcoming", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-live", "maxLive", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-height", "maxHeight", this._onSettingsChanged, null);
    },

    _onSettingsChanged: function () {
        this._render();
    },

    _onToursChanged: function () {
        this._lastSnapshot = "";
        this._boardCache = [];
        this._stubCache = [];
        this._stubLoc = {};
        this._stubEvents = {};
        this._lastListAt = 0;
        this._finishedById = {};
        this._render();
        this._fetch(true);
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
            let now = Date.now();
            let startMs = m.startMs;
            let started = !isNaN(startMs) && startMs <= now;
            let startDayEt = _etYmd(startMs);
            let todayEt = _etYmd(now);
            let yesterdayEt = _etYmd(now - 24 * 3600 * 1000);
            let overnight = started && startDayEt === yesterdayEt && startDayEt !== todayEt;

            if (m.status === "Finished") {
                finished.push(m);
            } else if (m.status === "Live" || overnight) {
                live.push(m);
            } else if (m.status === "Upcoming" && (isNaN(startMs) || startDayEt === todayEt)) {
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

        live = live.slice(0, this.maxLive || 12);
        if (this.showCompleted) {
            finished = finished.slice(0, this.maxCompleted || 0);
        } else {
            finished = [];
        }
        if (this.showUpcoming) {
            upcoming = upcoming.slice(0, this.maxUpcoming || 12);
        } else {
            upcoming = [];
        }
        return { live: live, finished: finished, upcoming: upcoming };
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

    _fittedWidth: function (setCols) {
        let needed = SCORE_FIT_BASE_PX + Math.max(setCols, 1) * SET_COL_PX + CHROME_PX;
        return Math.max(this.deskletWidth || 420, needed);
    },

    _render: function () {
        if (this._destroyed || !this._root) {
            return;
        }
        this._root.destroy_all_children();

        let groups = this._selectedMatches();
        let visible = groups.live.concat(groups.upcoming, groups.finished);
        let widthPx = this._fittedWidth(this._maxSetColumns(visible));
        this._root.style = "min-width: " + widthPx + "px; width: " + widthPx + "px;";
        this._root.clip_to_allocation = false;

        this._root.add_child(this._buildHeader());

        if (this._error && this._matches.length === 0) {
            this._root.add_child(this._label(this._error, "lt-error", true));
            return;
        }

        let scroll = new St.ScrollView({
            style: "max-height: " + (this.maxHeight || 720) + "px;",
            x_expand: true
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.overlay_scrollbars = true;
        scroll.clip_to_allocation = false;

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

    _appendGroupedMatches: function (parent, matches) {
        let lastKey = null;
        for (let i = 0; i < matches.length; i++) {
            let m = matches[i];
            let key = m.tour + "|" + m.tournament;
            if (key !== lastKey) {
                parent.add_child(this._buildTournamentHeader(m));
                lastKey = key;
            }
            parent.add_child(this._buildMatch(m));
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
        let showPoints = live && match.teams.some(function (t) {
            return !!t.points;
        });
        for (let i = 0; i < match.teams.length; i++) {
            box.add_child(this._buildTeamRow(match.teams[i], maxSets, live, showPoints));
        }

        let statusClass = "lt-status-upcoming";
        if (match.status === "Live") {
            statusClass = "lt-status-live";
        } else if (match.status === "Finished") {
            statusClass = "lt-status-finished";
        }
        let statusText = _("Finished");
        if (match.status === "Live") {
            let liveBit = _liveSummary(match.summary, maxSets);
            // Translators: %s is the current set, e.g. "LIVE · Set 3".
            statusText = liveBit ? _("LIVE · %s").format(liveBit) : _("LIVE");
        } else if (match.status === "Upcoming") {
            statusText = _formatMatchTime(match.startMs) || match.summary || _("Upcoming");
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
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _toggledLeagues: function () {
        let leagues = [];
        if (this.enableAtp || this.enableGrandSlam) {
            leagues.push("atp");
        }
        if (this.enableWta || this.enableGrandSlam) {
            leagues.push("wta");
        }
        return leagues;
    },

    _headerUrls: function () {
        // ESPN header API returns WTA or ATP separately; need both URLs to get both tours.
        // WTA header is ~64KB, ATP header is ~14KB. Grand Slam upcoming comes from dated core.
        let urls = [];
        if (this.enableWta) {
            urls.push(ESPN_URL);
        }
        if (this.enableAtp || this.enableGrandSlam) {
            urls.push(ESPN_URL + "&league=atp");
        }
        return urls;
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

    _compLink: function (c) {
        let links = (c && c.links) || [];
        for (let i = 0; i < links.length; i++) {
            let rel = links[i].rel || [];
            let href = links[i].href || "";
            if (rel.indexOf("desktop") !== -1 && _safeLink(href)) {
                return href;
            }
        }
        return _safeLink(links[0] && links[0].href);
    },

    _matchFromStub: function (stub, locToName, eventNames, status, summary) {
        let c = stub.comp;
        let location = (c.venue && c.venue.address && c.venue.address.summary) || "";
        let tournament = eventNames[stub.eventId] || locToName[location] || location || _("Tournament");
        if (!this._matchTourEnabled(stub.league, tournament)) {
            return null;
        }
        let slug = (c.type && c.type.slug) || "";
        let eventType = (c.type && c.type.text) || "";
        let competitors = (c.competitors || []).slice();
        competitors.sort(function (a, b) {
            return (a.order || 0) - (b.order || 0);
        });
        let slam = _isGrandSlam(tournament);
        let countryById = this._countryById;
        return {
            id: String(c.id || ""),
            tour: stub.league === "wta" ? "WTA" : "ATP",
            isGrandSlam: slam,
            badge: slam ? "Grand Slam" : (stub.league === "wta" ? "WTA" : "ATP"),
            tournament: tournament,
            location: location,
            roundName: _roundFromComp(c),
            courtName: _courtFromComp(c),
            eventType: eventType,
            status: status,
            statusCode: status === "Upcoming" ? "pre" : "",
            summary: summary || "",
            leadText: "",
            teams: competitors.map(function (p) {
                return {
                    name: p.name || _("TBD"),
                    seed: p.tournamentSeed || null,
                    athleteId: String(p.id || ""),
                    athleteRef: p.athlete && p.athlete.$ref ? p.athlete.$ref : "",
                    country: (p.id && countryById[p.id]) || "",
                    score: "",
                    points: "",
                    linescores: [],
                    serving: false,
                    winner: !!p.winner,
                    isDoubles: p.type === "team" || /doubles/i.test(slug)
                };
            }),
            isDoubles: /doubles/i.test(slug) || /doubles/i.test(eventType),
            recent: false,
            link: this._compLink(c),
            start: c.date || "",
            startMs: c.date ? Date.parse(c.date) : NaN,
            isToday: _etYmd(c.date ? Date.parse(c.date) : NaN) === _etYmd(Date.now())
        };
    },

    _eventWanted: function (league, eventId, eventNames) {
        let name = eventNames[eventId] || "";
        if (league === "atp" && this.enableAtp) {
            return true;
        }
        if (league === "wta" && this.enableWta) {
            return true;
        }
        if (this.enableGrandSlam && (!name || _isGrandSlam(name))) {
            return true;
        }
        return false;
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

    _etDateList: function () {
        let today = _etCompact(Date.now());
        let yest = _etCompact(Date.now() - 24 * 3600 * 1000);
        if (yest && yest !== today) {
            return [yest, today];
        }
        return [today];
    },

    _mapsFromHeader: function (headerMatches) {
        let locToName = Object.assign({}, this._stubLoc);
        let eventNames = Object.assign({}, this._stubEvents);
        for (let i = 0; i < (headerMatches || []).length; i++) {
            let m = headerMatches[i];
            if (m.location && m.tournament) {
                locToName[m.location] = m.tournament;
            }
            if (m.id && m.tournament) {
                eventNames[m.id] = m.tournament;
            }
        }
        return { locToName: locToName, eventNames: eventNames };
    },

    _fetchDatedBoard: function (headerMatches, done, force) {
        let maps = this._mapsFromHeader(headerMatches);
        let locToName = maps.locToName;
        let eventNames = maps.eventNames;
        let listsFresh = !force && this._stubCache.length
            && (Date.now() - this._lastListAt < LIST_INTERVAL_MS);
        if (listsFresh) {
            this._hydrateStubs(this._stubCache, locToName, eventNames, headerMatches, done);
            return;
        }
        let leagues = this._toggledLeagues();
        if (!leagues.length) {
            done([]);
            return;
        }
        let dates = this._etDateList();
        let listsLeft = leagues.length * dates.length;
        let stubs = [];
        let finishLists = () => {
            listsLeft -= 1;
            if (listsLeft > 0) {
                return;
            }
            this._stubCache = stubs;
            this._stubLoc = locToName;
            this._stubEvents = eventNames;
            this._lastListAt = Date.now();
            this._hydrateStubs(stubs, locToName, eventNames, headerMatches, done);
        };
        for (let l = 0; l < leagues.length; l++) {
            for (let d = 0; d < dates.length; d++) {
                let league = leagues[l];
                let day = dates[d];
                // Dated event lists are a few hundred bytes. Do not GET /events/{id}:
                // that resource inlines the whole tournament (~1MB).
                this._fetchJson(ESPN_CORE + "/" + league + "/events?dates=" + day + "&limit=20", (json) => {
                    let items = (json && json.items) || [];
                    let ids = [];
                    let seen = {};
                    for (let n = 0; n < items.length; n++) {
                        let id = _eventIdFromRef(items[n].$ref || items[n]);
                        if (!id || seen[id] || !this._eventWanted(league, id, eventNames)) {
                            continue;
                        }
                        seen[id] = true;
                        ids.push(id);
                    }
                    if (!ids.length) {
                        finishLists();
                        return;
                    }
                    listsLeft += ids.length;
                    finishLists();
                    for (let x = 0; x < ids.length; x++) {
                        this._fetchJson(
                            ESPN_CORE + "/" + league + "/events/" + ids[x] + "/competitions?dates=" + day + "&limit=50",
                            (cjson) => {
                                let comps = (cjson && cjson.items) || [];
                                for (let c = 0; c < comps.length; c++) {
                                    stubs.push({ league: league, eventId: ids[x], comp: comps[c] });
                                }
                                finishLists();
                            }
                        );
                    }
                });
            }
        }
    },

    _hydrateStubs: function (stubs, locToName, eventNames, headerMatches, done) {
        let now = Date.now();
        let todayEt = _etYmd(now);
        let headerByPair = {};
        for (let h = 0; h < (headerMatches || []).length; h++) {
            let m = headerMatches[h];
            let names = (m.teams || []).map(function (t) { return t.name || ""; });
            headerByPair[_pairKeyFromNames(names)] = m;
        }
        let wanted = [];
        let upcoming = [];
        let reused = [];
        for (let i = 0; i < stubs.length; i++) {
            let stub = stubs[i];
            let c = stub.comp;
            let slug = ((c.type && c.type.slug) || "") + " " + ((c.type && c.type.text) || "");
            if (!this.showDoubles && /doubles/i.test(slug)) {
                continue;
            }
            let tName = eventNames[stub.eventId] || "";
            if (tName && !this._matchTourEnabled(stub.league, tName)) {
                continue;
            }
            let startMs = c.date ? Date.parse(c.date) : NaN;
            let names = (c.competitors || []).map(function (p) { return p.name || ""; });
            let headerHit = headerByPair[_pairKeyFromNames(names)];
            if (headerHit) {
                if (headerHit.status === "Finished") {
                    continue;
                }
                if (headerHit.status === "Upcoming" && (isNaN(startMs) || startMs > now)) {
                    continue;
                }
            }
            let cid = String(c.id || "");
            if (cid && this._finishedById[cid]) {
                reused.push(this._finishedById[cid]);
                continue;
            }
            if (!isNaN(startMs) && startMs > now) {
                if (_etYmd(startMs) === todayEt) {
                    let up = this._matchFromStub(stub, locToName, eventNames, "Upcoming", "");
                    if (up) {
                        upcoming.push(up);
                    }
                }
                continue;
            }
            wanted.push(stub);
        }
        let finishAll = (scored) => {
            done((scored || []).concat(reused).concat(upcoming));
        };
        if (!wanted.length) {
            finishAll([]);
            return;
        }
        let left = wanted.length;
        let stated = [];
        let finishStatus = () => {
            left -= 1;
            if (left > 0) {
                return;
            }
            let live = [];
            let finished = [];
            let stillUpcoming = [];
            for (let s = 0; s < stated.length; s++) {
                if (stated[s].state === "in") {
                    live.push(stated[s]);
                } else if (stated[s].state === "post") {
                    finished.push(stated[s]);
                } else if (stated[s].state === "pre") {
                    let up = this._matchFromStub(stated[s].stub, locToName, eventNames, "Upcoming", "");
                    if (up) {
                        let names = (up.teams || []).map(function (t) { return t.name || ""; });
                        let headerHit = headerByPair[_pairKeyFromNames(names)];
                        if (headerHit && headerHit.startMs) {
                            up.startMs = headerHit.startMs;
                            up.start = headerHit.start || up.start;
                        }
                        stillUpcoming.push(up);
                    }
                }
            }
            finished.sort(function (a, b) {
                let am = a.stub.comp.date ? Date.parse(a.stub.comp.date) : 0;
                let bm = b.stub.comp.date ? Date.parse(b.stub.comp.date) : 0;
                return bm - am;
            });
            if (!this.showCompleted) {
                finished = [];
            } else if (finished.length > MAX_BOARD_FINISHED) {
                finished = finished.slice(0, MAX_BOARD_FINISHED);
            }
            let keep = live.concat(finished);
            if (!keep.length) {
                finishAll(stillUpcoming);
                return;
            }
            this._hydrateScores(keep, locToName, eventNames, (scored) => {
                finishAll((scored || []).concat(stillUpcoming));
            });
        };
        for (let w = 0; w < wanted.length; w++) {
            this._readStatus(wanted[w], (row) => {
                if (row) {
                    stated.push(row);
                }
                finishStatus();
            });
        }
    },

    _readStatus: function (stub, done) {
        let c = stub.comp;
        let statusRef = c.status && c.status.$ref ? _httpsRef(c.status.$ref) : "";
        let apply = (statusObj) => {
            let st = (statusObj && statusObj.type) || {};
            let state = st.state || "";
            if (!state) {
                let winner = (c.competitors || []).some(function (p) { return p.winner; });
                if (winner) {
                    state = "post";
                } else {
                    state = "pre";
                }
            }
            if (state === "post" && st.completed === false) {
                state = "in";
            }
            if (state === "pre") {
                done({ stub: stub, statusObj: statusObj, state: "pre" });
                return;
            }
            if (state !== "in" && state !== "post") {
                done(null);
                return;
            }
            done({ stub: stub, statusObj: statusObj, state: state });
        };
        if (!statusRef) {
            apply(null);
            return;
        }
        this._fetchJson(statusRef, apply, true);
    },

    _hydrateScores: function (rows, locToName, eventNames, done) {
        let left = rows.length;
        let out = [];
        let finishOne = () => {
            left -= 1;
            if (left <= 0) {
                done(out);
            }
        };
        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            let cid = String((row.stub && row.stub.comp && row.stub.comp.id) || "");
            if (row.state === "post" && cid && this._finishedById[cid]) {
                out.push(this._finishedById[cid]);
                finishOne();
                continue;
            }
            this._hydrateOne(row, locToName, eventNames, (m) => {
                if (m) {
                    out.push(m);
                    if (m.status === "Finished" && m.id) {
                        this._finishedById[m.id] = m;
                    } else if (m.status === "Live" && m.id && this._finishedById[m.id]) {
                        delete this._finishedById[m.id];
                    }
                }
                finishOne();
            });
        }
    },

    _hydrateOne: function (row, locToName, eventNames, done) {
        let stub = row.stub;
        let c = stub.comp;
        let statusObj = row.statusObj;
        let state = row.state;
        let competitors = (c.competitors || []).slice();
        competitors.sort(function (a, b) {
            return (a.order || 0) - (b.order || 0);
        });
        let live = state === "in";
        let pending = Math.max(1, competitors.length) + (live ? 1 : 0);
        let linesById = {};
        let serverId = "";
        let finish = () => {
            pending -= 1;
            if (pending > 0) {
                return;
            }
            let st = (statusObj && statusObj.type) || {};
            let location = (c.venue && c.venue.address && c.venue.address.summary) || "";
            let tournament = eventNames[stub.eventId] || locToName[location] || location || _("Tournament");
            if (!this._matchTourEnabled(stub.league, tournament)) {
                done(null);
                return;
            }
            let slug = (c.type && c.type.slug) || "";
            let eventType = (c.type && c.type.text) || "";
            let countryById = this._countryById;
            let teams = competitors.map(function (p) {
                let items = (linesById[p.id] && linesById[p.id].items) || [];
                let lines = items.map(function (ls) {
                    return {
                        value: ls.value,
                        tiebreak: ls.tiebreak || ls.tieBreakScore || null,
                        winner: false
                    };
                });
                return {
                    name: p.name || _("TBD"),
                    seed: p.tournamentSeed || null,
                    athleteId: String(p.id || ""),
                    athleteRef: p.athlete && p.athlete.$ref ? p.athlete.$ref : "",
                    country: (p.id && countryById[p.id]) || "",
                    score: "",
                    points: "",
                    linescores: lines,
                    serving: String(p.id) === String(serverId),
                    winner: !!p.winner,
                    isDoubles: p.type === "team" || /doubles/i.test(slug)
                };
            });
            let slam = _isGrandSlam(tournament);
            let period = (statusObj && statusObj.period) || 0;
            for (let t = 0; t < teams.length; t++) {
                let nlines = (teams[t].linescores || []).length;
                if (nlines > period) {
                    period = nlines;
                }
            }
            done({
                id: String(c.id || ""),
                tour: stub.league === "wta" ? "WTA" : "ATP",
                isGrandSlam: slam,
                badge: slam ? "Grand Slam" : (stub.league === "wta" ? "WTA" : "ATP"),
                tournament: tournament,
                location: location,
                roundName: _roundFromComp(c),
                courtName: _courtFromComp(c),
                eventType: eventType,
                status: state === "in" ? "Live" : "Finished",
                statusCode: state,
                summary: _liveSummary(st.detail || st.shortDetail || st.description, period),
                leadText: "",
                teams: teams,
                isDoubles: /doubles/i.test(slug) || /doubles/i.test(eventType),
                recent: true,
                link: this._compLink(c),
                start: c.date || "",
                startMs: c.date ? Date.parse(c.date) : NaN,
                isToday: true
            });
        };
        if (live) {
            let sitRef = c.situation && c.situation.$ref
                ? _httpsRef(c.situation.$ref)
                : ESPN_CORE + "/" + stub.league + "/events/" + stub.eventId + "/competitions/" + c.id + "/situation";
            this._fetchJson(sitRef, (json) => {
                serverId = _athleteIdFromRef(json && json.server && json.server.$ref);
                finish();
            }, true);
        }
        if (!competitors.length) {
            finish();
            return;
        }
        for (let i = 0; i < competitors.length; i++) {
            let p = competitors[i];
            let lsRef = p.linescores && p.linescores.$ref ? _httpsRef(p.linescores.$ref) : "";
            if (!lsRef) {
                finish();
                continue;
            }
            this._fetchJson(lsRef, (json) => {
                linesById[p.id] = json;
                finish();
            }, live);
        }
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
            parts.push(m.status, m.summary || "", m.tournament || "", m.roundName || "");
            let teams = m.teams || [];
            for (let t = 0; t < teams.length; t++) {
                let tm = teams[t];
                parts.push(tm.name || "", tm.serving ? "1" : "0", tm.winner ? "1" : "0", tm.score || "", tm.points || "", tm.country || "");
                let lines = tm.linescores || [];
                for (let k = 0; k < lines.length; k++) {
                    parts.push(String(lines[k].value), String(lines[k].tiebreak || ""));
                }
            }
        }
        return parts.join("\t");
    },

    _fetch: function (force) {
        if (this._fetching || !this._httpSession) {
            return;
        }
        this._fetching = true;

        this._fetchHeaders((headerMatches) => {
            this._fetchDatedBoard(headerMatches, (board) => {
                this._boardCache = board || [];
                this._lastBoardAt = Date.now();
                this._finishFetch(headerMatches, this._boardCache);
            }, force);
        });
    },

    _finishFetch: function (header, board) {
        this._fetching = false;
        try {
            header = header || [];
            board = board || [];
            header = header.filter((m) => {
                let league = m.tour === "WTA" ? "wta" : "atp";
                if (!this._matchTourEnabled(league, m.tournament)) {
                    return false;
                }
                if (m.isDoubles && !this.showDoubles) {
                    return false;
                }
                return true;
            });
            let fromBoard = [];
            let seen = {};
            for (let i = 0; i < board.length; i++) {
                let key = _matchKey(board[i]);
                if (!seen[key]) {
                    seen[key] = true;
                    fromBoard.push(board[i]);
                }
            }
            let rest = [];
            for (let j = 0; j < header.length; j++) {
                if (!seen[_matchKey(header[j])]) {
                    rest.push(header[j]);
                }
            }
            let next = fromBoard.concat(rest);
            this._applyHeaderServe(header, next);
            this._seedCountries(header.concat(fromBoard));
            this._fillCountries(next, (filled) => {
                this._applyMatches(filled);
            });
            return;
        } catch (e) {
            this._error = _("Invalid score data");
            global.logError(UUID + " merge error: " + e);
        }
        this._render();
    },

    _applyHeaderServe: function (header, matches) {
        let byPair = {};
        for (let i = 0; i < (header || []).length; i++) {
            let m = header[i];
            if (m.status !== "Live") {
                continue;
            }
            let names = (m.teams || []).map(function (t) { return t.name || ""; });
            byPair[_pairKeyFromNames(names)] = m;
        }
        for (let i = 0; i < (matches || []).length; i++) {
            let m = matches[i];
            if (m.status !== "Live") {
                continue;
            }
            let teams = m.teams || [];
            let hasServe = teams.some(function (t) { return t.serving; });
            if (hasServe) {
                continue;
            }
            let names = teams.map(function (t) { return t.name || ""; });
            let h = byPair[_pairKeyFromNames(names)];
            if (!h) {
                continue;
            }
            let hTeams = h.teams || [];
            for (let t = 0; t < teams.length; t++) {
                let key = _nameKey(teams[t].name);
                for (let n = 0; n < hTeams.length; n++) {
                    if (hTeams[n].serving && _nameKey(hTeams[n].name) === key) {
                        teams[t].serving = true;
                    }
                }
            }
        }
    },

    _seedCountries: function (matches) {
        for (let i = 0; i < (matches || []).length; i++) {
            let teams = matches[i].teams || [];
            for (let t = 0; t < teams.length; t++) {
                let tm = teams[t];
                if (tm.athleteId && tm.country) {
                    this._countryById[tm.athleteId] = tm.country;
                }
            }
        }
    },

    _countryFromAthlete: function (json) {
        if (!json) {
            return "";
        }
        let abbr = json.citizenshipCountry && json.citizenshipCountry.abbreviation;
        if (abbr) {
            return String(abbr).toUpperCase();
        }
        return _countryFromLogo(json.flag && json.flag.href);
    },

    _fetchAthleteCountry: function (id, ref, done) {
        if (!id) {
            done("");
            return;
        }
        if (this._countryById[id] !== undefined) {
            done(this._countryById[id]);
            return;
        }
        if (!this._countryPending[id]) {
            this._countryPending[id] = [];
            let url = ref || ("https://sports.core.api.espn.com/v2/sports/tennis/athletes/" + id);
            this._fetchJson(_httpsRef(url), (json) => {
                let cc = this._countryFromAthlete(json);
                this._countryById[id] = cc;
                let wait = this._countryPending[id] || [];
                delete this._countryPending[id];
                for (let i = 0; i < wait.length; i++) {
                    wait[i](cc);
                }
            });
        }
        this._countryPending[id].push(done);
    },

    _fillCountries: function (matches, done) {
        let left = 1;
        let tick = () => {
            left -= 1;
            if (left <= 0) {
                done(matches);
            }
        };
        for (let i = 0; i < (matches || []).length; i++) {
            let teams = matches[i].teams || [];
            for (let t = 0; t < teams.length; t++) {
                let tm = teams[t];
                if (tm.country || tm.isDoubles || !tm.athleteId) {
                    continue;
                }
                if (this._countryById[tm.athleteId] !== undefined) {
                    tm.country = this._countryById[tm.athleteId];
                    continue;
                }
                left += 1;
                this._fetchAthleteCountry(tm.athleteId, tm.athleteRef, (cc) => {
                    tm.country = cc;
                    tick();
                });
            }
        }
        tick();
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
        this._root = null;
    }
};

function main(metadata, deskletId) {
    return new TennisTodayDesklet(metadata, deskletId);
}
