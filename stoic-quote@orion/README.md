# Stoic Quote — Cinnamon Desklet

A Linux Mint Cinnamon desklet that displays a daily Stoic quote drawn from seven philosophers across the school's full history:

| Author | Era | Primary sources |
|---|---|---|
| Zeno of Citium | ~334–262 BC | *Lives of the Eminent Philosophers* (D.L. 7) |
| Cleanthes | ~330–230 BC | *Hymn to Zeus*, D.L. 7 |
| Chrysippus | ~280–207 BC | Fragments, D.L. 7 |
| Epictetus | ~50–135 AD | *Discourses*, *Enchiridion* |
| Musonius Rufus | ~30–100 AD | *Lectures* |
| Marcus Aurelius | 121–180 AD | *Meditations* |
| Seneca | ~4 BC–65 AD | *Letters from a Stoic*, *On the Shortness of Life* |

## Features

- **63 curated quotes** across seven authors (Zeno, Cleanthes, Chrysippus, Epictetus, Musonius Rufus, Marcus Aurelius, Seneca), with source attribution
- **Deterministic daily rotation** — the same quote is shown to all users on a given date (hash of YYYY-MM-DD mod corpus size); it does not change if Cinnamon restarts
- **Midnight auto-refresh** — switches to the next day's quote at local midnight via a Mainloop timer
- **Manual refresh button** — circular arrow in the corner reloads quotes.json and re-renders
- **Live settings** — width, source visibility, refresh mode, and button toggle all apply without a restart

## Settings

| Setting | Default | Description |
|---|---|---|
| Width | 380 px | Desklet width (300–500 px) |
| Show source | On | Show book/work name below author |
| Show refresh button | On | Show the ↺ refresh button |
| Refresh frequency | Daily | Daily (midnight), Hourly, or Manual only |

## Local Installation

### 1. Copy the files

```bash
mkdir -p ~/.local/share/cinnamon/desklets/stoic-quote@orion
cp -r ~/stoic-quote@orion/* ~/.local/share/cinnamon/desklets/stoic-quote@orion/
```

### 2. (Optional) Generate a PNG icon from the included SVG

If you have `rsvg-convert` (from `librsvg2-bin`):
```bash
rsvg-convert -w 48 -h 48 \
  ~/.local/share/cinnamon/desklets/stoic-quote@orion/icon.svg \
  -o ~/.local/share/cinnamon/desklets/stoic-quote@orion/icon.png
```

Or with ImageMagick:
```bash
convert -background none -resize 48x48 \
  ~/.local/share/cinnamon/desklets/stoic-quote@orion/icon.svg \
  ~/.local/share/cinnamon/desklets/stoic-quote@orion/icon.png
```

### 3. Add the desklet to your desktop

- Right-click the desktop → **Desklets**
- Find **Stoic Quote** in the list and click **+** to add it

### Reloading after edits

After editing files (e.g., updating quotes.json), reload without a full logout:

- **Right-click desktop → Troubleshoot → Restart Cinnamon**
- Or from a terminal: `nohup cinnamon --replace > /dev/null 2>&1 &`
- Or open **Looking Glass** (Alt+F2, type `lg`, Enter) and run:
  `imports.ui.main.loadTheme()` or remove and re-add the desklet

## Adding / editing quotes

`quotes.json` is a plain JSON array. Each entry:

```json
{
  "text":   "Quote text here.",
  "author": "Author Name",
  "source": "Work Title, Book/Letter N"
}
```

The desklet picks today's quote as `djb2_hash("YYYY-MM-DD") % len(quotes)`. Adding quotes at the end shifts all future dates; inserting in the middle shifts more. If you want stable date-to-quote mapping, only append.

## Submitting to Cinnamon Spices

1. Fork [linuxmint/cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets)
2. Copy the `stoic-quote@orion/` folder into the repo root
3. Add a `screenshot.png` (1920×1080 or a cropped portion showing the desklet)
4. Ensure `icon.png` is 48×48 (convert from `icon.svg` above)
5. Open a pull request — the Spices team reviews and merges

## Debug output

All log lines are prefixed `[stoic-quote]` and visible in **Looking Glass** (Alt+F2 → `lg` → Log tab).

## License

Public domain / CC0. Quote texts are historical works in the public domain.
