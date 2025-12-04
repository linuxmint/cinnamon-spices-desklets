
# Time and Date Desklet

This is a simple customizable desklet to display the time and date. The format of the time and date are configurable through desklet settings. 

### Customization

You can customize this desklet to your taste. Change yours fonts, colors, sizes and more. Check out the different options.

### How to configure it:

The time and date format are from the JavaScript `toLocaleFormat` function, and the possible values can be found at:

http://pubs.opengroup.org/onlinepubs/007908799/xsh/strftime.html 

For example to change time format to HOURS:MINUTES:SECONDS use `%H:%M:%S`. Also, you may use any normal characters between special formatting characters like `%H text %M`, which would render as ex. `14 text 50` at 14:50. 

### Tips
- You can add multiple desklets by clicking the "+" icons in your desklet manager.
- You can backup your desklets by going to the settings. There you should find an icon in the top right corner. Select the Export to a file option or import to load your backup.


### Remarks

This desklet was originally made by @nightflame. At the time of writing, this desklet had not been updated for years. I decided to heavily modernize it, because it was lacking in functionality compared with newer desklets.