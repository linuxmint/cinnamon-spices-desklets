const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Sparkline = imports.sparkline.Sparkline;

const STATUS_GREEN = "● ";
const STATUS_AMBER = "● ";
const STATUS_RED   = "● ";

var GpuRow = class GpuRow {
    constructor(index, deviceName) {
        this.index = index;
        this.deviceName = deviceName;

        this.actor = new St.BoxLayout({ vertical: true, style_class: "ngm-gpu-row" });

        // --- Header line: "GPU 0  RTX 3060  ●" ---
        this._headerBox = new St.BoxLayout({ style_class: "ngm-header" });
        this._headerLabel = new St.Label({
            text: `GPU ${index}  ${deviceName}  `,
            style_class: "ngm-header-text",
        });
        this._statusDot = new St.Label({ text: STATUS_GREEN, style_class: "ngm-status-dot ngm-green" });
        this._headerBox.add(this._headerLabel);
        this._headerBox.add(this._statusDot);
        this.actor.add(this._headerBox);

        // --- Usage line: "Usage 72%   <sparkline>" ---
        this._usageBox = new St.BoxLayout({ style_class: "ngm-usage-line" });
        this._usageLabel = new St.Label({ text: "Usage  --%", style_class: "ngm-metric-label" });
        this._usageBox.add(this._usageLabel);
        this._sparkline = new Sparkline({});
        this._usageBox.add(this._sparkline.actor);
        this.actor.add(this._usageBox);

        // --- VRAM line: "VRAM  [██████░░░░░]  4.2 / 12.0 GB" ---
        this._vramBox = new St.BoxLayout({ style_class: "ngm-vram-line" });
        this._vramLabel = new St.Label({ text: "VRAM ", style_class: "ngm-metric-label" });
        this._vramBox.add(this._vramLabel);

        this._vramTrackWidth = 180;
        this._vramTrack = new St.Bin({
            style_class: "ngm-bar-track",
            width: this._vramTrackWidth,
            height: 10,
        });
        this._vramFill = new St.Bin({
            style_class: "ngm-bar-fill",
            height: 10,
            width: 0,
        });
        this._vramTrack.set_child(this._vramFill);
        this._vramBox.add(this._vramTrack);

        this._vramText = new St.Label({ text: "-- / -- GB", style_class: "ngm-vram-text" });
        this._vramBox.add(this._vramText);
        this.actor.add(this._vramBox);

        // --- Temp / Fan / Power line ---
        this._tfpBox = new St.BoxLayout({ style_class: "ngm-tfp-line" });
        this._tempLabel  = new St.Label({ text: "Temp --°C ",   style_class: "ngm-metric" });
        this._fanLabel   = new St.Label({ text: " Fan --%",     style_class: "ngm-metric" });
        this._powerLabel = new St.Label({ text: " Power -- W",  style_class: "ngm-metric" });
        this._tfpBox.add(this._tempLabel);
        this._tfpBox.add(this._fanLabel);
        this._tfpBox.add(this._powerLabel);
        this.actor.add(this._tfpBox);

        // --- Procs line ---
        this._procsBox = new St.BoxLayout({ style_class: "ngm-procs-line" });
        this._procsLabel = new St.Label({ text: "Procs  --", style_class: "ngm-metric" });
        this._procsBox.add(this._procsLabel);
        this.actor.add(this._procsBox);

        // Threshold defaults — overwritten by setThresholds()
        this._tempWarnC = 75;
        this._tempCritC = 83;
    }

    update(sample) {
        const util = sample.utilPct;
        this._usageLabel.set_text(`Usage  ${util == null ? "--" : util}%`);
        this._sparkline.push(util == null ? 0 : util);

        // VRAM
        const used = sample.memUsedMb;
        const total = sample.memTotalMb;
        if (used != null && total != null && total > 0) {
            const usedGb = (used / 1024).toFixed(1);
            const totalGb = (total / 1024).toFixed(1);
            const pct = used / total;
            const fillWidth = Math.round(this._vramTrackWidth * pct);
            this._vramFill.set_width(fillWidth);
            this._vramText.set_text(`${usedGb} / ${totalGb} GB`);
            this._vramFill.style_class = pct > 0.95
                ? "ngm-bar-fill ngm-bar-fill-red"
                : pct > 0.80
                    ? "ngm-bar-fill ngm-bar-fill-amber"
                    : "ngm-bar-fill";
        } else {
            this._vramFill.set_width(0);
            this._vramText.set_text("-- / -- GB");
        }

        // Temp
        const t = sample.tempC;
        this._tempLabel.set_text(`Temp ${t == null ? "--" : t}°C `);
        this._tempLabel.style_class = this._tempClass(t);

        // Fan
        const f = sample.fanPct;
        this._fanLabel.set_text(` Fan ${f == null ? "--" : f}% `);

        // Power
        const w = sample.powerW, lim = sample.powerLimitW;
        const wTxt = w == null ? "--" : w.toFixed(0);
        const lTxt = lim == null ? "--" : lim.toFixed(0);
        this._powerLabel.set_text(` Power ${wTxt} / ${lTxt} W`);
        this._powerLabel.style_class = this._powerClass(w, lim);
    }

    setStatus(level) {
        // level: "green" | "amber" | "red"
        this._statusDot.style_class = `ngm-status-dot ngm-${level}`;
    }

    setHistoryCapacity(n) {
        this._sparkline.setCapacity(n);
    }

    setThresholds({ tempWarnC, tempCritC }) {
        this._tempWarnC = tempWarnC;
        this._tempCritC = tempCritC;
    }

    setProcsVisible(visible) {
        this._procsBox.visible = !!visible;
    }

    setProcCount(n) {
        this._procsLabel.set_text(`Procs  ${n == null ? "--" : n}`);
    }

    _tempClass(t) {
        if (t == null) return "ngm-metric";
        if (t >= this._tempCritC) return "ngm-metric ngm-red";
        if (t >= this._tempWarnC) return "ngm-metric ngm-amber";
        if (t < 60) return "ngm-metric ngm-green";
        return "ngm-metric";
    }

    _powerClass(w, limitW) {
        if (w == null || limitW == null || limitW <= 0) return "ngm-metric";
        const pct = w / limitW;
        if (pct > 0.90) return "ngm-metric ngm-red";
        if (pct > 0.60) return "ngm-metric ngm-amber";
        return "ngm-metric";
    }
};
