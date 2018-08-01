const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const DeskletManager = imports.ui.deskletManager;
const Settings = imports.ui.settings;
const Global = global; // This is done so that Auto-completion for Gnome project can be used. see: https://github.com/RyanNerd/gnome-autocomplete
const Gettext = imports.gettext;

const UUID = "top@ryannerd";
const DESKLET_DIR = DeskletManager.deskletMeta[UUID].path; // path to this desklet (unused)

const PID_MAX_LIMIT          = 20;
const DEFAULT_PID_LIMIT      = 10;
const DEFAULT_UPDATE_TIMER   = 5;
const DEFAULT_TOP_COMMAND    = "top -n 1 -b";
const DEFAULT_SHOW_TASKS     = true;
const DEFAULT_SHOW_CPU       = true;
const DEFAULT_SHOW_RAM       = true;
const DEFAULT_SHOW_SWAP      = true;
const DEFAULT_SHOW_PROCESSES = true;
const DEFAULT_TITLE_COLOR    = "midnightblue";
const DEFAULT_LABEL_COLOR    = "black";
const DEFAULT_VALUE_COLOR    = "white";

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

/**
 * Preparatory function for when we implement string translations.
 * @param {string} str
 * @return {string}
 * @private
 */
function _(str) {
    return Gettext.dgettext(UUID, str);
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
                // Is there a space at the first position? If so don't include it in the line parsing
                if (item.substr(0,1)===" ") {
                    line=item.replace(/\s+/g, ",").substring(1);
                } else {
                    line=item.replace(/\s+/g, ",");
                }
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
        try {
            Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

            // Get the configuration bindings
            this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
            this.settings.bindProperty(Settings.BindingDirection.IN, "pid-lines", "cfgMaxPidLines", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-rate", "cfgRefreshRate", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "top-command", "cfgTopCommand", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-tasks", "cfgShowTasks", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-cpu", "cfgShowCpu", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-ram", "cfgShowRam", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-swap", "cfgShowSwap", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-processes", "cfgShowProcesses", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "title-color", "cfgTitleColor", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "cfgLabelColor", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "value-color", "cfgValueColor", this.on_setting_changed);
            this.settings.bindProperty(Settings.BindingDirection.IN, "enable-custom-command", "cfgEnableCustomCommand", this.on_setting_changed);

            this.cfgMaxPidLines   = parseInt(this.cfgMaxPidLines) || DEFAULT_PID_LIMIT;
            this.cfgRefreshRate   = parseInt(this.cfgRefreshRate) || DEFAULT_UPDATE_TIMER;
            this.cfgTopCommand    = this.cfgTopCommand            || DEFAULT_TOP_COMMAND;
            this.cfgShowTasks     = this.cfgShowTasks             || DEFAULT_SHOW_TASKS;
            this.cfgShowCpu       = this.cfgShowCpu               || DEFAULT_SHOW_CPU;
            this.cfgShowRam       = this.cfgShowRam               || DEFAULT_SHOW_RAM;
            this.cfgShowSwap      = this.cfgShowSwap              || DEFAULT_SHOW_SWAP;
            this.cfgShowProcesses = this.cfgShowProcesses         || DEFAULT_SHOW_PROCESSES;
            this.cfgTitleColor    = this.cfgTitleColor            || DEFAULT_TITLE_COLOR;
            this.cfgLabelColor    = this.cfgLabelColor            || DEFAULT_LABEL_COLOR;
            this.cfgValueColor    = this.cfgValueColor            || DEFAULT_VALUE_COLOR;

            // Set the timer as inactive.
            this.timeout = 0;

            // Kick off the UI Setup and refresh
            this.on_setting_changed();

        } catch (e) {
            Global.logError(e);
        }
    },

    /**
     * Desklet event hook that fires when the user changes anything in the configuration dialog.
     */
    on_setting_changed()
    {
        // Prevent any refresh until we have set up the UI
        if (this.timeout > 0) {
            Mainloop.source_remove(this.timeout);
        }

        if (this.cfgEnableCustomCommand) {
            this.cfgTopCommand = this.cfgTopCommand || DEFAULT_TOP_COMMAND;
        } else {
            this.cfgTopCommand = DEFAULT_TOP_COMMAND;
        }

        // Nuke the mainContainer
        this.mainContainer = null;

        // Set up the UI
        this.setupUI();

        // Show the UI and call refresh to populate initial values.
        this.setContent(this.mainContainer);

        // Update the display values and start the refresh timer.
        this._refresh();
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
        if (this.cfgShowTasks)
        {
            this.taskTitles = new St.BoxLayout({vertical: true});
            this.taskValues = new St.BoxLayout({vertical: true});

            this.taskTitleMain = new St.Label({text: _("TASKS"), style_class: "topMainTitle", style: "color: " + this.cfgTitleColor});
            this.taskTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.taskTitleRunning = new St.Label({text: _("Running:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.taskTitleSleeping = new St.Label({text: _("Sleeping:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.taskTitleStopped = new St.Label({text: _("Stopped:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.taskTitleZombie = new St.Label({text: _("Zombie:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});

            this.taskTitles.add(this.taskTitleMain);
            this.taskTitles.add(this.taskTitleTotal);
            this.taskTitles.add(this.taskTitleRunning);
            this.taskTitles.add(this.taskTitleSleeping);
            this.taskTitles.add(this.taskTitleStopped);
            this.taskTitles.add(this.taskTitleZombie);

            this.taskValueMain = new St.Label({text: "", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.taskValueTotal = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.taskValueRunning = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.taskValueSleeping = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.taskValueStopped = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.taskValueZombie = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});

            this.taskValues.add(this.taskValueMain);
            this.taskValues.add(this.taskValueTotal);
            this.taskValues.add(this.taskValueRunning);
            this.taskValues.add(this.taskValueSleeping);
            this.taskValues.add(this.taskValueStopped);
            this.taskValues.add(this.taskValueZombie);

            this.headerContainer.add(this.taskTitles);
            this.headerContainer.add(this.taskValues);
        }

        /**
         * CPU
         */
        if (this.cfgShowCpu)
        {
            this.cpuTitles = new St.BoxLayout({vertical: true});
            this.cpuValues = new St.BoxLayout({vertical: true});

            this.cpuTitleMain = new St.Label({text: _("CPU%"), style_class: "topMainTitle", style: "color: " + this.cfgTitleColor});
            this.cpuTitleUser = new St.Label({text: _("User:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleSystem = new St.Label({text: _("System:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleNi = new St.Label({text: _("Nice:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleIdle = new St.Label({text: _("Idle:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleHi = new St.Label({text: _("H/I:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleSi = new St.Label({text: _("S/I:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.cpuTitleSt = new St.Label({text: _("St:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});

            this.cpuTitles.add(this.cpuTitleMain);
            this.cpuTitles.add(this.cpuTitleUser);
            this.cpuTitles.add(this.cpuTitleSystem);
            this.cpuTitles.add(this.cpuTitleNi);
            this.cpuTitles.add(this.cpuTitleIdle);
            this.cpuTitles.add(this.cpuTitleHi);
            this.cpuTitles.add(this.cpuTitleSi);
            this.cpuTitles.add(this.cpuTitleSt);

            this.cpuValueMain = new St.Label({text: "", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueUser = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueSystem = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueNi = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueIdle = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueHi = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueSi = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.cpuValueSt = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});

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
        }

        /**
         * RAM
         */
        if (this.cfgShowRam)
        {
            this.ramTitles = new St.BoxLayout({vertical: true});
            this.ramValues = new St.BoxLayout({vertical: true});

            this.ramTitleMain = new St.Label({text: _("RAM"), style_class: "topMainTitle", style: "color: " + this.cfgTitleColor});
            this.ramTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.ramTitleFree = new St.Label({text: _("Free:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.ramTitleUsed = new St.Label({text: _("Used:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.ramTitleCache = new St.Label({text: _("Cache:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});

            this.ramTitles.add(this.ramTitleMain);
            this.ramTitles.add(this.ramTitleTotal);
            this.ramTitles.add(this.ramTitleFree);
            this.ramTitles.add(this.ramTitleUsed);
            this.ramTitles.add(this.ramTitleCache);

            this.ramValueMain = new St.Label({text: "", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.ramValueTotal = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.ramValueFree = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.ramValueUsed = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.ramValueCache = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});

            this.ramValues.add(this.ramValueMain);
            this.ramValues.add(this.ramValueTotal);
            this.ramValues.add(this.ramValueFree);
            this.ramValues.add(this.ramValueUsed);
            this.ramValues.add(this.ramValueCache);

            this.headerContainer.add(this.ramTitles);
            this.headerContainer.add(this.ramValues);
        }

        /**
         * SWAP
         */
        if (this.cfgShowSwap)
        {
            this.swapTitles = new St.BoxLayout({vertical: true});
            this.swapValues = new St.BoxLayout({vertical: true});

            this.swapTitleMain = new St.Label({text: _("SWAP"), style_class: "topMainTitle", style: "color: " + this.cfgTitleColor});
            this.swapTitleTotal = new St.Label({text: _("Total:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.swapTitleFree = new St.Label({text: _("Free"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.swapTitleUsed = new St.Label({text: _("Used:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});
            this.swapTitleAvailable = new St.Label({text: _("Available:"), style_class: "topTitle", style: "color: " + this.cfgLabelColor});

            this.swapTitles.add(this.swapTitleMain);
            this.swapTitles.add(this.swapTitleTotal);
            this.swapTitles.add(this.swapTitleFree);
            this.swapTitles.add(this.swapTitleUsed);
            this.swapTitles.add(this.swapTitleAvailable);

            this.swapValueMain = new St.Label({text: "", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.swapValueTotal = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.swapValueFree = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.swapValueUsed = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});
            this.swapValueAvailable = new St.Label({text: "0", style_class: "topValue", style: "color: " + this.cfgValueColor});

            this.swapValues.add(this.swapValueMain);
            this.swapValues.add(this.swapValueTotal);
            this.swapValues.add(this.swapValueFree);
            this.swapValues.add(this.swapValueUsed);
            this.swapValues.add(this.swapValueAvailable);

            this.headerContainer.add(this.swapTitles);
            this.headerContainer.add(this.swapValues);
        }

        /**
         * PROCESSES
         */
        if (this.cfgShowProcesses)
        {
            this.procTable = new St.Table();
            this.procTable.add(new St.Label({text: _("PID"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 0});
            this.procTable.add(new St.Label({text: _("USER"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 1});
            this.procTable.add(new St.Label({text: _("PR"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 2});
            this.procTable.add(new St.Label({text: _("NI"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 3});
            this.procTable.add(new St.Label({text: _("VIRT"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 4});
            this.procTable.add(new St.Label({text: _("RES"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 5});
            this.procTable.add(new St.Label({text: _("SHR"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 6});
            this.procTable.add(new St.Label({text: _("S"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 7});
            this.procTable.add(new St.Label({text: _("CPU"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 8});
            this.procTable.add(new St.Label({text: _("MEM"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 9});
            this.procTable.add(new St.Label({text: _("TIME"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 10});
            this.procTable.add(new St.Label({text: _("CMD"), style_class: "topProcTitle", style: "color: " + this.cfgTitleColor}), {row: 0, col: 11});

            this.procGrid = Array2D(PID_MAX_LIMIT, 11);
            for (let row = 0; row < this.cfgMaxPidLines; row++)
            {
                for (let col = 0; col <= 11; col++)
                {
                    this.procGrid[row][col] = new St.Label({text: _(""), style_class: "topValue", style: "color: " + this.cfgValueColor});
                    this.procTable.add(this.procGrid[row][col], {row: row + 1, col: col});
                }
            }
            this.detailContainer.add_actor(this.procTable);
        }

        // Check if user has shut everything off and if so then just show a label indicating to change things in config
        if (!(
            this.cfgShowProcesses ||
            this.cfgShowTasks     ||
            this.cfgShowSwap      ||
            this.cfgShowCpu       ||
            this.cfgShowRam)) {
            this.headerContainer.add(new St.Label({text: _("Top Desklet - Open Configuration for display options"), style_class: "topMainTitle"}));
        }

        // Add the header and detail tables to the main container table.
        this.mainTable.add(this.headerContainer, {row:0, col:0});
        this.mainTable.add(this.detailContainer, {row:1, col:0});
        this.mainContainer.add(this.mainTable);
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
            let top = topToJsonParser.parse(topOutput, this.cfgMaxPidLines);

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
            for(let row=0; row < this.cfgMaxPidLines; row++)
            {
                this.procGrid[row][0].text = parseInt(processes[row].pid).toString();
                this.procGrid[row][1].text = processes[row].user;
                this.procGrid[row][2].text = processes[row].pr;
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
        this.timeout = Mainloop.timeout_add_seconds(this.cfgRefreshRate, Lang.bind(this, this._refresh));
    },

    /**
     * Desklet event hook.
     */
    on_desklet_removed()
    {
        if (this.timeout > 0) {
            Mainloop.source_remove(this.timeout);
        }
    },

    /**
     * Executes `top` command synchronously. Upon success returns the output as a string, otherwise a null.
     * @return {string | null}
     */
    getTopOutput()
    {
        // Execute the top command.
        let [ok, output, err, exitStatus] = GLib.spawn_command_line_sync(this.cfgTopCommand);

        // If all is well then return the output from the command as a string.
        if (ok && output) {
            return output.toString();
        }

        // Log details of the failure.
        Global.log("`" + this.cfgTopCommand + "` command failure (exit code:" + exitStatus +"): \n" + err.toString());

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
