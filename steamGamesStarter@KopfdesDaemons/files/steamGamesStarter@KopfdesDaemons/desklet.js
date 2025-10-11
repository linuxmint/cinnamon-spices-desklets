const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const { SteamHelper } = require("./helpers/steam.helper");
const { UiHelper } = require("./helpers/ui.helper");

const UUID = "steamGamesStarter@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class SteamGamesStarterDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.games = [];
    this.error = null;
    this.steamInstallationType = "system package";
    this.cmdPromt = "/usr/games/steam";
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

    this.setHeader(_("Steam Games Starter"));
    this._loadGamesAndSetupUI();
  }

  async _loadGamesAndSetupUI() {
    if (!this.mainContainer) {
      this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
      this.mainContainer.add_child(UiHelper.createHeader(this.metadata.path, this._loadGamesAndSetupUI.bind(this)));
    }
    if (this.scrollView) {
      this.mainContainer.remove_child(this.scrollView);
      this.scrollView.destroy();
    }
    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this._updateScrollViewStyle();

    this.scrollView.add_actor(UiHelper.createLoadingView());
    this.mainContainer.add_child(this.scrollView);

    this.error = null;
    this.games = [];
    this.cmdPromt = this.steamInstallType === "flatpak" ? "flatpak run com.valvesoftware.Steam" : "/usr/games/steam";

    try {
      this.games = await SteamHelper.getGames(this.steamInstallType);
    } catch (e) {
      this.error = e;
      global.logError(`Error getting Steam games: ${e}`);
    } finally {
      this._setupLayout();
    }
  }

  _setupLayout() {
    if (!this.mainContainer) {
      this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
      this.mainContainer.add_child(UiHelper.createHeader(this.metadata.path, this._loadGamesAndSetupUI.bind(this)));
    }

    const gamesToDisplay = this.games.slice(0, this.numberOfGames);

    if (this.scrollView) {
      this.mainContainer.remove_child(this.scrollView);
      this.scrollView.destroy();
    }

    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this._updateScrollViewStyle();

    if (this.error || gamesToDisplay.length === 0) {
      this.scrollView.add_actor(UiHelper.createErrorView(this.error, gamesToDisplay.length > 0, this.metadata.path));
    } else {
      const gamesContainer = new St.BoxLayout({ vertical: true, style_class: "games-container" });
      gamesToDisplay.forEach(game => {
        const gameItem = UiHelper.createGameItem(game, this.cmdPromt, this.metadata.path);
        gamesContainer.add_child(gameItem);
      });
      this.scrollView.add_actor(gamesContainer);
    }

    this.mainContainer.add_child(this.scrollView);
    this.setContent(this.mainContainer);
  }

  _updateScrollViewStyle() {
    if (!this.scrollView) return;
    this.scrollView.set_style("max-height:" + this.maxDeskletHeight + "px; background-color: " + this.backgroundColor + ";");
  }
}

function main(metadata, deskletId) {
  return new SteamGamesStarterDesklet(metadata, deskletId);
}
