const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;

const UUID = "minecraft-server-status@KopfdesDaemons";

let MinecraftServerStatusHelper, UiHelper;
if (typeof require !== "undefined") {
  MinecraftServerStatusHelper = require("./helpers/minecraft-server-status").MinecraftServerStatusHelper;
  UiHelper = require("./helpers/ui").UiHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.desklets[UUID];
  MinecraftServerStatusHelper = DESKLET_DIR.helpers["minecraft-server-status"].MinecraftServerStatusHelper;
  UiHelper = DESKLET_DIR.helpers.ui.UiHelper;
}

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Minecraft Server Status"));
    this._menu.addAction(_("Reload"), () => this._setupLayout());

    // Properties
    this._mainContainer = null;
    this._isReloading = false;
    this._refreshTimeoutId = null;
    this._startupTimeoutID = null;

    // Helpers
    this.minecraftServerStatusHelper = new MinecraftServerStatusHelper(deskletId);
    this.uiHelper = new UiHelper();

    // Default settings
    this.scaleSize = 1;
    this.serverAddresses = [];
    this.maxHeight = 30;
    this.backgroundColor = "rgba(134, 134, 134, 0.58)";
    this.hideDecoration = true;
    this.refreshInterval = 1;
    this.showHeader = true;
    this.fontColor = "inherit";

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "server-addresses", "serverAddresses", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "max-height", "maxHeight", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._onContainerStyleChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._setRefreshInterval);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-header", "showHeader", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "font-color", "fontColor", this._setupLayout);
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
    this._setRefreshInterval();
    this._onDecorationsChanged();

    // The first request after system start will fail
    // Delay to ensure network services are ready and try again
    if (this._startupTimeoutID) Mainloop.source_remove(this._startupTimeoutID);
    this._startupTimeoutID = Mainloop.timeout_add_seconds(10, () => {
      this._setupLayout();
      this._startupTimeoutID = null;
      return false;
    });
  }

  on_desklet_removed() {
    this.minecraftServerStatusHelper._removeCache();
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
    if (this._startupTimeoutID) {
      Mainloop.source_remove(this._startupTimeoutID);
      this._startupTimeoutID = null;
    }
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _onDecorationsChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _setRefreshInterval() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
    if (this.refreshInterval > 0) {
      this._refreshTimeoutId = Mainloop.timeout_add_seconds(this.refreshInterval * 60, () => {
        this._setupLayout();
        return true;
      });
    }
  }

  async _setupLayout() {
    // Setup main container
    const container = new St.BoxLayout({ vertical: true });
    this._mainContainer = container;
    this._onContainerStyleChanged();

    // Header
    if (this.showHeader) {
      const header = this.uiHelper.getHeader({ scaleSize: this.scaleSize, fontColor: this.fontColor, reloadCallback: () => this._setupLayout() });
      container.add_child(header);
    }

    this.setContent(container);

    // Setup view
    if (this.serverAddresses.length === 0) {
      const setupView = this.uiHelper.getSetupView({ scaleSize: this.scaleSize, fontColor: this.fontColor });
      container.add_child(setupView);
      return;
    }

    const scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    scrollView.set_style(`max-height: ${this.scaleSize * this.maxHeight}em;`);
    const serverListContainer = new St.BoxLayout({ vertical: true });
    scrollView.add_actor(serverListContainer);
    container.add_child(scrollView);

    const promises = this.serverAddresses.map(async address => {
      const itemBin = new St.Bin({ x_expand: true, x_fill: true });
      serverListContainer.add_child(itemBin);

      const loadingView = this.uiHelper.getServerListItemLoadingView({ name: address.name, scaleSize: this.scaleSize, fontColor: this.fontColor });
      itemBin.set_child(loadingView);

      try {
        const status = await this.minecraftServerStatusHelper.getServerStatus(address.address);

        // Return when reload during loading
        if (this._mainContainer !== container) return;

        loadingView.destroy();

        const options = {
          name: address.name,
          status: status,
          scaleSize: this.scaleSize,
          fontColor: this.fontColor,
        };

        const serverItem = this.uiHelper.getServerListItem(options);
        itemBin.set_child(serverItem);
      } catch (e) {
        global.logError(`[${UUID}] Error getting status for ${address.address}: ${e}`);
        const errorView = this.uiHelper.getServerListItemErrorView({ name: address.name, scaleSize: this.scaleSize, fontColor: this.fontColor });
        itemBin.set_child(errorView);
      }
    });

    await Promise.all(promises);
  }

  _onContainerStyleChanged() {
    if (this._mainContainer) {
      this._mainContainer.set_style(
        `color: ${this.fontColor}; width: ${this.scaleSize * 20}em; background-color: ${this.backgroundColor}; padding: ${this.scaleSize * 1}em; border-radius: ${this.scaleSize * 0.3}em;`,
      );
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
