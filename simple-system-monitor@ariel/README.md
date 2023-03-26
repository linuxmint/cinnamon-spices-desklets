# Simple System Monitor
Shows some system status values.
* CPU usage
* Memory usage
* Network utilization (Download, Upload)
* Temperature (CPU, GPU)

## Dependencies
This extension requires [libgtop](https://developer.gnome.org/libgtop/stable) in order to function.

## Instructions
To install dependencies:
* Debian GNU/Linux, Ubuntu, and derivatives:
    `sudo apt install gir1.2-gtop-2.0 libgtop2-dev`
* Fedora and derivatives:
    `sudo dnf install libgtop2 libgtop2-devel`
* Arch and derivatives:
    `sudo pacman -S libgtop`

You will have to **restart the shell** (`Alt + F2` &rarr; `r`) **after installing** the dependencies.

### For customizing the font, if the new font selection is invalid, the field will be reset to empty once closed.
### Valid fonts will update the desklet immediately.
