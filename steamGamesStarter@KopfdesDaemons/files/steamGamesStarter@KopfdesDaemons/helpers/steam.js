const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Util = imports.misc.util;

const UUID = "steamGamesStarter@KopfdesDaemons";

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
    let contentBytes;
    try {
      [, contentBytes] = await new Promise((resolve, reject) => {
        file.load_contents_async(null, (obj, res) => {
          try {
            resolve(obj.load_contents_finish(res));
          } catch (e) {
            reject(e);
          }
        });
      });
    } catch (e) {
      if (e.matches && e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
        return null;
      }
      global.logError(`${UUID}: Error loading appmanifest file ${filePath}: ${e}`);
      return null;
    }
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
    let libraryfoldersFileContentBytes;
    try {
      [, libraryfoldersFileContentBytes] = await new Promise((resolve, reject) => {
        libraryfoldersFile.load_contents_async(null, (obj, res) => {
          try {
            resolve(obj.load_contents_finish(res));
          } catch (e) {
            reject(e);
          }
        });
      });
    } catch (e) {
      if (e.matches && e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
        throw new Error(`Steam library file not found at: ${libraryfoldersFilePath}`);
      }
      throw e;
    }

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

  // Helper to find the first readable file among a list of candidate paths
  static async findFirstExistingFile(paths) {
    for (const filePath of paths) {
      const file = Gio.File.new_for_path(filePath);
      try {
        const stream = await new Promise((resolve, reject) => {
          file.read_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
              resolve(obj.read_finish(res));
            } catch (e) {
              reject(e);
            }
          });
        });
        await new Promise((resolve, reject) => {
          stream.close_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
              resolve(obj.close_finish(res));
            } catch (e) {
              reject(e);
            }
          });
        });
        return filePath;
      } catch (e) {
        if (!e.matches || !e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
          global.logError(`${UUID}: Error accessing file ${filePath}: ${e}`);
        }
      }
    }
    return null;
  }

  // Helper to load a game's header image from the Steam appcache
  static async getGameHeaderImage(appid, size, scaleSize) {
    const appCachePath = GLib.get_home_dir() + "/.steam/steam/appcache/librarycache/";
    const commonImageNames = ["header.jpg", "library_header.jpg", "library_hero.jpg"];
    const appDir = GLib.build_filenamev([appCachePath, String(appid)]);

    const directPaths = commonImageNames.map(name => GLib.build_filenamev([appDir, name]));
    let imagePath = await this.findFirstExistingFile(directPaths);

    // If no image is found in the appDir, search subdirectories
    if (!imagePath) {
      const appDirFile = Gio.File.new_for_path(appDir);
      try {
        const enumerator = await new Promise((resolve, reject) => {
          appDirFile.enumerate_children_async(
            "standard::name,standard::type",
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (obj, res) => {
              try {
                resolve(obj.enumerate_children_finish(res));
              } catch (e) {
                reject(e);
              }
            },
          );
        });

        const subDirs = [];
        try {
          while (true) {
            const files = await new Promise((resolve, reject) => {
              enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                try {
                  resolve(obj.next_files_finish(res));
                } catch (e) {
                  reject(e);
                }
              });
            });
            if (!files || files.length === 0) break;
            for (const fileInfo of files) {
              if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                const entryName = fileInfo.get_name();
                if (!entryName.startsWith(".")) {
                  subDirs.push(GLib.build_filenamev([appDir, entryName]));
                }
              }
            }
          }
        } finally {
          try {
            await new Promise((resolve, reject) => {
              enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                try {
                  resolve(obj.close_finish(res));
                } catch (e) {
                  reject(e);
                }
              });
            });
          } catch (e) {}
        }
        subDirs.sort();

        const subDirPaths = [];
        for (const name of commonImageNames) {
          for (const subDir of subDirs) {
            subDirPaths.push(GLib.build_filenamev([subDir, name]));
          }
        }
        imagePath = await this.findFirstExistingFile(subDirPaths);
      } catch (e) {
        if (!e.matches || !e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
          global.logError(`${UUID}: Error searching subdirectories for appid ${appid}: ${e}`);
        }
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
    if (steamInstallType === "custom install") {
      try {
        const [, parsed] = GLib.shell_parse_argv(customCMD || "");
        if (parsed && parsed.length > 0) return parsed;
      } catch (e) {
        if (customCMD) return [customCMD];
      }
      return ["/usr/games/steam"];
    }
    if (steamInstallType === "flatpak") {
      return ["flatpak", "run", "com.valvesoftware.Steam"];
    }
    return ["/usr/games/steam"];
  }

  static runGame(appid, steamInstallType, customCMD) {
    const cmd = this.getSteamCommand(steamInstallType, customCMD);
    Util.spawn([...cmd, `steam://rungameid/${appid}`]);
  }

  static openStorePage(appid, steamInstallType, customCMD) {
    const cmd = this.getSteamCommand(steamInstallType, customCMD);
    Util.spawn([...cmd, `steam://store/${appid}`]);
  }
};
