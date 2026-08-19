# Color Timer Clock

A Cinnamon desklet with three cards — **Clock**, **Timer** and **Chronometer** — whose background colors follow a schedule you define. Each card's color ramps between (time, color) stops: the clock by time of day wrapping over midnight, the timer by time remaining, the chronometer by time elapsed.

![Color Timer Clock desklet](screenshot.png)

## Features

- Up to three side-by-side cards; show or hide each one
- Per-card color schedules with smooth (interpolated) or stepped transitions
- Clock card with an optional IANA timezone
- Timer with on-card play/pause, reset and ±60 s buttons; survives restarts and expires correctly even after downtime
- Chronometer with pause/resume; the accumulated time survives restarts, and an optional hundredths display (20 updates/s while running)
- Text and border colors adapt to the card background for readability (WCAG contrast ratio)
- Tooltips on every card control
- One-click "Reset all schedules to defaults"

## Configuration

Right-click the desklet → **Configure…**

- **Color schedules** — a list of (time, color) stops per card. Colors are hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or a name (`red`, `blue`, …). Duplicate times keep the last row; invalid rows are dropped with a log line
- **Smooth color transitions** — blend gradually between stops, or hold each color and jump at the next stop
- **Timer minutes / seconds** — the default duration the timer restarts from
- **Show hundredths of a second** — adds a `.ss` fraction to the chronometer while it runs
- **Time / date format** — `strftime` patterns for the clock card
- **Maximum font sizes, card spacing, desklet width / height** — cards shrink text to fit

## Notes

Colors interpolate piecewise-linearly in RGB, so a red→blue ramp passes through purple. The clock schedule wraps over midnight; timer and chronometer schedules hold the last stop's color beyond it. Cards share the desklet width and each needs about 130 px — when the width cannot fit them all, the chronometer and then the timer hide automatically (a note is logged) and return when the desklet is widened.

UUID: `cinnamon-color-timer-clock-desklet@curbsoftware`

## License

GNU General Public License v2.0 or later. See [LICENSE](LICENSE).
