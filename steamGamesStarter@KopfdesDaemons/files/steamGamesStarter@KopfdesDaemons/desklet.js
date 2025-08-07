const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Settings = imports.ui.settings;

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

    // Setup settings and bind them to properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "steam-install-type", "steamInstallType", this._loadGamesAndSetupUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "number-of-games", "numberOfGames", this._loadGamesAndSetupUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "max-desklet-height", "maxDeskletHeight", this._onDeskletHeightChanged.bind(this));

    this.setHeader(_("Steam Games Starter"));
    this._loadGamesAndSetupUI();
  }

  // Load game data and set up the UI
  _loadGamesAndSetupUI() {
    try {
      this.error = null;
      this.games = [];

      // Set command prompt based on the installation type
      if (this.steamInstallType === "flatpak") {
        this.cmdPromt = "flatpak run com.valvesoftware.Steam";
      } else {
        this.cmdPromt = "/usr/games/steam";
      }

      // Get Steam library paths
      let libraryfoldersDataPath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
      if (this.steamInstallType === "flatpak") {
        libraryfoldersDataPath = GLib.get_home_dir() + "/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/libraryfolders.vdf";
      }
      const libraryfoldersData = GLib.file_get_contents(libraryfoldersDataPath)[1].toString();
      const libraryPaths = this._extractLibraryPaths(libraryfoldersData);

      // Find all appmanifest files in the library paths
      const appmanifestPaths = [];
      for (const path of libraryPaths) {
        const steamAppsPath = GLib.build_filenamev([path, "steamapps"]);
        const [, out] = GLib.spawn_command_line_sync(`find "${steamAppsPath}" -name "*.acf"`);
        if (out) {
          appmanifestPaths.push(...out.toString().trim().split("\n"));
        }
      }

      // Extract game info from each appmanifest file
      for (const path of appmanifestPaths) {
        if (path) {
          const game = this._extractGameInfo(path);
          if (game) this.games.push(game);
        }
      }
    } catch (e) {
      this.error = e;
      global.logError(`Error initializing desklet: ${e}`);
    }
    this._setupLayout();
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    const mainContainer = new St.BoxLayout({ vertical: true, style_class: "main-container" });

    // Setup header
    const headerContaier = new St.BoxLayout({ style_class: "header-container", reactive: true, track_hover: true });
    mainContainer.add_child(headerContaier);
    const headerLabel = new St.Label({ text: _("Steam Games Starter"), style_class: "header-label" });
    headerContaier.add_child(headerLabel);
    const spacer = new St.BoxLayout({ x_expand: true });
    headerContaier.add_child(spacer);
    const reloadIcon = this._getImageAtScale(`${this.metadata.path}/reload.svg`, 24, 24);
    const reloadButton = new St.Button({ child: reloadIcon, style_class: "reload-button" });
    reloadButton.connect("clicked", () => this._loadGamesAndSetupUI());
    headerContaier.add_child(reloadButton);

    // Filter and sort the games by last played date (newest first)
    let sortedGames = this.games.filter((game) => game.lastPlayed).sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    // Filter "Proton Experimental" and "Steam Linux Runtime 3.0 (sniper)" and "Steam Linux Runtime 2.0 (sniper)"
    sortedGames = sortedGames.filter((game) => game.appid != "1628350" && game.appid != "1493710" && game.appid != "1391110");

    // Slice the games to display
    const gamesToDisplay = sortedGames.slice(0, this.numberOfGames);

    const gamesContainer = new St.BoxLayout({ vertical: true, style_class: "games-container" });

    gamesToDisplay.forEach((game) => {
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
      const buttonHeight = 22;
      const createButton = (iconName, callback, styleClass) => {
        const icon = this._getImageAtScale(`${this.metadata.path}/${iconName}.svg`, buttonHeight, buttonHeight);
        const button = new St.Button({ child: icon, style_class: styleClass });
        button.connect("clicked", callback.bind(this));
        return button;
      };

      const playButton = createButton(
        "play",
        () => GLib.spawn_command_line_async(`${this.cmdPromt} steam://rungameid/${game.appid}`),
        "play-button"
      );
      buttonRow.add_child(playButton);
      const shopButton = createButton(
        "shop",
        () => GLib.spawn_command_line_async(`${this.cmdPromt} steam://store/${game.appid}`),
        "shop-button"
      );
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

    this.scrollView = new St.ScrollView({
      style: "max-height:" + this.maxDeskletHeight + "px; background-color: rgba(58, 64, 74, 0.5);",
      overlay_scrollbars: true,
      clip_to_allocation: true,
    });
    if (this.error || gamesToDisplay.length === 0) {
      this.scrollView.add_actor(errorLayout);
    } else {
      this.scrollView.add_actor(gamesContainer);
    }
    mainContainer.add_child(this.scrollView);

    this.setContent(mainContainer);
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
  _extractGameInfo(filePath) {
    const content = GLib.file_get_contents(filePath)[1].toString();
    const nameMatch = content.match(/"name"\s*"(.*?)"/);
    const appidMatch = content.match(/"appid"\s*"(.*?)"/);
    const lastPlayedMatch = content.match(/"LastPlayed"\s*"(.*?)"/);

    if (nameMatch && appidMatch && lastPlayedMatch) {
      return {
        name: nameMatch[1],
        appid: appidMatch[1],
        lastPlayed: lastPlayedMatch[1],
      };
    }
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

  _onDeskletHeightChanged() {
    if (this.scrollView) {
      this.scrollView.set_style("max-height:" + this.maxDeskletHeight + "px; background-color: rgba(58, 64, 74, 0.5);");
    }
  }
}

function main(metadata, deskletId) {
  return new SteamGamesStarterDesklet(metadata, deskletId);
}
