# Linux Visualizator

Real-time visualization of CPU (per-core), RAM/Swap, network traffic, disk usage and I/O,
and GPU load/memory/temperature (NVIDIA or AMD, if detected).

Source code and issue tracker: https://github.com/KoDiK2005/linux-visualizator

## Features

- CPU: per-core rings, bars, or an overall-load graph; average load, frequency and
  temperature shown in the section header.
- RAM/Swap usage bars with absolute GB values; the Swap bar hides itself automatically
  when no swap is configured.
- Network throughput sparkline (down/up), with an optional interface filter and a
  bytes/bits unit toggle.
- Disk usage bars per partition (with an optional mount-point filter) plus a read/write
  I/O sparkline.
- GPU usage/memory/temperature bar. Supports NVIDIA (via `nvidia-smi`) and AMD (via
  `amdgpu` sysfs); the section is omitted automatically if no supported GPU is found.
- Fully custom accent colors per category, adjustable warning/critical color thresholds,
  an interface scale slider, and a configurable section order.
- Click the desklet to launch a command of your choice (defaults to
  `gnome-system-monitor`).

All metrics are read directly from `/proc`, `sysfs`, and standard CLI tools, using
asynchronous GIO calls so the desklet never blocks Cinnamon's main loop.
