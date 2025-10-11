const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "github-contribution-grid@KopfdesDaemons";

const { GitHubHelper } = require("./helpers/github.helper");
const { Day } = require("./models/day.model");

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
      const weeks = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);

      const days = [];

      for (const week of weeks) {
        const contributionDays = week.contributionDays;
        for (const day of contributionDays) {
          const date = day.date;
          const contributionCount = day.contributionCount;

          days.push(new Day(date, contributionCount));
        }
      }

      const box = new St.BoxLayout({ vertical: true, style_class: "main-container" });
      for (const day of days) {
        const label = new St.Label({ text: `${day.contributionCount}` });
        box.add_child(label);
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
