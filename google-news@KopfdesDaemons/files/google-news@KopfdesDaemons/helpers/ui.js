const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Util = imports.misc.util;

const UUID = "google-news@KopfdesDaemons";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

var UiHelper = class UiHelper {
  constructor() {}

  getNewsScrollView(scaleSize, width, height, news) {
    const scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    scrollView.set_style(`max-height: ${scaleSize * height}em; width: ${scaleSize * width}em;`);

    const scrollViewContent = new St.BoxLayout({ vertical: true });
    scrollViewContent.set_style(`spacing: ${scaleSize * 1}em;`);
    scrollView.add_actor(scrollViewContent);

    for (const item of news) {
      const newsItemContainer = new St.BoxLayout({ vertical: true, y_expand: true });
      newsItemContainer.set_style(`min-height: 7em; padding: ${scaleSize * 1}em; background-color: rgba(98, 100, 110, 0.36); border-radius: ${scaleSize * 0.8}em;`);

      // Title
      const title = new St.Label({ text: item.title });
      title.set_style(`font-size: ${scaleSize * 1.5}em;`);
      title.clutter_text.set_line_wrap(true);
      newsItemContainer.add_child(title);

      // Spacer
      const spacer = new St.Bin({ y_expand: true });
      spacer.set_style(`height: ${scaleSize * 0.5}em;`);
      newsItemContainer.add_child(spacer);

      const footer = new St.BoxLayout({ y_align: St.Align.MIDDLE });
      footer.set_style(`spacing: ${scaleSize * 0.5}em;`);

      // Favicon
      const iconSize = Math.round(scaleSize * 15);
      const gicon = Gio.FileIcon.new(Gio.File.new_for_path(item.thumbnailPath));
      const icon = new St.Icon({ gicon: gicon, icon_size: iconSize });
      footer.add_child(icon);

      // Source
      const sourceBox = new St.Bin();
      const source = new St.Label({ text: item.source });
      sourceBox.add_actor(source);
      footer.add_child(sourceBox);

      // Date
      const dateBox = new St.Bin();
      const date = new St.Label({ text: item.pubDate });
      dateBox.add_actor(date);
      footer.add_child(dateBox);

      // Spacer
      const spacer2 = new St.Bin({ x_expand: true });
      footer.add_child(spacer2);

      // Read more button
      const readMoreButton = new St.Button({ label: _("Read more"), style_class: "google-news-read-more-button" });
      readMoreButton.set_style(`padding: ${scaleSize * 0.5}em; border-radius: ${scaleSize * 0.5}em;`);
      readMoreButton.connect("clicked", () => {
        Util.spawn(["xdg-open", item.link]);
      });
      footer.add_child(readMoreButton);

      newsItemContainer.add_child(footer);

      scrollViewContent.add_actor(newsItemContainer);
    }

    return scrollView;
  }

  getLoadingView(scaleSize, width, height) {
    // Container
    const box = new St.BoxLayout({ vertical: true });
    box.set_style(`width: ${scaleSize * width}em; height: ${scaleSize * height}em;`);

    // Label
    const loadingLabel = new St.Label({ text: _("Loading...") });
    loadingLabel.set_style(`font-size: ${scaleSize * 1.5}em;`);

    box.add_child(new St.Bin({ child: loadingLabel, x_align: St.Align.MIDDLE, y_expand: true }));
    return box;
  }

  getHeader(scaleSize, reloadCallback) {
    const header = new St.BoxLayout({ y_align: St.Align.MIDDLE, style: `spacing: ${scaleSize * 0.5}em;` });

    // Google News icon
    const iconBox = new St.Bin();
    iconBox.set_style(`padding: ${scaleSize * 0.5}em; height: ${scaleSize * 2.5}em; width: ${scaleSize * 2.5}em;`);
    iconBox.add_actor(this._getIcon("/icons/google-news.svg", scaleSize * 50));
    header.add_child(iconBox);

    // Label
    const labelBin = new St.Bin();
    const label = new St.Label({ text: _("Google News") });
    label.set_style(`font-size: ${scaleSize * 1.5}em;`);
    labelBin.add_actor(label);
    header.add_child(labelBin);

    // Spacer
    const spacer = new St.Bin({ x_expand: true });
    header.add_child(spacer);

    // Reload button
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

    reloadButton.set_child(reloadIcon);
    buttonBox.add_actor(reloadButton);
    header.add_child(buttonBox);

    return header;
  }

  _getIcon(path, size) {
    const icon_file = DESKLET_DIR + path;
    const scaledSize = Math.round(size * this.scaleSize);
    return new St.Icon({ gicon: Gio.icon_new_for_string(icon_file), icon_size: scaledSize });
  }
};
