# System Temperature Desklet

This desklet displays the temperature of a specific thermal zone on your system. To configure it correctly, you need to specify the path to the thermal zone's temperature file in the desklet settings.

## Finding the Correct Temperature File

1. **Locate Thermal Zones:**

   Thermal zone files are usually located under `/sys/class/thermal/`. You can list them with the command:

   ```bash
   ls /sys/class/thermal/
   ```

2. **Identify the Relevant Thermal Zone:**

   Each thermal_zoneX directory represents a thermal zone. Inside, you'll find a file that contains the temperature data (in millidegrees Celsius).

3. **Set the Path in Desklet Settings:**

   In the desklet settings, specify the full path to the temperature file you want to monitor, such as:

   `/sys/class/thermal/thermal_zone2/temp`

   This will allow the desklet to display the correct temperature for the chosen thermal zone.

## Development

Importent commands for the desklet development:

Open desklets error log:

```bash
 tail -f ~/.xsession-errors
```

Install translation:

```bash
cd ~/.local/share/cinnamon/desklets/devtest-systemTemperature@KopfDesDaemons
cinnamon-json-makepot -i
```
