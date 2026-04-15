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

    this.mainContainer = null;
    this.scrollView = null;

    this.scaleSize = 1;
    this.width = 35;
    this.height = 40;
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
  }

  async _setupLayout() {
    // Container
    this.mainContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    this.mainContainer.set_style(`spacing: ${this.scaleSize * 0.5}em;`);
    this.setContent(this.mainContainer);

    // Header
    const header = this.uiHelper.getHeader(this.scaleSize, this.reload.bind(this));
    this.mainContainer.add_child(header);

    await this._loadNews();
  }

  async _loadNews(forceReload = false) {
    if (this.scrollView) {
      this.scrollView.destroy();
      this.scrollView = null;
    }

    // Loading view
    const loadingView = this.uiHelper.getLoadingView(this.scaleSize, this.width, this.height);
    this.mainContainer.add_child(loadingView);

    // News
    const news = await this.googleNewsHelper.getNews(forceReload);
    this.scrollView = this.uiHelper.getNewsScrollView(this.scaleSize, this.width, this.height, news);
    loadingView.destroy();
    this.mainContainer.add_child(this.scrollView);
  }

  async reload() {
    await this._loadNews(true);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
