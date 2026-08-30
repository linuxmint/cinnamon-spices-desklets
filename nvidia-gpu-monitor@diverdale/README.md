# NVIDIA GPU Monitor — Cinnamon Desklet

Per-GPU temperature, usage, VRAM, power, fan, and process count for NVIDIA cards.

## Why another one?

Other Cinnamon NVIDIA desklets call `nvidia-smi` synchronously, which blocks Cinnamon's main loop for 30–200 ms per refresh and visibly freezes the desktop. This desklet uses `Gio.Subprocess` so all queries run asynchronously off the main thread.

## Requirements

- NVIDIA proprietary driver with `nvidia-smi` on `$PATH`.
- Cinnamon ≥ 5.0.

## Install

This desklet directory must live at:

```
~/.local/share/cinnamon/desklets/nvidia-gpu-monitor@diverdale/
```

Then: right-click the desktop → **Add desklets** → enable **NVIDIA GPU Monitor**.

## Configuration

Right-click the desklet → **Configure...**

| Setting | Default | Notes |
|---|---|---|
| Temperature warning threshold | 75 °C | Number turns amber at or above this |
| Temperature critical threshold | 83 °C | Number turns red at or above this |
| Sparkline history window | 120 s | Number of samples = window ÷ 2 (refresh is fixed at 2 s) |
| Show process count | on | Hide the "Procs" line if you don't care |
| Click action | open terminal with `watch nvidia-smi` | Or open `nvidia-settings`, or do nothing |

## Troubleshooting

- **"nvidia-smi not found"** — install the NVIDIA proprietary driver.
- **Stale data warning** — the desklet has had 5+ consecutive failed queries. Check `~/.xsession-errors` for `[nvidia-gpu-monitor@diverdale]` lines.
- **Click does nothing** — none of `x-terminal-emulator`, `gnome-terminal`, or `xterm` is installed. Either install one or set click action to "Do nothing".

## Uninstall

Remove the desklet via right-click → "Remove this desklet", then:

```bash
rm -rf ~/.local/share/cinnamon/desklets/nvidia-gpu-monitor@diverdale
```
