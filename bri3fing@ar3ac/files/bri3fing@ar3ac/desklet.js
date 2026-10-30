const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const ModalDialog = imports.ui.modalDialog;
const Dialog = imports.ui.dialog;
const Tooltips = imports.ui.tooltips;
const Pango = imports.gi.Pango;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "bri3fing@ar3ac";

// Setup gettext domain binding
Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));
function _(str) {
    let customTranslation = Gettext.dgettext(UUID, str);
    if (customTranslation !== str) return customTranslation;
    return Gettext.gettext(str);
}

function Bri3fingDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

Bri3fingDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.desklet_id = desklet_id;
        this._timeoutId = null;
        this._isLoading = false;
        this._calendars = [];
        this._events = [];
        this._notifiedEventIds = new Set();
        this._hiddenCalendarUids = new Set();
        this._searchQuery = "";
        this._calendarsSubmenu = null;

        // Force disable Cinnamon's default opaque decorations
        this.metadata["prevent-decorations"] = true;
        this._updateDecoration();

        // Desklet settings binding
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "days-ahead", "daysAhead", this._onConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._onIntervalChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-past-events", "showPastEvents", this._onConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-event-location", "showEventLocation", this._onConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-format-24h", "timeFormat24h", this._onConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "default-calendar-uid", "defaultCalendarUid", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "hidden-calendars", "hiddenCalendarsStr", () => {
            this._parseHiddenCalendars();
            this._renderSchedule({ events: this._events, calendars: this._calendars });
        });
        this.settings.bindProperty(Settings.BindingDirection.IN, "notify-imminent-events", "notifyImminentEvents", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "notify-lead-time", "notifyLeadTime", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparent-background", "transparentBackground", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-opacity", "deskletOpacity", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-height", "deskletHeight", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "auto-shrink-height", "autoShrinkHeight", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-height", "maxHeight", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "header-font-size", "headerFontSize", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "compact-mode", "compactMode", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "custom-colors", "customColors", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "section-color", "sectionColor", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "title-color", "titleColor", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-color", "timeColor", this._onStyleChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "calendar-tag-color", "calendarTagColor", this._onStyleChanged.bind(this));

        this._parseHiddenCalendars();
        this._buildUI();
        this._applyCustomStyle();

        // Context menu items
        let newEventItem = new PopupMenu.PopupMenuItem(_("New Event…"));
        newEventItem.connect("activate", () => this._showAddEventDialog());
        this._menu.addMenuItem(newEventItem);

        let refreshMenuItem = new PopupMenu.PopupMenuItem(_("Refresh Briefing"));
        refreshMenuItem.connect("activate", () => this.refresh());
        this._menu.addMenuItem(refreshMenuItem);

        let onlineAccountsItem = new PopupMenu.PopupMenuItem(_("Online Accounts…"));
        onlineAccountsItem.connect("activate", () => this._openOnlineAccounts());
        this._menu.addMenuItem(onlineAccountsItem);

        // Initial fetch & start timer
        this.refresh();
        this._startTimer();
    },

    _updateDecoration: function() {
        try {
            if (this._header) this._header.hide();
            if (this.content) {
                this.content.style_class = "";
                this.content.set_style("background-color: transparent; border: none; padding: 0; box-shadow: none;");
            }
        } catch (e) {}
    },

    _buildUI: function() {
        this._updateDecoration();

        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-container"
        });
        this.setContent(this.window);

        // Header container
        this.header = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-header"
        });
        this.window.add_actor(this.header);

        // Title & date box
        let titleBox = new St.BoxLayout({
            vertical: true,
            x_expand: true
        });
        this.header.add_actor(titleBox);

        // Clickable Date Button (opens system calendar)
        this.dateBtn = new St.Button({
            style_class: "bri3fing-date-button",
            reactive: true,
            can_focus: true,
            x_align: St.Align.START
        });
        this.dateBtn.set_x_align(Clutter.ActorAlign.START);
        this.dateLabel = new St.Label({
            text: this._getFormattedCurrentDate(),
            style_class: "bri3fing-date-title"
        });
        this.dateBtn.set_child(this.dateLabel);
        new Tooltips.Tooltip(this.dateBtn, _("Open Calendar"));
        this.dateBtn.connect("clicked", () => this._openCalendarApp());
        titleBox.add_actor(this.dateBtn);

        this.subtitleLabel = new St.Label({
            text: _("Checking schedule…"),
            style_class: "bri3fing-subtitle"
        });
        titleBox.add_actor(this.subtitleLabel);

        // Action buttons (Search + Add Event + Refresh)
        let actionsBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: "spacing: 4px;"
        });
        this.header.add_actor(actionsBox);

        // Search toggle button
        this.searchBtn = new St.Button({
            style_class: "bri3fing-action-button",
            reactive: true,
            can_focus: true
        });
        new Tooltips.Tooltip(this.searchBtn, _("Search Events"));
        this.searchIcon = new St.Icon({
            icon_name: "edit-find-symbolic",
            icon_size: 15
        });
        this.searchBtn.set_child(this.searchIcon);
        this.searchBtn.connect("clicked", () => this._toggleSearch());
        actionsBox.add_actor(this.searchBtn);

        // Quick add button
        this.addBtn = new St.Button({
            style_class: "bri3fing-action-button",
            reactive: true,
            can_focus: true
        });
        new Tooltips.Tooltip(this.addBtn, _("Add New Event"));
        this.addIcon = new St.Icon({
            icon_name: "list-add-symbolic",
            icon_size: 15
        });
        this.addBtn.set_child(this.addIcon);
        this.addBtn.connect("clicked", () => this._showAddEventDialog());
        actionsBox.add_actor(this.addBtn);

        // Refresh button
        this.refreshBtn = new St.Button({
            style_class: "bri3fing-action-button",
            reactive: true,
            can_focus: true
        });
        new Tooltips.Tooltip(this.refreshBtn, _("Refresh Schedule"));
        this.refreshIcon = new St.Icon({
            icon_name: "view-refresh-symbolic",
            icon_size: 15
        });
        this.refreshBtn.set_child(this.refreshIcon);
        this.refreshBtn.connect("clicked", () => this.refresh());
        actionsBox.add_actor(this.refreshBtn);

        // Search box (collapsible)
        this.searchBox = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-search-box",
            visible: false
        });
        this.window.add_actor(this.searchBox);

        this.searchEntry = new St.Entry({
            style_class: "bri3fing-search-entry",
            hint_text: _("Search events…"),
            can_focus: true,
            x_expand: true
        });
        this.searchBox.add_actor(this.searchEntry);

        this.searchCloseBtn = new St.Button({
            style_class: "bri3fing-search-close-button",
            reactive: true,
            can_focus: true
        });
        let closeIcon = new St.Icon({
            icon_name: "window-close-symbolic",
            icon_size: 12
        });
        this.searchCloseBtn.set_child(closeIcon);
        new Tooltips.Tooltip(this.searchCloseBtn, _("Close Search"));
        this.searchCloseBtn.connect("clicked", () => this._closeSearch());
        this.searchBox.add_actor(this.searchCloseBtn);

        this.searchEntry.clutter_text.connect("text-changed", () => {
            this._onSearchQueryChanged();
        });

        // Scroll view for events (with subtle top/bottom fade effect)
        this.scrollView = new St.ScrollView({
            style_class: "bri3fing-scroll-view vfade",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        this.scrollView.set_mouse_scrolling(true);
        this.window.add_actor(this.scrollView);

        // Schedule content box
        this.scheduleBox = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-schedule-box",
            x_expand: true
        });
        this.scrollView.add_actor(this.scheduleBox);

        // Message / zero state box
        this.messageBox = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-message-box",
            x_expand: true
        });
        this.window.add_actor(this.messageBox);
    },

    _getFormattedCurrentDate: function() {
        let now = new Date();
        let days = [_("Sunday"), _("Monday"), _("Tuesday"), _("Wednesday"), _("Thursday"), _("Friday"), _("Saturday")];
        let months = [
            _("January"), _("February"), _("March"), _("April"), _("May"), _("June"),
            _("July"), _("August"), _("September"), _("October"), _("November"), _("December")
        ];
        return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
    },

    _openCalendarApp: function() {
        try {
            Util.trySpawn(["gnome-calendar"]);
        } catch (e) {
            try {
                Util.trySpawn(["evolution", "-c", "calendar"]);
            } catch (e2) {
                Main.notifyError(_("Bri3fing"), _("Could not launch calendar application"));
            }
        }
    },

    _toggleSearch: function() {
        let isVis = !this.searchBox.visible;
        this.searchBox.visible = isVis;
        if (isVis) {
            this.searchBtn.add_style_class_name("bri3fing-action-button-active");
            this.searchEntry.clutter_text.grab_key_focus();
        } else {
            this.searchBtn.remove_style_class_name("bri3fing-action-button-active");
            this.searchEntry.set_text("");
            this._searchQuery = "";
            this._renderSchedule({ events: this._events, calendars: this._calendars });
        }
        this._updateDynamicHeight();
    },

    _closeSearch: function() {
        this.searchBox.visible = false;
        this.searchBtn.remove_style_class_name("bri3fing-action-button-active");
        this.searchEntry.set_text("");
        this._searchQuery = "";
        this._renderSchedule({ events: this._events, calendars: this._calendars });
        this._updateDynamicHeight();
    },

    _onSearchQueryChanged: function() {
        this._searchQuery = (this.searchEntry.get_text() || "").trim();
        this._renderSchedule({ events: this._events, calendars: this._calendars });
    },

    _extractMeetingUrl: function(ev) {
        let text = `${ev.location || ""} ${ev.description || ""}`;
        let match = text.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.jit\.si|webex\.com)[^\s"'>)]+/i);
        return match ? match[0] : null;
    },

    _parseHiddenCalendars: function() {
        this._hiddenCalendarUids = new Set();
        if (this.hiddenCalendarsStr) {
            let parts = this.hiddenCalendarsStr.split(",");
            for (let p of parts) {
                let trimmed = p.trim();
                if (trimmed) this._hiddenCalendarUids.add(trimmed);
            }
        }
    },

    _updateCalendarsContextMenu: function(calendars) {
        if (!calendars || calendars.length === 0) return;

        if (this._calendarsSubmenu) {
            this._calendarsSubmenu.destroy();
            this._calendarsSubmenu = null;
        }

        this._calendarsSubmenu = new PopupMenu.PopupSubMenuMenuItem(_("Visible Calendars"));

        for (let cal of calendars) {
            let isVisible = !this._hiddenCalendarUids.has(cal.uid);
            let item = new PopupMenu.PopupSwitchMenuItem(cal.name, isVisible);
            item.connect("toggled", (sw, state) => {
                if (state) {
                    this._hiddenCalendarUids.delete(cal.uid);
                } else {
                    this._hiddenCalendarUids.add(cal.uid);
                }
                let val = Array.from(this._hiddenCalendarUids).join(",");
                this.settings.setValue("hidden-calendars", val);
                this._renderSchedule({ events: this._events, calendars: this._calendars });
            });
            this._calendarsSubmenu.menu.addMenuItem(item);
        }

        this._menu.addMenuItem(this._calendarsSubmenu, 2);
    },

    _checkImminentEventNotifications: function(events) {
        if (this.notifyImminentEvents === false) return;
        if (!events || events.length === 0) return;

        let nowSec = Math.floor(Date.now() / 1000);
        let leadSec = (this.notifyLeadTime || 10) * 60;

        for (let ev of events) {
            if (ev.all_day) continue;
            if (!ev.start_ts) continue;
            if (this._hiddenCalendarUids.has(ev.calendar_uid)) continue;

            let diff = ev.start_ts - nowSec;
            if (diff > -60 && diff <= leadSec) {
                let eventKey = `${ev.uid || ev.summary}_${ev.start_ts}`;
                if (!this._notifiedEventIds.has(eventKey)) {
                    this._notifiedEventIds.add(eventKey);

                    let title = _("Upcoming Event: %s").replace("%s", ev.summary || _("Event"));
                    let sTime = ev.start_time_str ? this._formatTime(ev.start_time_str) : "";
                    let minutesLeft = Math.max(1, Math.round(diff / 60));
                    let body = "";
                    if (diff <= 60) {
                        body = _("Starting now at %s").replace("%s", sTime);
                    } else {
                        body = _("Starts in %d min (%s)").replace("%d", String(minutesLeft)).replace("%s", sTime);
                    }
                    if (ev.location) {
                        body += ` • 📍 ${ev.location}`;
                    }

                    Main.notify(title, body);
                }
            }
        }
    },

    _applyCustomStyle: function() {
        this._updateDecoration();
        if (!this.window) return;

        try {
            let width = this.deskletWidth || 340;
            this.window.set_width(width);

            let isTransparent = this.transparentBackground === true;
            let opacityPct = (this.deskletOpacity !== undefined && this.deskletOpacity !== null) ? this.deskletOpacity : 30;
            let padding = this.compactMode ? "8px 10px" : "12px 14px";

            if (isTransparent || opacityPct === 0) {
                this.window.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padding};`);
            } else {
                let alpha = (opacityPct / 100).toFixed(2);
                this.window.set_style(`background-color: rgba(18, 18, 20, ${alpha}); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.40); padding: ${padding};`);
            }

            this._reapplyItemStyles();
            this._updateDynamicHeight();
        } catch (e) {}
    },

    _updateDynamicHeight: function() {
        if (!this.window) return;
        try {
            let width = this.deskletWidth || 340;
            this.window.set_width(width);

            let configuredH = (this.deskletHeight !== undefined && this.deskletHeight !== null)
                ? this.deskletHeight
                : (this.maxHeight || 290);
            let autoShrink = this.autoShrinkHeight === true;

            // Measure header height and window vertical padding
            let headerH = 45;
            if (this.header) {
                let [, hH] = this.header.get_preferred_height(width);
                if (hH > 0) headerH = hH;
            }
            let pad = this.compactMode ? 20 : 28;
            let availableScrollH = Math.max(70, configuredH - headerH - pad);

            if (this.scrollView && this.scheduleBox) {
                let [, schedH] = this.scheduleBox.get_preferred_height(width);
                if (schedH > 0) {
                    this.scrollView.show();
                    let targetScrollH = autoShrink ? Math.min(schedH, availableScrollH) : availableScrollH;
                    this.scrollView.set_height(targetScrollH);
                } else {
                    this.scrollView.hide();
                    this.scrollView.set_height(0);
                }
            }

            this.window.set_height(-1);
            if (this.content) this.content.set_height(-1);
            if (this.actor) this.actor.set_height(-1);

            let [, natH] = this.window.get_preferred_height(width);
            let targetH = autoShrink ? Math.max(natH, 75) : Math.max(natH, configuredH);

            this.window.set_height(targetH);
            if (this.content) this.content.set_height(targetH);
            if (this.actor) this.actor.set_height(targetH);
        } catch (e) {}
    },

    _reapplyItemStyles: function() {
        let fontSize = this.fontSize || 9;
        let headerFontSize = this.headerFontSize || 11;
        let metaFontSize = Math.max(7, fontSize - 1.5);
        let sectionFontSize = Math.max(7, fontSize - 1.5);

        let useCustom = this.customColors === true;
        let sectionCol = (useCustom && this.sectionColor) ? this.sectionColor : null;
        let titleCol = (useCustom && this.titleColor) ? this.titleColor : null;
        let timeCol = (useCustom && this.timeColor) ? this.timeColor : null;
        let calTagCol = (useCustom && this.calendarTagColor) ? this.calendarTagColor : null;

        if (this.dateLabel) {
            this.dateLabel.set_style(`font-size: ${headerFontSize}pt;`);
        }
        if (this.subtitleLabel) {
            this.subtitleLabel.set_style(`font-size: ${Math.max(7.5, headerFontSize - 3)}pt;`);
        }

        if (!this.scheduleBox) return;
        try {
            let children = this.scheduleBox.get_children();
            for (let i = 0; i < children.length; i++) {
                let child = children[i];
                if (!child) continue;
                if (child._titleLabel) {
                    let st = `font-size: ${fontSize}pt; min-height: ${Math.max(13, fontSize + 3)}px;`;
                    if (titleCol) st += ` color: ${titleCol};`;
                    child._titleLabel.set_style(st);
                }
                if (child._timeLabel) {
                    let st = `font-size: ${metaFontSize}pt;`;
                    if (timeCol) st += ` color: ${timeCol};`;
                    child._timeLabel.set_style(st);
                }
                if (child._calendarTagLabel) {
                    let st = `font-size: ${Math.max(6.5, metaFontSize - 0.5)}pt;`;
                    if (calTagCol) st += ` color: ${calTagCol};`;
                    child._calendarTagLabel.set_style(st);
                }
                if (child._sectionTitleLabel) {
                    let st = `font-size: ${sectionFontSize}pt;`;
                    if (sectionCol) st += ` color: ${sectionCol};`;
                    child._sectionTitleLabel.set_style(st);
                }
                if (child._sectionCountLabel) {
                    child._sectionCountLabel.set_style(`font-size: ${sectionFontSize}pt;`);
                }
            }
        } catch (e) {}
    },

    _onConfigChanged: function() {
        this.refresh();
    },

    _onIntervalChanged: function() {
        this._startTimer();
    },

    _onStyleChanged: function() {
        this._applyCustomStyle();
    },

    _startTimer: function() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        let minutes = this.refreshInterval || 10;
        if (minutes < 1) minutes = 1;
        let intervalMs = minutes * 60 * 1000;

        this._timeoutId = Mainloop.timeout_add(intervalMs, () => {
            this.refresh();
            return true;
        });
    },

    _findHelperPath: function() {
        if (this.metadata && this.metadata["path"]) {
            return GLib.build_filenamev([this.metadata["path"], "eds_helper.py"]);
        }
        return GLib.build_filenamev([GLib.get_user_data_dir(), "cinnamon", "desklets", this.metadata["uuid"], "eds_helper.py"]);
    },

    _executeHelper: function(args, callback) {
        let helper = this._findHelperPath();
        let argv = ["/usr/bin/python3", helper].concat(args);

        try {
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [ok, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (p.get_successful()) {
                        callback(true, stdout, stderr);
                    } else {
                        callback(false, stdout, stderr || `Exit status: ${p.get_exit_status()}`);
                    }
                } catch (e) {
                    callback(false, null, e.message);
                }
            });
        } catch (e) {
            callback(false, null, e.message);
        }
    },

    refresh: function() {
        if (this._isLoading) return;
        this._isLoading = true;

        if (this.dateLabel) {
            this.dateLabel.set_text(this._getFormattedCurrentDate());
        }
        if (this.subtitleLabel) {
            this.subtitleLabel.set_text(_("Updating schedule…"));
        }

        let days = this.daysAhead || 14;
        let args = ["events", "--days", String(days)];
        if (this.showPastEvents) {
            args.push("--include-past");
        }

        this._executeHelper(args, (success, stdout, stderr) => {
            this._isLoading = false;
            if (success) {
                try {
                    let data = JSON.parse(stdout);
                    if (data.status === "success") {
                        this._calendars = data.calendars || [];
                        this._events = data.events || [];
                        this._hasOnlineAccounts = (data.has_online_accounts === true);
                        this._updateCalendarsContextMenu(this._calendars);
                        this._checkImminentEventNotifications(this._events);
                        this._renderSchedule(data);

                        let now = new Date();
                        let hours = String(now.getHours()).padStart(2, "0");
                        let mins = String(now.getMinutes()).padStart(2, "0");
                        let updatedText = _("Updated at %s").replace("%s", `${hours}:${mins}`);

                        let visibleEvents = this._events.filter(e => !this._hiddenCalendarUids.has(e.calendar_uid));
                        let todayCount = visibleEvents.filter(e => e.day_category === "today").length;

                        if (!this._hasOnlineAccounts && this._events.length === 0) {
                            this.subtitleLabel.set_text(_("No online account connected"));
                        } else if (!this._hasOnlineAccounts && this._events.length > 0) {
                            let countText = todayCount === 1 ? `1 ${_("event today")}` : (todayCount > 1 ? `${todayCount} ${_("events today")}` : _("No events today"));
                            this.subtitleLabel.set_text(`${countText} • ${_("Local mode")}`);
                        } else {
                            if (todayCount === 1) {
                                this.subtitleLabel.set_text(`1 ${_("event today")} • ${updatedText}`);
                            } else if (todayCount > 1) {
                                this.subtitleLabel.set_text(`${todayCount} ${_("events today")} • ${updatedText}`);
                            } else {
                                this.subtitleLabel.set_text(`${_("No events today")} • ${updatedText}`);
                            }
                        }
                    } else {
                        this._renderError(data.message || _("Failed to retrieve events"));
                    }
                } catch (e) {
                    this._renderError(_("Failed to parse calendar data: ") + e.message);
                }
            } else {
                this._renderError(stderr || _("Error querying calendar service"));
            }
            this._updateDynamicHeight();
        });
    },

    _renderSchedule: function(data) {
        this.scheduleBox.destroy_all_children();
        this.messageBox.destroy_all_children();

        let rawEvents = (data && data.events) ? data.events : (this._events || []);
        let calendars = (data && data.calendars) ? data.calendars : (this._calendars || []);
        let hasOnlineAccounts = (data && data.has_online_accounts !== undefined)
            ? (data.has_online_accounts === true)
            : (this._hasOnlineAccounts === true);

        if (calendars.length === 0 || (!hasOnlineAccounts && rawEvents.length === 0)) {
            this.scrollView.hide();
            this.messageBox.show();
            this._renderNoCalendarsCard();
            this._updateDynamicHeight();
            return;
        }

        // Filter out hidden calendars
        let events = rawEvents.filter(ev => !this._hiddenCalendarUids.has(ev.calendar_uid));

        // Filter by active search query
        let query = (this._searchQuery || "").trim().toLowerCase();
        if (query) {
            events = events.filter(ev => {
                let s = (ev.summary || "").toLowerCase();
                let l = (ev.location || "").toLowerCase();
                let d = (ev.description || "").toLowerCase();
                let c = (ev.calendar_name || "").toLowerCase();
                return s.includes(query) || l.includes(query) || d.includes(query) || c.includes(query);
            });
        }

        if (events.length === 0) {
            this.scrollView.hide();
            this.messageBox.show();
            if (query) {
                this._renderNoSearchResultsCard(this._searchQuery);
            } else if (!hasOnlineAccounts) {
                this._renderNoCalendarsCard();
            } else {
                this._renderEmptySchedule();
            }
            this._updateDynamicHeight();
            return;
        }

        this.messageBox.hide();
        this.scrollView.show();

        // If running in local mode (no online accounts synced), show a subtle top notice with a quick connect button
        if (!hasOnlineAccounts) {
            this._renderLocalModeNotice();
        }

        // Chronus Android widget style: Group events day-by-day chronologically
        let dateGroups = new Map();
        events.forEach(ev => {
            let key = ev.date_str || "upcoming";
            if (!dateGroups.has(key)) {
                dateGroups.set(key, []);
            }
            dateGroups.get(key).push(ev);
        });

        dateGroups.forEach((dayEvents, dateStr) => {
            let headerTitle = this._formatSectionHeaderDate(dateStr, dayEvents[0]);
            this._addSection(headerTitle, dayEvents);
        });

        this._reapplyItemStyles();
        this._updateDynamicHeight();
    },

    _renderLocalModeNotice: function() {
        let banner = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-account-notice-banner",
            reactive: true
        });

        let icon = new St.Icon({
            icon_name: "dialog-information-symbolic",
            icon_size: 14,
            style: "color: #60a5fa; margin-right: 6px;"
        });
        banner.add_actor(icon);

        let lbl = new St.Label({
            text: _("Local calendar only"),
            style_class: "bri3fing-account-notice-text",
            x_expand: true
        });
        banner.add_actor(lbl);

        let btn = new St.Button({
            label: _("Connect Google…"),
            style_class: "bri3fing-account-notice-btn",
            reactive: true
        });
        btn.connect("clicked", () => this._openOnlineAccounts());
        banner.add_actor(btn);

        this.scheduleBox.add_actor(banner);
    },

    _formatSectionHeaderDate: function(dateStr, sampleEvent) {
        if (!dateStr || dateStr === "upcoming") return _("Upcoming").toUpperCase();

        let parts = dateStr.split("-");
        if (parts.length !== 3) return dateStr;

        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let day = parseInt(parts[2], 10);
        let d = new Date(year, month, day);

        let shortDays = [_("Sun"), _("Mon"), _("Tue"), _("Wed"), _("Thu"), _("Fri"), _("Sat")];
        let fullDays = [
            _("Sunday"), _("Monday"), _("Tuesday"), _("Wednesday"),
            _("Thursday"), _("Friday"), _("Saturday")
        ];
        let shortMonths = [
            _("Jan"), _("Feb"), _("Mar"), _("Apr"), _("May"), _("Jun"),
            _("Jul"), _("Aug"), _("Sep"), _("Oct"), _("Nov"), _("Dec")
        ];

        let dayIdx = d.getDay();
        let monthIdx = d.getMonth();
        let shortDay = shortDays[dayIdx] || "";
        let fullDay = fullDays[dayIdx] || "";
        let shortMonth = shortMonths[monthIdx] || "";

        let dayCategory = sampleEvent ? sampleEvent.day_category : "";

        if (dayCategory === "today") {
            return `${_("Today").toUpperCase()} • ${shortDay} ${day} ${shortMonth}`;
        } else if (dayCategory === "tomorrow") {
            return `${_("Tomorrow").toUpperCase()} • ${shortDay} ${day} ${shortMonth}`;
        } else {
            return `${fullDay.toUpperCase()} • ${day} ${shortMonth}`;
        }
    },

    _addSection: function(title, eventsList) {
        let headerBox = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-section-header"
        });

        let titleLabel = new St.Label({
            text: title.toUpperCase(),
            style_class: "bri3fing-section-title"
        });
        titleLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        headerBox._sectionTitleLabel = titleLabel;
        headerBox.add_actor(titleLabel);

        let countLabel = new St.Label({
            text: ` (${eventsList.length})`,
            style_class: "bri3fing-section-count"
        });
        countLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        headerBox._sectionCountLabel = countLabel;
        headerBox.add_actor(countLabel);

        this.scheduleBox.add_actor(headerBox);

        eventsList.forEach(ev => {
            let row = this._createEventRow(ev);
            this.scheduleBox.add_actor(row);
        });
    },

    _createEventRow: function(ev) {
        let row = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-event-row",
            reactive: true,
            can_focus: true
        });

        if (ev.is_ongoing) {
            row.add_style_class_name("bri3fing-event-row-active");
        } else if (ev.is_imminent) {
            row.add_style_class_name("bri3fing-event-row-imminent");
        }

        // Calendar color pill
        let colorPill = new St.BoxLayout({
            style_class: "bri3fing-color-pill",
            style: `background-color: ${ev.calendar_color || "#4285F4"};`
        });
        row.add_actor(colorPill);

        // Middle details box
        let detailsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "bri3fing-event-details"
        });
        row.add_actor(detailsBox);

        // Summary Label
        let summaryLabel = new St.Label({
            text: ev.summary || _("(Untitled event)"),
            style_class: "bri3fing-event-summary"
        });
        summaryLabel.clutter_text.set_line_wrap(true);
        summaryLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        row._titleLabel = summaryLabel;
        detailsBox.add_actor(summaryLabel);

        // Meta Box (Time • Location • Calendar)
        let metaBox = new St.BoxLayout({
            vertical: false,
            style_class: "bri3fing-event-meta"
        });
        detailsBox.add_actor(metaBox);

        // Format time string
        let timeStr = "";
        if (ev.all_day) {
            timeStr = _("All Day");
        } else if (ev.start_time_str) {
            let sTime = this._formatTime(ev.start_time_str);
            let eTime = ev.end_time_str ? this._formatTime(ev.end_time_str) : "";
            timeStr = eTime ? `${sTime} – ${eTime}` : sTime;
        }

        if (ev.multi_day) {
            timeStr = `${timeStr} • ${_("multi-day")}`;
        }

        let timeLabel = new St.Label({
            text: timeStr,
            style_class: "bri3fing-time-label"
        });
        row._timeLabel = timeLabel;
        metaBox.add_actor(timeLabel);

        // Location
        if (this.showEventLocation !== false && ev.location && ev.location.trim().length > 0) {
            let locLabel = new St.Label({
                text: ` • 📍 ${ev.location.trim()}`,
                style_class: "bri3fing-meta-subtext"
            });
            metaBox.add_actor(locLabel);
        }

        // Calendar source tag
        if (ev.calendar_name) {
            let calTag = new St.Label({
                text: ev.calendar_name,
                style_class: "bri3fing-meta-calendar"
            });
            calTag.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            row._calendarTagLabel = calTag;
            metaBox.add_actor(calTag);
        }

        // Video meeting link detection (Meet, Zoom, Teams, Webex, Jitsi)
        let meetingUrl = this._extractMeetingUrl(ev);
        if (meetingUrl) {
            let joinBtn = new St.Button({
                style_class: "bri3fing-join-button",
                reactive: true,
                can_focus: true
            });
            let joinBox = new St.BoxLayout({
                vertical: false,
                style: "spacing: 3px;"
            });
            let joinIcon = new St.Icon({
                icon_name: "camera-video-symbolic",
                icon_size: 11
            });
            let joinLabel = new St.Label({
                text: _("Join"),
                style_class: "bri3fing-join-label"
            });
            joinBox.add_actor(joinIcon);
            joinBox.add_actor(joinLabel);
            joinBtn.set_child(joinBox);
            new Tooltips.Tooltip(joinBtn, _("Join Video Call (%s)").replace("%s", meetingUrl));
            joinBtn.connect("clicked", () => {
                Util.spawn(["xdg-open", meetingUrl]);
                return Clutter.EVENT_STOP;
            });
            row.add_actor(joinBtn);
        }

        // Status badge (NOW / SOON)
        if (ev.is_ongoing) {
            let nowBadge = new St.Label({
                text: _("NOW"),
                style_class: "bri3fing-badge-now"
            });
            row.add_actor(nowBadge);
        } else if (ev.is_imminent) {
            let soonBadge = new St.Label({
                text: _("SOON"),
                style_class: "bri3fing-badge-soon"
            });
            row.add_actor(soonBadge);
        }

        // Click row to view details / delete dialog
        row.connect("button-press-event", () => {
            this._showEventDetailsDialog(ev);
            return Clutter.EVENT_STOP;
        });

        return row;
    },

    _formatTime: function(hhmm) {
        if (!hhmm) return "";
        let use24h = this.timeFormat24h !== false;
        if (use24h) return hhmm;

        let parts = hhmm.split(":");
        let h = parseInt(parts[0], 10);
        let m = parts[1] || "00";
        let ampm = h >= 12 ? "PM" : "AM";
        let h12 = h % 12 || 12;
        return `${h12}:${m} ${ampm}`;
    },

    _showEventDetailsDialog: function(ev) {
        let dlg = new ModalDialog.ModalDialog();
        this._activeDialog = dlg;

        let headerMeta = [];
        if (ev.calendar_name) headerMeta.push(ev.calendar_name);
        if (ev.date_str) headerMeta.push(ev.date_str);

        let content = new Dialog.MessageDialogContent({
            title: ev.summary || _("(Untitled event)"),
            description: headerMeta.join(" • ")
        });
        dlg.contentLayout.add_child(content);

        let detailsBox = new St.BoxLayout({
            vertical: true,
            style: "spacing: 8px; padding: 6px 0; min-width: 360px;"
        });
        content.add_child(detailsBox);

        // Time
        let timeStr = ev.all_day ? _("All Day") : `${this._formatTime(ev.start_time_str)} – ${this._formatTime(ev.end_time_str)}`;
        let timeLbl = new St.Label({
            text: `🕒 ${timeStr}`,
            style: "color: #93c5fd; font-size: 10pt; font-weight: 600;"
        });
        detailsBox.add_actor(timeLbl);

        // Location
        if (ev.location && ev.location.trim().length > 0) {
            let locLbl = new St.Label({
                text: `📍 ${ev.location.trim()}`,
                style: "color: #cbd5e1; font-size: 9.5pt;"
            });
            locLbl.clutter_text.set_line_wrap(true);
            detailsBox.add_actor(locLbl);
        }

        // Description
        if (ev.description && ev.description.trim().length > 0) {
            let descLbl = new St.Label({
                text: ev.description.trim(),
                style: "color: #94a3b8; font-size: 9pt; padding-top: 4px;"
            });
            descLbl.clutter_text.set_line_wrap(true);
            descLbl.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            detailsBox.add_actor(descLbl);
        }

        // Video meeting link in details dialog
        let meetingUrl = this._extractMeetingUrl(ev);
        if (meetingUrl) {
            let joinBtn = new St.Button({
                style_class: "bri3fing-primary-button",
                label: `📹 ${_("Join Video Call")}`,
                reactive: true
            });
            joinBtn.connect("clicked", () => {
                Util.spawn(["xdg-open", meetingUrl]);
                dlg.close();
            });
            detailsBox.add_actor(joinBtn);
        }

        dlg.setButtons([
            {
                label: _("Edit Event…"),
                action: () => {
                    dlg.close();
                    this._showEditEventDialog(ev);
                }
            },
            {
                label: _("Delete Event"),
                action: () => {
                    dlg.close();
                    this._deleteEvent(ev);
                }
            },
            {
                label: _("Close"),
                action: () => dlg.close(),
                default: true,
                key: Clutter.KEY_Escape
            }
        ]);

        dlg.open();
    },

    _deleteEvent: function(ev) {
        if (!ev.calendar_uid || !ev.uid) return;

        if (this.subtitleLabel) {
            this.subtitleLabel.set_text(_("Deleting event…"));
        }

        this._executeHelper(["delete", "--calendar", ev.calendar_uid, "--uid", ev.uid], (success, stdout, stderr) => {
            if (success) {
                if (this.subtitleLabel) {
                    this.subtitleLabel.set_text(_("Event deleted"));
                }
                Mainloop.timeout_add(300, () => {
                    this.refresh();
                    return false;
                });
            } else {
                let errMsg = stderr || _("Failed to delete event");
                try {
                    let parsed = JSON.parse(stderr);
                    if (parsed && parsed.message) errMsg = parsed.message;
                } catch (e) {}
                this._renderError(errMsg);
            }
        });
    },

    _renderNoCalendarsCard: function() {
        let card = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-card-empty"
        });

        let icon = new St.Icon({
            icon_name: "x-office-calendar-symbolic",
            icon_size: 32,
            style_class: "bri3fing-card-icon"
        });
        card.add_actor(icon);

        let title = new St.Label({
            text: _("No calendars connected"),
            style_class: "bri3fing-card-title"
        });
        card.add_actor(title);

        let desc = new St.Label({
            text: _("Connect your Google Calendar or CalDAV account in Cinnamon Online Accounts to view and manage your schedule."),
            style_class: "bri3fing-card-desc"
        });
        desc.clutter_text.set_line_wrap(true);
        desc.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        card.add_actor(desc);

        let btnBox = new St.BoxLayout({
            vertical: false,
            style: "spacing: 8px; padding-top: 6px;",
            x_align: Clutter.ActorAlign.CENTER
        });
        card.add_actor(btnBox);

        let btn = new St.Button({
            label: _("Connect Account…"),
            style_class: "bri3fing-primary-button",
            reactive: true
        });
        btn.connect("clicked", () => this._openOnlineAccounts());
        btnBox.add_actor(btn);

        let addLocalBtn = new St.Button({
            label: _("New Event…"),
            style_class: "bri3fing-secondary-button",
            reactive: true
        });
        addLocalBtn.connect("clicked", () => this._showAddEventDialog());
        btnBox.add_actor(addLocalBtn);

        this.messageBox.add_actor(card);
    },

    _renderEmptySchedule: function() {
        let card = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-card-empty"
        });

        let icon = new St.Icon({
            icon_name: "object-select-symbolic",
            icon_size: 28,
            style_class: "bri3fing-card-icon"
        });
        card.add_actor(icon);

        let title = new St.Label({
            text: _("No upcoming events"),
            style_class: "bri3fing-card-title"
        });
        card.add_actor(title);

        let days = this.daysAhead || 14;
        let desc = new St.Label({
            text: _("Your schedule is clear for the next %d days.").replace("%d", String(days)),
            style_class: "bri3fing-card-desc"
        });
        card.add_actor(desc);

        let addBtn = new St.Button({
            label: _("+ Create New Event"),
            style_class: "bri3fing-secondary-button"
        });
        addBtn.connect("clicked", () => this._showAddEventDialog());
        card.add_actor(addBtn);

        this.messageBox.add_actor(card);
    },

    _renderNoSearchResultsCard: function(query) {
        let card = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-card-empty"
        });

        let icon = new St.Icon({
            icon_name: "edit-find-symbolic",
            icon_size: 28,
            style_class: "bri3fing-card-icon"
        });
        card.add_actor(icon);

        let title = new St.Label({
            text: _("No matching events"),
            style_class: "bri3fing-card-title"
        });
        card.add_actor(title);

        let desc = new St.Label({
            text: _("No events found matching \"%s\"").replace("%s", query || ""),
            style_class: "bri3fing-card-desc"
        });
        desc.clutter_text.set_line_wrap(true);
        desc.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        card.add_actor(desc);

        let clearBtn = new St.Button({
            label: _("Clear Search"),
            style_class: "bri3fing-secondary-button"
        });
        clearBtn.connect("clicked", () => this._closeSearch());
        card.add_actor(clearBtn);

        this.messageBox.add_actor(card);
    },

    _renderError: function(message) {
        this.scheduleBox.destroy_all_children();
        this.messageBox.destroy_all_children();
        this.scrollView.hide();
        this.messageBox.show();

        let errorBox = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-error-box"
        });

        let errTitle = new St.Label({
            text: _("Calendar Service Error"),
            style_class: "bri3fing-error-title"
        });
        errorBox.add_actor(errTitle);

        let errDesc = new St.Label({
            text: message,
            style_class: "bri3fing-error-desc"
        });
        errDesc.clutter_text.set_line_wrap(true);
        errDesc.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        errorBox.add_actor(errDesc);

        let retryBtn = new St.Button({
            label: _("Retry"),
            style_class: "bri3fing-secondary-button"
        });
        retryBtn.connect("clicked", () => this.refresh());
        errorBox.add_actor(retryBtn);

        this.messageBox.add_actor(errorBox);
        this._updateDynamicHeight();
    },

    _showAddEventDialog: function() {
        this._showEventFormDialog({ mode: "create" });
    },

    _showEditEventDialog: function(ev) {
        this._showEventFormDialog({ mode: "edit", event: ev });
    },

    _showEventFormDialog: function(options) {
        let mode = (options && options.mode) || "create";
        let isEdit = (mode === "edit" && options.event);
        let event = options.event || {};

        let dlg = new ModalDialog.ModalDialog();
        this._activeDialog = dlg;

        let content = new Dialog.MessageDialogContent({
            title: isEdit ? _("Edit Calendar Event") : _("New Calendar Event"),
            description: isEdit
                ? _("Modify event details and sync changes with your calendar.")
                : _("Create an event synced automatically with your calendar account.")
        });
        dlg.contentLayout.add_child(content);

        let formBox = new St.BoxLayout({
            vertical: true,
            style_class: "bri3fing-dialog-form",
            style: "spacing: 10px; padding: 4px 0;"
        });
        content.add_child(formBox);

        // 1. Title Input
        let titleLabel = new St.Label({ text: _("Event Title:"), style_class: "bri3fing-dialog-label" });
        formBox.add_actor(titleLabel);

        let titleEntry = new St.Entry({
            hint_text: _("e.g., Team Sync, Doctor Appointment"),
            style_class: "run-dialog-entry",
            can_focus: true
        });
        titleEntry.set_width(420);
        if (isEdit && event.summary) {
            titleEntry.set_text(event.summary);
        }
        formBox.add_actor(titleEntry);

        // 2. Calendar Selector (Clean Dropdown)
        let writableCalendars = this._calendars.filter(c => c.writable !== false);
        if (writableCalendars.length === 0) writableCalendars = this._calendars;

        let selectedCalendarUid = "";
        if (isEdit && event.calendar_uid) {
            selectedCalendarUid = event.calendar_uid;
        } else if (this.defaultCalendarUid && writableCalendars.some(c => c.uid === this.defaultCalendarUid)) {
            selectedCalendarUid = this.defaultCalendarUid;
        } else {
            let onlineCal = writableCalendars.find(c => c.is_online);
            selectedCalendarUid = onlineCal ? onlineCal.uid : (writableCalendars[0] ? writableCalendars[0].uid : "");
        }

        let curCal = writableCalendars.find(c => c.uid === selectedCalendarUid) || writableCalendars[0];
        if (curCal) selectedCalendarUid = curCal.uid;

        if (writableCalendars.length > 0) {
            let calContainer = new St.BoxLayout({ vertical: true, style: "spacing: 4px;" });
            let calLabel = new St.Label({ text: _("Calendar:"), style_class: "bri3fing-dialog-label" });
            calContainer.add_actor(calLabel);

            let dropdownBtn = new St.Button({
                style_class: "bri3fing-dropdown-btn",
                reactive: true,
                can_focus: true
            });
            dropdownBtn.set_width(420);

            let dropdownBtnBox = new St.BoxLayout({
                vertical: false,
                style: "spacing: 8px; y-align: center;"
            });
            dropdownBtn.set_child(dropdownBtnBox);

            let curColorDot = new St.Label({
                text: "⬤",
                style: `color: ${curCal ? curCal.color : "#3b82f6"}; font-size: 8.5pt; margin-top: 1px;`
            });
            dropdownBtnBox.add_actor(curColorDot);

            let curCalName = new St.Label({
                text: curCal ? curCal.name : _("Default Calendar"),
                style_class: "bri3fing-dropdown-btn-label",
                x_expand: true
            });
            dropdownBtnBox.add_actor(curCalName);

            let arrowIcon = new St.Label({
                text: "▾",
                style_class: "bri3fing-dropdown-btn-arrow"
            });
            dropdownBtnBox.add_actor(arrowIcon);

            calContainer.add_actor(dropdownBtn);

            let optionsScroll = new St.ScrollView({
                style_class: "bri3fing-dropdown-options-scroll",
                visible: false,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC
            });
            optionsScroll.set_width(420);
            optionsScroll.set_height(Math.min(writableCalendars.length * 34, 140));

            let optionsBox = new St.BoxLayout({
                vertical: true,
                style_class: "bri3fing-dropdown-options-box"
            });
            optionsScroll.add_actor(optionsBox);

            let optionItems = [];

            writableCalendars.forEach(c => {
                let itemBtn = new St.Button({
                    style_class: (c.uid === selectedCalendarUid) ? "bri3fing-dropdown-item bri3fing-dropdown-item-selected" : "bri3fing-dropdown-item",
                    reactive: true,
                    can_focus: true
                });
                let itemBox = new St.BoxLayout({
                    vertical: false,
                    style: "spacing: 8px; y-align: center; padding: 4px 6px;"
                });
                itemBtn.set_child(itemBox);

                let dot = new St.Label({
                    text: "⬤",
                    style: `color: ${c.color || "#3b82f6"}; font-size: 8.5pt;`
                });
                itemBox.add_actor(dot);

                let name = new St.Label({
                    text: c.name,
                    style_class: "bri3fing-dropdown-item-label",
                    x_expand: true
                });
                itemBox.add_actor(name);

                let check = new St.Label({
                    text: (c.uid === selectedCalendarUid) ? "✓" : "",
                    style_class: "bri3fing-dropdown-item-check"
                });
                itemBox.add_actor(check);

                itemBtn.connect("clicked", () => {
                    selectedCalendarUid = c.uid;
                    curCalName.set_text(c.name);
                    curColorDot.set_style(`color: ${c.color || "#3b82f6"}; font-size: 8.5pt; margin-top: 1px;`);

                    optionItems.forEach(opt => {
                        opt.btn.style_class = (opt.uid === selectedCalendarUid)
                            ? "bri3fing-dropdown-item bri3fing-dropdown-item-selected"
                            : "bri3fing-dropdown-item";
                        opt.check.set_text((opt.uid === selectedCalendarUid) ? "✓" : "");
                    });

                    optionsScroll.visible = false;
                    arrowIcon.set_text("▾");
                });

                optionItems.push({ uid: c.uid, btn: itemBtn, check: check });
                optionsBox.add_actor(itemBtn);
            });

            dropdownBtn.connect("clicked", () => {
                let isVis = !optionsScroll.visible;
                optionsScroll.visible = isVis;
                arrowIcon.set_text(isVis ? "▴" : "▾");
            });

            calContainer.add_actor(optionsScroll);
            formBox.add_actor(calContainer);
        }

        // 3. Date & Time Box
        let now = new Date();
        let todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

        let nextHour = (now.getHours() + 1) % 24;
        let defaultStart = `${String(nextHour).padStart(2, "0")}:00`;
        let defaultEnd = `${String((nextHour + 1) % 24).padStart(2, "0")}:00`;

        let initialDate = (isEdit && event.date_str) ? event.date_str : todayIso;
        let initialStart = (isEdit && event.start_time_str) ? event.start_time_str : defaultStart;
        let initialEnd = (isEdit && event.end_time_str) ? event.end_time_str : defaultEnd;
        let isAllDay = (isEdit && event.all_day === true);

        let dateTimeRow = new St.BoxLayout({ vertical: false, style: "spacing: 12px;" });
        formBox.add_actor(dateTimeRow);

        // Date Entry
        let dateBox = new St.BoxLayout({ vertical: true, style: "spacing: 4px;" });
        let dateLabel = new St.Label({ text: _("Date (YYYY-MM-DD):"), style_class: "bri3fing-dialog-label" });
        let dateEntry = new St.Entry({
            text: initialDate,
            style_class: "run-dialog-entry",
            can_focus: true
        });
        dateEntry.set_width(140);
        dateBox.add_actor(dateLabel);
        dateBox.add_actor(dateEntry);
        dateTimeRow.add_actor(dateBox);

        // Time Start Entry
        let startBox = new St.BoxLayout({ vertical: true, style: "spacing: 4px;" });
        let startLabel = new St.Label({ text: _("Start Time:"), style_class: "bri3fing-dialog-label" });
        let startEntry = new St.Entry({
            text: initialStart,
            style_class: "run-dialog-entry",
            can_focus: true
        });
        startEntry.set_width(120);
        startBox.add_actor(startLabel);
        startBox.add_actor(startEntry);
        dateTimeRow.add_actor(startBox);

        // Time End Entry
        let endBox = new St.BoxLayout({ vertical: true, style: "spacing: 4px;" });
        let endLabel = new St.Label({ text: _("End Time:"), style_class: "bri3fing-dialog-label" });
        let endEntry = new St.Entry({
            text: initialEnd,
            style_class: "run-dialog-entry",
            can_focus: true
        });
        endEntry.set_width(120);
        endBox.add_actor(endLabel);
        endBox.add_actor(endEntry);
        dateTimeRow.add_actor(endBox);

        // All Day Toggle
        let allDayBtn = new St.Button({
            label: isAllDay ? `☑ ${_("All Day Event")}` : `☐ ${_("All Day Event")}`,
            style_class: isAllDay ? "bri3fing-pill-btn-active" : "bri3fing-pill-btn",
            style: "margin-top: 2px;"
        });
        if (isAllDay) {
            startEntry.set_reactive(false);
            endEntry.set_reactive(false);
            startEntry.set_opacity(120);
            endEntry.set_opacity(120);
        }
        allDayBtn.connect("clicked", () => {
            isAllDay = !isAllDay;
            if (isAllDay) {
                allDayBtn.set_label(`☑ ${_("All Day Event")}`);
                allDayBtn.style_class = "bri3fing-pill-btn-active";
                startEntry.set_reactive(false);
                endEntry.set_reactive(false);
                startEntry.set_opacity(120);
                endEntry.set_opacity(120);
            } else {
                allDayBtn.set_label(`☐ ${_("All Day Event")}`);
                allDayBtn.style_class = "bri3fing-pill-btn";
                startEntry.set_reactive(true);
                endEntry.set_reactive(true);
                startEntry.set_opacity(255);
                endEntry.set_opacity(255);
            }
        });
        formBox.add_actor(allDayBtn);

        // 4. Location Input
        let locLabel = new St.Label({ text: _("Location (optional):"), style_class: "bri3fing-dialog-label" });
        formBox.add_actor(locLabel);

        let locEntry = new St.Entry({
            hint_text: _("e.g., Office, Google Meet, Coffee Shop"),
            style_class: "run-dialog-entry",
            can_focus: true
        });
        locEntry.set_width(420);
        if (isEdit && event.location) {
            locEntry.set_text(event.location);
        }
        formBox.add_actor(locEntry);

        // 5. Description / Notes Input
        let descLabel = new St.Label({ text: _("Description / Notes (optional):"), style_class: "bri3fing-dialog-label" });
        formBox.add_actor(descLabel);

        let descEntry = new St.Entry({
            hint_text: _("e.g., Agenda, Zoom link, details"),
            style_class: "run-dialog-entry",
            can_focus: true
        });
        descEntry.set_width(420);
        if (isEdit && event.description) {
            descEntry.set_text(event.description);
        }
        formBox.add_actor(descEntry);

        dlg.setInitialKeyFocus(titleEntry.clutter_text);

        let submit = () => {
            let summary = titleEntry.get_text().trim();
            if (!summary) return;

            let dateVal = dateEntry.get_text().trim() || todayIso;
            let startVal = startEntry.get_text().trim() || defaultStart;
            let endVal = endEntry.get_text().trim() || defaultEnd;
            let locVal = locEntry.get_text().trim();
            let descVal = descEntry.get_text().trim();

            dlg.close();

            if (isEdit) {
                if (this.subtitleLabel) {
                    this.subtitleLabel.set_text(_("Updating event…"));
                }
                let args = [
                    "edit",
                    "--calendar", event.calendar_uid,
                    "--uid", event.uid,
                    "--summary", summary,
                    "--date", dateVal
                ];
                if (selectedCalendarUid && selectedCalendarUid !== event.calendar_uid) {
                    args.push("--new-calendar", selectedCalendarUid);
                }
                if (isAllDay) {
                    args.push("--all-day");
                } else {
                    args.push("--start", startVal, "--end", endVal);
                }
                if (locVal) args.push("--location", locVal);
                if (descVal) args.push("--description", descVal);

                this._executeHelper(args, (success, stdout, stderr) => {
                    if (success) {
                        if (this.subtitleLabel) {
                            this.subtitleLabel.set_text(_("Event updated!"));
                        }
                        Mainloop.timeout_add(400, () => {
                            this.refresh();
                            return false;
                        });
                    } else {
                        let errMsg = stderr || _("Failed to update event");
                        try {
                            let parsed = JSON.parse(stderr);
                            if (parsed && parsed.message) errMsg = parsed.message;
                        } catch (e) {}
                        this._renderError(errMsg);
                    }
                });
            } else {
                if (this.subtitleLabel) {
                    this.subtitleLabel.set_text(_("Creating event…"));
                }
                let args = ["add", "--summary", summary, "--date", dateVal];
                if (selectedCalendarUid) {
                    args.push("--calendar", selectedCalendarUid);
                }
                if (isAllDay) {
                    args.push("--all-day");
                } else {
                    args.push("--start", startVal, "--end", endVal);
                }
                if (locVal) args.push("--location", locVal);
                if (descVal) args.push("--description", descVal);

                this._executeHelper(args, (success, stdout, stderr) => {
                    if (success) {
                        if (this.subtitleLabel) {
                            this.subtitleLabel.set_text(_("Event created!"));
                        }
                        Mainloop.timeout_add(400, () => {
                            this.refresh();
                            return false;
                        });
                    } else {
                        let errMsg = stderr || _("Failed to create event");
                        try {
                            let parsed = JSON.parse(stderr);
                            if (parsed && parsed.message) errMsg = parsed.message;
                        } catch (e) {}
                        this._renderError(errMsg);
                    }
                });
            }
        };

        titleEntry.clutter_text.connect("activate", submit);

        dlg.setButtons([
            {
                label: _("Cancel"),
                action: () => dlg.close(),
                key: Clutter.KEY_Escape
            },
            {
                label: isEdit ? _("Save Changes") : _("Create Event"),
                action: submit,
                default: true,
                key: Clutter.KEY_Return
            }
        ]);

        dlg.open();
    },

    _openOnlineAccounts: function() {
        try {
            Util.spawn(["cinnamon-settings", "online-accounts"]);
            this._startOnlineAccountsWatcher();
        } catch (e) {
            global.logError("[bri3fing] Failed to open Online Accounts: " + e.message);
        }
    },

    _startOnlineAccountsWatcher: function() {
        if (this._accountsWatcherId) {
            Mainloop.source_remove(this._accountsWatcherId);
            this._accountsWatcherId = null;
        }

        let attempts = 0;
        const maxAttempts = 30; // 30 * 3s = 90s polling window while user configures account
        this._accountsWatcherId = Mainloop.timeout_add_seconds(3, () => {
            attempts++;
            this.refresh();
            // Stop polling once online account is connected and events are loaded, or max attempts reached
            if ((this._hasOnlineAccounts && this._events.length > 0) || attempts >= maxAttempts) {
                this._accountsWatcherId = null;
                return false;
            }
            return true;
        });
    },

    on_desklet_removed: function() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._accountsWatcherId) {
            Mainloop.source_remove(this._accountsWatcherId);
            this._accountsWatcherId = null;
        }
    }
};

function main(metadata, desklet_id) {
    return new Bri3fingDesklet(metadata, desklet_id);
}
