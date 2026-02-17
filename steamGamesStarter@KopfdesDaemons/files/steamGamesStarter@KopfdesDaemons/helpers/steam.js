const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Util = imports.misc.util;

// AppIDs for games/tools to be filtered out from the list
const FILTERED_APP_IDS = [
  "1628350", // Proton Experimental
  "1493710", // Steam Linux Runtime 3.0 (sniper)
  "1391110", // Steam Linux Runtime 2.0 (soldier)
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
  static async getGames(steamInstallType) {
    // Get Steam library paths
    let libraryfoldersFilePath = GLib.get_home_dir() + "/.steam/steam/steamapps/libraryfolders.vdf";
    if (steamInstallType === "flatpak") {
      libraryfoldersFilePath = GLib.get_home_dir() + "/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/libraryfolders.vdf";
    }

    const libraryfoldersFile = Gio.file_new_for_path(libraryfoldersFilePath);
    if (!libraryfoldersFile.query_exists(null)) {
      throw new Error(`Steam library file not found at: ${libraryfoldersFilePath}`);
    }

    const [success, libraryfoldersFileContentBytes] = await new Promise(resolve =>
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
    const filteredGames = games.filter(game => game !== null && game.lastPlayed && !FILTERED_APP_IDS.includes(game.appid));

    // Filter and sort the games by last played date (newest first)
    const sortedGames = filteredGames.sort((a, b) => parseInt(b.lastPlayed, 10) - parseInt(a.lastPlayed, 10));

    return sortedGames;
  }

  // Helper to load a game's header image from the Steam appcache
  static getGameHeaderImage(appid, requestedWidth, requestedHeight) {
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

    if (imagePath) {
      const gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(imagePath) });
      const imageActor = new St.Icon({
        gicon: gicon,
        icon_size: requestedWidth,
        icon_type: St.IconType.FULLCOLOR,
        reactive: true,
        style: `width: ${requestedWidth}px; height: ${requestedHeight}px;`,
      });
      return imageActor;
    }

    global.logError(`Could not load an image for appid ${appid}`);
    return new St.Label({ text: "Error" });
  }

  static getSteamCommand(steamInstallType) {
    return steamInstallType === "flatpak" ? "flatpak run com.valvesoftware.Steam" : "/usr/games/steam";
  }

  static runGame(appid, steamInstallType) {
    const cmd = this.getSteamCommand(steamInstallType);
    GLib.spawn_command_line_async(`${cmd} steam://rungameid/${appid}`);
  }

  static openStorePage(appid, steamInstallType) {
    const cmd = this.getSteamCommand(steamInstallType);
    GLib.spawn_command_line_async(`${cmd} steam://store/${appid}`);
  }
};
