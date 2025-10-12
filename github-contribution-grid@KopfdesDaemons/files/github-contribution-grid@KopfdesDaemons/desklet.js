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

    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this.on_data_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this.on_data_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this.on_data_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this.on_style_setting_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this.on_style_setting_changed);
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "show-contribution-count",
      "showContributionCount",
      this.on_style_setting_changed
    );
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this.on_style_setting_changed);

    this.timeoutId = null;
    this.contributionData = null;
    this.mainContainer = null;

    this.setHeader(_("Github Contribution Grid"));

    this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-main-container" });
    this.mainContainer.add_child(this._createHeader());
    this.setContent(this.mainContainer);
    this._updateLoop();
  }

  on_desklet_removed() {
    if (this.timeoutId) {
      Mainloop.source_remove(this.timeoutId);
    }
  }

  on_data_setting_changed() {
    this._setupContributionData();
  }

  on_style_setting_changed() {
    this.mainContainer.remove_all_children();
    this.mainContainer.add_child(this._createHeader());
    this._renderContent(this.contributionData);
  }

  async _setupContributionData() {
    this.contributionData = null;

    if (!this.githubUsername || !this.githubToken) {
      this.setContent(new St.Label({ text: _("Please configure username and token in settings.") }));
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
      this.contributionData = response;
      this._renderContent(this.contributionData);
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this._renderContent(null, e.message);
    }
  }

  _createHeader() {
    const headerContainer = new St.BoxLayout({
      style_class: "github-contribution-grid-header-container",
    });
    const reloadBin = new St.Bin({
      style_class: "github-contribution-grid-reload-bin",
      reactive: true,
      track_hover: true,
    });
    reloadBin.connect("button-press-event", () => {
      this._setupContributionData();
    });
    const reloadIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    reloadBin.set_child(reloadIcon);
    headerContainer.add_child(reloadBin);

    if (this.showUsername) {
      const labelBin = new St.Bin({ style_class: "github-contribution-grid-label-bin" });
      const label = new St.Label({ text: this.githubUsername });
      labelBin.set_child(label);
      headerContainer.add_child(labelBin);
    }
    return headerContainer;
  }

  _renderContent(weeks, error = null) {
    if (this.contentContainer) {
      this.mainContainer.remove_child(this.contentContainer);
      this.contentContainer.destroy();
    }

    this.contentContainer = new St.BoxLayout({
      style_class: "github-contribution-grid-container",
      x_expand: true,
      style: `background-color: ${this.backgroundColor};`,
    });

    if (!this.githubUsername || !this.githubToken) {
      this.contentContainer.add_child(new St.Label({ text: _("Please configure username and token in settings.") }));
    } else if (error) {
      this.contentContainer.add_child(new St.Label({ text: error }));
    } else if (weeks) {
      for (const week of weeks) {
        const weekBox = new St.BoxLayout({
          vertical: true,
          style_class: "week-container",
        });

        for (const day of week.contributionDays) {
          const dayBin = new St.Bin({
            style_class: "day-bin",
            style: `font-size: ${this.blockSize}px; background-color: ${this._getContributionColor(day.contributionCount)};`,
            reactive: true,
            track_hover: true,
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
        this.contentContainer.add_child(weekBox);
      }
    }

    this.mainContainer.add_child(this.contentContainer);
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
    this._setupContributionData();
    this.timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
      this._updateLoop();
    });
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
