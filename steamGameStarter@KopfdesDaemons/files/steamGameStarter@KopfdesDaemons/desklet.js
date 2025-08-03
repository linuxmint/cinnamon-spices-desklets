const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;

const UUID = "steamGameStarter@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class StopwatchDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.libraryPaths = [];
    this.games = [];

    //  Read the paths of the Steam library folders
    const libraryfoldersDataPath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
    try {
      const [, out] = GLib.spawn_command_line_sync(`cat ${libraryfoldersDataPath}`);
      if (out === null) throw new Error("Could not retrieve Steam library folders.");
      this.libraryPaths = this._extractLibraryPaths(out.toString());
    } catch (e) {
      global.logError(`Error reading libraryfolders.vdf: ${e}`);
    }

    // Read the content of the Steam library folders and extract the appmanifest paths
    const appmanifestPaths = [];
    for (const libraryPath of this.libraryPaths) {
      const steamAppsPath = libraryPath + "/steamapps/";
      try {
        const [, out] = GLib.spawn_command_line_sync(`find ${steamAppsPath} -name "*.acf"`);
        if (out === null) throw new Error("Could not retrieve Steam library folder content.");
        const paths = out.toString().trim().split("\n");
        for (const path of paths) {
          if (path) {
            appmanifestPaths.push(path);
          }
        }
      } catch (e) {
        global.logError(`Error finding appmanifest files in ${steamAppsPath}: ${e}`);
      }
    }

    // Extract the game info from the appmanifest files
    for (const path of appmanifestPaths) {
      const game = this._extractGameInfo(path);
      if (game) {
        this.games.push(game);
      }
    }

    // Zeige die extrahierten Spiele in der Konsole
    global.log(this.games);

    // Set the desklet header and build the layout
    this.setHeader(_("Steam Game Starter"));
    this._setupLayout();
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    // Erstelle einen Hauptcontainer, der vertikal angeordnet ist
    const mainContainer = new St.BoxLayout({ vertical: true });

    // Filtere Spiele, die zuletzt gespielt wurden, und sortiere sie absteigend nach dem Datum
    const sortedGames = this.games
      .filter((game) => game.lastPlayed && game.lastPlayed !== "0")
      .sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    // Begrenze die Liste auf die 5 zuletzt gespielten Spiele
    const top5Games = sortedGames.slice(0, 5);

    // Iteriere durch die 5 meistgespielten Spiele
    for (const game of top5Games) {
      // Erstelle einen Container für jedes Spiel, um Name und Datum zu gruppieren
      const gameContainer = new St.BoxLayout({ vertical: true });

      // Lade das Bild
      const image = this._getImageAtScale(game.appid, 277, 143);
      gameContainer.add_child(image);

      // Erstelle das Label für den Spielnamen
      const gameLabel = new St.Label({ text: game.name });

      // Formatiere das Datum des letzten Spiels
      const lastPlayedTimestamp = parseInt(game.lastPlayed, 10) * 1000;
      const lastPlayedDate = new Date(lastPlayedTimestamp);
      const dateOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
      const formattedDate = lastPlayedDate.toLocaleDateString("de-DE", dateOptions);

      // Erstelle das Label für das Datum
      const dateLabel = new St.Label({ text: `Zuletzt gespielt: ${formattedDate}` });

      // Füge die Labels zum Spiel-Container hinzu
      gameContainer.add_child(gameLabel);
      gameContainer.add_child(dateLabel);

      // Füge den Spiel-Container zum Hauptcontainer hinzu
      mainContainer.add_child(gameContainer);
    }

    // Setze den Hauptcontainer als Inhalt des Desklets
    this.setContent(mainContainer);
  }

  // Helper to read the paths of the Steam library folders
  _extractLibraryPaths(vdfString) {
    const paths = [];
    const regex = /"path"\s*"(.*?)"/g;
    let match;
    while ((match = regex.exec(vdfString)) !== null) {
      if (!match[0].includes("debian-installation")) paths.push(match[1]);
    }
    return paths;
  }

  _extractGameInfo(filePath) {
    try {
      const [, out] = GLib.spawn_command_line_sync(`cat ${filePath}`);
      if (out === null) {
        global.logError(`Could not read appmanifest file: ${filePath}`);
        return null;
      }

      const content = out.toString();

      const nameMatch = content.match(/"name"\s*"(.*?)"/);
      const appidMatch = content.match(/"appid"\s*"(.*?)"/);
      const lastPlayedMatch = content.match(/"LastPlayed"\s*"(.*?)"/);

      if (nameMatch && appidMatch && lastPlayedMatch) {
        return {
          name: nameMatch[1],
          appid: appidMatch[1],
          lastPlayed: lastPlayedMatch[1],
        };
      } else {
        global.logError(`Could not parse appmanifest file: ${filePath}`);
        return null;
      }
    } catch (e) {
      global.logError(`Error processing file ${filePath}: ${e}`);
      return null;
    }
  }

  _getImageAtScale(appid, requestedWidth, requestedHeight) {
    const headerPath = GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/" + appid + "/header.jpg";
    const libraryHeaderPath = GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/" + appid + "/library_header.jpg";
    let imageFileName = null;
    let pixBuf = null;

    try {
      // Versuch, header.jpg zu laden
      pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(headerPath, requestedWidth, requestedHeight);
      imageFileName = headerPath;
    } catch (e) {
      // Wenn header.jpg fehlschlägt, versuche library_header.jpg zu laden
      try {
        pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(libraryHeaderPath, requestedWidth, requestedHeight);
        imageFileName = libraryHeaderPath;
      } catch (e2) {
        global.logError(`Error loading image for appid ${appid} from both paths: ${e2}`);
        return new St.Label({ text: "Error" });
      }
    }

    if (pixBuf) {
      const image = new Clutter.Image();
      const pixelFormat = pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;

      image.set_data(pixBuf.get_pixels(), pixelFormat, pixBuf.get_width(), pixBuf.get_height(), pixBuf.get_rowstride());

      // Erstelle einen Clutter.Actor, der klickbar ist
      const clickableActor = new Clutter.Actor({
        content: image,
        width: pixBuf.get_width(),
        height: pixBuf.get_height(),
        reactive: true, // Wichtig, um Klicks zu empfangen
      });

      // Verbinde das Klick-Event mit der Funktion zum Öffnen der Bibliotheksseite
      clickableActor.connect("button-press-event", () => {
        global.log(`Opening Steam library for appid ${appid}`);
        GLib.spawn_command_line_async(`steam steam://store/${appid}`);
        return Clutter.EVENT_PROPAGATE;
      });

      return clickableActor;
    }

    return new St.Label({ text: "Error" });
  }

  // Callback for when settings are changed
  _onSettingsChanged() {}

  // Clean up timeouts when the desklet is removed
  on_desklet_removed() {}
}

// Entry point function for the desklet
function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
