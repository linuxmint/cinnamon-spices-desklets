const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Util = imports.misc.util;

const UUID = "devtest-steamGamesStarter@KopfdesDaemons";

// AppIDs for games/tools to be filtered out from the list
const FILTERED_APP_IDS = [
  "1628350", // Proton Experimental
  "1493710", // Steam Linux Runtime 3.0 (sniper)
  "1391110", // Steam Linux Runtime 2.0 (soldier)
  "1826330", // Proton EasyAntiCheat Runtime
  "2348590", // Proton 8.0
  "2805730", // Proton 9.0
];

var SteamHelper = class SteamHelper {
  // Helper to read the paths of the Steam library folders
  static extractLibraryPaths(vdfString) {
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
  static async extractGameInfo(filePath) {
    const file = Gio.file_new_for_path(filePath);
    const [, contentBytes] = await new Promise(resolve => file.load_contents_async(null, (obj, res) => resolve(obj.load_contents_finish(res))));
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

  // Helper to get all installed games
  static async getGames(steamInstallType, customInstallPath) {
    // Get Steam library path
    let libraryfoldersFilePath;
    if (steamInstallType === "system package") {
      libraryfoldersFilePath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
    } else if (steamInstallType === "flatpak") {
      libraryfoldersFilePath = GLib.get_home_dir() + "/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/libraryfolders.vdf";
    } else if (steamInstallType === "custom install") {
      global.log(`Custom install path: ${customInstallPath}`);
      libraryfoldersFilePath = customInstallPath.replace(/^~/, GLib.get_home_dir());
      libraryfoldersFilePath = libraryfoldersFilePath.replace("file://", "");
    }

    const libraryfoldersFile = Gio.file_new_for_path(libraryfoldersFilePath);
    if (!libraryfoldersFile.query_exists(null)) {
      throw new Error(`Steam library file not found at: ${libraryfoldersFilePath}`);
    }

    const [, libraryfoldersFileContentBytes] = await new Promise(resolve =>
      libraryfoldersFile.load_contents_async(null, (obj, res) => resolve(obj.load_contents_finish(res))),
    );
    const libraryfoldersFileContent = new TextDecoder("utf-8").decode(libraryfoldersFileContentBytes);
    const libraryPaths = this.extractLibraryPaths(libraryfoldersFileContent);

    // Find all appmanifest files in the library paths
    const appmanifestPaths = [];
    for (const path of libraryPaths) {
      const steamAppsPath = GLib.build_filenamev([path, "steamapps"]);
      const out = await new Promise(resolve => Util.spawn_async(["find", steamAppsPath, "-name", "*.acf"], stdout => resolve(stdout)));
      if (out) {
        const paths = out
          .trim()
          .split("\n")
          .filter(p => p);
        appmanifestPaths.push(...paths);
      }
    }

    // Extract game info from each appmanifest file
    const gamePromises = [];
    for (const path of appmanifestPaths) {
      if (path) {
        gamePromises.push(this.extractGameInfo(path));
      }
    }

    const games = await Promise.all(gamePromises);
    const filteredGames = games.filter(game => game !== null && !FILTERED_APP_IDS.includes(game.appid));

    // Filter and sort the games by last played date (newest first)
    const sortedGames = filteredGames.sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    return sortedGames;
  }

  // Helper to load a game's header image from the Steam appcache
  static getGameHeaderImage(appid, size, scaleSize) {
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

    const BASE_FONT_SIZE = 16;

    // Shrink default steam game header size
    const targetWidth = 460 * size;
    const targetHeight = 215 * size;

    // Convert pixels to em
    const widthInEm = (targetWidth * scaleSize) / BASE_FONT_SIZE;
    const heightInEm = (targetHeight * scaleSize) / BASE_FONT_SIZE;

    if (imagePath) {
      const file = Gio.File.new_for_path(imagePath);
      const imageUri = file.get_uri();

      const image = new St.Bin({
        style: `width: ${widthInEm}em; height: ${heightInEm}em; background-image: url("${imageUri}"); background-size: contain; background-position: center; background-repeat: no-repeat;`,
      });

      return image;
    }

    global.logError(`${UUID}: Could not load an image for appid ${appid}`);

    const errorLabel = new St.Label({
      text: _("Could not load image"),
      style: "font-size: " + scaleSize + "em; width:" + widthInEm + "em; height: " + heightInEm + "em; text-align: center; color: red;",
    });
    errorLabel.clutter_text.line_wrap = true;
    return errorLabel;
  }

  static getSteamCommand(steamInstallType, customCMD) {
    if (steamInstallType === "custom install") return customCMD;
    if (steamInstallType === "system package") return "/usr/games/steam";
    if (steamInstallType === "flatpak") return "flatpak run com.valvesoftware.Steam";
    return "";
  }

  static runGame(appid, steamInstallType, customCMD) {
    const cmd = this.getSteamCommand(steamInstallType, customCMD);
    GLib.spawn_command_line_async(`${cmd} steam://rungameid/${appid}`);
  }

  static openStorePage(appid, steamInstallType, customCMD) {
    const cmd = this.getSteamCommand(steamInstallType, customCMD);
    GLib.spawn_command_line_async(`${cmd} steam://store/${appid}`);
  }
};
