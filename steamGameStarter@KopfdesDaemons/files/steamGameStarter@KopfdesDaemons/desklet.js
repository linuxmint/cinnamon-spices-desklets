const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "steamGameStarter@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class SteamGameStarterDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.games = [];

    this.setHeader(_("Steam Game Starter"));
    this._loadGamesAndSetupUI();
  }

  // Load game data and set up the UI
  _loadGamesAndSetupUI() {
    try {
      // Get Steam library paths
      const libraryfoldersDataPath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
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

      this._setupLayout();
    } catch (e) {
      global.logError(`Error initializing desklet: ${e}`);
    }
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    const mainContainer = new St.BoxLayout({ vertical: true });

    // Filter and sort the games by last played date (newest first)
    const sortedGames = this.games
      .filter((game) => game.lastPlayed && game.lastPlayed !== "0")
      .sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    // Display the top 5 games
    const gamesToDisplay = sortedGames.slice(0, 5);

    gamesToDisplay.forEach((game) => {
      const gameContainer = new St.BoxLayout({ vertical: true });

      const imageActor = this._getGameHeaderImage(game.appid, 277, 143);
      if (imageActor) {
        imageActor.connect("button-press-event", () => {
          GLib.spawn_command_line_async(`steam steam://store/${game.appid}`);
          return Clutter.EVENT_PROPAGATE;
        });
        gameContainer.add_child(imageActor);
      }

      const gameLabel = new St.Label({ text: game.name });
      gameContainer.add_child(gameLabel);

      // Format the last played date and add a label
      const lastPlayedDate = new Date(parseInt(game.lastPlayed, 10) * 1000);
      const formattedDate = lastPlayedDate.toLocaleDateString();
      const dateLabel = new St.Label({ text: _("Last played:") + ` ${formattedDate}` });
      gameContainer.add_child(dateLabel);

      mainContainer.add_child(gameContainer);
    });

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
    try {
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
    } catch (e) {
      global.logError(`Error processing file ${filePath}: ${e}`);
    }
    return null;
  }

  // Helper to load a game's header image from the Steam appcache
  _getGameHeaderImage(appid, requestedWidth, requestedHeight) {
    const imagePaths = [
      GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/" + appid + "/header.jpg",
      GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/" + appid + "/library_header.jpg",
    ];

    let pixBuf = null;
    let imageFileName = null;

    for (const path of imagePaths) {
      if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
        try {
          pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, requestedWidth, requestedHeight);
          imageFileName = path;
          break; // Found and loaded an image, so break the loop
        } catch (e) {
          global.logError(`Error loading image from path ${path}: ${e}`);
        }
      }
    }

    if (pixBuf && imageFileName) {
      const image = new Clutter.Image();
      const pixelFormat = pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
      image.set_data(pixBuf.get_pixels(), pixelFormat, pixBuf.get_width(), pixBuf.get_height(), pixBuf.get_rowstride());

      const clickableActor = new Clutter.Actor({
        content: image,
        width: pixBuf.get_width(),
        height: pixBuf.get_height(),
        reactive: true,
      });

      return clickableActor;
    }

    // Return a simple label if no image could be loaded
    global.logError(`Could not load an image for appid ${appid}`);
    return new St.Label({ text: "Error" });
  }
}

// Main entry point for the desklet
function main(metadata, deskletId) {
  return new SteamGameStarterDesklet(metadata, deskletId);
}
