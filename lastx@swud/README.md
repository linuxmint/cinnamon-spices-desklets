<<<<<<< HEAD
# LastfmNowPDesklet
=======
# Last.fm Desklet for Cinnamon

A **Cinnamon Desklet** that fetches and displays your currently playing or last listened track from **Last.fm**, including:

-  **Song Title**
-  **Artist Name**
-  **Album Cover**
- **Timestamp (Last Played)**

## Features
- Automatically fetches the latest played track from Last.fm
- Displays song details in a stylish overlay
- Updates at a configurable interval
- Fetches and sets the album art as the desklet's background
- Lightweight and simple to use

## Installation
1. **Download** the desklet files and place them in your Cinnamon desklet directory:
   ```sh
   ~/.local/share/cinnamon/desklets/lastx@swud/
   ```
2. **Enable** the desklet:
   - Right-click on the desktop → Add Desklets
   - Find **Last.fm Stats** and add it to your desktop
3. **Configure Settings**:
   - Open desklet settings
   - Enter your **Last.fm username**
   - Adjust the **update interval** if needed

## Configuration
The desklet uses a **settings-schema.json** file for easy customization:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `lastfm_user` | String | `""` | Your Last.fm username |
| `update_interval` | Number | `60` | How often to fetch updates (in seconds) |

## Dependencies
This desklet requires **GNOME Shell** and Cinnamon's **Desklet API**. Ensure Cinnamon and its components are installed.

## Troubleshooting
- If the desklet does not update:
  - Check that your Last.fm username is correctly set
  - Increase the update interval if requests are failing
  - Ensure you have an active internet connection

>>>>>>> cd96aff (v1)
