const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;
const Util = imports.misc.util;
const Tooltips = imports.ui.tooltips;

const UUID = "github-contribution-grid@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

var UiHelper = class UiHelper {
  static getHeader(username, showUsername, reloadCallback, scaleSize) {
    const headerContainer = new St.BoxLayout();
    const reloadButtonStyle = `width: ${1.6 * scaleSize}em; height: ${1.6 * scaleSize}em; padding: ${0.2 * scaleSize}em;`;

    // Reload button
    const reloadButton = new St.Button({
      style_class: "github-contribution-grid-reload-button",
      style: reloadButtonStyle,
    });
    reloadButton.connect("clicked", reloadCallback);
    const reloadIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      style: reloadButtonStyle,
    });
    new Tooltips.Tooltip(reloadButton, _("Reload"));
    reloadButton.set_child(reloadIcon);
    headerContainer.add_child(reloadButton);

    // Username
    if (showUsername) {
      const userButtonStyle = `font-size: ${1 * scaleSize}em; padding: 0 ${0.5 * scaleSize}em;`;
      const usernameButton = new St.Button({ label: username, style_class: "github-contribution-grid-user-button", style: userButtonStyle });
      usernameButton.connect("clicked", () => Util.spawnCommandLine(`xdg-open "https://github.com/${username}"`));
      new Tooltips.Tooltip(usernameButton, _("Open GitHub profile"));
      headerContainer.add_child(usernameButton);
    }

    return headerContainer;
  }

  static getSetupUI(gitHubTokenCreationURL, scaleSize, blockSize, colors) {
    const container = new St.Table();
    container.add(this._getSkeletonGrid(scaleSize, blockSize, colors), { row: 0, col: 0 });

    const dialogBoxStyle = `background-color: rgba(0, 0, 0, 0.575); padding: ${1 * scaleSize}em; border-radius: ${0.3 * scaleSize}em;`;
    const setupBox = new St.BoxLayout({ vertical: true, style: dialogBoxStyle });

    // Labels
    setupBox.add_child(
      new St.Label({
        text: _("GitHub Contribution Grid"),
        style: `font-weight: bold; font-size: ${1.5 * scaleSize}em; margin-bottom: ${1 * scaleSize}em;`,
      }),
    );
    setupBox.add_child(new St.Label({ text: _("Please configure username and token in settings."), style: `font-size: ${1 * scaleSize}em;` }));

    // Create token button
    const createTokenButton = new St.Button({
      style_class: "github-contribution-grid-link",
      label: _("Create a GitHub token"),
      style: `padding: ${0.5 * scaleSize}em; border: ${0.07 * scaleSize}em solid gray; margin-top: ${1 * scaleSize}em; font-size: ${1 * scaleSize}em;`,
    });
    createTokenButton.connect("clicked", () => Util.spawnCommandLine(`xdg-open "${gitHubTokenCreationURL}"`));
    setupBox.add_child(createTokenButton);

    container.add(setupBox, {
      row: 0,
      col: 0,
      x_expand: true,
      y_expand: true,
      x_fill: false,
      y_fill: false,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    return container;
  }

  static getErrorUI(errorMsg, reloadCallback, scaleSize, blockSize, colors) {
    const container = new St.Table();
    container.add(this._getSkeletonGrid(scaleSize, blockSize, colors), { row: 0, col: 0 });

    const errorBox = new St.BoxLayout({
      vertical: true,
      style: `background-color: rgba(0, 0, 0, 0.575); padding: ${1 * scaleSize}em; border-radius: ${0.3 * scaleSize}em;`,
    });

    // Labels
    errorBox.add_child(
      new St.Label({
        text: _("GitHub Contribution Grid"),
        style: `font-weight: bold; font-size: ${1.5 * scaleSize}em; margin-bottom: ${1 * scaleSize}em;`,
      }),
    );
    errorBox.add_child(new St.Label({ text: _("Error:"), style: `font-size: ${1 * scaleSize}em;` }));
    errorBox.add_child(new St.Label({ text: errorMsg, style: `color: red; font-size: ${scaleSize}em;` }));

    // Reload button
    const reloadButton = new St.Button({
      style_class: "github-contribution-grid-error-reload-button",
      label: _("Reload"),
      style: `padding: ${0.5 * scaleSize}em; border: ${0.07 * scaleSize}em solid gray; margin-top: ${1 * scaleSize}em; font-size: ${1 * scaleSize}em;`,
    });
    reloadButton.connect("clicked", reloadCallback);
    errorBox.add_child(reloadButton);

    container.add(errorBox, {
      row: 0,
      col: 0,
      x_expand: true,
      y_expand: true,
      x_fill: false,
      y_fill: false,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    return container;
  }

  static getContributionGrid(weeks, scaleSize, blockSize, showContributionCount, colors) {
    const gridBox = new St.BoxLayout();

    let weekIndex = 0;
    let loopId = 0;

    const processWeeks = () => {
      for (let i = 0; i < 4; i++) {
        if (weekIndex >= weeks.length) {
          loopId = 0;
          return false;
        }

        const week = weeks[weekIndex];
        const weekBox = new St.BoxLayout({ vertical: true, style_class: "week-container" });

        for (const day of week.contributionDays) {
          const dayBin = new St.Bin({
            style_class: "day-bin",
            reactive: true,
            track_hover: true,
            style: `font-size: ${(scaleSize * blockSize) / 16}em; background-color: ${this.getContributionColor(
              day.contributionCount,
              colors,
            )}; margin: ${0.2 * scaleSize}em; border-width: ${0.07 * scaleSize}em; border-style: solid;`,
          });

          new Tooltips.Tooltip(dayBin, `${day.date} ${day.contributionCount} ` + _("contributions"));

          if (showContributionCount) {
            const countLabel = new St.Label({ text: day.contributionCount.toString() });
            dayBin.set_child(countLabel);
          }
          weekBox.add_child(dayBin);
        }
        gridBox.add_child(weekBox);
        weekIndex++;
      }
      return true;
    };

    loopId = Mainloop.idle_add(processWeeks);

    gridBox.connect("destroy", () => {
      if (loopId) {
        Mainloop.source_remove(loopId);
        loopId = 0;
      }
    });

    return gridBox;
  }

  static _getSkeletonGrid(scaleSize, blockSize, colors) {
    const weeks = [];
    for (let i = 0; i < 53; i++) {
      const contributionDays = [];
      for (let j = 0; j < 7; j++) {
        contributionDays.push({ contributionCount: 0, date: "" });
      }
      weeks.push({ contributionDays });
    }
    return this.getContributionGrid(weeks, scaleSize, blockSize, false, colors);
  }

  static getContributionColor(count, colors) {
    if (colors) {
      if (count >= 10) return colors.c10;
      if (count >= 9) return colors.c9;
      if (count >= 6) return colors.c6;
      if (count >= 4) return colors.c4;
      if (count > 0) return colors.c1;
      if (count === 0) return colors.c0;
    } else {
      if (count >= 10) return "#56d364";
      if (count >= 9) return "#2ea043";
      if (count >= 6) return "#196c2e";
      if (count >= 4) return "#196c2e";
      if (count > 0) return "#033a16";
      if (count === 0) return "#151b23";
    }
  }
};
