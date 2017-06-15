# Quote of the Day Cinnamon Desklet #

v0.4.0 - June 4, 2017

This desklet displays a random quote of the day. Left click it to display a new random quote at any time.

## Configuration Options ##

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

## Localization Information ##
Quote of the Day can easily be configured to display quotes in languages other than English.  This desklet
uses `fortune` files (or custom input files, see below) as the source for quotations.  Browse the `fortune`
files that Linux Mint provides by opening the Synaptic Package Manager and typing "fortunes."  Install the 
desired package(s) from there, or, run

`sudo apt-get install fortunes-XX`, where XX is a two letter locale abbreviation.  Be aware, however, that
fortunes may not be available for every locale.

After installing the fortunes-\* package for the desired locale, open the desklet settings and select the new 
fortune file.  Generally this will be found in `/usr/share/games/fortunes/XX` where XX is the two letter
locale abbreviation.

## Input File Format ##

The input file format is the same as that for the classic fortune (`/usr/games/fortune`) program. 
See `/usr/share/games/fortunes` for examples. The format is simply, "a text file with quotations, 
each separated by the character "%" on its own line," as explained on the Wikipedia page. Whitespace 
formatting within the text file is preserved when the quote is displayed.

## Custom Input Files ##

A custom input file may be created simply by typing a set of quotations in to a file following the format
above.  After creating a custom input file, you must also run:
`strfile input_file input_file.dat`
to create the .dat file that `fortune` requires.  The `-c` option of `strfile` allows you to change
the delimiting character, if desired.

A custom input file may also be created by combining existing `fortune` files.  To do so, copy your favorite
fortunes (i. e. `literature` and `riddles`) from `/usr/share/games/fortunes` to your home directory, then
execute following command in your home directory:

`cat literature riddles > myfortunes && strfile myfortunes`

This will create the files `myfortunes` and `myfortunes.dat` in your home directory. Then go to desklet settings
and choose the `myfortunes` file from your home directory.

## TODO ##

Provide a GUI method to change the font.

## Known Issues ##

- The text shadow may not be visible upon reboot until the mouse is hovered over the quote. 
  I'm unsure if this is an error in the desklet, or a problem with Cinnamon.

Comments welcome.

- Jess (tinytinnu [at] gmail [dot] com)
- RavetcoFX (RavetcoFX [at] gmail [dot] [com]
