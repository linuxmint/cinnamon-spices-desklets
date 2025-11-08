# Translation guidelines

These are intended to provide a little more context to some one- or few-word
entries, as well as guidance for how everything might fit within the space
of the desklet.


## Moon Phases

*Note that changing your system date will update the moon phase accordingly,*
*so you can easily preview these labels.*

### "Full moon", "Waxing Crescent", etc.
These are the eight standard moon phase names.

### "New", "Full", "Half"
These also refer to the Moon and its phases, being simple abbreviations for
"New moon" etc., so please make sure the translation reflects this.
In particular, in the case of most gendered languages, make sure the grammatical
gender of the translated word matches with that of your word for "Moon".
Also note that, unlike the above, these labels really should be kept to a single word
if possible.


## Weather

*Note that, unlike the Moon phases above, there is no easy way to manipulate*
*the weather caption, since it comes directly from WeatherAPI.*
*You can always temporarily hack the source code for testing.*

### "Clear"
This refers to the weather, as in "clear sky", not to other meanings
of the word "clear".

### "Rain"
Note that this word appears in two distinct points of the desklet:
as a weather caption, and as the label to the "Chance of rain" display.
It still refers to its common meaning of "water that falls from the sky" in both cases,
so a unified translation should be possible.

In case this is an irreconcileable problem for your language,
please open an issue or a pull request.

### "Cold Precip."
This is intended to be a shortened version of "Cold precipitations",
as a generic term for hail, sleet, etc., but I preferred to make the two words
have a similar length, hence the abbreviation. You are not required to do the same.


## Short labels

These all appear in the same spot.
It's best to keep each to one short word if possible.

### "Next"
This word refers to the Moon, as in "Next full moon",
so please apply the same guidelines as the moon phases.

### "Limit"
This is intended as in "Time limit", in case it informs your translation.

### "None"
This appears when "Custom countdown" is selected in the configuration
but there is no target date set in the "Data" page.

Also note that same word also appears in the dropdown menu for the "Emoji display"
and "Caption display" settings. If this turns out to be especially jarring for
your language, please open an issue or a pull request.

### "Temp"
This is short for "Temperature".
This is not a hard requirement, but consider keeping to a similar amount of letters.


## Settings

### (W), (C), (D), ...
These must match between the explanation of the requirements and the settings
in the other menus. I suggest just leaving them as they are.

### This uses standard strftime...
This message appears twice in very similar forms, but it's not a duplicate:
their final sentences are actually different.

### Drop shadow
At the cost of maybe pointing out the obvious, "drop shadow" is just
the name of the graphical effect. Nothing is being literally let go of
and falling to the ground. In case of difficulty, please translate as though
this read "Shadow" or "Text shadow".

### "Enabled", "Persistent"
These refer to the target dates you count down to, in case this
guides the choice of grammatical gender for languages where it matters.

### Emoji
One list-type setting has emoji headings to keep it compact.
Please leave the emoji.


## Coherence with Cinnamon

A few messages also appear in default applets, desklets and settings widgets
in Cinnamon, and thus already have "upstream" translations.
It may be best for the translations in this desklet to align with Cinnamon's for
the sake of coherence, if possible.

### "Date and Time Settings"
This string also appears in the Calendar applet.

### "Add new entry" etc.
These tooltips also appear in the "list" settings widget, which is rather uncommon.
For example, Cassia Window List (CassiaWindowList@klangman) uses it multiple times.


## Desklet name

### "Moonlight Clock"
This is the desklet's name. Feel free to add a little poetic license to the
general meaning of the words to make a name that sounds better than a
literal translation, if you feel so inclined.
