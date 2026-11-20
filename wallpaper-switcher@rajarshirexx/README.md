# Wallpaper Switcher

A minimal, floating wallpaper controller desklet for Cinnamon Desktop with a frosted glass backdrop and automatic slideshow timer.

## Features

- **Minimal UI**: Translucent floating glass pill (`←   ⏸   →`).
- **Controls**:
  - `←` : Previous wallpaper
  - `⏸` / `▶` : Pause or resume automatic slideshow
  - `→` : Next wallpaper
- **Slideshow Timer**: Automatically advances wallpapers at configurable intervals (1 min, 5 min, 10 min, 15 min, 30 min, 1 hour, or Custom).
- **Native Cinnamon Integration**: Sets desktop background directly through Cinnamon's native desktop background settings (`org.cinnamon.desktop.background picture-uri`). No external daemons, shell scripts, or wallpaper managers required.
- **Robust**: Gracefully handles missing directories, empty folders, single files, and deleted files.
- **Right-Click Settings**: Configurable wallpaper directory and slideshow interval via native Cinnamon desklet settings dialog.

## Installation

Install via Cinnamon's built-in Desklet settings:
1. Open **System Settings → Desklets**.
2. Click the **Download** tab.
3. Search for **Wallpaper Switcher** and click **Install**.
4. In the **Manage** tab, select **Wallpaper Switcher** and click **`+`** to add it to your desktop.

