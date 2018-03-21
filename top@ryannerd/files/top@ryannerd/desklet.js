const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const DeskletManager = imports.ui.deskletManager;
const Gettext = imports.gettext;
const UUID = "top@ryannerd";
const DESKLET_DIR = DeskletManager.deskletMeta[UUID].path; // path to this desklet (unused)
const PID_LIMIT = 10; // TODO: Make this user defined.
const UPDATE_TIMER = 5; // TODO: Make this user defined.
const TOP_COMMAND = "top -n 1 -b"; // TODO: Make this user defined.
const DEBUG = false; // Set this to true or "verbose" if you are tweaking the desklet (emits some useful info into global.log())
const Global = global; // This is done so that Auto-completion for Gnome project can be used.

/**
 * Preparatory function for when we implement string translations.
 * @param str
 * @return {*}
 * @private
 */
function _(str) {
    // return Gettext.dgettext(UUID, str);
    return str;
}

/**
 * DESKLET: Top (top@ryannerd)
 * Description: Displays output from the `top` command as a nicely formatted desklet
 * Developers: [https://github.com/RyanNerd]
 * See README.md for more info
 * TODO:
 *  - Display PIDs in a grid
 *  - User configuration options:
 *      - How often the update runs. Currently every 20 seconds.
 *      - Allow user to configure how many pid lines to display. Currently set to 10;
 *      - Allow user to change `top ` command and switches. Currently set as 'top -n 1 -b'
 *      - Allow user to select the height and width of the desklet. Currently width: 450px
 *  - Language Translations
 */

/**
 * `top` string output to JSON parser
 * R&D (Rob & Duplicate) - shamelessly stolen from:
 * @see https://github.com/devalexqt/topparser
 */
const topToJsonParser =
{
    /**
     * Parses a single line from `top` output
     * @param {&object} _result The resulting object from parsing
     * @param {string} _name The name of the line being parsed: 'task', 'cpu', 'ram', or 'swap'
     * @param {string} _line The line to parse
     */
    parseLine(_result, _name, _line)
    {
        let line=_line.replace(RegExp("%","g"), "").split(":")[1].replace(RegExp(" ", "g"), "");
        _result[_name]={};
        let line_items=line.split(",");
        let i, item;
        for(i=0, item=line_items[i];i<line_items.length;item=line_items[++i]){
            let value=parseFloat(item);
            if(value===0 && item.indexOf(".") !== -1) {
                value="0.0"
            }
            let name=item.replace(value, "").replace(".0", "");
            _result[_name][name]=parseFloat(value);
        }
    },

    /**
     * Parses a process from a single line from `top` output
     * @param {&object} _result The resulting object from parsing
     * @param {string} _line The line to parse
     */
    parseProcess(_result, _line)
    {
        let items=_line.split(",");
        let process={
            pid:items[0],
            user:items[1],
            pr:items[2],
            ni:items[3],
            virt:items[4],
            res:items[5],
            shr:items[6],
            s:items[7],
            cpu:items[8],
            mem:items[9],
            time:items[10],
            command:items[11]
        };
        _result.process.push(process);
    },

    /**
     * Parse output from Linux `top` command into JSON
     * @param {string} data
     * @param {int} pid_limit
     * @return {{process: Array}}
     */
    parse(data, pid_limit)
    {
        if(!data) {
            return
        }

        let result={process:[]};
        let data_line=data.split("\n");

        //sys info
        this.parseLine(result, "task", data_line[1]);
        this.parseLine(result, "cpu", data_line[2].replace(" us,", "user,").replace(" sy,", " system,").replace(" id,", " idle,"));
        this.parseLine(result, "ram", data_line[3].replace(RegExp("k ","g"), " ").replace(" buff/cache", "cache"));
        this.parseLine(result, "swap", data_line[4].replace(" used.", "used,").replace(" avail Mem", "avail"));

        //process
        if (pid_limit) {
            if(pid_limit>=data_line.length-1){
                pid_limit=data_line.length-1;
            } else {
                pid_limit += 7;
            }
        } else {
            pid_limit=data_line.length-1;
        }

        let i, item, line, offset;
        for (i=7, item=data_line[i];i<pid_limit;item=data_line[++i]) {
            if (item) {
                offset = (i === 7) ? 1 : 0;
                line=item.replace(/\s+/g, ",").substring(offset);
                if (line !== "") {
                    this.parseProcess(result, line);
                }
            }
        }
        result.time=new Date().getTime();

        return result;
    }
};

/**
 * Top Desklet init
 *
 * @param metadata
 * @param desklet_id
 * @constructor
 */
function TopDesklet(metadata, desklet_id)
{
    this._init(metadata, desklet_id);
}

/**
 *
 * Top Desklet
 * Main logic
 */
TopDesklet.prototype =
{
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id)
    {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.setupUI();
    },

    /**
     * Set up the initial User Interface
     */
    setupUI()
    {
        // Set up all the UI via ST
        this.mainContainer = new St.BoxLayout({style_class: "mainTopContainer"});

        /**
         * TASKS
         */
        this.taskTitles = new St.BoxLayout({vertical: true});
        this.taskValues = new St.BoxLayout({vertical: true});

        this.taskTitleMain = new St.Label({text: _("TASKS"), style_class: "topMainTitle"});
        this.taskTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle"});
        this.taskTitleRunning = new St.Label({text: _("Running:"), style_class: "topTitle"});
        this.taskTitleSleeping = new St.Label({text: _("Sleeping:"), style_class: "topTitle"});
        this.taskTitleStopped = new St.Label({text: _("Stopped:"), style_class: "topTitle"});
        this.taskTitleZombie = new St.Label({text: _("Zombie:"), style_class: "topTitle"});

        this.taskTitles.add(this.taskTitleMain);
        this.taskTitles.add(this.taskTitleTotal);
        this.taskTitles.add(this.taskTitleRunning);
        this.taskTitles.add(this.taskTitleSleeping);
        this.taskTitles.add(this.taskTitleStopped);
        this.taskTitles.add(this.taskTitleZombie);

        this.taskValueMain = new St.Label({text: "", style_class: "topValue"});
        this.taskValueTotal = new St.Label({text: "0", style_class: "topValue"});
        this.taskValueRunning = new St.Label({text: "0", style_class: "topValue"});
        this.taskValueSleeping = new St.Label({text: "0", style_class: "topValue"});
        this.taskValueStopped = new St.Label({text: "0", style_class: "topValue"});
        this.taskValueZombie = new St.Label({text: "0", style_class: "topValue"});

        this.taskValues.add(this.taskValueMain);
        this.taskValues.add(this.taskValueTotal);
        this.taskValues.add(this.taskValueRunning);
        this.taskValues.add(this.taskValueSleeping);
        this.taskValues.add(this.taskValueStopped);
        this.taskValues.add(this.taskValueZombie);

        this.mainContainer.add(this.taskTitles);
        this.mainContainer.add(this.taskValues);

        /**
         * CPU
         */
        this.cpuTitles = new St.BoxLayout({vertical: true});
        this.cpuValues = new St.BoxLayout({vertical: true});

        this.cpuTitleMain = new St.Label({text: _("CPU%"), style_class: "topMainTitle"});
        this.cpuTitleUser = new St.Label({text: _("User:"), style_class: "topTitle"});
        this.cpuTitleSystem = new St.Label({text: _("System:"), style_class: "topTitle"});
        this.cpuTitleNi = new St.Label({text: _("Nice:"), style_class: "topTitle"});
        this.cpuTitleIdle = new St.Label({text: _("Idle:"), style_class: "topTitle"});
        this.cpuTitleHi = new St.Label({text: _("H/I:"), style_class: "topTitle"});
        this.cpuTitleSi = new St.Label({text: _("S/I:"), style_class: "topTitle"});
        this.cpuTitleSt = new St.Label({text: _("St:"), style_class: "topTitle"});

        this.cpuTitles.add(this.cpuTitleMain);
        this.cpuTitles.add(this.cpuTitleUser);
        this.cpuTitles.add(this.cpuTitleSystem);
        this.cpuTitles.add(this.cpuTitleNi);
        this.cpuTitles.add(this.cpuTitleIdle);
        this.cpuTitles.add(this.cpuTitleHi);
        this.cpuTitles.add(this.cpuTitleSi);
        this.cpuTitles.add(this.cpuTitleSt);

        this.cpuValueMain = new St.Label({text: "", style_class: "topValue"});
        this.cpuValueUser = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueSystem = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueNi = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueIdle = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueHi = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueSi = new St.Label({text: "0", style_class: "topValue"});
        this.cpuValueSt = new St.Label({text: "0", style_class: "topValue"});

        this.cpuValues.add(this.cpuValueMain);
        this.cpuValues.add(this.cpuValueUser);
        this.cpuValues.add(this.cpuValueSystem);
        this.cpuValues.add(this.cpuValueNi);
        this.cpuValues.add(this.cpuValueIdle);
        this.cpuValues.add(this.cpuValueHi);
        this.cpuValues.add(this.cpuValueSi);
        this.cpuValues.add(this.cpuValueSt);

        this.mainContainer.add(this.cpuTitles);
        this.mainContainer.add(this.cpuValues);

        /**
         * RAM
         */
        this.ramTitles = new St.BoxLayout({vertical: true});
        this.ramValues = new St.BoxLayout({vertical: true});

        this.ramTitleMain = new St.Label({text: _("RAM"), style_class: "topMainTitle"});
        this.ramTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle"});
        this.ramTitleFree = new St.Label({text: _("Free:"), style_class: "topTitle"});
        this.ramTitleUsed = new St.Label({text: _("Used:"), style_class: "topTitle"});
        this.ramTitleCache = new St.Label({text: _("Cache:"), style_class: "topTitle"});

        this.ramTitles.add(this.ramTitleMain);
        this.ramTitles.add(this.ramTitleTotal);
        this.ramTitles.add(this.ramTitleFree);
        this.ramTitles.add(this.ramTitleUsed);
        this.ramTitles.add(this.ramTitleCache);

        this.ramValueMain = new St.Label({text: "", style_class: "topValue"});
        this.ramValueTotal = new St.Label({text: "0", style_class: "topValue"});
        this.ramValueFree = new St.Label({text: "0", style_class: "topValue"});
        this.ramValueUsed = new St.Label({text: "0", style_class: "topValue"});
        this.ramValueCache = new St.Label({text: "0", style_class: "topValue"});

        this.ramValues.add(this.ramValueMain);
        this.ramValues.add(this.ramValueTotal);
        this.ramValues.add(this.ramValueFree);
        this.ramValues.add(this.ramValueUsed);
        this.ramValues.add(this.ramValueCache);

        this.mainContainer.add(this.ramTitles);
        this.mainContainer.add(this.ramValues);

        /**
         * SWAP
         */
        this.swapTitles = new St.BoxLayout({vertical: true});
        this.swapValues = new St.BoxLayout({vertical: true});

        this.swapTitleMain = new St.Label({text: _("SWAP"), style_class: "topMainTitle"});
        this.swapTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle"});
        this.swapTitleFree = new St.Label({text: _("Free"), style_class: "topTitle"});
        this.swapTitleUsed = new St.Label({text: _("Used:"), style_class: "topTitle"});
        this.swapTitleAvailable = new St.Label({text: _("Available:"), style_class: "topTitle"});

        this.swapTitles.add(this.swapTitleMain);
        this.swapTitles.add(this.swapTitleTotal);
        this.swapTitles.add(this.swapTitleFree);
        this.swapTitles.add(this.swapTitleUsed);
        this.swapTitles.add(this.swapTitleAvailable);

        this.swapValueMain = new St.Label({text: "", style_class: "topValue"});
        this.swapValueTotal = new St.Label({text: "0", style_class: "topValue"});
        this.swapValueFree = new St.Label({text: "0", style_class: "topValue"});
        this.swapValueUsed = new St.Label({text: "0", style_class: "topValue"});
        this.swapValueAvailable = new St.Label({text: "0", style_class: "topValue"});

        this.swapValues.add(this.swapValueMain);
        this.swapValues.add(this.swapValueTotal);
        this.swapValues.add(this.swapValueFree);
        this.swapValues.add(this.swapValueUsed);
        this.swapValues.add(this.swapValueAvailable);

        this.mainContainer.add(this.swapTitles);
        this.mainContainer.add(this.swapValues);


        this.setContent(this.mainContainer);
        this._refresh();
    },

    /**
     * Called when desklet initializes and in set intervals after that.
     * @private
     */
    _updateTop()
    {
        // Get the top output as a string.
        let topOutput = this.getTopOutput();

        // Is topOutput not null then we have a valid string to parse.
        if (topOutput !== null) {
            // Parse the string into JSON for easier handling.
            let top = topToJsonParser.parse(topOutput, PID_LIMIT);

            // Debugging
            if (DEBUG) {
                if (DEBUG === 'VERBOSE' || DEBUG === 'verbose') {
                    Global.log(topOutput);
                }
                Global.log(top);
            }

            // TASKS
            this.taskValueTotal.text = top.task.total.toString();
            this.taskValueRunning.text = top.task.running.toString();
            this.taskValueSleeping.text = top.task.sleeping.toString();
            this.taskValueStopped.text = top.task.stopped.toString();
            this.taskValueZombie.text = top.task.zombie.toString();

            // CPU
            this.cpuValueUser.text = top.cpu.user.toString();
            this.cpuValueSystem.text = top.cpu.system.toString();
            this.cpuValueNi.text = top.cpu.ni.toString();
            this.cpuValueIdle.text = top.cpu.idle.toString();
            this.cpuValueHi.text = top.cpu.hi.toString();
            this.cpuValueSt.text = top.cpu.st.toString();

            // RAM
            this.ramValueTotal.text = top.ram.total.toString();
            this.ramValueFree.text = top.ram.free.toString();
            this.ramValueUsed.text = top.ram.used.toString();
            this.ramValueCache.text = top.ram.cache.toString();

            // SWAP
            this.swapValueTotal.text = top.swap.total.toString();
            this.swapValueFree.text = top.swap.free.toString();
            this.swapValueUsed.text = top.swap.used.toString();
            this.swapValueAvailable.text = top.swap.avail.toString();
        }
    },

    /**
     * Refresh the UI in set intervals.
     * @private
     */
    _refresh()
    {
        this._updateTop();
        this.timeout = Mainloop.timeout_add_seconds(UPDATE_TIMER, Lang.bind(this, this._refresh));
    },

    on_desklet_removed()
    {
        Mainloop.source_remove(this.timeout);
    },

    /**
     * Executes `top` command synchronously. Upon success returns the output as a string, otherwise a null.
     *
     * @return {string | null}
     */
    getTopOutput()
    {
        // Execute the top command.
        let [ok, output, err, exitStatus] = GLib.spawn_command_line_sync(TOP_COMMAND);

        // If all is well then return the output from the command as a string.
        if (ok && output) {
            return output.toString();
        }

        // Log details of the failure if we are in debug mode.
        if (DEBUG) {
            Global.log("`" +TOP_COMMAND +"` command failure (exit code:" + exitStatus +"): \n" + err.toString());
        }

        return null;
    }
};

/**
 * Desklet entry point
 *
 * @param metadata
 * @param desklet_id
 * @return {TopDesklet}
 */
function main(metadata, desklet_id)
{
    return new TopDesklet(metadata, desklet_id);
}
