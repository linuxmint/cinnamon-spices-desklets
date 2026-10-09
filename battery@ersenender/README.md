# Battery

Shows the charge level of the laptop battery as a percentage, as a small battery graphic or both, with the charging state and the remaining time.

- **Battery details**: manufacturer and model of the installed battery, technology, health (current capacity compared with the design capacity), charge cycles and the charge limit of the device, as far as the battery reports them.
- **Warning**: below a threshold you choose the value turns red and the desklet asks you to plug in the charger.
- **Battery care** (optional): reminds you to unplug the charger at an upper limit (default 80%) and to charge at a lower limit (default 30%); both limits are marked in the graphic. It only reminds - it does not change how the device charges. If the device keeps a charge limit itself, that limit is shown instead.
- Optionally a notification when a limit is crossed.

The data comes from `/sys/class/power_supply`; on a computer without a battery the desklet only says so.

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/battery@ersenender/po/battery@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/battery@ersenender/COPYING`.
