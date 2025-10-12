const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "github-contribution-grid@KopfdesDaemons";

const { GitHubHelper } = require("./helpers/github.helper");

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

    this.githubUsername = this.settings.getValue("github-username") || "";
    this.githubToken = this.settings.getValue("github-token") || "";

    this.settings.bindProperty(Settings.BindingDirection.IN, "github-username", "githubUsername", this._setupLayout.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "github-token", "githubToken", this._setupLayout.bind(this));

    this.setHeader(_("Github Contribution Grid"));
    this._setupLayout();
  }

  async _setupLayout() {
    if (!this.githubUsername || !this.githubToken) {
      this.setContent(
        new St.Label({
          text: _("Please configure username and token in settings."),
        })
      );
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
      this._renderGrid(response);
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this.setContent(new St.Label({ text: _("Error fetching data. See logs for details.") }));
    }
  }

  _renderGrid(weeks) {
    const container = new St.BoxLayout({
      style_class: "github-contribution-grid-main-container",
      x_expand: true,
    });

    for (const week of weeks) {
      const weekBox = new St.BoxLayout({
        vertical: true,
        style_class: "week-container",
      });

      for (const day of week.contributionDays) {
        const dayBin = new St.Bin({
          style_class: "day-bin",
          style: `background-color: ${this._getContributionColor(day.contributionCount)};`,
        });
        // const label = new St.Label({
        //   text: day.contributionCount.toString(),
        //   style: "color: white;",
        // });
        // dayBin.set_child(label);
        weekBox.add_child(dayBin);
      }
      container.add_child(weekBox);
    }
    this.setContent(container);
  }

  _getContributionColor(count) {
    if (count >= 10) return "#56d364";
    if (count >= 9) return "#2ea043";
    if (count >= 6) return "#196c2e";
    if (count >= 4) return "#196c2e";
    if (count > 0) return "#033a16";
    if (count === 0) return "#151b23";
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
