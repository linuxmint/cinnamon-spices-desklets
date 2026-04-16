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
    this._menu.addAction(_("Reload"), () => this._reload());

    // Helpers
    this._googleNewsHelper = new GoogleNewsHelper();
    this._uiHelper = new UiHelper();

    // Properties
    this._mainContainer = null;
    this._headerLayout = null;
    this._scrollView = null;
    this._errorView = null;
    this._loadingView = null;
    this._isReloading = false;
    this._timeoutId = null;
    this._startupTimeoutID = null;

    // Default settings
    this.scaleSize = 1;
    this.width = 35;
    this.height = 43;
    this.ceid = "US:en";
    this.refreshInterval = 10;
    this.newsKeywords = [];
    this.hideDecoration = true;
    this.backgroundColor = "transparent";
    this.showHeader = true;
    this.showHeaderText = true;
    this.headerText = _("Google News");
    this.headerTextColor = "inherit";
    this.showHeaderIcon = true;
    this.showReloadButton = true;
    this.newsItemBackgroundColor = "rgba(98, 100, 110, 0.36)";
    this.newsItemTextColor = "inherit";

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onScaleChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._setMainContainerStyle);
    this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._setMainContainerStyle);
    this.settings.bindProperty(Settings.BindingDirection.IN, "ceid", "ceid", this._onNewsSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._onRefreshIntervalChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "news-keywords", "newsKeywords", this._onNewsSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._setMainContainerStyle);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-header", "showHeader", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-header-text", "showHeaderText", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "header-text", "headerText", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "header-text-color", "headerTextColor", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-header-icon", "showHeaderIcon", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-reload-button", "showReloadButton", this._onHeaderSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "news-item-background-color", "newsItemBackgroundColor", this._onNewsSettingChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "news-item-text-color", "newsItemTextColor", this._onNewsSettingChanged);
  }

  on_desklet_added_to_desktop() {
    this._setDefaultCeid();
    this._onDecorationsChanged();
    this._googleNewsHelper.setConfig(this.ceid);
    this._setupLayout();
    this._loadNews();

    // The first request after system start will fail
    // Delay to ensure network services are ready and try again
    if (this._startupTimeoutID) Mainloop.source_remove(this._startupTimeoutID);
    this._startupTimeoutID = Mainloop.timeout_add_seconds(10, () => {
      this._startupTimeoutID = null;
      if (!this._googleNewsHelper.cachedNews) {
        this._reload();
      }
      return false;
    });
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
    if (this._startupTimeoutID) {
      Mainloop.source_remove(this._startupTimeoutID);
      this._startupTimeoutID = null;
    }
  }

  on_desklet_reloaded() {
    this._googleNewsHelper._removeCache();
    this._isReloading = true;
  }

  _onNewsSettingChanged() {
    this._setDefaultCeid();
    this._googleNewsHelper.setConfig(this.ceid, this.newsKeywords);
    this._reload();
  }

  _onScaleChanged() {
    this._setupLayout();
    this._reload();
  }

  _onRefreshIntervalChanged() {
    this._setRefreshInterval();
  }

  _onDecorationsChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _onHeaderSettingChanged() {
    if (this.showHeader) {
      if (this._headerLayout) {
        this._headerLayout.destroy();
        this._headerLayout = null;
        this._setupHeader();
      } else {
        this._setupHeader();
      }
    } else {
      if (this._headerLayout) {
        this._headerLayout.destroy();
        this._headerLayout = null;
      }
    }
  }

  _setRefreshInterval() {
    if (this._timeoutId) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.refreshInterval > 0) {
      this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
        this._timeoutId = null;
        this._reload();
        return false;
      });
    }
  }

  _setMainContainerStyle() {
    if (this._mainContainer) {
      this._mainContainer.set_style(
        `spacing: ${this.scaleSize * 0.5}em; width: ${this.scaleSize * this.width}em; height: ${this.scaleSize * this.height}em; background-color: ${this.backgroundColor}; border-radius: ${this.scaleSize * 0.8}em;`,
      );
    }
  }

  async _setupLayout() {
    // Container
    this._mainContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    this._setMainContainerStyle();
    this.setContent(this._mainContainer);

    if (this.showHeader) this._setupHeader();
  }

  _setupHeader() {
    const headerSettings = {
      scaleSize: this.scaleSize,
      showHeaderText: this.showHeaderText,
      headerText: this.headerText,
      headerTextColor: this.headerTextColor,
      reloadCallback: this._reload.bind(this),
      showHeaderIcon: this.showHeaderIcon,
      showReloadButton: this.showReloadButton,
    };
    this._headerLayout = this._uiHelper.getHeader(headerSettings);
    this._mainContainer.insert_child_at_index(this._headerLayout, 0);
  }

  async _loadNews(forceReload = false) {
    this._destroyViews();

    // Loading view
    this._loadingView = this._uiHelper.getLoadingView(this.scaleSize);
    this._mainContainer.add_child(this._loadingView);

    // News
    try {
      const news = await this._googleNewsHelper.getNews(forceReload);
      this._destroyViews();
      const newsScrollViewSettings = {
        news: news,
        scaleSize: this.scaleSize,
        newsItemBackgroundColor: this.newsItemBackgroundColor,
        newsItemTextColor: this.newsItemTextColor,
      };
      this._scrollView = this._uiHelper.getNewsScrollView(newsScrollViewSettings);
      this._mainContainer.add_child(this._scrollView);
    } catch (e) {
      global.log(`[${UUID}] Error loading news: ${e}`);
      this._destroyViews();
      this._errorView = this._uiHelper.getErrorView(this.scaleSize, e);
      this._mainContainer.add_child(this._errorView);
    }
    this._setRefreshInterval();
  }

  _destroyViews() {
    if (this._scrollView) {
      this._scrollView.destroy();
      this._scrollView = null;
    }
    if (this._errorView) {
      this._errorView.destroy();
      this._errorView = null;
    }
    if (this._loadingView) {
      this._loadingView.destroy();
      this._loadingView = null;
    }
  }

  async _reload() {
    await this._loadNews(true);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
