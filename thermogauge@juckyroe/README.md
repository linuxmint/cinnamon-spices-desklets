# Thermo Gauge

Auto-detected temperature gauges for the Cinnamon desktop. Every `temp*_input` exposed in `/sys` is discovered automatically — pick which sensors to show in desklet settings.

## Install

```bash
./desklets/thermogauge/install.sh
```

Then add it from the desktop: right-click → **Desklets** → **Thermo Gauge**.

## Usage

1. Add the desklet from **Desklets** (right-click desktop → Desklets).
2. Open **Desklet settings → Sensors**.
3. Check **Show** for each sensor you want on the desktop.
4. After hardware changes, toggle **Refresh sensor list now** ON, then OFF.

## Settings

- **Sensors** — choose which temperature sources to display.
- **Visual** — layout, scale, refresh interval, gauge full scale, colors.

## Credits

Developed by juckyroe. Implementation assisted by **Cursor** (Composer 2.5 Fast).

## Publishing

To submit this desklet to Cinnamon Spices (global Download tab), see [PUBLISH.md](PUBLISH.md).
