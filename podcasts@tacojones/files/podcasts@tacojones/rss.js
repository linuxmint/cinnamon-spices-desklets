// A small RSS reader for podcast feeds. GJS has no XML parser, and podcast feeds
// only need a few tags, so this picks them out of the text.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

// Zones that pubDates give as abbreviations JavaScript's Date doesn't know.
const ZONES = { Z: "+0000", BST: "+0100", CET: "+0100", CEST: "+0200", EET: "+0200", EEST: "+0300",
    IST: "+0530", JST: "+0900", AEST: "+1000", AEDT: "+1100", NZST: "+1200", NZDT: "+1300" };

function decode(text) {
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
            if (name[0] === "#") {
                const code = name[1] === "x" || name[1] === "X"
                    ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
                return isNaN(code) || code > 0x10FFFF ? whole : String.fromCodePoint(code);
            }
            return ENTITIES[name.toLowerCase()] ?? whole;
        })
        .trim();
}

// The text of a feed from its bytes (a Uint8Array). The encoding comes from a byte order mark,
// else the XML declaration, else charset (from the HTTP headers), else UTF-8. Text that
// claims UTF-8 but isn't is read as Windows-1252, the usual mistake.
function decodeBytes(bytes, charset = "") {
    if (bytes[0] === 0xFE && bytes[1] === 0xFF)
        return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    if (bytes[0] === 0xFF && bytes[1] === 0xFE)
        return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
        bytes = bytes.subarray(3); // GJS's TextDecoder keeps it
    const head = String.fromCharCode(...bytes.subarray(0, 200));
    const declared = head.match(/^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([\w.:-]+)["']/);
    let decoder;
    try {
        decoder = new TextDecoder(declared?.[1] || charset || "utf-8", { fatal: true });
    } catch (e) {
        decoder = new TextDecoder("utf-8", { fatal: true });
    }
    try {
        return decoder.decode(bytes);
    } catch (e) {
        return new TextDecoder("windows-1252").decode(bytes);
    }
}

// A pubDate as a Date, or null.
function parseDate(text) {
    if (!text)
        return null;
    let date = new Date(text);
    if (isNaN(date)) {
        const zone = text.match(/\s([A-Z]{1,4})$/);
        date = new Date(zone ? text.slice(0, zone.index) + " " + (ZONES[zone[1]] ?? "+0000") : text);
    }
    return isNaN(date) ? null : date;
}

// The text inside the first <tag>...</tag> in xml, or "".
function tagText(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
    return match ? decode(match[1]) : "";
}

// An attribute of the first <tag ...> in xml, or "".
function tagAttribute(xml, tag, attribute) {
    const match = xml.match(new RegExp(`<${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    return match ? decode(match[2] ?? match[3]) : "";
}

// The <item>s of xml from the first on, or from the last back.
function* items(xml) {
    for (const [item] of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi))
        yield item;
}

function* itemsBackwards(xml) {
    let end = xml.length;
    while (end > 0) {
        const start = xml.lastIndexOf("<item", end - 1);
        if (start < 0)
            return;
        end = start;
        if (!/^<item[\s>]/.test(xml.slice(start, start + 6)))
            continue; // <items>, <itemCount>…
        const close = xml.indexOf("</item>", start);
        if (close >= 0)
            yield xml.slice(start, close + 7);
    }
}

// An item as an episode, or null when it has no audio.
function episode(item) {
    const url = tagAttribute(item, "enclosure", "url") || tagAttribute(item, "media:content", "url");
    if (!url)
        return null;
    return {
        title: tagText(item, "title"),
        url,
        date: parseDate(tagText(item, "pubDate")),
        duration: tagText(item, "itunes:duration"),
        guid: tagText(item, "guid") || url,
    };
}

// The first count episodes from an item iterator.
function take(iterator, count) {
    const taken = [];
    for (const item of iterator) {
        if (taken.length >= count)
            break;
        const found = episode(item);
        if (found)
            taken.push(found);
    }
    return taken;
}

// { title, image, episodes: [{ title, url, date, duration, guid }] }, newest first, with at most
// limit episodes. An episode's title is "" when the feed gives none.
//
// Feeds list their items newest first, or oldest first for serials, so when the first and last
// items' dates say which, only that end is read; parsing every item of a feed with years of
// episodes takes long enough to stall Cinnamon.
function parse(xml, limit = Infinity) {
    const itemsAt = xml.search(/<item[\s>]/i);
    const channel = itemsAt >= 0 ? xml.slice(0, itemsAt) : xml;
    const imageBlock = channel.match(/<image[\s>][\s\S]*?<\/image>/i);
    const feed = {
        title: tagText(channel.replace(/<image[\s>][\s\S]*?<\/image>/gi, ""), "title"),
        image: tagAttribute(channel, "itunes:image", "href") || (imageBlock ? tagText(imageBlock[0], "url") : ""),
        episodes: [],
    };
    const first = items(xml).next().value, last = itemsBackwards(xml).next().value;
    const firstDate = first && parseDate(tagText(first, "pubDate"));
    const lastDate = last && parseDate(tagText(last, "pubDate"));
    if (limit !== Infinity && firstDate && lastDate)
        feed.episodes = take(firstDate >= lastDate ? items(xml) : itemsBackwards(xml), limit);
    else
        feed.episodes = take(items(xml), Infinity);
    feed.episodes.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    feed.episodes.length = Math.min(feed.episodes.length, limit);
    return feed;
}

if (typeof module !== "undefined")
    module.exports = { parse, decode, decodeBytes, parseDate };
