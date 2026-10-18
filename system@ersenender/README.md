# System

Shows the CPU load with a history curve, the temperatures of processor and graphics card, the fan speed, the free space on the system disk and the free memory - and which process currently uses the most CPU time and the most memory. Temperature and disk space turn red at thresholds you choose; a nearly full system disk can also raise a notification. The tooltips add uptime, load averages and swap usage.

Almost everything is read from `/proc` and `/sys` (hwmon). For the top consumers the desklet starts `top` briefly every few seconds (can be switched off); `nvidia-smi` is only called when an NVIDIA card is present. Rows the computer does not report (fan, graphics temperature) are hidden.

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/system@ersenender/po/system@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/system@ersenender/COPYING`.
