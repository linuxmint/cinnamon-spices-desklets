const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;

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

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "loading-animation", "loadingAnimation", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-accent-color", "showAccentColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "accent-color", "accentColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.updateDecoration.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "row-background-color", "rowBackgroundColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "values-color", "valuesColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "headline", "headline", this._onSettingsChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this.updateDecoration();
    this._setupUI();
  }

  on_desklet_removed() {
    this.settings.finalize();
    if (this._loadingTimeoutId) Mainloop.source_remove(this._loadingTimeoutId);
    if (this._animationTimeoutId) Mainloop.source_remove(this._animationTimeoutId);
  }

  async _setupUI() {
    let bootTimes;
    if (this._loadingTimeoutId) {
      Mainloop.source_remove(this._loadingTimeoutId);
      this._loadingTimeoutId = null;
    }
    try {
      bootTimes = await BootTimeHelper.getBootTime();
    } catch (e) {
      if (e.message === "Bootup is not yet finished") {
        if (!this._loadingUIisLoaded) {
          this._loadingUIisLoaded = true;
          this._getLoadingUI();
        }
        this._loadingTimeoutId = Mainloop.timeout_add_seconds(1, () => this._setupUI());
        return;
      } else {
        this._showErrorUI(String(e));
        return;
      }
    }
    if (bootTimes) {
      if (this._animationTimeoutId) {
        Mainloop.source_remove(this._animationTimeoutId);
        this._animationTimeoutId = null;
      }
      this._getBootTimeUI(bootTimes);
    }
  }

  _getBootTimeUI(bootTimes) {
    const mainContainer = new St.BoxLayout({ vertical: true, style_class: "boot-time-main-container" });
    if (this.headline) {
      const headline = new St.Label({ text: _("Boot Time"), style_class: "boot-time-headline" });
      mainContainer.add_child(headline);
    }
    let widestLabelSize = 0;
    const labels = [];
    for (const bootTime of bootTimes) {
      const row = new St.BoxLayout({ x_expand: true, style_class: "boot-time-row" });
      row.set_style(`background-color:${this.rowBackgroundColor};`);

      const label = new St.Label({ text: bootTime.label });
      label.set_style(`color: ${this.labelColor}; font-weight: bold;`);

      if (bootTime.name === "Total" && this.showAccentColor) {
        row.set_style(row.style + ` border: solid 1px ${this.accentColor};`);
      }
      labels.push(label);
      row.add_child(label);

      // Get label width to support different widths of translations
      const [width] = label.get_size();
      if (width > widestLabelSize) widestLabelSize = width;

      // Value Label
      const value = new St.Label({ text: bootTime.value });
      value.set_style(`color: ${this.valuesColor};`);
      row.add_child(value);

      mainContainer.add_child(row);
    }

    widestLabelSize += widestLabelSize / 10;
    for (const label of labels) {
      label.set_style(label.style + ` width: ${widestLabelSize}px;`);
    }

    this.setContent(mainContainer);
  }

  _onSettingsChanged() {
    this._loadingUIisLoaded = false;
    this._setupUI();
  }

  updateDecoration() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _getLoadingUI() {
    const loadingContainer = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      style_class: "boot-time-loading-container",
    });
    if (this.loadingAnimation) loadingContainer.add_child(this._drawCircle());
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
    if (this.loadingAnimation) this._startAnimation();
  }

  _showErrorUI(errorText) {
    const errorContainer = new St.BoxLayout({ vertical: true });
    const errorLabel = new Clutter.Text({
      text: errorText,
      line_wrap: true,
      line_alignment: Pango.Alignment.CENTER,
      color: new Clutter.Color({ red: 255, green: 0, blue: 0, alpha: 255 }),
    });
    const bin = new St.Bin({
      style_class: "boot-time-error-bin",
      child: errorLabel,
    });
    const icon = new St.Icon({
      icon_name: "emblem-important-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 32,
    });
    errorContainer.add_child(icon);
    errorContainer.add_child(bin);
    this.setContent(errorContainer);
  }

  _startAnimation() {
    this.animationState = 0;
    if (this._animationTimeoutId) {
      Mainloop.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = null;
    }
    this._animationTimeoutId = Mainloop.timeout_add(20, this._updateAnimation.bind(this));
  }

  _updateAnimation() {
    if (!this.loadingAnimation) {
      Mainloop.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = null;
      return false;
    }
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
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
