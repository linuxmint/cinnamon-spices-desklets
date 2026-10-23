# PowerPulse

Compact battery monitor for the Cinnamon desktop.

PowerPulse shows wireless device battery levels on the desktop using **UPower**. **HeadsetControl** is optional and adds extra headset readings when that program is installed from your distribution.

![PowerPulse](screenshot.png)

## Features

- Automatic discovery of UPower batteries (laptop, mouse, keyboard, headset, speakers, and similar devices)
- Compact cards with icon, name, percentage and progress bar
- Click a device to expand details (status, time remaining, voltage, health)
- Hover panel with extra device info and actions
- Configurable sort order, low-battery notifications, and compact mode
- Spanish and English translations

## Optional dependency

HeadsetControl is not required. Without it, PowerPulse still lists every battery that UPower reports.

If your distribution packages HeadsetControl, install it with the system package manager. Do not download extra desklet code from outside Cinnamon Spices.

## Usage

| Action | Result |
|--------|--------|
| Click a device | Expand or collapse details |
| Click the title | Show a short summary |
| Right-click | Desklet menu (refresh, sort, settings) |

Configure the desklet from the context menu or *System Settings → Desklets → PowerPulse*.
