const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "devtest-steamGamesStarter@KopfdesDaemons";
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
    this.numberOfGames = 10;
    this.maxDeskletHeight = 400;
    this.scrollView = null;
    this.mainContainer = null;
    this.backgroundColor = "rgba(58, 64, 74, 0.5)";

    // Setup settings and bind them to properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "steam-install-type", "steamInstallType", this._loadGamesAndSetupUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "number-of-games", "numberOfGames", this._loadGamesAndSetupUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "max-desklet-height", "maxDeskletHeight", this._updateScrollViewStyle.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._updateScrollViewStyle.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._initUI();
    this._loadGamesAndSetupUI();
  }

  _initUI() {
    this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
    this.mainContainer.add_child(UiHelper.createHeader(this.metadata.path, this._loadGamesAndSetupUI.bind(this)));
    this.setContent(this.mainContainer);
  }

  async _loadGamesAndSetupUI() {
    this._setupLayout(true);

    this.error = null;
    this.games = [];

    try {
      this.games = await SteamHelper.getGames(this.steamInstallType);
    } catch (e) {
      this.error = e;
      global.logError(`Error getting Steam games: ${e}`);
    }

    this._setupLayout();
  }

  _setupLayout(loading = false) {
    const gamesToDisplay = this.games.slice(0, this.numberOfGames);

    if (this.scrollView) {
      this.mainContainer.remove_child(this.scrollView);
      this.scrollView.destroy();
    }

    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this._updateScrollViewStyle();

    if (loading) {
      this.scrollView.add_actor(UiHelper.createLoadingView());
    } else if (this.error || gamesToDisplay.length === 0) {
      this.scrollView.add_actor(UiHelper.createErrorView(this.error, gamesToDisplay.length > 0, this.metadata.path));
    } else {
      const gamesContainer = new St.BoxLayout({ vertical: true, style_class: "games-container" });
      gamesToDisplay.forEach(game => {
        const gameItem = UiHelper.createGameItem(game, this.steamInstallType, this.metadata.path);
        gamesContainer.add_child(gameItem);
      });
      this.scrollView.add_actor(gamesContainer);
    }

    this.mainContainer.add_child(this.scrollView);
  }

  _updateScrollViewStyle() {
    if (!this.scrollView) return;
    this.scrollView.set_style("max-height:" + this.maxDeskletHeight + "px; background-color: " + this.backgroundColor + ";");
  }
}

function main(metadata, deskletId) {
  return new SteamGamesStarterDesklet(metadata, deskletId);
}
