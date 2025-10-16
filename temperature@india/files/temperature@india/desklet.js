const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const PopupMenu = imports.ui.popupMenu;


const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["temperature@india"].path;

const HOME_DIR = GLib.get_home_dir();
// As in kernel 6.16 old temperature methods not working, 
// lm_sensores code is taken from temperature@fevimu applet.

const sensorRegex = /^([\sA-z\w]+[\s|:|\d]{1,4})(?:\s+\+)(\d+\.\d+)°[FC]|(?:\s+\()([a-z]+)(?:[\s=+]+)(\d+\.\d)°[FC],\s([a-z]+)(?:[\s=+]+)(\d+\.\d)/gm;
const cpuIdentifiers = ['Tctl', 'CPU Temperature'];
/*
const _ = function(str) {
    let translation = Gettext.gettext(str);
    if (translation !== str) {
        return translation;
    }
    return Gettext.dgettext(UUID, str);
}
*/

function getImage(imageFileName) {
    let pixBuf = GdkPixbuf.Pixbuf.new_from_file(imageFileName);
    let image = new Clutter.Image();
    image.set_data(
        pixBuf.get_pixels(),
        pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
        pixBuf.get_width(),
        pixBuf.get_height(),
        pixBuf.get_rowstride()
    );

    let actor = new Clutter.Actor({ width: pixBuf.get_width(), height: pixBuf.get_height() });
    actor.set_content(image);

    return actor;
}


function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}


function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        // set images
        this.bar_img = "mercury.svg";
        this.bg_img = "thermometer.svg";
        this.thermometer_bg = getImage(DESKLET_ROOT + "/img/" + this.bg_img);
        this.thermometer_fg = getImage(DESKLET_ROOT + "/img/" + this.bar_img);
        this.thermometer_fg.set_position(23,30);
        this.thermometer_fg.set_width(4);
        this.thermometer_fg.set_height(400);

        // container for subelements (icon, label)
        this.containerThermometer = new St.Group();


        // label for percent string
        this.labelTemp = new St.Label({ style_class: "text" });
        this.labelTemp.set_text("°C");
        this.labelTemp.style = "font-size:10px;"
        this.labelTemp.set_position(10, 510);

        // add actor
        //this.thermometer_bg.remove_all_children();
        this.containerThermometer.add_actor(this.thermometer_bg);
        this.containerThermometer.add_actor(this.thermometer_fg);
        this.containerThermometer.add_actor(this.labelTemp);
        this.setContent(this.containerThermometer);



        this.lang = {
            acpi: 'ACPI Adapter',
            pci: 'PCI Adapter',
            virt: 'Virtual Thermal Zone'
        };
        this.statusLabel = new St.Label({
            text: '--',
            style_class: 'temperature-label'
        });

        this.isLooping = true;
        this.waitForCmd = false;

        this.sensorsPath = null;
        Util.spawn_async(['which', 'sensors'], Lang.bind(this, this._detectSensors));

        //this.updateTemperature();
        //this.loopId = Mainloop.timeout_add(5000, () => this.updateTemperature()); 
        //this.setHeader("Thermometer");
        // start update cycle

        //this.setupUI();
    },

    _detectSensors: function(ret) {
        // detect if sensors is installed
        if (ret != "") {
            this.sensorsPath = ret.toString().split('\n', 1)[0]; // find the path of the sensors
            this.labelTemp.set_text(this.sensorsPath+"°C");
            //this.updateTemperature();
            this.loopId = Mainloop.timeout_add(1000, () => this.updateTemperature()); 
        } else {
            this.sensorsPath = null;
            this.labelTemp.set_text("Please install lm-sensores");

        }


    },

    updateTemperature: function() {
        //this.labelTemp.set_text("Update Temperature  °C"+this.sensorsPath);
        if (!this.isLooping) {
            return false;
        } 

        if (this.sensorsPath && !this.waitForCmd) {
            //this.labelTemp.set_text("sensore spawn °C");
            this.waitForCmd = true;
            Util.spawn_async([this.sensorsPath], Lang.bind(this, this._updateTemperature));
        }

        return true;
    },


    _updateTemperature: function(sensorsOutput) {
        //this.labelTemp.set_text("Update Temperature processing °C");
        let items = [];
        let tempInfo = null;
        let temp = 0;

        if (sensorsOutput != "") {
            tempInfo = this._findTemperatureFromSensorsOutput(sensorsOutput.toString()); //get temperature from sensors
        }

        if (tempInfo) {
            let critical = 0;
            let high = 0;
            let packageIds = 0;
            let packageCount = 0;
            let s = 0;
            let n = 0; //sum and count
            this.labelTemp.set_text("Processing  °C"+tempInfo.length);


            for (let i = 0; i < tempInfo.length; i++) {
                this.labelTemp.set_text("Processing  loop "+i);

                if (tempInfo[i].label.indexOf('Package') > -1) {
                    critical = tempInfo[i].crit ? tempInfo[i].crit : 0;
                    high = tempInfo[i].high ? tempInfo[i].high : 0;
                    packageIds += tempInfo[i].value;
                    this.labelTemp.set_text(tempInfo[i].value+" °C");
                    packageCount++;
                } else if (tempInfo[i].label.indexOf('Core') > -1) {
                    s += tempInfo[i].value;
                    this.labelTemp.set_text(tempInfo[i].value+" °C");
                    n++;
                }
                if (cpuIdentifiers.indexOf(tempInfo[i].label) > -1) {
                    temp = tempInfo[i].value;
                    this.labelTemp.set_text(tempInfo[i].value+" °C");
                }
                //items.push(tempInfo[i].label + ': ' + this._formatTemp(tempInfo[i].value));
                this.labelTemp.set_text(tempInfo[i].value+" °C");
                this.labelTemp.set_position(60, (100-tempInfo[i].value)*4 );
                this.thermometer_fg.set_position(23,(100-tempInfo[i].value)*4 );
                this.thermometer_fg.set_height(tempInfo[i].value*4 );
            }
            /*
            if (high > 0 || critical > 0) {
                items.push("");
                items.push(_("Thresholds Info") + ":")
                if (high > 0) items.push("  " + _("High Temp") + ': ' + this._formatTemp(high));
                if (critical > 0) items.push("  " + _("Crit. Temp") + ': ' + this._formatTemp(critical));
            }
            if (packageCount > 0) {
                temp = packageIds / packageCount;
            } else if (n > 0) {
                temp = s / n;
            }
            let label = this._formatTemp(temp);
       
            if (this.state.changeColor === false) this.state.onlyColors = false;
            if (critical && temp >= critical) {
                this.title = (this.isHorizontal === true && this.state.onlyColors === false) ? _('Critical') + ': ' + label : this._formatTemp(temp, true);
                this.actor.style = (this.state.changeColor === true) ? "background: FireBrick;" : "background: transparent;";
            } else if (high && temp >= high) {
                this.title = (this.isHorizontal === true && this.state.onlyColors === false) ? _('High') + ': ' + label : this._formatTemp(temp, true);
                this.actor.style = (this.state.changeColor === true) ? "background: DarkOrange;" : "background: transparent;";
            } else {
                this.title = this._formatTemp(temp, true);
                this.actor.style = "background: transparent;";
            } */
        }
/*
        if (!tempInfo || !temp) {
            // if we don't have the temperature yet, use some known files
            tempInfo = this._findTemperatureFromFiles();
            if (tempInfo.temp) {
                this.title = this._formatTemp(tempInfo.temp, true);
                items.push(_('Current Temperature') + ': ' + this._formatTemp(tempInfo.temp));
                if (tempInfo.crit) {
                    items.push(_('Critical Temperature') + ': ' + this._formatTemp(tempInfo.crit));
                }
            }
        } */

        this.waitForCmd = false;

        return true;
    },


    _findTemperatureFromSensorsOutput: function(txt) {
        let match;
        let entries = [];
        while ((match = sensorRegex.exec(txt)) !== null) {
            if (match.index === sensorRegex.lastIndex) {
                sensorRegex.lastIndex++;
            }
            let entry = {};
            for (let i = 0; i < match.length; i++) {
                if (!match[i]) {
                    continue;
                }
                if (i % 2) {
                    match[i] = match[i].trim();
                    if (match[i].indexOf(':') > -1) {
                        entry.label = match[i].replace(/:/, '').trim();
                    }
                } else {
                    match[i] = parseFloat(match[i].trim());
                    if (isNaN(match[i])) {
                        continue;
                    }
                    if (match[i - 1].indexOf(':') > -1) {
                        entry.value = match[i];
                    } else if (entries.length > 0 && entries[entries.length - 1].value) {
                        entries[entries.length - 1][match[i - 1]] = match[i];
                    } else {
                        continue;
                    }
                }
            }
            if (!entry.label || !entry.value) {
                continue;
            }
            if (entry != {}) entries.push(entry);
        }
        return entries;
    },
/*
    _findTemperatureFromFiles: function() {
        let info = {};
        let tempFiles = [
            // hwmon for new 2.6.39, 3.x linux kernels
            '/sys/class/hwmon/hwmon0/temp1_input',
            '/sys/devices/platform/coretemp.0/temp1_input',
            '/sys/bus/acpi/devices/LNXTHERM:00/thermal_zone/temp',
            '/sys/devices/virtual/thermal/thermal_zone0/temp',
            '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_input',
            // old kernels with proc fs
            '/proc/acpi/thermal_zone/THM0/temperature',
            '/proc/acpi/thermal_zone/THRM/temperature',
            '/proc/acpi/thermal_zone/THR0/temperature',
            '/proc/acpi/thermal_zone/TZ0/temperature',
            // Debian Sid/Experimental on AMD-64
            '/sys/class/hwmon/hwmon0/device/temp1_input'
        ];
        for (let i = 0; i < tempFiles.length; i++) {
            if (GLib.file_test(tempFiles[i], 1 << 4)) {
                let temperature = GLib.file_get_contents(tempFiles[i]);
                if (temperature[0]) {
                    info.temp = parseInt(temperature[1]) / 1000;
                    break;
                }
            }
        }
        let critFiles = [
            '/sys/devices/platform/coretemp.0/temp1_crit',
            '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_crit',
            // hwmon for new 2.6.39, 3.0 linux kernels
            '/sys/class/hwmon/hwmon0/temp1_crit',
            // Debian Sid/Experimental on AMD-64
            '/sys/class/hwmon/hwmon0/device/temp1_crit'
        ];
        for (let i = 0; i < critFiles.length; i++) {
            if (GLib.file_test(critFiles[i], 1 << 4)) {
                let temperature = GLib.file_get_contents(critFiles[i]);
                if (temperature[0]) {
                    info.crit = parseInt(temperature[1]) / 1000;
                }
            }
        }
        return info;
    },


    _toFahrenheit: function(c) {
        return 9 / 5 * c + 32;
    },

    _formatTemp: function(t, line_feed = false) {
        let precisionDigits;
        precisionDigits = this.state.onlyIntegerPart ? 0 : 1;
        let value;
        let unit = "";
        let separator = "";
        if (this.state.showUnit) {
            unit = "°";
            separator = (this.isHorizontal || !line_feed) ? " " : (this.state.showUnitLetter) ? "\n" : "";
        } else if (!line_feed) {
            separator = " ";
            unit = "°";
        }

        if (this.state.useFahrenheit) {
            if (this.state.showUnit && this.state.showUnitLetter) unit = "°F";
            value = (
                this._toFahrenheit(t)
                .toFixed(precisionDigits)
                .toString()
            );
        } else {
            if (this.state.showUnit && this.state.showUnitLetter) unit = "°C";
            value = ((Math.round(t * 10) / 10)
                .toFixed(precisionDigits)
                .toString()
            );
        }
        return '%s%s%s'.format(value, separator, unit)
    }
*/

    on_desklet_removed: function() {

        Mainloop.source_remove(this.loopId);
        this.loopId = 0;
        this.isLooping = false;
        //this.settings.finalize();
    },
 


}
