const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext;

const UUID = "devtest-steamGamesStarter@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

const SteamHelper = imports.helpers.steam.SteamHelper;
const ImageHelper = imports.helpers.image.ImageHelper;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

const UiHelper = class UiHelper {
  static createHeader(metadataPath, onReload) {
    const headerContainer = new St.BoxLayout({ style_class: "header-container", reactive: true, track_hover: true });
    headerContainer.add_child(new St.Label({ text: _("Steam Games Starter"), style_class: "header-label" }));
    headerContainer.add_child(new St.BoxLayout({ x_expand: true }));

    const reloadButton = new St.Button({
      child: ImageHelper.getImageAtScale(`${metadataPath}/reload.svg`, 24, 24),
      style_class: "reload-button",
    });
    reloadButton.connect("clicked", onReload);

    headerContainer.add_child(reloadButton);
    return headerContainer;
  }

  static createGameItem(game, steamInstallType, metadataPath) {
    const gameContainer = new St.BoxLayout({ style_class: "game-container", reactive: true, track_hover: true });

    const imageActor = SteamHelper.getGameHeaderImage(game.appid, 139, 72);
    if (imageActor) {
      imageActor.connect("button-press-event", () => {
        SteamHelper.openStorePage(game.appid, steamInstallType);
        return Clutter.EVENT_PROPAGATE;
      });
      gameContainer.add_child(imageActor);
    }

    const labelContainer = new St.BoxLayout({ vertical: true, style_class: "label-container" });
    const gameLabel = new St.Label({ text: game.name, style_class: "game-label" });
    labelContainer.add_child(gameLabel);

    // Format the last played date and add a label
    const lastPlayedDate = new Date(parseInt(game.lastPlayed, 10) * 1000);
    const formattedDate = lastPlayedDate.toLocaleDateString();
    const dateLabel = new St.Label({ text: _("Last played:") + ` ${formattedDate}` });
    labelContainer.add_child(dateLabel);

    const buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });

    const playIcon = ImageHelper.getImageAtScale(`${metadataPath}/play.svg`, 22, 22);
    const playButton = new St.Button({ child: playIcon, style_class: "play-button" });
    playButton.connect("clicked", () => SteamHelper.runGame(game.appid, steamInstallType));
    buttonRow.add_child(playButton);

    const shopIcon = ImageHelper.getImageAtScale(`${metadataPath}/shop.svg`, 22, 22);
    const shopButton = new St.Button({ child: shopIcon, style_class: "shop-button" });
    shopButton.connect("clicked", () => SteamHelper.openStorePage(game.appid, steamInstallType));
    buttonRow.add_child(shopButton);

    labelContainer.add_child(buttonRow);
    gameContainer.add_child(labelContainer);

    return gameContainer;
  }

  static createLoadingView() {
    const loadingLabel = new St.Label({ text: _("Loading..."), style_class: "loading-label" });
    const box = new St.BoxLayout({ vertical: true, style_class: "loading-layout" });
    box.add_child(new St.Bin({ child: loadingLabel, x_align: St.Align.MIDDLE, y_expand: true }));
    return box;
  }

  static createErrorView(error, gamesFound, metadataPath) {
    const errorLayout = new St.BoxLayout({ style_class: "error-layout", vertical: true });

    const errorIcon = ImageHelper.getImageAtScale(`${metadataPath}/error.svg`, 48, 48);
    const iconBin = new St.Bin({ child: errorIcon, style_class: "error-icon" });
    errorLayout.add_child(iconBin);

    if (!gamesFound) {
      const noGamesLabel = new St.Label({ text: _("No installed games found"), style_class: "no-games-label" });
      errorLayout.add_child(noGamesLabel);
    }

    if (error) {
      const clutterText = new Clutter.Text({
        text: "Error: " + error.message,
        line_wrap: true,
        color: new Clutter.Color({ red: 255, green: 0, blue: 0, alpha: 255 }),
      });

      const errorLabel = new St.Bin({ child: clutterText, style_class: "error-label" });
      errorLayout.add_child(errorLabel);
    }

    return errorLayout;
  }
};
