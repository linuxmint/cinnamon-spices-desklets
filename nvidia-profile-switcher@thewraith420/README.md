# Nvidia Profile Switcher Desklet

A Cinnamon desklet for easily switching between Nvidia Prime profiles on Linux systems with hybrid graphics.

![Nvidia Profile Switcher Screenshot](screenshot.png)

## Features

- **Quick Profile Switching**: Switch between Intel (Power Saving), Hybrid (On-Demand), and Nvidia (Performance) modes
- **Visual Mode Indicator**: See your current graphics mode at a glance with icons and text
- **Customizable Layout**: Choose between horizontal or vertical layouts
- **Custom Icons**: Use system icons or emoji, with adjustable sizes
- **Accent Colors**: Customize the color scheme to match your desktop
- **Font Size Options**: Small, Medium, or Large text sizes
- **Reboot Management**: Choose to reboot immediately or later, with configurable countdown timer
- **Smart Dialogs**: Option to skip confirmation dialogs for faster switching

## Requirements

- Linux Mint or any Linux distribution running Cinnamon desktop
- Nvidia Prime capable hardware (laptop with Intel + Nvidia hybrid graphics)
- `prime-select` utility installed (usually comes with Nvidia drivers)
- `pkexec` or `sudo` for privilege elevation

## Installation

### From Cinnamon Applets Website (Recommended)
1. Right-click on your desktop
2. Select "Add Desklets"
3. Go to "Download" tab
4. Search for "Nvidia Profile Switcher"
5. Click "Install"

### Manual Installation
1. Download the latest release
2. Extract to `~/.local/share/cinnamon/desklets/`
3. Install the custom icons:
```bash
sudo cp icons/*.svg /usr/share/icons/hicolor/scalable/apps/
sudo gtk-update-icon-cache /usr/share/icons/hicolor/
```
4. Restart Cinnamon (Alt+F2, type 'r', press Enter)
5. Right-click desktop → Add Desklets → Select "Nvidia Profile Switcher"

## Configuration

Right-click the desklet and select "Configure" to access settings:

### Visual Settings
- **Layout**: Horizontal or Vertical orientation
- **Accent Color**: Customize highlight and border colors
- **Font Size**: Small, Medium, or Large
- **Show Mode Indicator**: Display current mode icon and text
- **Show Profile Names**: Display Intel/Hybrid/Nvidia labels
- **Show Descriptions**: Display Power Saving/Hybrid/Performance text
- **Use System Icons**: Toggle between system icons and emoji

### Icon Settings
- **Icon Size**: Adjust profile button icon size (16-48px)
- **Mode Indicator Icon Size**: Adjust status icon size (16-48pt)
- **Mode Indicator Text Size**: Adjust status text size (5-12pt)
- **Custom Icons**: Specify icon names for each profile

### Behavior Settings
- **Reboot Delay**: Countdown timer duration (5-120 seconds)
- **Skip Confirmation Dialog**: Enable one-click switching
- **Reboot Method**: Choose systemctl, reboot command, or shutdown

## Usage

1. Click on a profile button to switch modes
2. Choose whether to reboot now or later
3. If rebooting now, a countdown will appear with cancel option
4. Profile changes take effect after reboot/logout

## Troubleshooting

### Desklet doesn't appear
- Make sure you've restarted Cinnamon after installation
- Check that the icons are installed correctly
- Verify `prime-select` is available: `which prime-select`

### Password prompt doesn't appear
- The desklet will fall back to terminal-based sudo if GUI prompt fails
- Ensure `pkexec` is installed and configured

### Icons don't display
- Run: `sudo gtk-update-icon-cache /usr/share/icons/hicolor/`
- Restart Cinnamon
- Check that icon files exist in `/usr/share/icons/hicolor/scalable/apps/`

### Profile doesn't switch
- Manually test: `sudo prime-select intel`
- Check system logs: `journalctl -xe | grep prime`
- Ensure you have proper permissions for prime-select

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues on GitHub.

## License

This project is licensed under the GPL-3.0 License - see the LICENSE file for details.

## Credits

Created by thewraith420

Special thanks to the Cinnamon development team and the Linux Mint community.

## Changelog

### Version 1.0.0 (Initial Release)
- Profile switching with Intel, Hybrid, and Nvidia modes
- Customizable layout and appearance
- Configurable reboot countdown
- System icon support with custom hybrid mode icon
- Multiple reboot methods
- Skip confirmation option
