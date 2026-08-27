# World Clock

A Cinnamon desklet that shows a grid of clocks, each with its own name and timezone.

Left-click does nothing. Click the trailing **+** tile to add a clock. Right-click a tile to edit or remove it. Clocks set to the system timezone (`local`) are outlined.

![World Clock desklet](screenshots/world-clock-desklet.webp)

The settings window:

![World Clock settings](screenshots/world-clock-config.webp)

## Why this exists

Good world clock apps are hard to find. On any OS. The good ones live on your phone, or they bury the feature under menus, or they insist on taking over your system timezone.

I wanted the opposite. A glance at my desktop to see what time it is where my colleagues and partners are, all over the world, without touching my own clock. A grid of clocks, one per timezone, always visible. Nothing more.

That's what this desklet is.

## Features

- Auto (near-square) or fixed rows × columns
- Searchable timezone list (IANA zones plus Local)
- Shared time/date formats; font sizes are maximums and each tile scales down to fit
- Last clock cannot be removed
- Optional confirmation before removing a named clock
- Layout, spacing, and size are configured from Cinnamon Desklet settings

## Configuration

Right-click the desklet to **Configure…**

- **Grid layout mode**: auto or fixed rows/columns
- **Allow adding, removing and editing clocks**: turn off for a read-only grid
- **Show a "+" tile**: hide the add tile while keeping the right-click menu
- **Time / date format**: `strftime` patterns (for example `%H:%M` or `%I:%M %p`)
- **Maximum font sizes**: time, date, and label; tiles shrink so nothing overflows
- **Tile spacing** and **desklet width / height**

## Notes

This is a desktop **desklet**, not the panel [World Clock Calendar](https://cinnamon-spices.linuxmint.com/applets/view/108) applet. It can run next to that applet; they do not share settings.

UUID: `cinnamon-world-clock-desklet@curbsoftware`

Derived from [TimeAndDate@nightflame](https://cinnamon-spices.linuxmint.com/desklets/view/9).

## License

GNU General Public License v2.0 or later. See [LICENSE](LICENSE).
