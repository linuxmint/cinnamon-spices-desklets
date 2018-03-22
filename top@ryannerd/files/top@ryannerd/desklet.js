const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const DeskletManager = imports.ui.deskletManager;
// const Gettext = imports.gettext;
const UUID = "top@ryannerd";
const DESKLET_DIR = DeskletManager.deskletMeta[UUID].path; // path to this desklet (unused)
const PID_LIMIT = 10; // TODO: Make this user defined.
const UPDATE_TIMER = 5; // TODO: Make this user defined.
const TOP_COMMAND = "top -n 1 -b"; // TODO: Make this user defined.
const DEBUG = false; // Set this to true or "verbose" if you are tweaking the desklet (emits some useful info into Global.log())
const Global = global; // This is done so that Auto-completion for Gnome project can be used. see: https://github.com/RyanNerd/gnome-autocomplete

// l10n/translation support
// Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

/**
 * Preparatory function for when we implement string translations.
 * @param {string} str
 * @return {string}
 * @private
 */
function _(str) {
    // return Gettext.dgettext(UUID, str);
    return str;
}

/**
 * Really?!? - Spidermonkey the javascript interpreter is so bad that we need to do this?
 * Then again we are using javascript:
 * @see https://blog.dantup.com/2014/05/web-development-sucks-and-its-not-getting-any-better/
 * @see https://stackoverflow.com/questions/7545641/javascript-multidimensional-array
 * @param {int} x
 * @param {int} y
 * @return {[,]}
 * @constructor
 */
function Array2D(x, y)
{
    let array2D = new Array(x);

    for(let i = 0; i < array2D.length; i++)
    {
        array2D[i] = new Array(y);
    }

    return array2D;
}

/**
 * DESKLET: Top (top@ryannerd)
 * Description: Displays output from the `top` command as a nicely formatted desklet
 * Developers: [https://github.com/RyanNerd]
 * See README.md for more info
 * TODO:
 *  - User configuration options:
 *      - How often the update runs. Currently every 5 seconds.
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
        let lineItems=line.split(",");
        let i, item;
        for(i=0, item=lineItems[i]; i < lineItems.length; item=lineItems[++i]) {
            let value=parseFloat(item);
            if(value===0 && item.indexOf(".") !== -1) {
                value = "0.0";
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
        let items =_line.split(",");
        let process = {
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
     * @param {int} pidLimit
     * @return {{process: Array}}
     */
    parse(data, pidLimit)
    {
        let result={process:[]};
        let dataLine = data.split("\n");

        //sys info
        this.parseLine(result, "task", dataLine[1]);
        this.parseLine(result, "cpu", dataLine[2].replace(" us,", "user,").replace(" sy,", " system,").replace(" id,", " idle,"));
        this.parseLine(result, "ram", dataLine[3].replace(RegExp("k ","g"), " ").replace(" buff/cache", "cache"));
        this.parseLine(result, "swap", dataLine[4].replace(" used.", "used,").replace(" avail Mem", "avail"));

        //process
        if (pidLimit) {
            if(pidLimit>=dataLine.length-1){
                pidLimit=dataLine.length-1;
            } else {
                pidLimit += 7;
            }
        } else {
            pidLimit=dataLine.length-1;
        }

        let i, item, line, offset;
        for (i=7, item=dataLine[i]; i < pidLimit; item=dataLine[++i]) {
            if (item) {
                line=item.replace(/\s+/g, ",").substring(1);
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
 * @param metadata
 * @param deskletId
 * @constructor
 */
function TopDesklet(metadata, deskletId)
{
    this._init(metadata, deskletId);
}

/**
 * Top Desklet - Main logic
 */
TopDesklet.prototype =
{
    __proto__: Desklet.Desklet.prototype,

    /**
     * Desklet Init
     * @param metadata
     * @param deskletId
     * @private
     */
    _init(metadata, deskletId)
    {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.setupUI();
    },

    /**
     * Set up the initial User Interface
     */
    setupUI()
    {
        // Set up all the UI via ST
        this.mainContainer = new St.BoxLayout({style_class: "mainTopContainer"});
        this.headerContainer = new St.BoxLayout();
        this.detailContainer = new St.BoxLayout({vertical: true, x_align: 0});
        this.mainTable = new St.Table();

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

        this.headerContainer.add(this.taskTitles);
        this.headerContainer.add(this.taskValues);

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

        this.headerContainer.add(this.cpuTitles);
        this.headerContainer.add(this.cpuValues);

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

        this.headerContainer.add(this.ramTitles);
        this.headerContainer.add(this.ramValues);

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

        this.headerContainer.add(this.swapTitles);
        this.headerContainer.add(this.swapValues);

        /**
         * PROCESSES
         */
        this.procTable = new St.Table();
        this.procTable.add(new St.Label({text: _("PID"), style_class: "topProcTitle"}), {row: 0, col: 0});
        this.procTable.add(new St.Label({text: _("USER"), style_class: "topProcTitle"}), {row: 0, col: 1});
        this.procTable.add(new St.Label({text: _("PR"), style_class: "topProcTitle"}), {row: 0, col: 2});
        this.procTable.add(new St.Label({text: _("NI"), style_class: "topProcTitle"}), {row: 0, col: 3});
        this.procTable.add(new St.Label({text: _("VIRT"), style_class: "topProcTitle"}), {row: 0, col: 4});
        this.procTable.add(new St.Label({text: _("RES"), style_class: "topProcTitle"}), {row: 0, col: 5});
        this.procTable.add(new St.Label({text: _("SHR"), style_class: "topProcTitle"}), {row: 0, col: 6});
        this.procTable.add(new St.Label({text: _("S"), style_class: "topProcTitle"}), {row: 0, col: 7});
        this.procTable.add(new St.Label({text: _("CPU"), style_class: "topProcTitle"}), {row: 0, col: 8});
        this.procTable.add(new St.Label({text: _("MEM"), style_class: "topProcTitle"}), {row: 0, col: 9});
        this.procTable.add(new St.Label({text: _("TIME"), style_class: "topProcTitle"}), {row: 0, col: 10});
        this.procTable.add(new St.Label({text: _("CMD"), style_class: "topProcTitle"}), {row: 0, col: 11});

        this.procGrid = Array2D(PID_LIMIT, 11);
        for(let row=0; row < PID_LIMIT; row++)
        {
            for(let col=0; col <= 11; col++) {
                this.procGrid[row][col] = new St.Label({text: _(""), style_class: "topValue"});
                this.procTable.add(this.procGrid[row][col], {row: row+1, col: col});
            }
        }
        this.detailContainer.add_actor(this.procTable);

        // Add the header and detail tables to the main container table.
        this.mainTable.add(this.headerContainer, {row:0, col:0});
        this.mainTable.add(this.detailContainer, {row:1, col:0});
        this.mainContainer.add(this.mainTable);

        // Show the UI and call refresh to populate initial values and start the refresh timer.
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

            // PROCESSES
            let processes = top.process;
            for(let row=0; row < PID_LIMIT; row++)
            {
                this.procGrid[row][0].text = parseInt(processes[row].pid).toString();
                this.procGrid[row][1].text = processes[row].user;
                this.procGrid[row][2].text = parseInt(processes[row].pr).toString();
                this.procGrid[row][3].text = parseInt(processes[row].ni).toString();
                this.procGrid[row][4].text = parseInt(processes[row].virt).toString();
                this.procGrid[row][5].text = parseInt(processes[row].res).toString();
                this.procGrid[row][6].text = parseInt(processes[row].shr).toString();
                this.procGrid[row][7].text = processes[row].s;
                this.procGrid[row][8].text = parseFloat(processes[row].cpu).toString();
                this.procGrid[row][9].text = parseFloat(processes[row].mem).toString();
                this.procGrid[row][10].text = processes[row].time;
                this.procGrid[row][11].text = processes[row].command;
            }
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

    /**
     * Desklet event hook.
     */
    on_desklet_removed()
    {
        Mainloop.source_remove(this.timeout);
    },

    /**
     * Executes `top` command synchronously. Upon success returns the output as a string, otherwise a null.
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
 * @param metadata
 * @param desklet_id
 * @return {TopDesklet}
 */
function main(metadata, desklet_id)
{
    return new TopDesklet(metadata, desklet_id);
}
