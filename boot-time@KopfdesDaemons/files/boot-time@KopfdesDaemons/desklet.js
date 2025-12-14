const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Pango = imports.gi.Pango;

const UUID = "boot-time@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

const { BootTimeHelper } = require("./helpers/boot-time.helper");

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Boot Time"));
    this._setupUI();
  }

  async _setupUI() {
    let bootTimes;
    try {
      bootTimes = await BootTimeHelper.getBootTime();
    } catch (e) {
      if (!this.loadingUIisLoaded) {
        this.loadingUIisLoaded = true;
        this._getLoadingUI();
      }
      if (this._timeout) Mainloop.source_remove(this._timeout);
      this._timeout = Mainloop.timeout_add_seconds(1, () => this._setupUI());
      return;
    }
    if (bootTimes) this._getBootTimeUI(bootTimes);
    if (this._timeout) Mainloop.source_remove(this._timeout);
  }

  _getBootTimeUI(bootTimes) {
    if (this._animationTimeout) {
      Mainloop.source_remove(this._animationTimeout);
      this._animationTimeout = null;
    }
    const mainContainer = new St.BoxLayout({ vertical: true, style_class: "boot-time-main-container" });
    const headline = new St.Label({ text: _("Boot Time"), style_class: "boot-time-headline" });
    mainContainer.add_child(headline);

    let widestLabelSize = 0;
    const labels = [];
    for (const bootTime of bootTimes) {
      const row = new St.BoxLayout({ x_expand: true, style_class: "boot-time-row" });

      const label = new St.Label({ text: bootTime.label, style_class: "boot-time-label" });
      if (bootTime.name === "Total") {
        row.style_class = "boot-time-row-total";
      }
      labels.push(label);
      row.add_child(label);

      // Get label width to support different widths of translations
      const width = label.get_width();
      if (width > widestLabelSize) widestLabelSize = width;

      // Value Label
      row.add_child(new St.Label({ text: bootTime.value }));

      mainContainer.add_child(row);
    }

    widestLabelSize += widestLabelSize / 10;
    for (const label of labels) {
      label.set_style(`width: ${widestLabelSize}px;`);
    }

    this.setContent(mainContainer);
  }

  _getLoadingUI() {
    const loadingContainer = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      style_class: "boot-time-loading-container",
    });
    loadingContainer.add_child(this._drawCircle());
    const loadingLabel = new Clutter.Text({
      text: _("Boot process not yet complete..."),
      line_wrap: true,
      line_alignment: Pango.Alignment.CENTER,
      color: new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 }),
    });
    const bin = new St.Bin({
      style_class: "boot-time-loading-bin",
      child: loadingLabel,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    loadingContainer.add_child(bin);
    this.setContent(loadingContainer);
    this._startAnimation();
  }

  _startAnimation() {
    this.animationState = 0;
    if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
    this._animationTimeout = Mainloop.timeout_add(16, this._updateAnimation.bind(this));
  }

  _updateAnimation() {
    this.animationState += 0.01;
    if (this.animationState > 1) this.animationState = 0;

    this.circleActor.set_scale(this.animationState, this.animationState);
    this.circleActor.set_opacity(Math.floor(255 * (1 - this.animationState)));

    return true;
  }

  _drawCircle() {
    this.circleActor = new Clutter.Actor({
      width: 200,
      height: 200,
    });
    const canvas = new Clutter.Canvas();
    canvas.set_size(200 * global.ui_scale, 200 * global.ui_scale);

    canvas.connect("draw", (canvas, cr, width, height) => {
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();
      cr.setOperator(Cairo.Operator.OVER);
      cr.scale(width, height);
      cr.translate(0.5, 0.5);

      cr.setSourceRGBA(1, 1, 1, 1);
      cr.setLineWidth(0.05);
      cr.arc(0, 0, 0.4, 0, Math.PI * 2);
      cr.stroke();

      return true;
    });

    canvas.invalidate();
    this.circleActor.set_content(canvas);
    this.circleActor.set_pivot_point(0.5, 0.5);
    return this.circleActor;
  }

  on_desklet_removed() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
    if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
