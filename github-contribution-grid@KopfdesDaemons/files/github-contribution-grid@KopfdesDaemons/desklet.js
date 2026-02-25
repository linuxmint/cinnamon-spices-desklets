const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "github-contribution-grid@KopfdesDaemons";

let GitHubHelper, UiHelper;
if (typeof require !== "undefined") {
  GitHubHelper = require("./helpers/github").GitHubHelper;
  UiHelper = require("./helpers/ui").UiHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
  imports.searchPath.push(DESKLET_DIR);
  GitHubHelper = imports.helpers.github.GitHubHelper;
  UiHelper = imports.helpers.ui.UiHelper;
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
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this.onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this.onBackgroundColorChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this.onShowUsernameChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-contribution-count", "showContributionCount", this.onGridChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._mainContainer = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-main-container" });
    this._mainContainer.add_child(UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData()));
    this.setContent(this._mainContainer);

    this._setupContributionData();

    // The first request after system start will fail
    // Delay to ensure network services are ready and try again
    if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
    this._timeoutId = Mainloop.timeout_add_seconds(3, () => {
      this._timeoutId = null;
      this._setupContributionData();
      return false;
    });
  }

  on_desklet_removed() {
    if (this._timeoutId) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  onDataSettingChanged() {
    this._mainContainer.remove_all_children();
    this._mainContainer.add_child(UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData()));
    this._setupContributionData();
  }

  onShowUsernameChanged() {
    // Destroy the current header
    this._mainContainer.get_children()[0].destroy();
    // Add the new header
    this._mainContainer.insert_child_at_index(
      UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData()),
      0,
    );
  }

  onBackgroundColorChanged() {
    if (this.contentContainer) {
      this.contentContainer.style = `background-color: ${this.backgroundColor}; border-radius: 0.2em;`;
    }
  }

  onGridChanged() {
    if (this._contributionData) this._renderGrid(this._contributionData);
  }

  async _setupContributionData() {
    this._contributionData = null;

    if (!this.githubUsername || !this.githubToken) {
      this._renderSetup();
      if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
      this._contributionData = response;
      this._renderGrid(this._contributionData);

      // Set up auto-refresh
      if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
      this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
        this._timeoutId = null;
        this._setupContributionData();
        return false;
      });
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this._renderError(e.message);
    }
  }

  _createContentContainer() {
    if (this.contentContainer) {
      this._mainContainer.remove_child(this.contentContainer);
      this.contentContainer.destroy();
    }

    this.contentContainer = new St.BoxLayout({ style: `background-color: ${this.backgroundColor}; border-radius: 0.2em;` });
    this._mainContainer.add_child(this.contentContainer);
  }

  _renderSetup() {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getSetupUI(GitHubHelper.gitHubTokenCreationURL));
  }

  _renderError(errorMsg) {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getErrorUI(errorMsg, () => this._setupContributionData()));
  }

  _renderGrid(weeks) {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getContributionGrid(weeks, this.blockSize, this.showContributionCount));
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
