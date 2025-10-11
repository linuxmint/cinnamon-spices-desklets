const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;

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

  // Load game data and set up the UI
  async _loadGamesAndSetupUI() {
    // First, set up the loading view
    if (!this.mainContainer) {
      this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
      this._setupHeader();
    }
    if (this.scrollView) {
      this.mainContainer.remove_child(this.scrollView);
      this.scrollView.destroy();
    }
    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    this._updateScrollViewStyle();

    this._setupLoadingView();

    try {
      this.error = null;
      this.games = [];

      // Set command prompt based on the installation type
      this.cmdPromt = this.steamInstallType === "flatpak" ? "flatpak run com.valvesoftware.Steam" : "/usr/games/steam";

      // Get Steam library paths
      let libraryfoldersFilePath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
      if (this.steamInstallType === "flatpak") {
        libraryfoldersFilePath = GLib.get_home_dir() + "/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/libraryfolders.vdf";
      }

      const libraryfoldersFile = Gio.file_new_for_path(libraryfoldersFilePath);
      if (!libraryfoldersFile.query_exists(null)) {
        throw new Error(`Steam library file not found at: ${libraryfoldersFilePath}`);
      }

      const [success, libraryfoldersFileContentBytes] = await new Promise(resolve =>
        libraryfoldersFile.load_contents_async(null, (obj, res) => resolve(obj.load_contents_finish(res)))
      );
      const libraryfoldersFileContent = new TextDecoder("utf-8").decode(libraryfoldersFileContentBytes);
      const libraryPaths = this._extractLibraryPaths(libraryfoldersFileContent);

      // Find all appmanifest files in the library paths
      const appmanifestPaths = [];
      for (const path of libraryPaths) {
        const steamAppsPath = GLib.build_filenamev([path, "steamapps"]);
        const out = await new Promise(resolve => Util.spawn_async(["find", steamAppsPath, "-name", "*.acf"], stdout => resolve(stdout)));
        if (out) appmanifestPaths.push(...out.trim().split("\n"));
      }

      // Extract game info from each appmanifest file
      const gamePromises = [];
      for (const path of appmanifestPaths) {
        if (path) {
          gamePromises.push(this._extractGameInfo(path));
        }
      }

      const games = await Promise.all(gamePromises);
      this.games = games.filter(game => game !== null);
    } catch (e) {
      this.error = e;
      global.logError(`Error initializing desklet: ${e}`);
    } finally {
      this._setupLayout();
    }
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    if (!this.mainContainer) {
      this.mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });
      this._setupHeader();
    }

    // Filter and sort the games by last played date (newest first)
    let sortedGames = this.games.filter(game => game.lastPlayed).sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    // Filter "Proton Experimental" and "Steam Linux Runtime 3.0 (sniper)" and "Steam Linux Runtime 2.0 (sniper)"
    sortedGames = sortedGames.filter(game => game.appid != "1628350" && game.appid != "1493710" && game.appid != "1391110");

    // Slice the games to display
    const gamesToDisplay = sortedGames.slice(0, this.numberOfGames);

    const gamesContainer = new St.BoxLayout({ vertical: true, style_class: "games-container" });

    gamesToDisplay.forEach(game => {
      const gameContainer = new St.BoxLayout({ style_class: "game-container", reactive: true, track_hover: true });

      const imageActor = this._getGameHeaderImage(game.appid, 139, 72);
      if (imageActor) {
        imageActor.connect("button-press-event", () => {
          GLib.spawn_command_line_async(`${this.cmdPromt} steam://store/${game.appid}`);
          return Clutter.EVENT_PROPAGATE;
        });
        gameContainer.add_child(imageActor);
      }

      const labelContainer = new St.BoxLayout({ vertical: true, style_class: "label-container" });
      const gameLabel = new St.Label({ text: game.name, style_class: "game-label" });
      labelContainer.add_child(gameLabel);
      gameContainer.add_child(labelContainer);

      // Format the last played date and add a label
      const lastPlayedDate = new Date(parseInt(game.lastPlayed, 10) * 1000);
      const formattedDate = lastPlayedDate.toLocaleDateString();
      const dateLabel = new St.Label({ text: _("Last played:") + ` ${formattedDate}` });
      labelContainer.add_child(dateLabel);

      const buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });

      const playIcon = this._getImageAtScale(`${this.metadata.path}/play.svg`, 22, 22);
      const playButton = new St.Button({ child: playIcon, style_class: "play-button" });
      playButton.connect("clicked", () => GLib.spawn_command_line_async(`${this.cmdPromt} steam://rungameid/${game.appid}`));
      buttonRow.add_child(playButton);

      const shopIcon = this._getImageAtScale(`${this.metadata.path}/shop.svg`, 22, 22);
      const shopButton = new St.Button({ child: shopIcon, style_class: "shop-button" });
      shopButton.connect("clicked", () => GLib.spawn_command_line_async(`${this.cmdPromt} steam://store/${game.appid}`));
      buttonRow.add_child(shopButton);

      labelContainer.add_child(buttonRow);

      gamesContainer.add_child(gameContainer);
    });

    const errorLayout = new St.BoxLayout({ style_class: "error-layout", vertical: true });

    const errorIcon = this._getImageAtScale(`${this.metadata.path}/error.svg`, 48, 48);
    const iconBin = new St.Bin({ child: errorIcon, style_class: "error-icon" });
    errorLayout.add_child(iconBin);

    if (gamesToDisplay.length === 0) {
      const noGamesLabel = new St.Label({ text: _("No installed games found"), style_class: "no-games-label" });
      errorLayout.add_child(noGamesLabel);
    }

    if (this.error) {
      // Use Clutter.Text to display the error message with line wrapping
      const clutterText = new Clutter.Text({
        text: "Error: " + this.error.message,
        line_wrap: true,
        color: new Clutter.Color({ red: 255, green: 0, blue: 0, alpha: 255 }),
      });

      const errorLabel = new St.Bin({ child: clutterText, style_class: "error-label" });
      errorLayout.add_child(errorLabel);
    }

    if (this.scrollView) {
      this.mainContainer.remove_child(this.scrollView);
      this.scrollView.destroy();
    }

    this.scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true, style_class: "vfade" });
    this._updateScrollViewStyle();

    if (this.error || gamesToDisplay.length === 0) {
      this.scrollView.add_actor(errorLayout);
    } else {
      this.scrollView.add_actor(gamesContainer);
    }

    this.mainContainer.add_child(this.scrollView);
    this.setContent(this.mainContainer);
  }

  _setupHeader() {
    const headerContainer = new St.BoxLayout({ style_class: "header-container", reactive: true, track_hover: true });
    headerContainer.add_child(new St.Label({ text: _("Steam Games Starter"), style_class: "header-label" }));
    headerContainer.add_child(new St.BoxLayout({ x_expand: true }));
    const reloadButton = new St.Button({
      child: this._getImageAtScale(`${this.metadata.path}/reload.svg`, 24, 24),
      style_class: "reload-button",
    });
    reloadButton.connect("clicked", () => this._loadGamesAndSetupUI());
    headerContainer.add_child(reloadButton);
    this.mainContainer.add_child(headerContainer);
  }

  _setupLoadingView() {
    const loadingLabel = new St.Label({ text: _("Loading..."), style_class: "loading-label" });
    const box = new St.BoxLayout({ vertical: true, style_class: "loading-layout" });
    box.add_child(new St.Bin({ child: loadingLabel, x_align: St.Align.MIDDLE, y_expand: true }));
    this.scrollView.add_actor(box);
    this.mainContainer.add_child(this.scrollView);
    this.setContent(this.mainContainer);
  }

  // Helper to read the paths of the Steam library folders
  _extractLibraryPaths(vdfString) {
    const paths = [];
    const regex = /"path"\s*"(.*?)"/g;
    let match;
    while ((match = regex.exec(vdfString)) !== null) {
      if (!match[0].includes("debian-installation")) {
        paths.push(match[1]);
      }
    }
    return paths;
  }

  // Helper to extract game info from an appmanifest file
  async _extractGameInfo(filePath) {
    const file = Gio.file_new_for_path(filePath);
    const [, contentBytes] = await new Promise(resolve =>
      file.load_contents_async(null, (obj, res) => resolve(obj.load_contents_finish(res)))
    );
    const content = new TextDecoder("utf-8").decode(contentBytes);

    const nameMatch = /"name"\s*"(.*?)"/.exec(content);
    const appidMatch = /"appid"\s*"(.*?)"/.exec(content);
    const lastPlayedMatch = /"LastPlayed"\s*"(.*?)"/.exec(content);

    if (nameMatch && appidMatch && lastPlayedMatch) {
      return {
        name: nameMatch[1],
        appid: appidMatch[1],
        lastPlayed: lastPlayedMatch[1],
      };
    }
    return null;
  }

  // Helper to create an actor from a Pixbuf
  _createActorFromPixbuf(pixBuf) {
    const pixelFormat = pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
    const image = new Clutter.Image();
    image.set_data(pixBuf.get_pixels(), pixelFormat, pixBuf.get_width(), pixBuf.get_height(), pixBuf.get_rowstride());

    return new Clutter.Actor({
      content: image,
      width: pixBuf.get_width(),
      height: pixBuf.get_height(),
    });
  }

  // Helper to load a game's header image from the Steam appcache
  _getGameHeaderImage(appid, requestedWidth, requestedHeight) {
    const appCachePath = GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/";
    const commonImageNames = ["header.jpg", "library_header.jpg", "library_hero.jpg"];

    let imagePath = null;
    for (const name of commonImageNames) {
      const potentialPath = GLib.build_filenamev([appCachePath, appid, name]);
      if (GLib.file_test(potentialPath, GLib.FileTest.EXISTS)) {
        imagePath = potentialPath;
        break;
      }
    }

    let pixBuf = null;
    if (imagePath) {
      try {
        pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imagePath, requestedWidth, requestedHeight);
      } catch (e) {
        global.logError(`Error loading image ${imagePath}: ${e}`);
      }
    }

    if (pixBuf) {
      const imageActor = this._createActorFromPixbuf(pixBuf);

      const clickableBin = new St.Bin({
        reactive: true,
        width: pixBuf.get_width(),
        height: pixBuf.get_height(),
      });
      clickableBin.set_child(imageActor);
      return clickableBin;
    }

    global.logError(`Could not load an image for appid ${appid}`);
    return new St.Label({ text: "Error" });
  }

  // Helper to load and scale an SVG image
  _getImageAtScale(imageFileName, requestedWidth, requestedHeight) {
    try {
      const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, requestedWidth, requestedHeight);
      return this._createActorFromPixbuf(pixBuf);
    } catch (e) {
      global.logError(`Error loading image ${imageFileName}: ${e}`);
      return new St.Label({ text: "Error" });
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
