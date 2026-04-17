const UUID = "google-news@KopfdesDaemons";
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

let HttpHelper;
if (typeof require !== "undefined") {
  HttpHelper = require("./helpers/http").HttpHelper;
} else {
  const DESKLET_DIR = imports.ui.deskletManager.desklets[UUID];
  HttpHelper = DESKLET_DIR.helpers.http.HttpHelper;
}

var GoogleNewsHelper = class {
  httpHelper;
  URL = "https://news.google.com/rss";
  cacheDir = GLib.get_user_cache_dir() + "/" + UUID;
  cachedNews;
  cacheTimestamp;
  ceid = "";
  newsKeywords = [];

  constructor() {
    this.HttpHelper = new HttpHelper();
  }

  setConfig(ceid, newsKeywords) {
    this.ceid = ceid;
    if (newsKeywords && newsKeywords.length > 0) {
      this.newsKeywords = newsKeywords.map(object => object.keyword);
    } else {
      this.newsKeywords = [];
    }
    this._removeCache();
  }

  _buildUrl() {
    let url = this.URL;
    const params = [];

    if (this.ceid) {
      params.push(`ceid=${encodeURIComponent(this.ceid)}`);
    }

    if (this.newsKeywords && this.newsKeywords.length > 0) {
      params.push(`q=${encodeURIComponent(this.newsKeywords.join(" OR "))}`);
    }

    if (params.length > 0) {
      url += "?" + params.join("&");
    }

    return url;
  }

  async getNews(forceReload = false) {
    const cacheLifeSpan = 1000 * 60 * 60;
    if (!forceReload && this.cachedNews && Date.now() - this.cacheTimestamp < cacheLifeSpan) {
      return this.cachedNews;
    }

    const url = this._buildUrl();
    const news = await this.HttpHelper.fetchText(url);
    const parsedNews = this._parseNews(news);

    GLib.mkdir_with_parents(this.cacheDir, 0o755);

    const promises = parsedNews.map(async (item, i) => {
      if (item.thumbnail) {
        try {
          const filename = this.cacheDir + "/favicon_" + i + ".png";
          const success = await this.HttpHelper.downloadFile(item.thumbnail, filename);
          if (success) {
            item.thumbnailPath = filename;
          }
        } catch (e) {
          global.log(`[${UUID}] Error downloading thumbnail: ${e}`);
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
      const rawPubDate = getTagContent("pubDate", itemXml);
      const pubDate = this._formatRelativeTime(rawPubDate);
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

  _formatRelativeTime(dateString) {
    if (!dateString) return "";

    const pubDate = new Date(dateString);
    if (isNaN(pubDate.getTime())) return dateString;

    const diffMs = Date.now() - pubDate.getTime();
    if (diffMs < 0) return _("Just now");

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return _("%s d").replace("%s", diffDays);
    } else if (diffHours > 0) {
      return _("%s h").replace("%s", diffHours);
    } else if (diffMins > 0) {
      return _("%s m").replace("%s", diffMins);
    } else {
      return _("Just now");
    }
  }

  _removeCache() {
    try {
      const cacheDirFile = Gio.File.new_for_path(this.cacheDir);
      if (cacheDirFile.query_exists(null)) {
        const enumerator = cacheDirFile.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
          cacheDirFile.get_child(info.get_name()).delete(null);
        }
        cacheDirFile.delete(null);
      }
      this.cachedNews = null;
      this.cacheTimestamp = null;
    } catch (e) {
      global.log(`[${UUID}] Error removing cache: ${e}`);
    }
  }
};
