const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;

const UUID = "devtest-steamGamesStarter@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

let SteamHelper;
if (typeof require !== "undefined") {
  SteamHelper = require("./helpers/steam.js").SteamHelper;
} else {
  SteamHelper = imports.helpers.steam.SteamHelper;
}

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

var UiHelper = class UiHelper {
  static createHeader(metadataPath, onReload, scaleSize) {
    const headerContainer = new St.BoxLayout();
    headerContainer.add_child(
      new St.Label({
        text: _("Steam Games Starter"),
        style_class: "header-label",
        style: "font-size: " + 2 * scaleSize + "em;",
      }),
    );
    headerContainer.add_child(new St.BoxLayout({ x_expand: true }));

    const reloadButton = new St.Button({
      child: new St.Icon({
        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${metadataPath}/icons/reload.svg`) }),
        style: "width: " + 1.5 * scaleSize + "em; height: " + 1.5 * scaleSize + "em;",
        icon_type: St.IconType.FULLCOLOR,
      }),
      style_class: "reload-button",
      style: "border-radius: " + 0.5 * scaleSize + "em; width: " + 3 * scaleSize + "em; height: " + 3 * scaleSize + "em;",
    });
    reloadButton.connect("clicked", onReload);

    headerContainer.add_child(reloadButton);
    return headerContainer;
  }

  static createGameItem(gameData) {
    const {
      game,
      steamInstallType,
      customCMD,
      metadataPath,
      scaleSize,
      showGameHeaderImage,
      gameHeaderImageSize,
      gameLabelFontSize,
      lastPlayedLabelFontSize,
      showGameStartButton,
      showGameShopButton,
    } = gameData;
    const gameContainer = new St.BoxLayout({
      reactive: true,
      track_hover: true,
      style_class: "game-container",
      style: "margin: " + 0.5 * scaleSize + "em;",
    });

    if (showGameHeaderImage) {
      const image = SteamHelper.getGameHeaderImage(game.appid, gameHeaderImageSize, scaleSize);
      const button = new St.Button({ child: image });
      button.connect("clicked", () => SteamHelper.runGame(game.appid, steamInstallType, customCMD));
      gameContainer.add_child(button);
    }

    const labelContainer = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style: "margin-left: " + 0.5 * scaleSize + "em;",
    });
    const fontSizeGameLabelEm = (gameLabelFontSize / 16) * scaleSize;
    const gameLabel = new St.Label({
      text: game.name,
      style_class: "game-label",
      style: "font-weight: bold; font-size: " + fontSizeGameLabelEm + "em;",
    });
    labelContainer.add_child(gameLabel);

    // Format the last played date and add a label
    const fontSizeLastPlayedLabelEm = (lastPlayedLabelFontSize / 16) * scaleSize;
    const lastPlayedDate = new Date(parseInt(game.lastPlayed, 10) * 1000);
    const formattedDate = game.lastPlayed !== "0" ? lastPlayedDate.toLocaleDateString() : _("Unknown");
    const dateLabel = new St.Label({ text: _("Last played:") + ` ${formattedDate}`, style: "font-size: " + fontSizeLastPlayedLabelEm + "em;" });
    labelContainer.add_child(dateLabel);

    const buttonRow = new St.BoxLayout({ style: "spacing: " + 0.5 * scaleSize + "em;" });

    if (showGameStartButton) {
      const playIcon = new St.Icon({
        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${metadataPath}/icons/play.svg`) }),
        style: "width: " + 1.7 * scaleSize + "em; height: " + 1.7 * scaleSize + "em;",
        icon_type: St.IconType.FULLCOLOR,
      });
      const playButton = new St.Button({
        child: playIcon,
        style_class: "play-button",
        style: "border-radius: " + 0.5 * scaleSize + "em;",
      });
      playButton.connect("clicked", () => SteamHelper.runGame(game.appid, steamInstallType, customCMD));
      buttonRow.add_child(playButton);
    }

    if (showGameShopButton) {
      const shopIcon = new St.Icon({
        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${metadataPath}/icons/shop.svg`) }),
        style: "width: " + 1.7 * scaleSize + "em; height: " + 1.7 * scaleSize + "em;",
        icon_type: St.IconType.FULLCOLOR,
      });
      const shopButton = new St.Button({
        child: shopIcon,
        style_class: "shop-button",
        style: "border-radius: " + 0.5 * scaleSize + "em",
      });
      shopButton.connect("clicked", () => SteamHelper.openStorePage(game.appid, steamInstallType, customCMD));
      buttonRow.add_child(shopButton);
    }

    labelContainer.add_child(buttonRow);
    gameContainer.add_child(labelContainer);

    return gameContainer;
  }

  static createLoadingView(scaleSize) {
    const loadingLabel = new St.Label({
      text: _("Loading..."),
      style: "font-size: " + 1.5 * scaleSize + "em;",
    });
    const box = new St.BoxLayout({
      vertical: true,
      style: "height: " + 30 * scaleSize + "em;",
    });
    box.add_child(new St.Bin({ child: loadingLabel, x_align: St.Align.MIDDLE, y_expand: true }));
    return box;
  }

  static createErrorView(error, gamesFound, metadataPath, scaleSize) {
    const errorLayout = new St.BoxLayout({
      vertical: true,
      style: "height: " + 30 * scaleSize + "em;",
    });

    const errorIcon = new St.Icon({
      gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${metadataPath}/icons/error.svg`) }),
      style: "width: " + 5 * scaleSize + "em; height: " + 5 * scaleSize + "em;",
      icon_size: 80 * scaleSize,
      icon_type: St.IconType.FULLCOLOR,
    });
    const iconBin = new St.Bin({
      child: errorIcon,
      style: "margin: " + 1 * scaleSize + "em; width: " + 5 * scaleSize + "em; height: " + 5 * scaleSize + "em;",
    });
    errorLayout.add_child(iconBin);

    if (!gamesFound) {
      const noGamesLabel = new St.Label({
        text: _("No installed games found"),
        style: "font-size: " + 1.5 * scaleSize + "em; text-align: center;",
      });
      errorLayout.add_child(noGamesLabel);
    }

    if (error) {
      const label = new St.Label();
      label.set_text("Error: " + error.message);
      label.clutter_text.line_wrap = true;
      const errorLabel = new St.Bin({
        child: label,
        style: "margin: " + 1 * scaleSize + "em; color: red; font-size: " + 1.5 * scaleSize + "em;",
      });
      errorLayout.add_child(errorLabel);
    }

    return errorLayout;
  }
};
