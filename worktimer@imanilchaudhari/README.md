# Work Timer

A Cinnamon desklet for tracking your work session with automatic reminders as time runs out.

## Features

- Countdown clock showing remaining work time (HH:MM or HH:MM:SS)
- Progress bar that shrinks and changes colour as time runs out — green → amber → orange → red
- Desktop notifications at fixed milestones: 1 hour, 30 min, 15 min, 5 min, 1 min remaining
- Optional periodic reminders on a configurable interval
- Optional sound alert on each reminder using built-in system sounds
- Start, Pause, and Reset controls

## Settings

| Setting | Description |
|---|---|
| Working hours | Length of your work session (1–16 hours) |
| Reminder interval | How often to receive periodic reminders (5, 15, 30, or 60 min) |
| Show seconds | Toggle seconds display on the clock |
| Play sound on reminders | Enable or disable audio alerts |
| Reminder sound | Choose from a set of built-in system sounds |

## Installation

Install via the Cinnamon Desklets manager (right-click desktop → Add Desklets), or manually:

```bash
cp -r files/worktimer@imanilchaudhari ~/.local/share/cinnamon/desklets/
```

Then reload Cinnamon (Alt+F2 → `r` → Enter) and add the desklet from the desklets manager.

## Author

[imanilchaudhari](https://github.com/imanilchaudhari)
