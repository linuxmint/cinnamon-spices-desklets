const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Mainloop = imports.mainloop;
const Cairo = imports.cairo;
const Settings = imports.ui.settings;

const UUID = "devtest-boot-time@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

let BootTimeHelper;
if (typeof require !== "undefined") {
  BootTimeHelper = require("./helpers/boot-time").BootTimeHelper;
} else {
  BootTimeHelper = imports.helpers["boot-time"].BootTimeHelper;
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Boot Time"));

    this._loadingUIisLoaded = false;
    this._loadingTimeoutId = null;
    this._animationTimeoutId = null;
    this.animationState = 0;

    // Default settings
    this.loadingAnimation = true;
    this.showAccentColor = false;
    this.accentColor = "rgb(47, 255, 82)";
    this.hideDecorations = false;
    this.labelColor = "rgb(255, 255, 255)";
    this.rowBackgroundColor = "rgba(0, 0, 0, 0.253)";
    this.valuesColor = "rgb(255, 255, 255)";
    this.showHeadline = true;

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "loading-animation", "loadingAnimation", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-accent-color", "showAccentColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "accent-color", "accentColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.updateDecoration.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "row-background-color", "rowBackgroundColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "values-color", "valuesColor", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-headline", "showHeadline", this._onSettingsChanged.bind(this));
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
    const mainContainer = new St.BoxLayout({ vertical: true, style: "spacing: 0.5em;" });
    if (this.showHeadline) {
      const headline = new St.Label({ text: _("Boot Time"), style_class: "boot-time-headline" });
      mainContainer.add_child(headline);
    }
    const rowStyle = `border-radius: 0.3em; padding: 0.3em; spacing: 1em; background-color:${this.rowBackgroundColor};`;
    const labelStyle = `color: ${this.labelColor}; font-weight: bold;`;

    let widestLabelSize = 0;
    const labels = [];
    for (const bootTime of bootTimes) {
      const row = new St.BoxLayout({ x_expand: true, style: rowStyle });

      const label = new St.Label({ text: bootTime.label, style: labelStyle });

      if (bootTime.name === "Total" && this.showAccentColor) {
        row.set_style(row.style + ` border: solid 1px ${this.accentColor};`);
      }
      labels.push(label);
      row.add_child(label);

      // Get label width to support different widths of translations
      const [width] = label.get_size();
      if (width > widestLabelSize) widestLabelSize = width;

      // Value Label
      const value = new St.Label({ text: bootTime.value, style: `color: ${this.valuesColor};` });
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
    const loadingContainer = new St.BoxLayout({ vertical: true, style: "min-height: 13em;" });
    if (this.loadingAnimation) {
      loadingContainer.add_child(
        new St.Bin({
          child: this._drawCircle(),
          x_align: St.Align.MIDDLE,
        }),
      );
    }
    const loadingLabel = new St.Label({ text: _("Boot process not yet complete..."), style: "text-align: center; max-width: 10em;" });
    loadingLabel.clutter_text.line_wrap = true;

    loadingContainer.add_child(
      new St.Bin({
        child: loadingLabel,
        x_align: St.Align.MIDDLE,
        y_align: St.Align.MIDDLE,
        y_expand: true,
      }),
    );
    this.setContent(loadingContainer);
    if (this.loadingAnimation) this._startAnimation();
  }

  _showErrorUI(errorText) {
    const errorLabelStyle = "text-align: center; color: red; max-width: 10em;";
    const iconStyle = "width: 4em; height: 4em;";
    const errorContainer = new St.BoxLayout({ vertical: true, style: "min-height: 10em" });
    const errorLabel = new St.Label({ text: errorText, style: errorLabelStyle });
    errorLabel.clutter_text.line_wrap = true;
    const icon = new St.Icon({
      icon_name: "emblem-important-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      style: iconStyle,
      icon_size: 64,
    });
    const iconBin = new St.Bin({
      child: icon,
      style: iconStyle,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    errorContainer.add_child(iconBin);
    errorContainer.add_child(errorLabel);
    this.setContent(errorContainer);
  }

  _startAnimation() {
    this.animationState = 0;
    if (this._animationTimeoutId) {
      Mainloop.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = null;
    }
    const fps = 60;
    this._animationTimeoutId = Mainloop.timeout_add(1000 / fps, this._updateAnimation.bind(this));
  }

  _updateAnimation() {
    if (!this.loadingAnimation) {
      Mainloop.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = null;
      return false;
    }
    this.animationState += 0.01;
    if (this.animationState > 1) this.animationState = 0;

    this.animatedLoadingCircle.set_scale(this.animationState, this.animationState);
    this.animatedLoadingCircle.set_opacity(Math.floor(255 * (1 - this.animationState)));

    return true;
  }

  _drawCircle() {
    this.animatedLoadingCircle = new St.DrawingArea({ style: `width: 10em; height: 10em;` });

    this.animatedLoadingCircle.connect("repaint", area => {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();

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
    });

    this.animatedLoadingCircle.queue_repaint();
    this.animatedLoadingCircle.set_pivot_point(0.5, 0.5);
    return this.animatedLoadingCircle;
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
