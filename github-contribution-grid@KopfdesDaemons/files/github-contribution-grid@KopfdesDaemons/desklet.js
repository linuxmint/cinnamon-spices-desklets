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
    this._initUI();
  }

  _initUI() {
    this.setContent(new St.Label({ text: "Hello World!" }));
    this._setupLayout();
  }

  async _setupLayout() {
    if (!this.githubUsername || !this.githubToken) return;

    const weeks = await GitHubHelper.getContributionData(this.githubUsername, this.githubToken);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
