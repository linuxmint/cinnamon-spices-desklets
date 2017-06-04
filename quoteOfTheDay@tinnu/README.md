# Quote of the Day Cinnamon Desklet #

v0.4.0 - June 4, 2017

This desklet displays a random quote of the day. Left click it to display a new random quote at any time.

## Configuration options ##

The following options are configurable via the Cinnamon Desklet GUI by right clicking "Quote of the Day desklet" 
and choosing Configure.

- Input file — see below for details on file format
- How frequently to display a new quote, from once a minute to once a day
- Font size
- Font color
- Font shadow (size, color, and blur)

By default, the font should come from the active theme. However, changes to the font face can be made 
by editing the stylesheet.css file. Add a line to the existing `.quote-container` element such as: 
`font-family: "Times New Roman";`

**Important**: Cinnamon may need to be restarted and/or the desklet may need to be removed and re-added 
for this change to take effect. 

## Input file format ##

The input file format is the same as that for the classic fortune (`/usr/games/fortune`) program. 
See `/usr/share/games/fortunes` for examples. The format is simply, "a text file with quotations, 
each separated by the character "%" on its own line," as explained on the Wikipedia page. Whitespace 
formatting within the text file is preserved when the quote is displayed.

After creating a custom input file, you must also run:
`strfile input_file input_file.dat`
to create the .dat file that `fortune` requires.  The `-c` option of `strfile` allows you to change
the delimiting character, if desired.

## TODO ##

Provide a GUI method to change the font.

## Known Issues ##

- The text shadow may not be visible upon reboot until the mouse is hovered over the quote. 
  I'm unsure if this is an error in the desklet, or a problem with Cinnamon.

Comments welcome.

- Jess (tinytinnu [at] gmail [dot] com)
- RavetcoFX (RavetcoFX [at] gmail [dot] [com]
