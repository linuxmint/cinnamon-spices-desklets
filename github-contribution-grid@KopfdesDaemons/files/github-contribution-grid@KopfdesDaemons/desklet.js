const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const UUID = "github-contribution-grid@KopfdesDaemons";

let GitHubHelper;
if (typeof require !== "undefined") {
  GitHubHelper = require("./helpers/github").GitHubHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
  imports.searchPath.push(DESKLET_DIR);
  GitHubHelper = imports.helpers.github.GitHubHelper;
}

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("GitHub Contribution Grid"));

    this._timeoutId = null;
    this._contributionData = null;
    this._mainContainer = null;
    this._isReloading = false;

    // Default settings
    this.githubUsername = "";
    this.githubToken = "";
    this.blockSize = 11;
    this.refreshInterval = 15;
    this.backgroundColor = "rgba(255, 255, 255, 0)";
    this.showContributionCount = false;
    this.showUsername = true;

    this._bindSettings(metadata, deskletId);
  }

  _bindSettings(metadata, deskletId) {
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this.onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this.onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this.onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this.onStyleSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this.onStyleSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this.onStyleSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-contribution-count", "showContributionCount", this.onStyleSettingChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._mainContainer = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-main-container" });
    this._mainContainer.add_child(this._createHeader());
    this.setContent(this._mainContainer);

    this._updateLoop();

    // The first request after system start will fail
    // Delay to ensure network services are ready and try again
    Mainloop.timeout_add_seconds(5, this._setupContributionData.bind(this));
  }

  on_desklet_removed() {
    if (this._timeoutId) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.settings && !this._isReloading) {
      this.settings.finally();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  onDataSettingChanged() {
    this._mainContainer.remove_all_children();
    this._mainContainer.add_child(this._createHeader());
    this._setupContributionData();
  }

  onStyleSettingChanged() {
    this._mainContainer.remove_all_children();
    this._mainContainer.add_child(this._createHeader());
    this._renderContent(this._contributionData);
  }

  async _setupContributionData() {
    this._contributionData = null;

    if (!this.githubUsername || !this.githubToken) {
      this._renderContent(null, _("Please configure username and token in settings."));
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
      this._contributionData = response;
      this._renderContent(this._contributionData);
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this._renderContent(null, e.message);
    }
  }

  _createHeader() {
    const headerContainer = new St.BoxLayout({ style_class: "github-contribution-grid-header-container" });

    // Reload button
    const reloadButton = new St.Button({ style_class: "github-contribution-grid-reload-bin" });
    reloadButton.connect("button-press-event", () => this._setupContributionData());
    const reloadIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    new Tooltips.Tooltip(reloadButton, _("Reload"));
    reloadButton.set_child(reloadIcon);
    headerContainer.add_child(reloadButton);

    // Username
    if (this.showUsername) {
      const usernameButton = new St.Button({ label: this.githubUsername, style_class: "github-contribution-grid-label-bin" });
      usernameButton.connect("button-press-event", () => Util.spawnCommandLine(`xdg-open "https://github.com/${this.githubUsername}"`));
      new Tooltips.Tooltip(usernameButton, _("Open GitHub profile"));
      headerContainer.add_child(usernameButton);
    }

    return headerContainer;
  }

  _renderContent(weeks, error = null) {
    if (this.contentContainer) {
      this._mainContainer.remove_child(this.contentContainer);
      this.contentContainer.destroy();
    }

    this.contentContainer = new St.BoxLayout({
      style_class: "github-contribution-grid-container",
      x_expand: true,
      style: `background-color: ${this.backgroundColor};`,
    });

    if (!this.githubUsername || !this.githubToken) {
      // UI for Desklet Setup
      const setupBox = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-setup-container" });
      setupBox.add_child(new St.Label({ text: "GitHub Contribution Grid", style_class: "github-contribution-grid-setup-headline" }));
      setupBox.add_child(new St.Label({ text: _("Please configure username and token in settings.") }));

      const createTokenButton = new St.Button({ style_class: "github-contribution-grid-link", label: _("Create a GitHub token") });
      createTokenButton.connect("clicked", () => Util.spawnCommandLine(`xdg-open "${GitHubHelper.gitHubTokenCreationURL}"`));
      setupBox.add_child(createTokenButton);

      this.contentContainer.add_child(setupBox);
    } else if (error) {
      // Error UI
      const errorBox = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-error-container" });
      errorBox.add_child(new St.Label({ text: "GitHub Contribution Grid", style_class: "github-contribution-grid-error-headline" }));
      errorBox.add_child(new St.Label({ text: _("Error:") }));
      errorBox.add_child(new St.Label({ text: error, style_class: "github-contribution-grid-error-message" }));
      const reloadButton = new St.Button({ style_class: "github-contribution-grid-error-reload-button", label: _("Reload") });
      reloadButton.connect("clicked", () => this._setupContributionData());
      errorBox.add_child(reloadButton);
      this.contentContainer.add_child(errorBox);
    } else if (weeks) {
      // Render GitHub Grid
      const gridBox = new St.BoxLayout({ style_class: "github-contribution-grid-grid-box" });

      for (const week of weeks) {
        const weekBox = new St.BoxLayout({ vertical: true, style_class: "week-container" });

        for (const day of week.contributionDays) {
          const dayBin = new St.Bin({
            style_class: "day-bin",
            reactive: true,
            track_hover: true,
            style: `font-size: ${this.blockSize}px; background-color: ${GitHubHelper.getContributionColor(day.contributionCount)};`,
          });

          new Tooltips.Tooltip(dayBin, `${day.date} ${day.contributionCount} ` + _("contributions"));

          if (this.showContributionCount) {
            const countLabel = new St.Label({ text: day.contributionCount.toString() });
            dayBin.set_child(countLabel);
          }
          weekBox.add_child(dayBin);
        }
        gridBox.add_child(weekBox);
      }
      this.contentContainer.add_child(gridBox);
    }

    this._mainContainer.add_child(this.contentContainer);
  }

  _updateLoop() {
    this._setupContributionData().finally(() => {
      this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
        this._updateLoop();
      });
    });
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
