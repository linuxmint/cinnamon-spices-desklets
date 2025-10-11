const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "github-contribution-grid@KopfdesDaemons";

const { GitHubHelper } = require("./helpers/github.helper");
const { Day } = require("./models/day.model");
const { Week } = require("./models/week.model");

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
    this._initUI();
  }

  _initUI() {
    this.setContent(new St.Label({ text: "Hello World!" }));
    this._setupLayout();
  }

  async _setupLayout() {
    if (!this.githubUsername || !this.githubToken) {
      this.setContent(new St.Label({ text: _("Please configure username and token in settings.") }));
      global.log("setup layout...");
      return;
    }

    try {
      const response = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);

      const weeks = [];

      for (const week of response) {
        const days = [];

        const contributionDays = week.contributionDays;
        for (const day of contributionDays) {
          const date = day.date;
          const contributionCount = day.contributionCount;

          days.push(new Day(date, contributionCount));
        }
        weeks.push(new Week(days));
      }

      const box = new St.BoxLayout({ style_class: "main-container" });
      for (const week of weeks) {
        const weekBox = new St.BoxLayout({ vertical: true, style_class: "week-container" });

        for (const day of week.contributionDays) {
          const bin = new St.Bin({ style_class: "day-bin" });

          const label = new St.Label({ text: `${day.contributionCount}`, style_class: "day-label" });
          bin.set_child(label);
          global.log(day.contributionCount);
          weekBox.add_child(bin);
        }
        box.add_child(weekBox);
      }
      this.setContent(box);
    } catch (e) {
      global.logError(`[${UUID}] Error fetching contribution data: ${e}`);
      this.setContent(new St.Label({ text: _("Error fetching data. See logs for details.") }));
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
