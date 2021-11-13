const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Util = imports.misc.util;

// Import local libraries
imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/jira@codeunifier/lib");
const JiraUtility = imports.jira.JiraUtility;

const SEPARATOR_LINE = "\n\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n";
const IDEN = "jira@codeunifier";

function JiraDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

JiraDesklet.prototype = {
    success: false,
    failed: false,
    jiraData: null,

    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        // account configs
        this.settings.bind("accountId", "accountId", this.onDeskletFormatChanged, null);
        this.settings.bind("accountEmail", "accountEmail", this.onDeskletFormatChanged, null);
        this.settings.bind("apiToken", "apiToken", this.onDeskletFormatChanged, null);
        this.settings.bind("projectBoardUrl", "projectBoardUrl", this.onDeskletFormatChanged, null);
        this.settings.bind("projectName", "projectName", this.onDeskletFormatChanged, null);
        this.settings.bind("atlassianDomain", "atlassianDomain", this.onDeskletFormatChanged, null);

        // style configs
        this.settings.bind("transparency", "transparency", this.onDeskletFormatChanged, null);
        this.settings.bind("backgroundColor", "backgroundColor", this.onDeskletFormatChanged, null);
        this.settings.bind("issueColor", "issueColor", this.onDeskletFormatChanged, null);

        if (this.accountId && this.accountEmail && this.apiToken && this.projectBoardUrl && this.projectName && this.atlassianDomain) {
            this.setupUI();

            this.updateLoop();
        } else {
            this.showMissingSettings();
        }
    },

    ////////////////////////////////////////////////////////////////////////////
    // Begin / restart the main loop, waiting for refreshSec before updating again
    _doLoop: function() {
        if (this.accountId && this.projectBoardUrl) {
            if(typeof this._timeoutId !== 'undefined') {
                Mainloop.source_remove(this._timeoutId);
            }
    
            this._timeoutId=Mainloop.timeout_add_seconds(Math.round(30 * (0.9 + Math.random()*0.2)),Lang.bind(this, this.getJiraTasks));
        }
    },

    updateLoop() {
        this.getJiraTasks();
        this.updateID = Mainloop.timeout_add_seconds(60, Lang.bind(this, this.updateLoop));
    },

    setupUI(){
        // creates container for one child
        this.window = new St.Bin();

        try {
            if (this.jiraData) {
                const box = new St.BoxLayout({ vertical: true });

                box.style = 'max-width: 338px';

                const issuesCount = new St.Label({ text: 'Total Issues: ' + this.jiraData.total + (this.loading ? ' (reloading...)' : '') });
                issuesCount.style = 'font-size: 18px; margin-bottom: 10px';

                box.add(issuesCount);
    
                for (let i = 0; i < this.jiraData.issues.length; i++) {
                    const issue = this.jiraData.issues[i];
    
                    const label = new St.Button({ label: issue.key });
                    label.style = 'padding-left: 5px; padding-right: 5px; font-weight: bold; background-color: ' + this.issueColor + '; border-radius: 10px';
                    label.connect('clicked', Lang.bind(this, this.issueClicked))

                    const status = new St.Label({ text: issue.fields.status.name });
                    status.style = 'margin-left: 10px; color: yellow';

                    const labelBox = new St.BoxLayout({ vertical: false });
                    labelBox.add(label);
                    labelBox.add(status);

                    box.add(labelBox);

                    // potential setup to include the issue's description fields
                    // let descText = '';

                    // for (let c1 = 0; c1 < issue.fields.description.content.length; c1++) {
                    //     const content1 = issue.fields.description.content[c1];

                    //     if (content1.content) {
                    //         for (let c2 = 0; c2 < content1.content.length; c2++) {
                    //             const content2 = content1.content[c2];

                    //             if (content2.text) {
                    //                 descText += content2.text + ' ';
                    //             }
                    //         }
                    //     }
                    // }

                    const descText = issue.fields.summary;

                    const description = new St.Label({ text: descText });

                    box.add(description);
    
                    const separator = new St.Label({ text: SEPARATOR_LINE });
    
                    // box.add(label);
                    box.add(separator);
                }

                this.window.add_actor(box);
            }
        } catch (e) {
            global.logError(IDEN + ': ISSUES | ' + e.message);
        }

        this.window.style = "padding: 10px; border-radius: 10px; background-color: rgba(" + (this.backgroundColor.replace('rgb(', '').replace(')', '')) + "," + this.transparency + ")";

        // Sets the container as content actor of the desklet
        this.setContent(this.window);
    },

    showMissingSettings() {
        // creates container for one child
        this.window = new St.Bin();

        const label = new St.Label({ text: "There are missing configurations. Please check the settings." });

        this.window.add_actor(label);

        this.window.style = "padding: 10px; border-radius: 10px; background-color: rgba(" + (this.backgroundColor.replace('rgb(', '').replace(')', '')) + "," + this.transparency + ")";

        // Sets the container as content actor of the desklet
        this.setContent(this.window);
    },

    issueClicked(btn) {
        const url = this.projectBoardUrl + "?assignee=" + this.accountId + "&selectedIssue=" + btn.get_label();
        Util.spawnCommandLine('xdg-open ' + url);
    },

    onDeskletFormatChanged() {
        this.setupUI();
    },

    /**
     * Called when user clicks on the desklet.
     */
    on_desklet_clicked(event) {
        global.logError(event.get_button());
        this.getJiraTasks();
    },

    getJiraTasks() {
        const jira = new JiraUtility();

        this.loading = true;
        this.setupUI();

        jira.getAssigned(this, function (resp) {
            if (resp) {
                this.loading = false;
                this.success = true;
                this.jiraData = JSON.parse(resp);
            } else {
                this.loading = false;
                this.failed = true;
            }

            this.setupUI();
        });
    }
};

function main(metadata, desklet_id) {
    return new JiraDesklet(metadata, desklet_id);
}
