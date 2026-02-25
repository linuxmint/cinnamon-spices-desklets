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
  static getHeader(username, showUsername, reloadCallback) {
    const headerContainer = new St.BoxLayout({ style_class: "github-contribution-grid-header-container" });

    // Reload button
    const reloadButton = new St.Button({ style_class: "github-contribution-grid-reload-bin" });
    reloadButton.connect("clicked", reloadCallback);
    const reloadIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    new Tooltips.Tooltip(reloadButton, _("Reload"));
    reloadButton.set_child(reloadIcon);
    headerContainer.add_child(reloadButton);

    // Username
    if (showUsername) {
      const usernameButton = new St.Button({ label: username, style_class: "github-contribution-grid-label-bin" });
      usernameButton.connect("clicked", () => Util.spawnCommandLine(`xdg-open "https://github.com/${username}"`));
      new Tooltips.Tooltip(usernameButton, _("Open GitHub profile"));
      headerContainer.add_child(usernameButton);
    }

    return headerContainer;
  }

  static getSetupUI(gitHubTokenCreationURL, blockSize) {
    const container = new St.Table();
    container.add(this._getSkeletonGrid(blockSize), { row: 0, col: 0 });

    const setupBox = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-setup-container" });

    // Labels
    setupBox.add_child(new St.Label({ text: "GitHub Contribution Grid", style_class: "github-contribution-grid-setup-headline" }));
    setupBox.add_child(new St.Label({ text: _("Please configure username and token in settings.") }));

    // Create token button
    const createTokenButton = new St.Button({ style_class: "github-contribution-grid-link", label: _("Create a GitHub token") });
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

  static getErrorUI(errorMsg, reloadCallback, blockSize) {
    const container = new St.Table();
    container.add(this._getSkeletonGrid(blockSize), { row: 0, col: 0 });

    const errorBox = new St.BoxLayout({ vertical: true, style_class: "github-contribution-grid-error-container" });

    // Labels
    errorBox.add_child(new St.Label({ text: "GitHub Contribution Grid", style_class: "github-contribution-grid-error-headline" }));
    errorBox.add_child(new St.Label({ text: _("Error:") }));
    errorBox.add_child(new St.Label({ text: errorMsg, style: "color: red;" }));

    // Reload button
    const reloadButton = new St.Button({ style_class: "github-contribution-grid-error-reload-button", label: _("Reload") });
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

  static getContributionGrid(weeks, blockSize, showContributionCount) {
    const gridBox = new St.BoxLayout({ style_class: "github-contribution-grid-grid-box" });

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
            style: `font-size: ${blockSize}px; background-color: ${this.getContributionColor(day.contributionCount)};`,
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

  static _getSkeletonGrid(blockSize) {
    const weeks = [];
    for (let i = 0; i < 53; i++) {
      const contributionDays = [];
      for (let j = 0; j < 7; j++) {
        contributionDays.push({ contributionCount: 0, date: "" });
      }
      weeks.push({ contributionDays });
    }
    return this.getContributionGrid(weeks, blockSize, false, false);
  }

  static getContributionColor(count) {
    if (count >= 10) return "#56d364";
    if (count >= 9) return "#2ea043";
    if (count >= 6) return "#196c2e";
    if (count >= 4) return "#196c2e";
    if (count > 0) return "#033a16";
    if (count === 0) return "#151b23";
  }
};
