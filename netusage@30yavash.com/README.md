# Network Usage Desklet

## What it does:

This applet keeps track of your Internet usage.

## How it does it:

The vnstat daemon runs in the background and collects info about your Internet usage.

The applet detects which device you're currently using, and exports a graph using vnstati.

## What you need for it to work:

You need:

  * To install vnstat
  * To install vnstati
  * To have the vnstat daemon running
  * To have vnstat configured for the devices you are using.

Note: In Linux Mint, you can simply run `apt install vnstati` and that will take care of everything for the built in devices. In other distributions it might depend on the way things are packaged but it's likely to be similar.

It is possible to add additional devices, for example a USB Mobile Internet stick. Running `man vnstat` will give some information on how to proceed but beware it is not trivial.

## Use on Distributions other than Mint:

  * The original version assumed the NMClient and NetworkManager libraries were in use as is the case in Mint versions up to 18.3 and most other current distro versions.
  * The latest versions can also switch to the more recent NM library used on some recent distributions such as Fedora 27 and higher.
  * It is possible that you may have to set up vnstati on other distributions - running `man vnstat` will provide information on how to proceed if that is the case.

## Contributors

  * The Desklet is based on an Applet by Clem.
  * The original Author of the Desklet was Siavash Salemi - 28 Sep 2013
  * Translation Support and bug fixes by NikoKrause
  * Network manager selection by Peter Curtis based on a technique by Jason Hicks

