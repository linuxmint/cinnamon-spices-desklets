const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const St = imports.gi.St;

const UUID = "google-news@KopfdesDaemons";

let UiHelper, GoogleNewsHelper;
if (typeof require !== "undefined") {
  GoogleNewsHelper = require("./helpers/google-news").GoogleNewsHelper;
  UiHelper = require("./helpers/ui").UiHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.desklets[UUID];
  GoogleNewsHelper = DESKLET_DIR.helpers.googleNews.GoogleNewsHelper;
  UiHelper = DESKLET_DIR.helpers.ui.UiHelper;
}

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Tutorial Desklet"));

    // Helpers
    this.googleNewsHelper = new GoogleNewsHelper();
    this.uiHelper = new UiHelper();

    this.scaleSize = 1;

    this.mainContainer = null;
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
  }

  async _setupLayout() {
    this.mainContainer = new St.BoxLayout({ vertical: true });
    const news = await this.googleNewsHelper.getNews();
    // global.log(news);
    const scrollView = this.uiHelper.getNewsScrollView(this.scaleSize, news);
    this.mainContainer.add_child(scrollView);
    this.setContent(this.mainContainer);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
