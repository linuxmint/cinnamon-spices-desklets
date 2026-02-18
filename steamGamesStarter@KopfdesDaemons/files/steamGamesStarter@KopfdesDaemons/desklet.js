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
    this.contentBox = null;
    this.loadId = 0;
    this.backgroundColor = "rgba(58, 64, 74, 0.5)";

    // Setup settings and bind them to properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "steam-install-type", "steamInstallType", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "number-of-games", "numberOfGames", this._refresh.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "max-desklet-height", "maxDeskletHeight", this._updateScrollViewStyle.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._updateScrollViewStyle.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._initUI();
    this._refresh();
  }

  on_desklet_removed() {
    this.settings.finalize();
  }

  _initUI() {
    this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
    this.mainContainer.add_child(UiHelper.createHeader(this.metadata.path, this._refresh.bind(this)));

    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this.scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this._updateScrollViewStyle();

    this.mainContainer.add_child(this.scrollView);
    this.setContent(this.mainContainer);
  }

  async _refresh() {
    const currentLoadId = ++this.loadId;
    this._showLoading();

    let games = [];
    let error = null;

    try {
      games = await SteamHelper.getGames(this.steamInstallType);
    } catch (e) {
      error = e;
      global.logError(`Error getting Steam games: ${e}`);
    }

    if (this.loadId !== currentLoadId) return;

    this.games = games;
    this.error = error;
    this._updateContent();
  }

  _showLoading() {
    this._clearContent();
    this.contentBox = UiHelper.createLoadingView();
    this.scrollView.add_actor(this.contentBox);
  }

  _updateContent() {
    this._clearContent();

    const gamesToDisplay = this.games.slice(0, this.numberOfGames);

    if (this.error || gamesToDisplay.length === 0) {
      this.contentBox = UiHelper.createErrorView(this.error, gamesToDisplay.length > 0, this.metadata.path);
    } else {
      this.contentBox = new St.BoxLayout({ vertical: true, style_class: "games-container" });
      gamesToDisplay.forEach(game => {
        const gameItem = UiHelper.createGameItem(game, this.steamInstallType, this.metadata.path);
        this.contentBox.add_child(gameItem);
      });
    }
    this.scrollView.add_actor(this.contentBox);
  }

  _clearContent() {
    if (this.contentBox) {
      this.contentBox.destroy();
      this.contentBox = null;
    }
  }

  _updateScrollViewStyle() {
    if (!this.scrollView) return;
    this.scrollView.set_style("max-height:" + this.maxDeskletHeight + "px; background-color: " + this.backgroundColor + ";");
  }
}

function main(metadata, deskletId) {
  return new SteamGamesStarterDesklet(metadata, deskletId);
}
