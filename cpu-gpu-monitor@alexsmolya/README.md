# CPU & GPU Monitor

CPU & GPU Monitor is a Cinnamon desklet with compact history graphs for:

- aggregate CPU usage;
- RAM usage;
- CPU temperature;
- NVIDIA GPU utilization;
- VRAM usage;
- GPU temperature.

## Hardware scope

The first public version targets Linux and Cinnamon. CPU temperature uses the
standard Linux hwmon interfaces exposed by AMD `k10temp` or `zenpower`, with a
constrained CPU/package thermal-zone fallback. NVIDIA metrics use the first row
returned by the system-provided `nvidia-smi` command.

Intel CPU temperature support is not claimed. AMD GPUs and Intel GPUs are not
supported, and multi-GPU selection is not implemented. This is not a claim of
support for every AMD CPU or NVIDIA GPU.

If `nvidia-smi` is absent or unavailable, the GPU section reports a degraded
state while CPU and RAM monitoring continue. A working `nvidia-smi` is normally
provided by the NVIDIA driver/package managed by the Linux distribution or
system; the desklet does not download external software.

## Settings

The settings panel provides the update interval, UI scale, legend visibility,
and separate colors for CPU/GPU utilization, memory, and temperature lines.

## Installation

The standard Cinnamon Spices installation path is **System Settings →
Desklets → Download**, followed by enabling the desklet from **Manage**. No
custom installer or external download is required.

## Verified environment

The initial release was live-tested on Cinnamon 6.6.9/X11 with an AMD Ryzen 5
5600H, its `k10temp` Tctl sensor, and an NVIDIA RTX 3050 Laptop GPU using
`nvidia-smi`. Other hardware and Cinnamon versions remain unverified.

## License

CPU & GPU Monitor is licensed under GPL-3.0-or-later.
