const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "github-contribution-grid@KopfdesDaemons";

const { GitHubHelper } = require("./helpers/github.helper");

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

    this.githubUsername = this.settings.getValue("github-username") || "";
    this.githubToken = this.settings.getValue("github-token") || "";
    this.blockSize = this.settings.getValue("block-size") || 11;
    this.refreshInterval = this.settings.getValue("refresh-interval") || 15;
    this.backgroundColor = this.settings.getValue("background-color") || "rgba(255, 255, 255, 0)";
    this.showContributionCount = this.settings.getValue("show-contribution-count") || false;
    this.showUsername = this.settings.getValue("show-username") || true;

    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-contribution-count", "showContributionCount", this.on_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this.on_setting_changed);

    this.timeoutId = null;

    this.setHeader(_("Github Contribution Grid"));

    // Delay the initial load to prevent race conditions on startup
    Mainloop.timeout_add_seconds(5, () => this._setupLayout());
    this._updateLoop();
  }

  on_desklet_removed() {
    if (this.timeoutId) {
      Mainloop.source_remove(this.timeoutId);
    }
  }

  on_setting_changed() {
    this._setupLayout();
  }

  async _setupLayout() {
    if (!this.githubUsername || !this.githubToken) {
      this.setContent(new St.Label({ text: _("Please configure username and token in settings.") }));
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
      this._renderGrid(response);
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this.setContent(new St.Label({ text: _("Error fetching data. See logs for details.") }));
    }
  }

  _renderGrid(weeks) {
    const mainContainer = new St.BoxLayout({
      vertical: true,
      style_class: "github-contribution-grid-main-container",
    });
    const headerContainer = new St.BoxLayout({
      style_class: "github-contribution-grid-header-container",
    });
    if (this.showUsername) {
      const labelBin = new St.Bin({
        style_class: "github-contribution-grid-label-bin",
      });
      const label = new St.Label({
        text: this.githubUsername,
        style_class: "github-contribution-grid-label",
      });
      labelBin.set_child(label);
      headerContainer.add_child(labelBin);
    }

    const gridContainer = new St.BoxLayout({
      style_class: "github-contribution-grid-container",
      x_expand: true,
      style: `background-color: ${this.backgroundColor};`,
    });
    mainContainer.add_child(headerContainer);
    mainContainer.add_child(gridContainer);

    for (const week of weeks) {
      const weekBox = new St.BoxLayout({
        vertical: true,
        style_class: "week-container",
      });

      for (const day of week.contributionDays) {
        const dayBin = new St.Bin({
          style_class: "day-bin",
          style: `font-size: ${this.blockSize}px; background-color: ${this._getContributionColor(day.contributionCount)};`,
        });
        if (this.showContributionCount) {
          const label = new St.Label({
            text: day.contributionCount.toString(),
            style: "color: white;",
          });
          dayBin.set_child(label);
        }
        weekBox.add_child(dayBin);
      }
      gridContainer.add_child(weekBox);
    }
    this.setContent(mainContainer);
  }

  _getContributionColor(count) {
    if (count >= 10) return "#56d364";
    if (count >= 9) return "#2ea043";
    if (count >= 6) return "#196c2e";
    if (count >= 4) return "#196c2e";
    if (count > 0) return "#033a16";
    if (count === 0) return "#151b23";
  }

  _updateLoop() {
    this._setupLayout();
    this.timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
      this._updateLoop();
    });
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
