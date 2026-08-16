/* global imports, global */
/**
 * clockDialog.js
 *
 * Modal dialog used to add or edit a world-clock tile (name + timezone list).
 *
 * The name field is a top-level St.Entry (same pattern as renameDialog.js) so
 * ModalDialog.pushModal() can give ClutterText a stage-wide key grab. Nested
 * BoxLayout packing and focusable timezone buttons previously stole that grab,
 * so typed names never landed in the entry.
 */

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const St = imports.gi.St;

const Dialog = imports.ui.dialog;
const ModalDialog = imports.ui.modalDialog;

let _translate = function (str) { return str; };

function setTranslate(fn) {
    if (typeof fn === "function")
        _translate = fn;
}

/* Call sites use _() so cinnamon-xlet-makepot's default keyword extracts
 * them; _() always routes through the injected translator. */
function _(str) {
    return _translate(str);
}

function _displayName(tz) {
    if (!tz || tz === "local")
        return _("Local");
    let parts = String(tz).split("/");
    return parts[parts.length - 1].replace(/_/g, " ");
}

function _listLabel(tz) {
    if (!tz || tz === "local")
        return _("Local (system timezone)");
    return _displayName(tz) + " — " + tz;
}

function _loadTimezones() {
    let zones = [];
    try {
        if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function")
            zones = Intl.supportedValuesOf("timeZone");
    } catch (e) {
        zones = [];
    }
    if (!zones || !zones.length) {
        zones = [
            "UTC", "America/New_York", "America/Chicago", "America/Denver",
            "America/Los_Angeles", "America/Toronto", "America/Mexico_City",
            "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
            "Europe/Moscow", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata",
            "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul",
            "Australia/Sydney", "Pacific/Auckland"
        ];
    }
    let seen = Object.create(null);
    let out = [];
    for (let i = 0; i < zones.length; i++) {
        let tz = zones[i];
        if (typeof tz !== "string" || !tz || tz === "local" || seen[tz])
            continue;
        seen[tz] = true;
        out.push(tz);
    }
    out.sort();
    out.unshift("local");
    return out;
}

var ClockConfigDialog = GObject.registerClass(
class ClockConfigDialog extends ModalDialog.ModalDialog {

    /**
     * _init:
     * @title (string): dialog title ("Add Clock" / "Edit Clock")
     * @initial (object): { name, timezone } to pre-fill
     * @callback (function): called with { name, timezone } on commit
     * @timezones (array): selectable timezone ids, including "local"
     */
    _init(title, initial, callback, timezones) {
        super._init();

        this._callback = callback;
        this._settled = false;
        this._activateIds = [];
        this._timezones = Array.isArray(timezones) && timezones.length > 1
            ? timezones.slice()
            : _loadTimezones();
        this._tzButtons = [];

        initial = initial && typeof initial === "object" ? initial : {};
        this._selectedTimezone = (typeof initial.timezone === "string" && initial.timezone)
            ? initial.timezone
            : "local";
        if (this._timezones.indexOf(this._selectedTimezone) === -1)
            this._timezones.splice(1, 0, this._selectedTimezone);

        let initialName = typeof initial.name === "string" ? initial.name.trim() : "";

        let content = new Dialog.MessageDialogContent({
            title: title || _("Clock"),
            description: _("Type a name, then pick a timezone from the list.")
        });
        this.contentLayout.add_child(content);

        this.contentLayout.add_child(new St.Label({
            text: _("Name"),
            style_class: "world-clock-dialog-label"
        }));
        this._nameEntry = this._createEntry(
            initialName,
            _("Clock name"),
            true
        );
        this.contentLayout.add_child(this._nameEntry);

        this.contentLayout.add_child(new St.Label({
            text: _("Timezone"),
            style_class: "world-clock-dialog-label"
        }));
        this._filterEntry = this._createEntry(
            "",
            _("Search city or region"),
            false
        );
        this.contentLayout.add_child(this._filterEntry);
        this._filterEntry.clutter_text.connect("text-changed", () => {
            this._rebuildTimezoneList();
        });

        this._listBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "world-clock-tz-box"
        });
        this._scroll = new St.ScrollView({
            style_class: "world-clock-tz-list",
            x_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        this._scroll.add_actor(this._listBox);
        this.contentLayout.add_child(this._scroll);

        this._selectedLabel = new St.Label({
            style_class: "world-clock-tz-selected",
            text: ""
        });
        this.contentLayout.add_child(this._selectedLabel);

        this._rebuildTimezoneList();
        this._updateSelectedLabel();

        this.setButtons([
            {
                label: _("Cancel"),
                action: () => this._cancel(),
                key: Clutter.KEY_Escape
            },
            {
                label: _("Save"),
                action: () => this._commit(),
                default: true
            }
        ]);

        /* Must come after setButtons(): addButton() focuses the first button
         * when nothing else has claimed focus. Focus the ClutterText, not the
         * St.Entry wrapper — that is what receives typed characters. */
        this.setInitialKeyFocus(this._nameEntry.clutter_text);
        this.connect("opened", () => this._focusName());
        this.connect("destroy", () => this._onDestroy());
    }

    _createEntry(value, hint, commitOnActivate) {
        let entry = new St.Entry({
            style_class: "world-clock-dialog-entry",
            can_focus: true,
            track_hover: true,
            reactive: true,
            x_expand: true,
            hint_text: hint || ""
        });
        let text = entry.clutter_text;
        text.editable = true;
        text.activatable = true;
        text.single_line_mode = true;
        if (value)
            entry.set_text(value);

        /* Clicking the entry must reclaim the modal key grab from timezone
         * list items or the default Save button. */
        entry.connect("button-press-event", () => {
            global.stage.set_key_focus(text);
            return Clutter.EVENT_PROPAGATE;
        });

        let id = text.connect("activate", () => {
            if (commitOnActivate)
                this._commit();
            else
                this._selectFirstVisible();
        });
        this._activateIds.push({ entry: entry, id: id });
        return entry;
    }

    _focusName() {
        try {
            let text = this._nameEntry.clutter_text;
            global.stage.set_key_focus(text);
            let value = this._nameEntry.get_text() || "";
            text.set_selection(0, value.length);
        } catch (e) {
            global.logError("[clockDialog] could not focus name entry: " + e);
        }
    }

    _visibleTimezones() {
        let q = "";
        try {
            q = this._filterEntry.get_text();
        } catch (e) {
            q = "";
        }
        q = q.trim().toLowerCase();
        if (!q)
            return this._timezones;
        return this._timezones.filter((tz) => {
            return String(tz).toLowerCase().indexOf(q) !== -1
                || _listLabel(tz).toLowerCase().indexOf(q) !== -1;
        });
    }

    _rebuildTimezoneList() {
        this._listBox.destroy_all_children();
        this._tzButtons = [];

        let zones = this._visibleTimezones();
        let limit = Math.min(zones.length, 400);
        for (let i = 0; i < limit; i++) {
            let tz = zones[i];
            let button = new St.Button({
                style_class: "world-clock-tz-item",
                label: _listLabel(tz),
                x_align: St.Align.START,
                x_expand: true,
                reactive: true,
                /* Keep keyboard focus on the name/filter entries. */
                can_focus: false
            });
            button.timezone = tz;
            button.connect("clicked", () => this._selectTimezone(tz));
            this._listBox.add_child(button);
            this._tzButtons.push(button);
        }
        this._highlightSelection();
    }

    _selectTimezone(tz) {
        this._selectedTimezone = tz || "local";
        this._highlightSelection();
        this._updateSelectedLabel();

        /* Only suggest a name when the field is still empty. Never overwrite
         * a name the user is typing or has already set. */
        try {
            if (!this._nameEntry.get_text().trim())
                this._nameEntry.set_text(_displayName(this._selectedTimezone));
        } catch (e) {
            /* entry gone */
        }
        this._focusName();
    }

    _selectFirstVisible() {
        let zones = this._visibleTimezones();
        if (zones.length)
            this._selectTimezone(zones[0]);
    }

    _highlightSelection() {
        for (let i = 0; i < this._tzButtons.length; i++) {
            let button = this._tzButtons[i];
            if (button.timezone === this._selectedTimezone)
                button.add_style_pseudo_class("outlined");
            else
                button.remove_style_pseudo_class("outlined");
        }
    }

    _updateSelectedLabel() {
        this._selectedLabel.set_text(
            _("Selected: %s").format(_listLabel(this._selectedTimezone))
        );
    }

    _onDestroy() {
        try {
            for (let i = 0; i < this._activateIds.length; i++) {
                let item = this._activateIds[i];
                if (item.entry && item.id)
                    item.entry.clutter_text.disconnect(item.id);
            }
        } catch (e) {
            /* entry already finalized */
        }
        this._activateIds = [];
        this._callback = null;
    }

    _cancel() {
        if (this._settled)
            return;
        this._settled = true;
        this.destroy();
    }

    _commit() {
        if (this._settled)
            return;
        this._settled = true;

        let name = "";
        let timezone = this._selectedTimezone || "local";
        try {
            name = this._nameEntry.get_text().trim();
        } catch (e) {
            global.logError("[clockDialog] could not read name: " + e);
        }
        if (!name)
            name = _displayName(timezone);

        let callback = this._callback;
        this.destroy();

        if (callback) {
            try {
                callback({ name: name, timezone: timezone });
            } catch (e) {
                global.logError("[clockDialog] save callback failed: " + e);
            }
        }
    }
});

/**
 * promptClock:
 * @title (string): dialog title
 * @initial (object): { name, timezone }
 * @callback (function): called with { name, timezone } on commit
 * @timezones (array): optional list of timezone ids
 *
 * Returns (boolean): whether the dialog opened.
 */
function promptClock(title, initial, callback, timezones) {
    try {
        if (!Array.isArray(timezones) || timezones.length < 2)
            timezones = _loadTimezones();
        let dialog = new ClockConfigDialog(title, initial, callback, timezones);
        dialog.open(global.get_current_time());
        return dialog;
    } catch (e) {
        global.logError("[clockDialog] could not open clock dialog: " + e);
        return null;
    }
}
