# News Feed — Multi-Source

A lightweight Cinnamon desklet that displays live headlines from multiple RSS feeds on your desktop. Click any headline to open it in your default browser.

![Screenshot](screenshot.png)

---

## Features

- Aggregates headlines from multiple RSS sources simultaneously
- Per-source error handling — one failing feed won't hide the others
- Clickable headlines open in your default browser
- Configurable number of stories per source (1–10)
- Adjustable refresh interval (1–60 minutes)
- Resizable width to fit your desktop layout

## Supported sources

| Source | Feed |
|---|---|
| Google News | `news.google.com/rss` |
| BBC World | `feeds.bbci.co.uk/news/world/rss.xml` |
| Linux Mint Blog | `blog.linuxmint.com/?feed=rss2` |

## Requirements

- Linux Mint with Cinnamon 5.4, 6.0, or 6.4

## Installation

**From Cinnamon Spices (recommended)**

1. Right-click the desktop → *Add Desklets*
2. Search for **News Feed**
3. Click *Install* then *Add to desktop*

**Manual**

```bash
cd ~/.local/share/cinnamon/desklets/
git clone https://github.com/YOUR_USERNAME/cinnamon-spices-desklets newsfeed@paull --depth 1 --filter=blob:none --sparse
cd newsfeed@paull
git sparse-checkout set newsfeed@paull
```

Then right-click the desktop → *Add Desklets* → find News Feed in the list.

## Settings

| Setting | Default | Description |
|---|---|---|
| Google News | On | Enable/disable Google News feed |
| BBC World | Off | Enable/disable BBC World feed |
| Linux Mint Blog | On | Enable/disable Linux Mint Blog feed |
| Stories per source | 3 | How many headlines to show per feed |
| Desklet width | 350 px | Width of the desklet panel |
| Refresh interval | 15 min | How often to fetch new headlines |

## Author

Paul Lintott

## License

GPL-2.0
