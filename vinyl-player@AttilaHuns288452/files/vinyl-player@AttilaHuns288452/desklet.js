/* === Vinyl Record Player Desklet === */
const Desklet = imports.ui.desklet;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

// Palettes: pre-computed dark and light color schemes
const SCHEMES = {
    dark: {
        fontColor: '#e0d8cc',
        playerColor: '#5a4a3a',
        recordColor: '#111111',
        labelColor: '#c4b089',
    },
    light: {
        fontColor: '#3d3228',
        playerColor: '#d4c5a9',
        recordColor: '#3a3430',
        labelColor: '#8b7355',
    },
};

// Lighten or darken a hex color by mixing with white/black.
// t = 0..1, higher = closer to white (lighten) or black (darken).
function shade(hex, t, towardWhite) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    const w = towardWhite ? 255 : 0;
    const f = t;
    return St.Color.to_string(St.Color.new_rgba(
        Math.round(r + (w - r) * f),
        Math.round(g + (w - g) * f),
        Math.round(b + (w - b) * f),
        1.0
    ));
}

// Derive a platter gradient from a single base color.
// Returns [top, mid, bottom] hex strings.
function platterGradients(base) {
    const light = shade(base, 0.25, true);
    const mid = base;
    const dark = shade(base, 0.15, false);
    return { top: mid, mid: light, bottom: dark, border: shade(base, 0.4, false) };
}

// Derive record gradient from base.
function recordGradients(base) {
    const dark = shade(base, 0.05, false);
    const mid = base;
    return { top: shade(base, 0.08, true), mid: dark, bottom: shade(base, 0.12, false), border: shade(base, 0.3, true) };
}

// Derive label gradient from base.
function labelGradients(base) {
    const light = shade(base, 0.15, true);
    const dark = shade(base, 0.1, false);
    return { top: base, mid: light, bottom: dark, border: shade(base, 0.3, false) };
}

const RecordPlayer = class {
    constructor(metadata, desklet) {
        this._metadata = metadata;
        this._desklet = desklet;
        this._settings = new Cinnamon.AppletSettings(metadata.uuid, metadata.uuid);

        // Bind all settings
        for (const s of ['scheme', 'fontColor', 'playerColor', 'recordColor', 'labelColor', 'playing', 'speed']) {
            this._settings.bindProperty('', s, s,
                () => this._applyColors(), true);
        }
        // Defaults
        this._settings.setDefault('scheme', 'dark');
        this._settings.setDefault('fontColor', '#b4afa5');
        this._settings.setDefault('playerColor', '#5a4a3a');
        this._settings.setDefault('recordColor', '#111111');
        this._settings.setDefault('labelColor', '#c4b089');
        this._settings.setDefault('playing', true);
        this._settings.setDefault('speed', 33);

        this._angle = 0;
        this._startTime = 0;
        this._rate = 0;

        this._initLayout();
        this._applyColors();
        this._onSettingsChanged();
    }

    _initLayout() {
        // Canvas
        this._canvas = new St.Bin({
            style_class: 'vinyl-canvas',
            width: 200,
            height: 200,
        });

        // Platter
        this._platter = new St.Bin({ style_class: 'vinyl-platter' });
        this._platter.set_position(18, 18);
        this._platter.set_size(164, 164);
        this._canvas.add_child(this._platter);

        // Record
        this._record = new St.Bin({ style_class: 'vinyl-record' });
        this._record.set_position(28, 28);
        this._record.set_size(144, 144);
        this._canvas.add_child(this._record);

        // Label
        this._label = new St.Bin({ style_class: 'vinyl-label' });
        this._label.set_position(70, 70);
        this._label.set_size(60, 60);
        this._canvas.add_child(this._label);

        // Spindle
        this._spindle = new St.Bin({ style_class: 'vinyl-spindle' });
        this._spindle.set_position(95, 95);
        this._spindle.set_size(10, 10);
        this._canvas.add_child(this._spindle);

        // Tonearm
        this._armBase = new St.Bin({ style_class: 'arm-base' });
        this._armBase.set_position(150, 22);
        this._armBase.set_size(12, 12);
        this._canvas.add_child(this._armBase);

        this._armBody = new St.Bin({ style_class: 'arm-body' });
        this._armBody.set_position(156, 28);
        this._armBody.set_size(80, 4);
        this._canvas.add_child(this._armBody);
        this._armBody.rotation_angle_z = 35;
        this._armBody.set_pivot_point(0, 0.5);

        // Title
        this._title = new St.Label({ style_class: 'vinyl-title', text: 'Vinyl Player' });
        this._title.set_position(50, 182);
        this._canvas.add_child(this._title);

        // Click toggle
        this._canvas.reactive = true;
        this._canvas.connect('button-press-event', () => this._togglePlay());

        // Popup menu
        this._popupManager = new PopupMenu.PopupMenuManager(this);
        this._popupMenu = new PopupMenu.PopupMenu(this._canvas, 0);

        const playItem = new PopupMenu.PopupMenuItem('Play / Pause');
        playItem.connect('activated', () => this._togglePlay());
        this._popupMenu.addMenuItem(playItem);

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        this._popupMenu.addMenuItem(sep);

        const s33 = new PopupMenu.PopupMenuItem('33 RPM');
        s33.connect('activated', () => this._setSpeed(33));
        this._popupMenu.addMenuItem(s33);

        const s45 = new PopupMenu.PopupMenuItem('45 RPM');
        s45.connect('activated', () => this._setSpeed(45));
        this._popupMenu.addMenuItem(s45);

        this._popupManager.addMenu(this._popupMenu);

        this._desklet.header.add_child(this._canvas);
    }

    // Apply all colors from current settings, with scheme-aware auto-generation.
    _applyColors() {
        if (!this._canvas) return;

        const scheme = this._settings.get_property('scheme');
        let fc = this._settings.get_property('fontColor');
        let pc = this._settings.get_property('playerColor');
        let rc = this._settings.get_property('recordColor');
        let lc = this._settings.get_property('labelColor');

        // When scheme is dark/light, override user colors with the palette, but
        // persist the chosen palette values back to settings so the dropdown
        // stays in sync (without this, switching back to "custom" loses nothing).
        if (scheme === 'dark') {
            fc = SCHEMES.dark.fontColor;
            pc = SCHEMES.dark.playerColor;
            rc = SCHEMES.dark.recordColor;
            lc = SCHEMES.dark.labelColor;
        } else if (scheme === 'light') {
            fc = SCHEMES.light.fontColor;
            pc = SCHEMES.light.playerColor;
            rc = SCHEMES.light.recordColor;
            lc = SCHEMES.light.labelColor;
        }
        // "custom" — use whatever the user set, no override.

        // Platter gradient (linear, left-to-right in CSS but visually radial-ish)
        const plg = platterGradients(pc);
        this._platter.set_style(
            `background: linear-gradient(135deg, ${plg.top}, ${plg.mid}, ${plg.bottom});` +
            `border: 2px solid ${plg.border};`
        );

        // Record gradient (radial)
        const rdg = recordGradients(rc);
        this._record.set_style(
            `background: radial-gradient(ellipse at center, ${rdg.top} 0%, ${rdg.mid} 30%, ${rdg.bottom} 70%, ${rdg.top} 100%);` +
            `border: 1px solid ${rdg.border};`
        );

        // Label gradient (radial)
        const lbg = labelGradients(lc);
        this._label.set_style(
            `background: radial-gradient(ellipse at center, ${lbg.top} 0%, ${lbg.mid} 40%, ${lbg.bottom} 100%);` +
            `border: 1px solid ${lbg.border};`
        );

        // Title color
        this._title.set_style(`color: ${fc};`);

        // Canvas background tint to complement (subtle dark tint from player color)
        const tint = shade(pc, 0.7, false);
        this._canvas.set_style(
            `background: rgba(20, 18, 16, 0.88);`
        );
    }

    _togglePlay() {
        this._settings.setProperty('playing', !this._settings.get_property('playing'));
    }

    _setSpeed(rpm) {
        this._settings.setProperty('speed', rpm);
    }

    _onSettingsChanged() {
        const playing = this._settings.get_property('playing');
        if (playing && !this._rate) {
            this._startTime = Date.now();
        }
        this._rate = playing ? 1 : 0;
    }

    onUpdate() {
        if (!this._rate) return;

        const speed = this._settings.get_property('speed');
        const msPerRev = speed === 45 ? 60000 / 45 : 60000 / 33;
        const elapsed = Date.now() - this._startTime;
        this._angle = ((elapsed / msPerRev) * 360) % 360;

        this._record.rotation_angle_z = this._angle;
        this._label.rotation_angle_z = this._angle;
    }
};

function main(metadata, desklet, callback) {
    const player = new RecordPlayer(metadata, desklet);
    callback(player);
}
