const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const St = imports.gi.St;
const Settings = imports.ui.settings;

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
    this._googleNewsHelper = new GoogleNewsHelper();
    this._uiHelper = new UiHelper();

    this._mainContainer = null;
    this._scrollView = null;
    this._isReloading = false;

    // Default settings
    this.scaleSize = 1;
    this.width = 35;
    this.height = 40;

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSizeChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onSizeChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onSizeChanged);
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
  }

  on_desklet_removed() {
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _onSizeChanged() {
    this._setupLayout();
  }

  async _setupLayout() {
    // Container
    this._mainContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    this._mainContainer.set_style(`spacing: ${this.scaleSize * 0.5}em;`);
    this.setContent(this._mainContainer);

    // Header
    const header = this._uiHelper.getHeader(this.scaleSize, this.reload.bind(this));
    this._mainContainer.add_child(header);

    await this._loadNews();
  }

  async _loadNews(forceReload = false) {
    if (this._scrollView) {
      this._scrollView.destroy();
      this._scrollView = null;
    }

    // Loading view
    const loadingView = this._uiHelper.getLoadingView(this.scaleSize, this.width, this.height);
    this._mainContainer.add_child(loadingView);

    // News
    const news = await this._googleNewsHelper.getNews(forceReload);
    if (this._scrollView) {
      this._scrollView.destroy();
      this._scrollView = null;
    }
    this._scrollView = this._uiHelper.getNewsScrollView(this.scaleSize, this.width, this.height, news);
    loadingView.destroy();
    this._mainContainer.add_child(this._scrollView);
  }

  async reload() {
    await this._loadNews(true);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
