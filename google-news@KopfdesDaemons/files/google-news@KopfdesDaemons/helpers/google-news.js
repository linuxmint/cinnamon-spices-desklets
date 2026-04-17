const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

const UUID = "google-news@KopfdesDaemons";

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
  cacheDir;
  cachedNews;
  cacheTimestamp;
  ceid = "";
  newsKeywords = [];

  constructor(deskletId) {
    this.HttpHelper = new HttpHelper();
    this.cacheDir = GLib.get_user_cache_dir() + "/" + UUID + "/" + deskletId;
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
      url += "/search";
      const formattedKeywords = this.newsKeywords.map(keyword => `"${keyword.trim().replace(/^"|"$/g, "")}"`);
      params.push(`q=${encodeURIComponent(formattedKeywords.join(" OR "))}`);
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

    const fetchTimestamp = Date.now();
    const promises = parsedNews.map(async (item, i) => {
      if (item.faviconURL) {
        try {
          const filename = this.cacheDir + "/favicon_" + i + "_" + fetchTimestamp + ".png";
          const success = await this.HttpHelper.downloadFile(item.faviconURL, filename);
          if (success) {
            item.faviconPath = filename;
          }
        } catch (e) {
          global.logError(`[${UUID}] Error downloading favicon: ${e}`);
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

      let faviconURL = "";
      const sourceUrlMatch = itemXml.match(/<source[^>]+url=["']([^"']+)["']/i);

      if (sourceUrlMatch) {
        const sourceUrl = sourceUrlMatch[1].replace(/&amp;/g, "&");
        try {
          const domainMatch = sourceUrl.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
          if (domainMatch && domainMatch[1]) {
            faviconURL = `https://www.google.com/s2/favicons?domain=${domainMatch[1]}&sz=64`;
          }
        } catch (e) {}
      }

      newsItems.push({ title, link, pubDate, source, faviconURL });
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
    this.cachedNews = null;
    this.cacheTimestamp = null;

    try {
      const cacheDirFile = Gio.File.new_for_path(this.cacheDir);
      cacheDirFile.enumerate_children_async("standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (file, res) => {
        try {
          const enumerator = file.enumerate_children_finish(res);
          let info;
          while ((info = enumerator.next_file(null)) !== null) {
            try {
              file.get_child(info.get_name()).delete(null);
            } catch (e) {}
          }
          enumerator.close(null);
          try {
            file.delete(null);
          } catch (e) {}
        } catch (e) {
          if (e.code !== Gio.IOErrorEnum.NOT_FOUND) {
            global.logError(`[${UUID}] Error removing cache: ${e}`);
          }
        }
      });
    } catch (e) {
      global.logError(`[${UUID}] Error initiating cache removal: ${e}`);
    }
  }
};
