const UUID = "google-news@KopfdesDaemons";
const GLib = imports.gi.GLib;

let HttpHelper;
if (typeof require !== "undefined") {
  HttpHelper = require("./helpers/http").HttpHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.desklets[UUID];
  HttpHelper = DESKLET_DIR.helpers.http.HttpHelper;
}

var GoogleNewsHelper = class {
  URL = "https://news.google.com/rss";
  httpHelper;
  cachedNews;
  cacheTimestamp;

  constructor() {
    this.HttpHelper = new HttpHelper();
  }

  async getNews(forceReload = false) {
    const cacheLifeSpan = 1000 * 60 * 60;
    if (!forceReload && this.cachedNews && Date.now() - this.cacheTimestamp < cacheLifeSpan) {
      return this.cachedNews;
    }

    const news = await this.HttpHelper.fetchText(this.URL);
    const parsedNews = this._parseNews(news);

    const cacheDir = GLib.get_user_cache_dir() + "/" + UUID;
    GLib.mkdir_with_parents(cacheDir, 0o755);

    const promises = parsedNews.map(async (item, i) => {
      if (item.thumbnail) {
        const filename = cacheDir + "/favicon_" + i + ".png";
        const success = await this.HttpHelper.downloadFile(item.thumbnail, filename);
        if (success) {
          item.thumbnailPath = filename;
        }
      }
    });

    await Promise.all(promises);
    this.cachedNews = parsedNews;
    this.cacheTimestamp = Date.now();
    return parsedNews;
  }

  _parseNews(news) {
    const newsItems = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    const getTagContent = (tag, xml) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = xml.match(regex);
      if (!m) return "";
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .trim();
    };

    while ((match = itemRegex.exec(news)) !== null) {
      const itemXml = match[1];
      const title = getTagContent("title", itemXml);
      const link = getTagContent("link", itemXml);
      const pubDate = getTagContent("pubDate", itemXml);
      const source = getTagContent("source", itemXml);

      let thumbnail = "";
      const sourceUrlMatch = itemXml.match(/<source[^>]+url=["']([^"']+)["']/i);

      if (sourceUrlMatch) {
        const sourceUrl = sourceUrlMatch[1].replace(/&amp;/g, "&");
        try {
          const domainMatch = sourceUrl.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
          if (domainMatch && domainMatch[1]) {
            thumbnail = `https://www.google.com/s2/favicons?domain=${domainMatch[1]}&sz=64`;
          }
        } catch (e) {}
      }

      newsItems.push({ title, link, pubDate, source, thumbnail });
    }
    return newsItems;
  }
};
