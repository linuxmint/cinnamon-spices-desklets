const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Util = imports.misc.util;
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
    this.githubUsername = "";
    this.githubToken = "";
    this.blockSize = 11;
    this.refreshInterval = 15;
    this.backgroundColor = "rgba(255, 255, 255, 0)";
    this.showContributionCount = false;
    this.showUsername = true;
    this.timeoutId = null;
    this.contributionData = null;
    this.mainContainer = null;

    this.bindSettings(metadata, deskletId);

    this.setHeader(_("Github Contribution Grid"));

    this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-main-container" });
    this.mainContainer.add_child(this._createHeader());
    this.setContent(this.mainContainer);

    this._updateLoop();
  }

  bindSettings(metadata, deskletId) {
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this.onDataSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this.onDataSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this.onDataSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this.onStyleSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this.onStyleSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this.onStyleSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-contribution-count", "showContributionCount", this.onStyleSettingChanged);
  }

  on_desklet_removed() {
    if (this.timeoutId) {
      Mainloop.source_remove(this.timeoutId);
      this.timeoutId = null;
    }
  }

  onDataSettingChanged = () => {
    this.mainContainer.remove_all_children();
    this.mainContainer.add_child(this._createHeader());
    this._setupContributionData();
  };

  onStyleSettingChanged = () => {
    this.mainContainer.remove_all_children();
    this.mainContainer.add_child(this._createHeader());
    this._renderContent(this.contributionData);
  };

  async _setupContributionData() {
    this.contributionData = null;

    if (!this.githubUsername || !this.githubToken) {
      this._renderContent(null, _("Please configure username and token in settings."));
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
    const headerContainer = new St.BoxLayout({ style_class: "github-contribution-grid-header-container" });

    // Reload button
    const reloadBin = new St.Bin({
      style_class: "github-contribution-grid-reload-bin",
      reactive: true,
      track_hover: true,
    });
    reloadBin.connect("button-press-event", () => this._setupContributionData());
    const reloadIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    reloadBin.set_child(reloadIcon);
    headerContainer.add_child(reloadBin);

    // Username
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
      // UI for Desklet Setup
      const messageBox = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-message-box" });
      messageBox.add_child(new St.Label({ text: _("Please configure username and token in settings.") }));

      const linkButton = new St.Button({
        reactive: true,
        track_hover: true,
        style_class: "github-contribution-grid-link",
        label: _("Create a GitHub token"),
      });
      linkButton.connect("clicked", () => {
        Util.spawnCommandLine(`xdg-open "${GitHubHelper.gitHubTokenCrationURL}"`);
      });
      messageBox.add_child(linkButton);

      this.contentContainer.add_child(messageBox);
    } else if (error) {
      // Error UI
      const messageBox = new St.BoxLayout({ vertical: true });
      messageBox.add_child(new St.Label({ text: _("Error:") }));
      messageBox.add_child(new St.Label({ text: error, style_class: "github-contribution-grid-error-message" }));
      this.contentContainer.add_child(messageBox);
    } else if (weeks) {
      // Render GitHub Grid
      const gridBox = new St.BoxLayout({ style_class: "github-contribution-grid-grid-box" });

      for (const week of weeks) {
        const weekBox = new St.BoxLayout({ vertical: true, style_class: "week-container" });

        for (const day of week.contributionDays) {
          const dayBin = new St.Bin({
            style_class: "day-bin",
            style: `font-size: ${this.blockSize}px; background-color: ${GitHubHelper.getContributionColor(day.contributionCount)};`,
          });

          if (this.showContributionCount) {
            const label = new St.Label({ text: day.contributionCount.toString() });
            dayBin.set_child(label);
          }
          weekBox.add_child(dayBin);
        }
        gridBox.add_child(weekBox);
      }
      this.contentContainer.add_child(gridBox);
    }

    this.mainContainer.add_child(this.contentContainer);
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
