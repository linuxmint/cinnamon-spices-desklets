const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Mainloop = imports.mainloop;

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
      global.log("bootTimes: ", bootTimes);
    } catch (e) {
      global.log("ERROR: ", e);
      global.log("LoadingUI: ", this.loadingUIisLoaded);
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
    const loadingContainer = new St.BoxLayout({ vertical: true, style_class: "boot-time-loading-container" });
    const loadingLabel = new St.Label({ text: _("Boot process not yet complete..."), style_class: "boot-time-loading-label" });
    loadingContainer.add_child(loadingLabel);
    this.setContent(loadingContainer);
  }

  on_desklet_removed() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
