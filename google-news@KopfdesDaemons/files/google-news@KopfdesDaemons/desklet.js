const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;

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
    this.setHeader(_("Google News"));

    // Helpers
    this._googleNewsHelper = new GoogleNewsHelper();
    this._uiHelper = new UiHelper();

    // Properties
    this._mainContainer = null;
    this._scrollView = null;
    this._isReloading = false;
    this._timeoutId = null;

    // Default settings
    this.scaleSize = 1;
    this.width = 35;
    this.height = 40;
    this.ceid = "US:en";
    this.refreshInterval = 10;

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSizeChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onSizeChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onSizeChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "ceid", "ceid", this._onNewsSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._onRefreshIntervalChanged);
  }

  on_desklet_added_to_desktop() {
    this._setDefaultCeid();
    this._googleNewsHelper.setConfig(this.ceid);
    this._setupLayout();
  }

  _setDefaultCeid() {
    if (!this.ceid || this.ceid.trim() === "") {
      let newCeid = "US:en"; // Fallback
      const locales = GLib.get_language_names();
      for (const locale of locales) {
        const match = locale.match(/^([a-z]{2})_([A-Z]{2})/);
        if (match) {
          newCeid = `${match[2]}:${match[1]}`;
          break;
        }
      }
      this.settings.setValue("ceid", newCeid);
      global.log(`[${UUID}] Using default CEID: ${newCeid}`);
      this.ceid = newCeid;
    }
  }

  on_desklet_removed() {
    if (this._timeoutId) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _onNewsSettingChanged() {
    this._setDefaultCeid();
    this._googleNewsHelper.setConfig(this.ceid);
    this.reload();
  }

  _onSizeChanged() {
    this._setupLayout();
  }

  _onRefreshIntervalChanged() {
    this._setRefreshInterval();
  }

  _setRefreshInterval() {
    if (this._timeoutId) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.refreshInterval > 0) {
      this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
        this._timeoutId = null;
        this.reload();
        return false;
      });
    }
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

    this._setRefreshInterval();
  }

  async reload() {
    global.log(`[${UUID}] Reloading...`);
    await this._loadNews(true);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
