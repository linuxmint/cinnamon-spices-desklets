The desklet is based on Network usage monitor applet from clem.

**How it does it:**

The vnstat daemon runs in the background and collects info about your Internet usage.

The applet detect which device youre currently using, and simply export a graph using vnstati.

**What you need for it to work:**

You need:
* To install vnstat
* To install vnstati
* To have the vnstat daemon running

Note: In Linux Mint, you can simply run `apt install vnstati` and that will take care of everything. In other distributions it might depend on the way things are packaged but its likely to be similar.

*-Siavash Salemi*