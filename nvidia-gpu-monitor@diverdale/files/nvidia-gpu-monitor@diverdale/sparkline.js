const St = imports.gi.St;
const Cairo = imports.cairo;

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 24;
const DEFAULT_CAPACITY = 60;

var Sparkline = class Sparkline {
    constructor({ width, height, capacity, lineColor } = {}) {
        this.width = width || DEFAULT_WIDTH;
        this.height = height || DEFAULT_HEIGHT;
        this.capacity = capacity || DEFAULT_CAPACITY;
        this.lineColor = lineColor || [0.4, 0.8, 1.0]; // cyan-ish
        this.values = [];

        this.actor = new St.DrawingArea({
            width: this.width,
            height: this.height,
            style_class: "ngm-sparkline",
        });
        this.actor.connect("repaint", this._onRepaint.bind(this));
    }

    push(value) {
        this.values.push(value);
        while (this.values.length > this.capacity) this.values.shift();
        this.actor.queue_repaint();
    }

    setCapacity(n) {
        this.capacity = Math.max(2, n | 0);
        while (this.values.length > this.capacity) this.values.shift();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();

        // Background: nothing (transparent — let stylesheet set bg).

        if (this.values.length < 2) { cr.$dispose(); return; }

        // Y range: assume 0..100 for percentages. Override later if needed.
        const yMin = 0, yMax = 100;
        const yRange = yMax - yMin || 1;

        const n = this.values.length;
        const xStep = w / (this.capacity - 1);
        // Right-align: most recent sample on the right edge.
        const xOffset = w - (n - 1) * xStep;

        cr.setLineWidth(1.5);
        cr.setSourceRGB(this.lineColor[0], this.lineColor[1], this.lineColor[2]);

        const yFor = v => h - ((v - yMin) / yRange) * (h - 2) - 1;

        cr.moveTo(xOffset, yFor(this.values[0]));
        for (let i = 1; i < n; i++) {
            cr.lineTo(xOffset + i * xStep, yFor(this.values[i]));
        }
        cr.stroke();
        cr.$dispose();
    }
};
