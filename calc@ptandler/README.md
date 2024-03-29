# Mini-Calculator Desklet based on JavaScript Expressions

Very simple and minimalistic but yet quite powerful calculator that evaluates [JavaScript expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators). The complete power of JS directly at your hand! ;-)

Original repository: [https://github.com/ptandler/cinnamon-spices-desklets](https://github.com/ptandler/cinnamon-spices-desklets/tree/calc%40ptandler/calc%40ptandler)

## Keyboard Input
Keyboard input is available after the desklet was raised to top by the defined shortcut (default SUPER+C, can be changed in the desklet settings).

## Features and Example Expressions

- `1 + 2` = `3`
- `(1 + 2) * (3 + 4)` = `21`
- All functions defined in the [JavaScript `Math` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math) are included using the [`with` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with) (knowing that is not generally recommended using `with` in JS, but I think here it's kind of convenient):
  - `min(1,2)` = `1`
  - `max(1,2)` = `2`
  - `sqrt(16)` = `4`
  - `abs(-1)` = `1`
  - The **trigonometric functions** `sin(), cos(), tan(), asin(), acos(), atan(), and atan2()` expect (and return) angles in radians.
    - Helper functions: `degToRad(180)` = approx. `3.14`, `radToDeg(PI)` = `180`
  - `random()` returns a pseudo-random number between 0 and 1.
  - Euler's constant: `E` = approx. `2.718`
  - `PI` = approx. `3.14159`
- You can define **variables**; this expression will return the assigned value. The variables will keep their value until the desklet is restarted:
  - `a=2` = `2`
- You can use the **comma `,` operator** to evaluate several expressions and return just the value of the last one. Can be used to define variables:
  - `a=2, b=3, a*b`
- For conditional expression you can use the JS `? :` operator, e.g. `1 < 2 ? "that's true" : "no, wrong"`
- You can define **functions**:
  - `fib = (n) => n <= 0 ? 0 : (n <= 1 ? 1 : (fib(n - 1) + fib(n - 2))), fib(7)` = `13`
    CAUTION: Be careful with recursive functions, I'm not sure if there is a timeout for the evaluation of the expression and if it's quite long. So you can crash your desktop if evaluation hangs ... believe me, I tried ;-) 
- You can use all **builtin JavaScript** functions and global objects (available in GJS / CJS), such as `JSON.stringify`

## ToDo: Ideas for Further Development

- [ ] add scrollbar to historyBox if it gets longer _(how does this work with St?)_
- [ ] make max number of history entries configurable & ensure not to store more entries in the list
- [ ] add option to convert locale number format (e.g. `1,23`) to JS notation (i.e. `1.23`) to avoid errors for those used to one of these formats!
- [ ] add button and keyboard shortcut for "copy value to **clipboard**"
- [ ] add icon to open message box for documentation and introduction that **explains some JS expression syntax** (e.g. the examples above)
- [ ] add **translations** (i18n)
- [ ] add option to use the result of current expression as new input when pressing `Enter` key (instead of empty string)
- [ ] add keyboard shortcuts to show / hide history (e.g. Ctrl H)
- [ ] add keyboard shortcuts to navigate in history (e.g. Ctrl arrow up / down) - should also show history if hidden
- [ ] add option to make history persistent and save last N entries it to some sensible place (where? settings?)
- [ ] add option to clear history
- [ ] add option to turn off to use `JSON.stringify()` to display results

## Changelog

### version 0.2, 2021-12-08

- [x] add expression & result **history** as dropdown with scrollbar (on pressing "enter" + put result as input text and place cursor & focus)
- [x] add action copy input or result from history to current expression (by click) 

### version 0.1, 2021-09-21

- initial version: just simple evaluation 

## Development Hints

This is the first desklet and also first Gnome app I developed. It was a bit tricky for me to find helpful documentation. Here some things that were helpful for me.

### Gnome

Kind of useful Documentation:

- [Gnome developer documentation](https://developer.gnome.org/documentation/introduction.html)
- [Gnome GTK API 4.0 documentation](https://docs.gtk.org/gtk4/#classes)
- [Gnome's St widget library](https://gjs-docs.gnome.org/st10~1.0_api/) and the doc of [St's JS binding](https://www.roojs.com/seed/gir-1.2-gtk-3.0/seed/St.html)
- [Introduction to Gnome JS (GJS) extensions](https://gjs.guide/extensions/overview/anatomy.html#prefs-js) in general
- https://gjs.guide/guides/gtk/3/ Gtk / GJS Guide

### Cinnamon

- source can be directly put in .local/share/cinnamon/uuid (where `uuid` is the UUID of you desklet)
- use `Cinnamon Looking Glass` ("Melange") to
    - reload code after changes!! (tab "Extension")
    - see log messages
- I had to restart Cinnamon in order to get the CSS reloaded, not sure if there is another possibility.
- The directory of the desklets listed on https://cinnamon-spices.linuxmint.com/ is based on https://github.com/linuxmint/cinnamon-spices-desklets
- The [scollin's developer's tools desklet](https://cinnamon-spices.linuxmint.com/desklets/view/17) is quite helpful!

#### Documentation:

- [A bit too short introduction in writing Cinnamon desklets](http://www.erikedrosa.com/2014/12/31/hello-world-desklet-tutorial.html)
- Cinnamon-specific tutorials https://projects.linuxmint.com/reference/git/cinnamon-tutorials/
- https://nickdurante.github.io/development/Writing-a-Cinnamon-Applet/
- https://github.com/gustavo-iniguez-goya/arpsentinel-applet/wiki/Collaborating-and-resources
  - "Read the source code (very useful): /usr/share/cinnamon/js/ui/"
- [Source of the Cinnamon docs](https://github.com/linuxmint/cinnamon/tree/master/docs/reference)
  - but also as [MarkDown version here](https://github.com/linuxmint/linuxmint.github.io/tree/master/reference/git) ... is this generated from the above?
