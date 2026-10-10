# TheLauncher

A Cinnamon desklet that displays application launchers, documents, and folders from a directory on disk.

## Features

- Filesystem-driven: copy files into your link folder or add via Configure
- Applications (`.desktop`), documents (regular files), and subfolders
- Tile or list layout with light/dark theme presets
- Multiple desklet instances with separate subdirectories
- Per-item order and enable/disable via `.thelauncher.json`
- Nine screen anchors with configurable pixel padding
- Large folders scroll within the current monitor's usable area
- Hover brings the launcher to the foreground
- Position lock, max dimensions, and folder navigation

## Usage

1. Install the desklet and add it to your desktop.
2. Open **Configure → General** and set your link subdirectory.
3. Add items by copying files to the link directory or using **Configure → Links → Add item**.

Default link path: `~/.local/share/thelauncher/<subdirectory>/`

## Position and screen space

Under **Configure → General → Behavior → Lock to position**, choose one of the nine screen positions. **Padding (px)** sets the distance from the monitor's usable edges, keeping clear of desktop panels. For example, Bottom left with 20 px padding keeps the launcher's left and bottom edges 20 px from those boundaries as you open larger or smaller folders.

Folders with more items than fit on screen scroll inside the available area. Set Lock to position to Off before dragging the launcher to another monitor.

Hover over an exposed part of the launcher to bring it above application windows. It returns to the desktop layer after the pointer leaves, unless Cinnamon's Show desklets mode was already active.

## Acknowledgments

This whole project started when I was using [Quick Links - Launcher](https://cinnamon-spices.linuxmint.com/desklets/view/76) by NotSirius-A, which is a great launcher, but I wanted a few more enhancements.

## License

MIT — see repository LICENSE file.
