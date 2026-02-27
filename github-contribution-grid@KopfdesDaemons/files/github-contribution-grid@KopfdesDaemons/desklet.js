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
    this._lastError = null;
    this._mainContainer = null;
    this._isReloading = false;

    // Default settings
    this.githubUsername = "";
    this.githubToken = "";
    this.scaleSize = 1;
    this.blockSize = 11;
    this.refreshInterval = 15;
    this.backgroundColor = "rgba(255, 255, 255, 0)";
    this.showContributionCount = false;
    this.showUsername = true;
    this.hideDecorations = true;
    this.color0 = "#151b23";
    this.color1 = "#033a16";
    this.color4 = "#196c2e";
    this.color6 = "#196c2e";
    this.color9 = "#2ea043";
    this.color10 = "#56d364";

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this._onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this._onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._onDataSettingChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onScaleChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "block-size", "blockSize", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._onBackgroundColorChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-username", "showUsername", this._rerenderHeader.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-contribution-count", "showContributionCount", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-0", "color0", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-1", "color1", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-4", "color4", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-6", "color6", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-9", "color9", this._onGridChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-10", "color10", this._onGridChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._mainContainer = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-main-container" });
    this._mainContainer.add_child(UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData(), this.scaleSize));
    this.setContent(this._mainContainer);

    this._setupContributionData();
    this._onDecorationsChanged();

    if (this.githubToken && this.githubUsername) {
      // The first request after system start will fail
      // Delay to ensure network services are ready and try again

      if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
      this._timeoutId = Mainloop.timeout_add_seconds(6, () => {
        this._timeoutId = null;
        this._setupContributionData();
        return false;
      });
    }
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

  _onDataSettingChanged() {
    this._mainContainer.remove_all_children();
    this._mainContainer.add_child(UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData(), this.scaleSize));
    this._setupContributionData();
  }

  _rerenderHeader() {
    // Destroy the current header
    this._mainContainer.get_children()[0].destroy();
    // Add the new header
    this._mainContainer.insert_child_at_index(
      UiHelper.getHeader(this.githubUsername, this.showUsername, () => this._setupContributionData(), this.scaleSize),
      0,
    );
  }

  _onBackgroundColorChanged() {
    if (this.contentContainer) {
      this.contentContainer.style = `background-color: ${this.backgroundColor}; border-radius: 0.2em;`;
    }
  }

  _onScaleChanged() {
    this._onGridChanged();
    this._rerenderHeader();
  }

  _onDecorationsChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _onGridChanged() {
    if (this._contributionData) {
      this._renderGrid(this._contributionData);
    } else if (this._lastError) {
      this._renderError(this._lastError);
    } else {
      this._renderSetup();
    }
  }

  async _setupContributionData() {
    this._contributionData = null;
    this._lastError = null;

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
      this._lastError = e.message;
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

  _getColors() {
    return {
      c0: this.color0,
      c1: this.color1,
      c4: this.color4,
      c6: this.color6,
      c9: this.color9,
      c10: this.color10,
    };
  }

  _renderSetup() {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getSetupUI(GitHubHelper.gitHubTokenCreationURL, this.scaleSize, this.blockSize, this._getColors()));
  }

  _renderError(errorMsg) {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getErrorUI(errorMsg, () => this._setupContributionData(), this.scaleSize, this.blockSize, this._getColors()));
  }

  _renderGrid(weeks) {
    this._createContentContainer();
    this.contentContainer.add_child(UiHelper.getContributionGrid(weeks, this.scaleSize, this.blockSize, this.showContributionCount, this._getColors()));
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
