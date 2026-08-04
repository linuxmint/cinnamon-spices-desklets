# AI Feed

Cinnamon desklet that aggregates trending AI content from GitHub, arXiv, Hacker News, and HuggingFace into one live desktop feed.

## Features

- **GitHub Trending** — top AI repos filtered by language
- **arXiv Papers** — latest cs.AI / cs.LG / cs.CL / cs.CV / stat.ML preprints
- **Hacker News** — AI/LLM-keyword filtered stories
- **HuggingFace** — trending models, datasets, optionally spaces
- **Bookmarks** — star items, search and revisit later via dialog
- **Configurable** — refresh interval, per-source counts, font scale, colors, dimensions, source display order, optional API tokens for higher rate limits

## Configuration

Right-click the desklet → Configure. Tabs:

- **General** — refresh interval and source display order
- **Sources** — enable/disable each source and item counts
- **Filters** — language / category / keyword filters per source
- **Appearance** — colors, font scale, width, height
- **Advanced** — optional GitHub/HuggingFace API tokens, user-agent, timeout, debug logging

## Requirements

- Cinnamon 5.4 or newer
- Internet connection (cached feed shown when offline)

## Bookmarks

Click the ★ in any feed row to bookmark. Click the ★ in the header to open the bookmark viewer (search + open + remove).

## Author

[suleman-dawood](https://github.com/suleman-dawood)
