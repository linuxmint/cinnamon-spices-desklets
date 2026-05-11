# Quick System Monitor

A minimalist, high-performance system monitoring desklet for the Cinnamon Desktop. Designed to be clean, non-intrusive, and highly customizable.

![Icon](icon.png)

## Features

* **Real-time Monitoring**: Tracks CPU, RAM, and GPU usage.
* **Multi-Disk Support**: Monitor multiple mount points (e.g., `/`, `/home`, or external drives) simultaneously.
* **Modern UI**: Non-bold typography and a "floating" glass aesthetic.
* **Compact Mode**: A toggle button collapses the desklet into a minimal two-line view (CPU/RAM/GPU on one line, disks on the next) with no progress bars, hiding the title and reducing padding.
* **High Customizability**:
    * **Scaling**: Resize the desklet from 50% to 200% without losing layout integrity.
    * **Transparency**: Achieve true 0% to 100% background opacity.
    * **Color Control**: Custom color pickers for both the background and the progress bars.

## Installation

1. Copy the folder `sys-monitor@Paul163-ai` to `~/.local/share/cinnamon/desklets/`.
2. Right-click your desktop and select **Add Desklets**.
3. Find **Quick System Monitor** and click the **+** button.

## Requirements

* **NVIDIA GPU Monitoring**: Requires `nvidia-smi` to be installed (standard with NVIDIA proprietary drivers).
* **Disk Monitoring**: Uses GIO for local paths and falls back to `df` for network or specialized mounts.

## Configuration Tips

### True Transparency
To get the cleanest look, it is highly recommended to:
1. Open the desklet **Configure** menu.
2. Go to **General Settings** (system level).
3. Set **Desklet Decorations** to **None**.
4. Set the **Background Transparency** slider to your preferred level (0.0 for completely floating text).

## Credits

Developed by Paul Lintott. Built for the Linux Mint community.
