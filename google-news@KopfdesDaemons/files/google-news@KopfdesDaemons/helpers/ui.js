const St = imports.gi.St;
const Gio = imports.gi.Gio;

var UiHelper = class UiHelper {
  constructor() {}

  getNewsScrollView(scaleSize, news) {
    const scrollView = new St.ScrollView({ overlay_scrollbars: true, clip_to_allocation: true });
    scrollView.set_style(`max-height: ${scaleSize * 45}em; width: ${scaleSize * 35}em;`);

    const scrollViewContent = new St.BoxLayout({ vertical: true });
    scrollViewContent.set_style(`spacing: ${scaleSize * 0.5}em;`);
    scrollView.add_actor(scrollViewContent);

    for (const item of news) {
      const newsItem = new St.BoxLayout({ vertical: true });
      newsItem.set_style(`spacing: ${scaleSize * 0.5}em; padding: ${scaleSize * 1}em; background-color: rgba(77, 83, 112, 0.7); border-radius: ${scaleSize * 0.5}em;`);

      const title = new St.Label({ text: item.title });
      title.set_style(`font-size: ${scaleSize * 1.5}em; font-weight: bold;`);

      const pubDate = new St.Label({ text: item.pubDate });
      const source = new St.Label({ text: item.source });

      const textContainer = new St.BoxLayout({ vertical: true });
      textContainer.add_child(title);
      textContainer.add_child(pubDate);
      textContainer.add_child(source);

      if (item.thumbnailPath) {
        const imageContainer = new St.BoxLayout({ vertical: false });

        const iconSize = Math.round(scaleSize * 64);
        const gicon = Gio.FileIcon.new(Gio.File.new_for_path(item.thumbnailPath));
        const icon = new St.Icon({ gicon: gicon, icon_size: iconSize });
        icon.set_style(`margin-right: ${scaleSize * 1}em;`);

        imageContainer.add_child(icon);
        imageContainer.add_child(textContainer);
        newsItem.add_child(imageContainer);
      } else {
        newsItem.add_child(textContainer);
      }

      scrollViewContent.add_actor(newsItem);
    }

    return scrollView;
  }
};
