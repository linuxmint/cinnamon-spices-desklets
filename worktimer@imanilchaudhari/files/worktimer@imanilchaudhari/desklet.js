const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Util = imports.misc.util;

const UUID = "worktimer@imanilchaudhari";

// thresholds where we send a one-time reminder
const REMINDER_MILESTONES = [
    { seconds: 3600, label: "1 hour" },
    { seconds: 1800, label: "30 minutes" },
    { seconds: 900, label: "15 minutes" },
    { seconds: 300, label: "5 minutes" },
    { seconds: 60, label: "1 minute" }
];

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}

function friendlyTime(seconds) {
    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h} hour${h > 1 ? 's' : ''}`;
    return `${m} minute${m !== 1 ? 's' : ''}`;
}

class WorkTimerDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "working-hours", "workingHours", this._onHoursChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "reminder-interval", "reminderInterval", null, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-seconds", "showSeconds", this._updateDisplay.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sound-enabled", "soundEnabled", null, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "reminder-sound", "reminderSound", null, null);

        this._timerId = null;
        this._running = false;
        this._seenMilestones = {};
        this._lastPeriodicAt = 0;

        this._initTimer();
        this._buildUI();
        this._updateDisplay();
    }

    _initTimer() {
        this._totalSecs = (this.workingHours || 8) * 3600;
        this._remaining = this._totalSecs;
        this._seenMilestones = {};
        this._lastPeriodicAt = this._totalSecs;
    }

    _buildUI() {
        this._root = new St.BoxLayout({ vertical: true, style_class: 'wt-root' });

        this._titleLabel = new St.Label({ text: 'WORK TIMER', style_class: 'wt-title' });
        this._clockLabel = new St.Label({ text: '08:00', style_class: 'wt-clock' });
        this._subLabel = new St.Label({ text: '8 hours remaining', style_class: 'wt-sublabel' });

        let barBg = new St.Bin({ style_class: 'wt-bar-bg' });
        this._barFill = new St.Bin({ style_class: 'wt-bar-fill' });
        barBg.set_child(this._barFill);

        this._statusLabel = new St.Label({ text: 'Ready — press Start', style_class: 'wt-status' });

        this._startBtn = new St.Button({ label: '▶  Start', style_class: 'wt-btn wt-btn-primary' });
        this._startBtn.connect('clicked', this._toggleTimer.bind(this));

        this._resetBtn = new St.Button({ label: '↺  Reset', style_class: 'wt-btn wt-btn-secondary' });
        this._resetBtn.connect('clicked', this._reset.bind(this));

        let btnRow = new St.BoxLayout({ style_class: 'wt-btnrow' });
        btnRow.add_actor(this._startBtn);
        btnRow.add_actor(this._resetBtn);

        this._root.add_actor(this._titleLabel);
        this._root.add_actor(this._clockLabel);
        this._root.add_actor(this._subLabel);
        this._root.add_actor(barBg);
        this._root.add_actor(this._statusLabel);
        this._root.add_actor(btnRow);

        this.setContent(this._root);
    }

    _toggleTimer() {
        this._running ? this._pause() : this._start();
    }

    _start() {
        if (this._remaining <= 0) return;
        this._running = true;
        this._startBtn.set_label('⏸  Pause');
        this._statusLabel.set_text('Running…');
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, this._tick.bind(this));
    }

    _pause() {
        this._running = false;
        this._startBtn.set_label('▶  Resume');
        this._statusLabel.set_text('Paused');
        this._stopTimer();
    }

    _reset() {
        this._stopTimer();
        this._running = false;
        this._initTimer();
        this._startBtn.set_label('▶  Start');
        this._statusLabel.set_text('Ready — press Start');
        this._updateDisplay();
    }

    _stopTimer() {
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _tick() {
        if (!this._running) return GLib.SOURCE_REMOVE;

        this._remaining = Math.max(0, this._remaining - 1);
        this._updateDisplay();
        this._checkReminders();

        if (this._remaining <= 0) {
            this._onFinish();
            return GLib.SOURCE_REMOVE;
        }

        return GLib.SOURCE_CONTINUE;
    }

    _checkReminders() {
        let secs = this._remaining;

        for (let milestone of REMINDER_MILESTONES) {
            if (secs === milestone.seconds && !this._seenMilestones[secs]) {
                this._seenMilestones[secs] = true;
                this._sendReminder(
                    `Work Timer — ${milestone.label} left`,
                    `You have ${milestone.label} remaining in your work session.`
                );
                return;
            }
        }

        let interval = (this.reminderInterval || 60) * 60;
        if (secs > 0 && secs <= this._lastPeriodicAt - interval) {
            this._lastPeriodicAt = secs;
            this._sendReminder('Work Timer', `${friendlyTime(secs)} remaining in your work session.`);
        }
    }

    _sendReminder(title, body) {
        Main.notify(title, body);
        this._playSound();
    }

    _playSound() {
        if (!this.soundEnabled || !this.reminderSound) return;
        let f = Gio.File.new_for_path(this.reminderSound);
        f.query_info_async(
            Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (file, res) => {
                try {
                    file.query_info_finish(res);
                    Util.trySpawn(['paplay', this.reminderSound]);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        logError(e, 'Error playing reminder sound');
                }
            }
        );
    }

    _onFinish() {
        this._timerId = null;
        this._running = false;
        this._startBtn.set_label('▶  Start');
        this._statusLabel.set_text('Session complete!');
        this._sendReminder(
            'Work Session Complete!',
            `Your ${this.workingHours || 8}-hour work session has ended. Great job!`
        );
    }

    _updateDisplay() {
        let secs = this._remaining;
        let h = Math.floor(secs / 3600);
        let m = Math.floor((secs % 3600) / 60);
        let s = secs % 60;

        let time = this.showSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
        this._clockLabel.set_text(time);
        this._subLabel.set_text(`${friendlyTime(secs)} remaining`);

        let pct = this._totalSecs > 0 ? secs / this._totalSecs : 0;
        let color = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#fbbf24' : pct > 0.1 ? '#fb923c' : '#f87171';

        this._clockLabel.style = `color: ${color};`;
        this._barFill.style = `width: ${Math.round(pct * 100)}%; background-color: ${color};`;
    }

    _onHoursChanged() {
        if (!this._running) this._reset();
    }

    on_desklet_removed() {
        this._stopTimer();
    }
}

function main(metadata, desklet_id) {
    return new WorkTimerDesklet(metadata, desklet_id);
}
