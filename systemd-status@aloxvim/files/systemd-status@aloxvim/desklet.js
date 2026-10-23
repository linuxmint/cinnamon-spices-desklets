// Cinnamon desklet: systemd service status with a colored indicator.
// Green = active, grey = inactive, red = failed, amber = in transition,
// purple = the unit does not exist or could not be queried.

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;

const UUID = 'systemd-status@aloxvim';
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + '/locale');

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// Valid systemd unit names (avoids passing odd arguments to systemctl).
const UNIT_RE = /^[A-Za-z0-9:_.\\@-]+$/;
const PROPS = 'Id,Description,LoadState,ActiveState,SubState';

function SystemdStatusDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

SystemdStatusDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this._timerId = 0;
        this._busy = false;
        this._rows = [];

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        const rebuild = () => this._rebuild();
        const restyle = () => this._applyStyles();
        this.settings.bind('services', 'services', rebuild);
        this.settings.bind('title', 'title', rebuild);
        this.settings.bind('interval', 'interval', () => this._restartTimer());
        this.settings.bind('show-substate', 'showSubstate', restyle);
        this.settings.bind('font-size', 'fontSize', restyle);
        this.settings.bind('dot-size', 'dotSize', restyle);
        this.settings.bind('terminal', 'terminal', null);
        ['active', 'inactive', 'failed', 'transition', 'unknown', 'text'].forEach(k => {
            const prop = 'color' + k.charAt(0).toUpperCase() + k.slice(1);
            this.settings.bind('color-' + k, prop, restyle);
        });

        this._menu.addAction(_('Refresh now'), () => this._refresh());

        this._rebuild();
        this._restartTimer();
    },

    // ---------- UI ----------

    _rebuild: function () {
        this._destroyRows();

        this._box = new St.BoxLayout({ vertical: true, style_class: 'sysd-box' });

        this._titleLabel = new St.Label({ style_class: 'sysd-title' });
        this._box.add_actor(this._titleLabel);
        this._titleLabel.set_text(this.title || '');
        this._titleLabel.visible = !!this.title;

        const list = Array.isArray(this.services) ? this.services : [];
        list.forEach(entry => {
            const name = (entry.name || '').trim();
            if (!name) return;

            const row = new St.BoxLayout({ style_class: 'sysd-row', reactive: true, track_hover: true });
            const dot = new St.Bin({ style_class: 'sysd-dot' });
            const text = new St.Label({ style_class: 'sysd-label' });
            const sub = new St.Label({ style_class: 'sysd-sub' });
            [dot, text, sub].forEach(a => {
                a.y_align = Clutter.ActorAlign.CENTER;
                row.add_actor(a);
            });

            const info = {
                name: name,
                label: (entry.label || '').trim(),
                user: !!entry.user,
                valid: UNIT_RE.test(name),
                row: row, dot: dot, text: text, sub: sub,
                tooltip: new Tooltips.Tooltip(row, name),
                state: 'unknown', substate: '', description: ''
            };
            text.set_text(info.label || name.replace(/\.service$/, ''));
            row.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    this._openStatus(info);
                    return true;
                }
                return false;
            });

            this._rows.push(info);
            this._box.add_actor(row);
        });

        if (this._rows.length === 0) {
            this._box.add_actor(new St.Label({
                style_class: 'sysd-empty',
                text: _('Right-click → Configure\nto add services')
            }));
        }

        this.setContent(this._box);
        this._applyStyles();
        this._refresh();
    },

    _destroyRows: function () {
        this._rows.forEach(r => { if (r.tooltip) r.tooltip.destroy(); });
        this._rows = [];
        if (this._box) {
            this._box.destroy();
            this._box = null;
        }
    },

    _colorFor: function (state) {
        switch (state) {
            case 'active': return this.colorActive;
            case 'inactive': return this.colorInactive;
            case 'failed': return this.colorFailed;
            case 'activating':
            case 'deactivating':
            case 'reloading':
            case 'refreshing': return this.colorTransition;
            default: return this.colorUnknown;
        }
    },

    _applyStyles: function () {
        if (!this._box) return;
        const fs = this.fontSize;
        const ds = this.dotSize;
        this._titleLabel.set_style(
            `font-size: ${Math.round(fs * 1.15)}pt; font-weight: bold; color: ${this.colorText}; padding-bottom: 6px;`);

        this._rows.forEach(r => {
            const color = this._colorFor(r.state);
            // Soft glow around the dot for "live" states.
            const glow = (r.state === 'active' || r.state === 'failed')
                ? `box-shadow: 0 0 ${Math.max(2, Math.round(ds / 3))}px ${color};` : '';
            r.dot.set_style(
                `width: ${ds}px; height: ${ds}px; border-radius: ${ds}px; ` +
                `background-color: ${color}; ${glow} margin-right: ${Math.round(ds * 0.7)}px;`);
            r.text.set_style(`font-size: ${fs}pt; color: ${this.colorText};`);
            r.sub.set_style(`font-size: ${Math.round(fs * 0.85)}pt; color: ${this.colorText}; padding-left: 8px; font-style: italic;`);
            r.sub.visible = !!this.showSubstate;
            r.sub.set_text(r.substate ? `(${r.substate})` : '');

            const state = r.state + (r.substate ? ' / ' + r.substate : '');
            const tip = [
                r.name + (r.user ? '  [' + _('user') + ']' : ''),
                r.description,
                _('State: %s').format(state),
                _('Click: show systemctl status')
            ].filter(Boolean).join('\n');
            r.tooltip.set_text(tip);
        });
    },

    // ---------- systemd queries ----------

    _restartTimer: function () {
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
        const secs = Math.max(1, parseInt(this.interval) || 5);
        this._timerId = Mainloop.timeout_add_seconds(secs, () => {
            this._refresh();
            return true; // keep repeating
        });
    },

    _refresh: function () {
        if (this._rows.length === 0) return;
        if (this._busy) {
            // A query is in progress (e.g. the list was changed): run again when it ends.
            this._refreshQueued = true;
            return;
        }

        const groups = { system: [], user: [] };
        this._rows.forEach(r => {
            if (!r.valid) {
                r.state = 'invalid';
                r.substate = _('invalid name');
                return;
            }
            groups[r.user ? 'user' : 'system'].push(r);
        });

        const pending = ['system', 'user'].filter(g => groups[g].length > 0);
        if (pending.length === 0) {
            this._applyStyles();
            return;
        }

        this._busy = true;
        let remaining = pending.length;
        const done = () => {
            remaining--;
            if (remaining === 0) {
                this._busy = false;
                this._applyStyles();
                if (this._refreshQueued) {
                    this._refreshQueued = false;
                    this._refresh();
                }
            }
        };
        pending.forEach(g => this._query(groups[g], g === 'user', done));
    },

    // A single "systemctl show" call per group: it returns one block per
    // unit, in the order requested, separated by blank lines.
    _query: function (rows, user, done) {
        const argv = ['systemctl'];
        if (user) argv.push('--user');
        argv.push('show', '--no-pager', '--property=' + PROPS, '--');
        rows.forEach(r => argv.push(r.name));

        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            global.logError('[systemd-status] ' + e);
            rows.forEach(r => { r.state = 'unknown'; r.substate = _('error'); });
            done();
            return;
        }

        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                if (!p.get_successful() && rows.length > 1) {
                    // One invalid unit (e.g. "foo@") makes systemctl abort the whole
                    // query: retry one by one so the rest are not lost.
                    let left = rows.length;
                    rows.forEach(r => this._query([r], user, () => { if (--left === 0) done(); }));
                    return;
                }
                const blocks = (stdout || '').trim().split(/\n\s*\n/);
                rows.forEach((r, i) => {
                    const props = {};
                    (blocks[i] || '').split('\n').forEach(line => {
                        const eq = line.indexOf('=');
                        if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
                    });
                    r.description = props.Description || '';
                    if (!props.ActiveState) {
                        r.state = 'unknown';
                        r.substate = _('no response');
                    } else if (props.LoadState === 'not-found') {
                        r.state = 'not-found';
                        r.substate = _('not found');
                    } else {
                        r.state = props.ActiveState;
                        r.substate = props.SubState || '';
                    }
                });
            } catch (e) {
                global.logError('[systemd-status] ' + e);
                rows.forEach(r => { r.state = 'unknown'; r.substate = _('error'); });
            }
            done();
        });
    },

    _openStatus: function (info) {
        if (!info.valid) return;
        const userFlag = info.user ? '--user ' : '';
        // Translations may contain single quotes: escape them for bash.
        const prompt = _('Press any key to close...').replace(/'/g, "'\\''");
        const cmd = `systemctl ${userFlag}status --no-pager -l -- '${info.name}'; ` +
                    `echo; read -n1 -s -r -p '${prompt}'`;
        const term = (this.terminal || 'x-terminal-emulator').trim();
        try {
            // Allows options in the setting, e.g. "xterm -fa Monospace".
            const [, termArgv] = GLib.shell_parse_argv(term);
            Util.spawn(termArgv.concat(['-e', 'bash', '-c', cmd]));
        } catch (e) {
            global.logError('[systemd-status] Could not open the terminal: ' + e);
        }
    },

    on_desklet_removed: function () {
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._destroyRows();
        if (this.settings) this.settings.finalize();
    }
};

function main(metadata, deskletId) {
    return new SystemdStatusDesklet(metadata, deskletId);
}
