# Systemd Service Status

A desklet that continuously shows the status of the systemd services you choose, each with a colored dot.

| Color | State (`ActiveState`) |
|---|---|
| Green | `active` (running, exited…) |
| Grey | `inactive` (stopped) |
| Red | `failed` |
| Amber | `activating`, `deactivating`, `reloading` |
| Purple | the unit does not exist or could not be queried |

## Configuration

Right-click the desklet → **Configure…**

- **Services**: a table with one row per unit. `nginx`, `nginx.service`, `docker.socket`, `backup.timer`… are all valid. Tick **User unit** for `systemctl --user` units (e.g. `pipewire.service`).
- Title, refresh interval, font and dot size, show the sub-state.
- Color of each state.
- Terminal used when clicking a service.

## Usage

- **Hover** a service: description and full state.
- **Left-click**: opens a terminal with `systemctl status` for that service.
- **Right-click → Refresh now**: forces a query.

## Notes

- No root needed: `systemctl show` is read-only.
- It makes a single asynchronous `systemctl` call per group (system/user) on each refresh, so the desktop never blocks, even with many services.
- Errors are logged to **Looking Glass** (`Alt+F2` → `lg` → *Log* tab) with the `[systemd-status]` prefix.
