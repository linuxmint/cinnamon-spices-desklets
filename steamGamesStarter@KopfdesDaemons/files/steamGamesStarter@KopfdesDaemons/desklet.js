const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "steamGamesStarter@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

let SteamHelper, UiHelper;
if (typeof require !== "undefined") {
  SteamHelper = require("./helpers/steam.js").SteamHelper;
  UiHelper = require("./helpers/ui.js").UiHelper;
} else {
  SteamHelper = imports.helpers.steam.SteamHelper;
  UiHelper = imports.helpers.ui.UiHelper;
}

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class SteamGamesStarterDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Steam Games Starter"));

    this.games = [];
    this.error = null;
    this.steamInstallationType = "system package";
    this.customInstallPath = null;
    this.customCMD = "/usr/games/steam";
    this.numberOfGames = 10;
    this.scaleSize = 1;
    this.maxDeskletHeight = 32;
    this.deskletWidth = 32;
    this.scrollView = null;
    this.mainContainer = null;
    this.loadId = 0;
    this.backgroundColor = "rgba(58, 64, 74, 0.5)";
    this.hideDecorations = true;
    this.showGameHeaderImage = true;
    this.gameHeaderImageSize = 0.4;
    this.gameLabelFontSize = 18;
    this.showLastPlayedLabel = true;
    this.lastPlayedLabelFontSize = 16;
    this.showGameStartButton = true;
    this.showGameShopButton = true;

    // Setup settings and bind them to properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "steam-install-type", "steamInstallType", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "custom-install-path", "customInstallPath", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "custom-cmd", "customCMD", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "number-of-games", "numberOfGames", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onScaleSizeChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "max-desklet-height", "maxDeskletHeight", this._updateScrollViewStyle.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._onScaleSizeChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._updateScrollViewStyle.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-game-header-image", "showGameHeaderImage", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "game-header-image-size", "gameHeaderImageSize", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-game-start-button", "showGameStartButton", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-game-shop-button", "showGameShopButton", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "game-label-font-size", "gameLabelFontSize", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-last-played-label", "showLastPlayedLabel", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "last-played-label-font-size", "lastPlayedLabelFontSize", this._refresh.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._initUI();
    this._onDecorationChanged();
    this._refresh();
  }

  on_desklet_removed() {
    this.settings.finalize();
  }

  _onDecorationChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _initUI() {
    if (this.mainContainer) {
      this.mainContainer.destroy();
    }

    this.mainContainer = new St.BoxLayout({ vertical: true });
    this.mainContainer.set_style("width:" + this.deskletWidth * this.scaleSize + "em;");
    this.mainContainer.add_child(UiHelper.createHeader(this.metadata.path, this._refresh.bind(this), this.scaleSize));

    this.scrollView = null;
    this.setContent(this.mainContainer);
  }

  async _refresh() {
    const currentLoadId = ++this.loadId;
    this._showLoading();

    let games = [];
    let error = null;

    try {
      games = await SteamHelper.getGames(this.steamInstallType, this.customInstallPath);
    } catch (e) {
      error = e;
      global.logError(`${UUID}: Error getting Steam games: ${e}`);
    }

    if (this.loadId !== currentLoadId) return;

    this.games = games;
    this.error = error;
    this._updateContent();
  }

  _showLoading() {
    this._updateScrollViewContent(UiHelper.createLoadingView(this.scaleSize));
  }

  _updateContent() {
    const gamesToDisplay = this.games.slice(0, this.numberOfGames);
    let contentBox;

    if (this.error || gamesToDisplay.length === 0) {
      contentBox = UiHelper.createErrorView(this.error, gamesToDisplay.length > 0, this.metadata.path, this.scaleSize);
    } else {
      contentBox = new St.BoxLayout({ vertical: true, style_class: "games-container" });
      gamesToDisplay.forEach(game => {
        const gameItemData = {
          game: game,
          steamInstallType: this.steamInstallType,
          customCMD: this.customCMD,
          metadataPath: this.metadata.path,
          scaleSize: this.scaleSize,
          showGameHeaderImage: this.showGameHeaderImage,
          gameHeaderImageSize: this.gameHeaderImageSize,
          gameLabelFontSize: this.gameLabelFontSize,
          showLastPlayedLabel: this.showLastPlayedLabel,
          lastPlayedLabelFontSize: this.lastPlayedLabelFontSize,
          showGameStartButton: this.showGameStartButton,
          showGameShopButton: this.showGameShopButton,
        };
        const gameItem = UiHelper.createGameItem(gameItemData);
        contentBox.add_child(gameItem);
      });
    }
    this._updateScrollViewContent(contentBox);
  }

  _updateScrollViewContent(content) {
    if (this.scrollView) {
      this.scrollView.destroy();
    }

    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this.scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this._updateScrollViewStyle();

    this.scrollView.add_actor(content);
    this.mainContainer.add_child(this.scrollView);
  }

  _updateScrollViewStyle() {
    if (!this.scrollView) return;
    this.scrollView.set_style("max-height:" + this.maxDeskletHeight * this.scaleSize + "em; background-color: " + this.backgroundColor + ";");
  }

  _onScaleSizeChanged() {
    this._initUI();
    this._updateContent();
  }
}

function main(metadata, deskletId) {
  return new SteamGamesStarterDesklet(metadata, deskletId);
}
