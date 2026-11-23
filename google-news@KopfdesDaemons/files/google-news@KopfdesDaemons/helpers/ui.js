const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Gettext = imports.gettext;
const Util = imports.misc.util;
const Tooltips = imports.ui.tooltips;

const UUID = "google-news@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

var UiHelper = class UiHelper {
  constructor() {}

  getNewsScrollView(settings) {
    const { news, scaleSize, newsItemBackgroundColor, newsItemTextColor } = settings;

    // Container
    const scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });

    const scrollViewContent = new St.BoxLayout({ vertical: true });
    scrollViewContent.set_style(`spacing: ${scaleSize * 1}em;`);
    scrollView.add_actor(scrollViewContent);

    for (const item of news) {
      const newsItemContainer = new St.BoxLayout({ vertical: true, y_expand: true });
      newsItemContainer.set_style(
        `min-height: ${scaleSize * 7}em; color: ${newsItemTextColor}; padding: ${scaleSize * 1}em; background-color: ${newsItemBackgroundColor}; border-radius: ${scaleSize * 0.8}em;`,
      );

      // Title
      const title = new St.Label({ text: item.title });
      title.set_style(`font-size: ${scaleSize * 1.5}em;`);
      title.clutter_text.set_line_wrap(true);
      title.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
      newsItemContainer.add_child(title);

      // Spacer
      const spacer = new St.Bin({ y_expand: true });
      spacer.set_style(`height: ${scaleSize * 0.5}em;`);
      newsItemContainer.add_child(spacer);

      const footer = new St.BoxLayout({ y_align: St.Align.MIDDLE });
      footer.set_style(`spacing: ${scaleSize * 0.5}em;`);

      // Favicon
      if (item.faviconPath) {
        const iconSize = Math.round(scaleSize * 50);
        const gicon = Gio.FileIcon.new(Gio.File.new_for_path(item.faviconPath));
        const icon = new St.Icon({ gicon: gicon, icon_size: iconSize, style: `height: ${scaleSize * 1.5}em; width: ${scaleSize * 1.5}em;` });
        const iconBox = new St.Bin({ child: icon });

        footer.add_child(iconBox);
      }

      // Source
      const sourceBox = new St.Bin();
      const source = new St.Label({ text: item.source });
      source.set_style(`font-size: ${scaleSize * 1}em;`);
      sourceBox.add_actor(source);
      footer.add_child(sourceBox);

      // Date
      const dateBox = new St.Bin();
      const date = new St.Label({ text: item.pubDate });
      date.set_style(`font-size: ${scaleSize * 1}em;`);
      dateBox.add_actor(date);
      footer.add_child(dateBox);

      // Spacer
      const spacer2 = new St.Bin({ x_expand: true });
      footer.add_child(spacer2);

      // Read more button
      const readMoreButton = new St.Button({ label: _("read more"), style_class: "google-news-read-more-button" });
      readMoreButton.set_style(`padding: ${scaleSize * 0.5}em; border-radius: ${scaleSize * 0.5}em; font-size: ${scaleSize * 1}em;`);
      readMoreButton.connect("clicked", () => {
        Util.spawn(["xdg-open", item.link]);
      });
      new Tooltips.Tooltip(readMoreButton, _("Open in browser"));

      footer.add_child(readMoreButton);

      newsItemContainer.add_child(footer);

      scrollViewContent.add_actor(newsItemContainer);
    }

    return scrollView;
  }

  getLoadingView(scaleSize) {
    // Container
    const loadingView = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });

    // Label
    const loadingLabel = new St.Label({ text: _("Loading...") });
    loadingLabel.set_style(`font-size: ${scaleSize * 1.5}em;`);

    loadingView.add_child(new St.Bin({ child: loadingLabel, x_align: St.Align.MIDDLE, y_expand: true }));
    return loadingView;
  }

  getErrorView(scaleSize, errorMessage) {
    // Container
    const errorView = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
    errorView.set_style(`padding: ${scaleSize * 0.5}em; spacing: ${scaleSize * 1}em; background-color: rgba(98, 100, 110, 0.36); border-radius: ${scaleSize * 0.8}em;`);

    const errorBin = new St.Bin();

    const errorIcon = new St.Icon({
      icon_name: "dialog-warning-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      style: `width: ${scaleSize * 2.5}em; height: ${scaleSize * 2.5}em; padding: ${scaleSize * 0.5}em; border-radius: ${scaleSize * 0.5}em;`,
    });

    errorBin.add_actor(errorIcon);
    errorView.add_child(errorBin);

    // Label
    const errorLabel = new St.Label({ text: _("Error loading news") });
    errorLabel.set_style(`font-size: ${scaleSize * 1.5}em; color: red;`);
    errorView.add_child(errorLabel);

    // ErrorMessage
    if (errorMessage) {
      const errorMessageLabel = new St.Label({ text: errorMessage.toString() });
      errorMessageLabel.set_style(`font-size: ${scaleSize * 1}em;`);
      errorMessageLabel.clutter_text.set_line_wrap(true);
      errorMessageLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
      errorView.add_child(errorMessageLabel);
    }

    return errorView;
  }

  getHeader(settings) {
    const { scaleSize, showHeaderText, headerText, headerTextColor, reloadCallback, showHeaderIcon, showReloadButton } = settings;

    // Container
    const header = new St.BoxLayout({ y_align: St.Align.MIDDLE, style: `spacing: ${scaleSize * 0.5}em;` });

    // Google News icon
    if (showHeaderIcon) {
      const iconBox = new St.Bin();
      iconBox.set_style(`padding: ${scaleSize * 0.5}em; height: ${scaleSize * 2.5}em; width: ${scaleSize * 2.5}em;`);
      iconBox.add_actor(this._getIcon("/icons/google-news.svg", scaleSize * 50));
      header.add_child(iconBox);
    }

    // Label
    if (showHeaderText) {
      const labelBin = new St.Bin();
      const label = new St.Label({ text: headerText });
      label.set_style(`font-size: ${scaleSize * 1.5}em; color: ${headerTextColor};`);
      labelBin.add_actor(label);
      header.add_child(labelBin);
    }

    // Spacer
    const spacer = new St.Bin({ x_expand: true });
    header.add_child(spacer);

    // Reload button
    if (showReloadButton) {
      const buttonBox = new St.Bin();
      const reloadButtonStyle = `width: ${scaleSize * 2.5}em; height: ${scaleSize * 2.5}em; padding: ${scaleSize * 0.5}em; border-radius: ${scaleSize * 0.5}em;`;
      const reloadButton = new St.Button({
        style: reloadButtonStyle,
        style_class: "google-news-reload-button",
      });
      reloadButton.connect("clicked", reloadCallback);
      const reloadIcon = new St.Icon({
        icon_name: "view-refresh-symbolic",
        icon_type: St.IconType.SYMBOLIC,
        style: reloadButtonStyle,
        style_class: "google-news-reload-button",
      });

      new Tooltips.Tooltip(reloadButton, _("Reload"));
      reloadButton.set_child(reloadIcon);
      buttonBox.add_actor(reloadButton);
      header.add_child(buttonBox);
    }

    return header;
  }

  _getIcon(path, size) {
    const icon_file = DESKLET_DIR + path;
    const scaledSize = Math.round(size * this.scaleSize);
    return new St.Icon({ gicon: Gio.icon_new_for_string(icon_file), icon_size: scaledSize });
  }
};
