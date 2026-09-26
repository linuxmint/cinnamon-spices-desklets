# TheLauncher

A Cinnamon desklet that displays application launchers, documents, and folders from a directory on disk.

## Features

- Filesystem-driven: copy files into your link folder or add via Configure
- Applications (`.desktop`), documents (regular files), and subfolders
- Tile or list layout with light/dark theme presets
- Multiple desklet instances with separate subdirectories
- Per-item order and enable/disable via `.thelauncher.json`
- Position lock, max dimensions, and folder navigation

## Usage

1. Install the desklet and add it to your desktop.
2. Open **Configure → General** and set your link subdirectory.
3. Add items by copying files to the link directory or using **Configure → Links → Add item**.

Default link path: `~/.local/share/thelauncher/<subdirectory>/`

## Acknowledgments

This whole project started when I was using [Quick Links - Launcher](https://cinnamon-spices.linuxmint.com/desklets/view/76) by NotSirius-A, which is a great launcher, but I wanted a few more enhancements.

## License

MIT — see repository LICENSE file.
