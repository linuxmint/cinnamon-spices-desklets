# Victron Energy Monitor

A Cinnamon desklet for monitoring Victron solar/battery systems via MQTT from Cerbo GX.

## Features

- Real-time battery state of charge with color-coded gauge (green/yellow/red)
- Solar production display with animated sun icon
- Home consumption display
- Battery charging/discharging indicator with power flow
- Time estimate to full or empty
- Car-dashboard style interface with glow effects

## Requirements

- Victron Cerbo GX device on your local network
- MQTT enabled on Cerbo GX (enabled by default)
- `mosquitto-clients` package:

```bash
sudo apt install mosquitto-clients
```

## Configuration

After adding the desklet, right-click and select "Configure..." to set:

| Setting | Description |
|---------|-------------|
| Cerbo GX hostname | Hostname or IP of your Cerbo GX (e.g., `cerbo.local`) |
| VRM Portal ID | Your VRM Portal ID (found in Cerbo GX settings or VRM portal) |
| Battery capacity | Total battery capacity in Wh (used for time estimates) |
| Display refresh interval | How often to update the display |
| MQTT keepalive interval | How often to send keepalive to Cerbo GX |

### Finding your VRM Portal ID

1. Log into [VRM Portal](https://vrm.victronenergy.com/)
2. Go to your installation
3. The Portal ID is shown in the URL or in Settings > General

Or on Cerbo GX: Settings > VRM online portal > VRM Portal ID

## MQTT Topics

The desklet subscribes to `N/{PORTAL_ID}/#` and parses:

| Data | Topic Pattern |
|------|---------------|
| Battery SOC | `system/*/Dc/Battery/Soc` |
| Consumption | `*/ConsumptionOnOutput/L1/Power` |
| Battery power | `battery/*/Dc/0/Power` |
| Solar power | `system/0/Dc/Pv/Power` |

## Troubleshooting

**No data showing:**
- Verify Cerbo GX is reachable: `ping cerbo.local`
- Test MQTT connection: `mosquitto_sub -h cerbo.local -t "N/+/#" -v`
- Check Portal ID matches your Cerbo GX

**Desklet not loading:**
- Check Looking Glass for errors: Alt+F2 > `lg` > Errors tab
