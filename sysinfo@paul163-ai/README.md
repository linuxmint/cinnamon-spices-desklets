# Full System Info Desklet

A comprehensive system monitor desklet for the Cinnamon desktop with a fully transparent background.

## What it shows

| Section | Data |
|---|---|
| **Header** | Hostname, OS name, kernel version |
| **System** | Uptime, load averages (1 / 5 / 15 min), process count |
| **CPU** | Model, thread count, usage % + bar, average frequency, temperature |
| **Memory** | RAM used / total + bar, swap used / total + bar, buffers + cache |
| **GPU** | Model, usage % + bar, VRAM used / total, temperature |
| **Storage** | Per-path used / total + bar (configurable) |
| **Network** | Live download / upload speeds, session totals |
| **Battery** | Level % + bar, status, estimated time remaining |

GPU requires `nvidia-smi` (NVIDIA cards only). Battery, GPU, Network sections can each be hidden via settings.

## Installation

Copy the `sysinfo@paul163-ai` folder to:

```
~/.local/share/cinnamon/desklets/
```

Then right-click the desktop → **Desklets** → find **Full System Info** → click **+**.

## Settings

Right-click the desklet → **Configure** to access all options.

| Setting | Default | Description |
|---|---|---|
| Refresh interval | 2 s | How often all data updates |
| Disk paths | `/` | Comma-separated mount points to monitor, e.g. `/, /home` |
| Show GPU | on | Toggle the GPU section |
| Show Network | on | Toggle the Network section |
| Show Battery | on | Toggle the Battery section |
| Background color | black | Color used when background opacity > 0 |
| Background opacity | 0.0 | 0 = fully transparent, 1 = fully opaque |
| Text color | white | Color of all label and value text |
| Accent color | blue | Color of progress bars |
| Font size | 9 pt | Base size — all text scales together |
| Desklet scale | 1.0 | Overall size multiplier |

Disk paths update live — no restart required.

## Requirements

- Cinnamon 5.0+
- `df` (standard, always present)
- `nvidia-smi` (optional, for GPU section)
- `/sys/class/power_supply/BAT*` (optional, for Battery section)

## Author

Paul Lintott
