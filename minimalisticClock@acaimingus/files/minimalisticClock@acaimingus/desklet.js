const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const mainloop = imports.mainloop;
const lang = imports.lang;
const uuid = "minimalisticClock@acaimingus";
const GLib = imports.gi.GLib;
const hourFormat = false;

function MinClockDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

MinClockDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

    // Bind settings
    this.settings = new Settings.DeskletSettings(
      this,
      this.metadata["uuid"],
      desklet_id
    );
    this.settings.bind(
      "color-picker",
      "clockColor",
      this._updateTextColor.bind(this)
    );
    this.settings.bind("reset-color-button", null, this.resetColor.bind(this));
    this.settings.bind(
      "12-hour-format",
      "use12hourformat",
      this.changeHourFormat.bind(this)
    );
    this.settings.bind(
      "install-font-button",
      null,
      this.manualFontInstall.bind(this)
    );

    // Initialize the hourFormat based on the setting value
    this.hourFormat = this.use12hourformat || false;

    // Default clock color
    this.clockColor = "#FFFFFF";

    // Try installing the font and initialize Clock
    this.installFont();
    this.setupUI();
  },

  // Method to manually trigger font installation
  manualFontInstall: function () {
    let homeDir = GLib.get_home_dir();
    let markerFilePath =
      homeDir +
      "/.local/share/cinnamon/desklets/minimalisticClock@acaimingus/.font_install_attempted";

    // Remove the marker for installation
    if (GLib.file_test(markerFilePath, GLib.FileTest.EXISTS)) {
      try {
        // Delete the marker file
        GLib.unlink(markerFilePath);
        global.log(
          "MinimalisticClock: Marker file removed. Retrying installation."
        );
      } catch (e) {
        global.logError("MinimalisticClock: Error removing marker file: " + e);
      }
    }

    // Call the actual font installation
    this.installFont();
  },

  // Method to install the bundled font with the clock.
  installFont: function () {
    // Safeguard against install loop if there is an issue with the installation.
    // Uses a marker file to flag an attempted installation attempt, so it will only try once.
    // If it fails, then the user can manually attempt again through desklet settings.

    // Path for marker file
    let homeDir = GLib.get_home_dir();
    let markerFilePath =
      homeDir +
      "/.local/share/cinnamon/desklets/minimalisticClock@acaimingus/.font_install_attempted";

    // Check installation marker
    if (GLib.file_test(markerFilePath, GLib.FileTest.EXISTS)) {
      global.log(
        "MinimalisticClock: Font installation has already been attempted, skipping."
      );
      return;
    }

    // Create marker
    try {
      GLib.file_set_contents(markerFilePath, ".");
    } catch (e) {
      global.logError("MinimalisticClock: Error writing marker file: " + e);
    }

    // Where the font should already be if installed.
    let targetFontPath = "/usr/share/fonts/SUSE.ttf";

    // Check if the font is already installed
    if (GLib.file_test(targetFontPath, GLib.FileTest.EXISTS)) {
      global.log(
        "MinimalisticClock: Font is already installed. No need to copy."
      );
      return;
    }

    // Path for included font
    let fontPath =
      homeDir +
      "/.local/share/cinnamon/desklets/minimalisticClock@acaimingus/SUSE.ttf";

    // Verify if the font file exists before attempting to copy
    if (!GLib.file_test(fontPath, GLib.FileTest.EXISTS)) {
      global.logError("MinimalisticClock: Font file not found at " + fontPath);
      return;
    }

    // Commands to be executed for font install
    let command = ["pkexec", "cp", fontPath, "/usr/share/fonts"];

    global.log("MinimalisticClock: Executing command: " + command.join(" "));

    // Create Subprocess for installing Font
    let subprocess = new Gio.Subprocess({
      argv: command,
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });

    subprocess.init(null);

    // Setup logging and error handling
    subprocess.communicate_utf8_async(null, null, (proc, result) => {
      let [success, stdout, stderr] = proc.communicate_utf8_finish(result);

      // Log the output
      if (stdout && stdout.trim() !== "") {
        global.log("MinimalisticClock: " + stdout.trim());
      }

      // Log the errors
      if (stderr && stderr.trim() !== "") {
        global.logError("MinimalisticClock: " + stderr.trim());
      }

      // Check if the command was successful
      if (success) {
        global.log("MinimalisticClock: Font installed successfully.");

        // Reload Cinnamon
        let restartCommand = ["cinnamon", "--replace"];
        let restartProc = new Gio.Subprocess({
          argv: restartCommand,
          flags:
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });

        restartProc.init(null);
        restartProc.communicate_utf8_async(null, null, (proc, result) => {
          let [success, stdout, stderr] = proc.communicate_utf8_finish(result);
          if (success) {
            // Log the output
            global.log("MinimalisticClock: Cinnamon restarted successfully.");
          } else {
            // Log the errors
            global.logError(
              "MinimalisticClock: Error restarting Cinnamon: " + stderr.trim()
            );
          }
        });
      } else {
        global.logError(
          // This shouldn't happen hopefully, but just in case.
          "MinimalisticClock: Font installation failed. Check permissions or file paths."
        );
      }
    });
  },

  // Method to update the text color from Settings
  _updateTextColor: function () {
    // Default to white if undefined
    let color = this.clockColor || "#FFFFFF"; 
    this.hour1.style = `color: ${color};`;
    this.hour2.style = `color: ${color};`;
    this.min1.style = `color: ${color};`;
    this.min2.style = `color: ${color};`;
  },

  // Method to reset the text color to default
  resetColor: function () {
    // Default color
    this.clockColor = "#FFFFFF";
    this._updateTextColor();
  },

  // Method for handling the switching between 12-hour- and 24-hour-format
  changeHourFormat: function () {
    this.hourFormat = this.use12hourformat;
  },

  // Create clock layout
  setupUI: function () {
    let screenWidth = global.display.get_monitor_geometry(0).width;
    let screenHeight = global.display.get_monitor_geometry(0).height;

    // Calculate font size dynamically based on screen resolution
    // 20% of whichever value is smaller
    let fontSize = Math.min(screenWidth, screenHeight) * 0.2;
    
    // Create main container for items
    this.mainContainer = new St.BoxLayout({
      vertical: true,
    });

    // Create hours layout
    this.hourrow = new St.BoxLayout({ vertical: false });
    this.hour1 = new St.Label({ text: "0", style_class: "grid1" });
    this.hour2 = new St.Label({ text: "0", style_class: "grid1" });
    this.hour1.style = `font-size: ${fontSize}px;`;
    this.hour2.style = `font-size: ${fontSize}px;`;
    this.hourrow.add(this.hour1);
    this.hourrow.add(this.hour2);

    // Create minutes layout
    this.minrow = new St.BoxLayout({ vertical: false });
    this.min1 = new St.Label({ text: "0", style_class: "grid1" });
    this.min2 = new St.Label({ text: "0", style_class: "grid1" });
    this.min1.style = `font-size: ${fontSize}px;`;
    this.min2.style = `font-size: ${fontSize}px;`;
    this.minrow.add(this.min1);
    this.minrow.add(this.min2);

    // Combine hours and minutes
    this.mainContainer.add(this.hourrow);
    this.mainContainer.add(this.minrow);

    // Apply the selected color to the labels
    this._updateTextColor();

    // Calculate the shift dynamically based on the container height
    // 11% of the screen height
    let shiftAmount_y = Math.round(screenHeight * 0.11);
    // 0.2% of the screen width
    let shiftAmount_x = Math.round(screenWidth * 0.002);
    this.minrow.anchor_y = shiftAmount_y;
    this.min2.anchor_x = shiftAmount_x;
    this.hour2.anchor_x = shiftAmount_x;

    // Set the main container as the desklet content
    this.setContent(this.mainContainer);

    // Time functionality
    this.updateTime();
  },

  // Method for updating the time
  updateTime: function () {
    let date = new Date();
    let dateh = date.getHours();
    let datem = date.getMinutes();

    // Handle 12-hour format
    if (this.hourFormat) {
      if (dateh === 0) {
        // Midnight as 12
        dateh = 12; 
      } else if (dateh > 12) {
        // Convert to 12-hour format
        dateh = dateh % 12; 
      }
    }

    // Handle single digit or double digit for hours
    if (dateh < 10) {
      this.hour1.set_text("0");
      this.hour2.set_text(dateh.toString());
    } else {
      this.hour1.set_text(dateh.toString()[0]);
      this.hour2.set_text(dateh.toString()[1]);
    }

    // Handle single digit or double digit for minutes
    if (datem < 10) {
      this.min1.set_text("0");
      this.min2.set_text(datem.toString());
    } else {
      this.min1.set_text(datem.toString()[0]);
      this.min2.set_text(datem.toString()[1]);
    }

    // Refresh every 2 seconds
    // Why 2 seconds? Save some resources while still staying relatively accurate.
    this.timeout = mainloop.timeout_add_seconds(
      2,
      lang.bind(this, this.updateTime)
    );
  },

  // Remove refresh loop when Desklet gets removed
  on_desklet_removed: function () {
    mainloop.source_remove(this.timeout);
  },
};

// main function
function main(metadata, desklet_id) {
  return new MinClockDesklet(metadata, desklet_id);
}
