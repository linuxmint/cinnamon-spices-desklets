# iOS Hardware & Battery Monitor

An **All-in-One Hardware & Bluetooth Battery Monitor** desklet for Cinnamon, inspired by the **iOS / macOS Sonoma Batteries & Activity Monitor** widgets.

![Screenshot](screenshot.png)

## Features

- **Hardware Circular Gauges (Zero external dependencies)**:
  - **CPU**: Real-time usage `%` (`/proc/stat`) and package temperature (`/sys/class/hwmon` — `k10temp`, `coretemp`, `zenpower`, `acpitz`).
  - **RAM**: Memory usage `%` and used/total `GB` (`/proc/meminfo`).
  - **GPU (NVIDIA / AMD / Intel)**: Usage `%`, temperature, and VRAM via native Linux DRM `sysfs` (`gpu_busy_percent`) or non-blocking async `nvidia-smi`.
  - **Cooler / Fan RPM**: Automatic detection of `fan*_input` sensors in `/sys/class/hwmon`.
- **Storage & Network Cards**:
  - **Disk**: Horizontal progress bar with used `%` and free/total `GB`.
  - **Network**: Live Download (`↓`) and Upload (`↑`) throughput on the active interface.
- **iOS-Style Batteries & Bluetooth Monitor**:
  - Combines **UPower (`UPowerGlib`)** and **BlueZ D-Bus (`org.freedesktop.DBus.ObjectManager` / `org.bluez.Battery1`)** to display your laptop battery alongside connected Bluetooth headphones, speakers, mice, keyboards, and gamepads.
  - Custom Cairo vector icons for each device category + charging bolt indicator.
- **Customizable Appearance**:
  - **Dark Glass (macOS Dark)**, **Light Frosted (iOS Light)**, or **Auto** theme mode.
  - Adjustable glass opacity, corner radius, widget scale (`0.75x` – `1.6x`), grid columns, and customizable header title (Device Model, Distro, Hostname, User, or Custom Text).
