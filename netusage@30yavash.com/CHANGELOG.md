# Change log since pdcurtis became involved
## 1.0.4
  * Extend number of choices of vnstati formats
  * Update CHANGELOG.md and README.md
## 1.0.3
  * Add desklet_id to various functions and enable multiple instances
  * Add Configure (settings-schema.json) to applet
  * Provide options to choose different vnstati formats including a user specified format
  * Tidy code to remove trailing spaces
  * Change Icon to be unique and have better affordance
  * Add CHANGELOG.md and Update README.md
## 1.0.2
  * Significant change to code to identify device as old code failed under Cinnamon 4.0
    - New code is identical to that used in applets vnstat@linuxmint.com and netusagemonitor@pdcurtis
  * Change "author" to "pdcurtis"
## 1.0.1
  * Changes for Cinnamon 4.0 and higher to avoid segfaults when old Network Manager Library is no longer available by using multiversion with folder 4.0 - Issues #2094 and #2097
  * Remove Try-Catch as no longer required in 4.0 and associated changes.
  * It is believed that all Distributions packaging Cinnamon 4.0 have changed to the new Network Manager Libraries
## 1.0.0
  * Changes to check which network manager libraries are in use and choose which to use - addresses/solves issue #1647 with Fedora versions 27 and higher.
  * Update README.md

