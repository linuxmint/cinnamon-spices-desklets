const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Tooltips = imports.ui.tooltips;

const UUID = "docker-desklet@wilkesreid";

function DockerManagerDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

DockerManagerDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._timerId = null;
        this._tooltips = [];
        this._actionInProgress = false;
        this._spinnerTimerId = null;
        this._spinnerFrames = ["\u25D0", "\u25D3", "\u25D1", "\u25D2"];  // ◐ ◓ ◑ ◒
        this._spinnerIndex = 0;
        this._activeSpinnerLabels = [];

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bind("refresh-interval", "refreshInterval", this._onSettingsChanged.bind(this));
        this.settings.bind("show-all-containers", "showAllContainers", this._onSettingsChanged.bind(this));
        this.settings.bind("widget-width", "widgetWidth", this._onSizeChanged.bind(this));
        this.settings.bind("widget-height", "widgetHeight", this._onSizeChanged.bind(this));

        this._buildLayout();
        this._fetchContainers();
        this._startTimer();
    },

    _buildLayout: function() {
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: "docker-desklet-container",
            width: this.widgetWidth,
            height: this.widgetHeight
        });

        // Header
        let headerBox = new St.BoxLayout({ style_class: "docker-desklet-header" });

        let titleLabel = new St.Label({
            text: "Docker Containers",
            style_class: "docker-desklet-header-label"
        });

        this._countLabel = new St.Label({
            text: "",
            style_class: "docker-desklet-count"
        });

        headerBox.add(titleLabel, { expand: true, x_fill: true });
        headerBox.add(this._countLabel);

        // Scroll view
        this._scrollView = new St.ScrollView({
            style_class: "docker-scroll-view"
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        this._containerList = new St.BoxLayout({ vertical: true });
        this._scrollView.add_actor(this._containerList);

        this._mainBox.add(headerBox, { x_fill: true });
        this._mainBox.add(this._scrollView, { expand: true, x_fill: true, y_fill: true });

        this.setContent(this._mainBox);
    },

    _onSettingsChanged: function() {
        this._stopTimer();
        this._fetchContainers();
        this._startTimer();
    },

    _onSizeChanged: function() {
        this._mainBox.set_size(this.widgetWidth, this.widgetHeight);
    },

    _startTimer: function() {
        this._stopTimer();
        this._timerId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._fetchContainers();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _stopTimer: function() {
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = null;
        }
    },

    _fetchContainers: function() {
        let cmd = "timeout 5 docker ps -a --format '{{json .}}' --no-trunc";
        if (!this.showAllContainers) {
            cmd = "timeout 5 docker ps --format '{{json .}}' --no-trunc";
        }

        try {
            let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                "/bin/bash -c \"" + cmd + " 2>&1\""
            );

            let output = stdout ? imports.byteArray.toString(stdout).trim() : "";
            let errOutput = stderr ? imports.byteArray.toString(stderr).trim() : "";
            let combinedOutput = output + " " + errOutput;

            if (combinedOutput.indexOf("Cannot connect to the Docker daemon") !== -1 ||
                combinedOutput.indexOf("Is the docker daemon running") !== -1) {
                this._showError("Docker daemon is not running.\nStart it with: sudo systemctl start docker");
                return;
            }

            if (combinedOutput.indexOf("permission denied") !== -1 ||
                combinedOutput.indexOf("Permission denied") !== -1) {
                this._showError("Permission denied.\nAdd your user to the docker group:\nsudo usermod -aG docker $USER\nThen log out and back in.");
                return;
            }

            if (combinedOutput.indexOf("docker: not found") !== -1 ||
                combinedOutput.indexOf("No such file or directory") !== -1) {
                this._showError("Docker is not installed.\nInstall it from https://docs.docker.com/engine/install/");
                return;
            }

            let containers = this._parseContainers(output);
            let groups = this._groupContainers(containers);
            this._renderContainers(groups, containers);

        } catch (e) {
            this._showError("Failed to run docker command:\n" + e.message);
        }
    },

    _parseContainers: function(output) {
        let containers = [];
        if (!output) return containers;

        let lines = output.split("\n");
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line || line[0] !== "{") continue;
            try {
                let data = JSON.parse(line);
                let composeProject = "";
                if (data.Labels) {
                    let labels = data.Labels.split(",");
                    for (let j = 0; j < labels.length; j++) {
                        let parts = labels[j].split("=");
                        if (parts[0] === "com.docker.compose.project") {
                            composeProject = parts.slice(1).join("=");
                            break;
                        }
                    }
                }
                containers.push({
                    id: data.ID,
                    name: data.Names,
                    state: data.State,
                    status: data.Status,
                    image: data.Image,
                    ports: data.Ports || "",
                    composeProject: composeProject
                });
            } catch (e) {
                // skip malformed lines
            }
        }
        return containers;
    },

    _groupContainers: function(containers) {
        let groups = {};
        let standalone = [];

        for (let i = 0; i < containers.length; i++) {
            let c = containers[i];
            if (c.composeProject) {
                if (!groups[c.composeProject]) {
                    groups[c.composeProject] = [];
                }
                groups[c.composeProject].push(c);
            } else {
                standalone.push(c);
            }
        }

        let sortedGroupNames = Object.keys(groups).sort();
        let result = [];
        for (let i = 0; i < sortedGroupNames.length; i++) {
            result.push({
                name: sortedGroupNames[i],
                containers: groups[sortedGroupNames[i]]
            });
        }

        if (standalone.length > 0) {
            result.push({
                name: null,
                containers: standalone
            });
        }

        return result;
    },

    _startSpinner: function(label) {
        this._activeSpinnerLabels.push(label);
        if (this._spinnerTimerId) return;  // already spinning
        this._spinnerIndex = 0;
        this._spinnerTimerId = Mainloop.timeout_add(100, () => {
            this._spinnerIndex = (this._spinnerIndex + 1) % this._spinnerFrames.length;
            let frame = this._spinnerFrames[this._spinnerIndex];
            for (let i = 0; i < this._activeSpinnerLabels.length; i++) {
                this._activeSpinnerLabels[i].set_text(frame);
            }
            return GLib.SOURCE_CONTINUE;
        });
    },

    _stopSpinner: function() {
        if (this._spinnerTimerId) {
            Mainloop.source_remove(this._spinnerTimerId);
            this._spinnerTimerId = null;
        }
        this._activeSpinnerLabels = [];
    },

    _disableAllButtons: function() {
        let children = this._containerList.get_children();
        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            // Find buttons in rows and group headers
            let innerChildren = child.get_children ? child.get_children() : [];
            for (let j = 0; j < innerChildren.length; j++) {
                if (innerChildren[j] instanceof St.Button) {
                    innerChildren[j].reactive = false;
                    innerChildren[j].add_style_class_name("docker-action-btn-disabled");
                }
            }
        }
    },

    _clearContainerList: function() {
        // Destroy tooltips first
        for (let i = 0; i < this._tooltips.length; i++) {
            this._tooltips[i].destroy();
        }
        this._tooltips = [];
        this._containerList.destroy_all_children();
    },

    _renderContainers: function(groups, allContainers) {
        this._clearContainerList();

        let runningCount = 0;
        for (let i = 0; i < allContainers.length; i++) {
            if (allContainers[i].state === "running") runningCount++;
        }
        this._countLabel.set_text(runningCount + "/" + allContainers.length + " running");

        if (allContainers.length === 0) {
            let emptyLabel = new St.Label({
                text: "No containers found.",
                style_class: "docker-error-label"
            });
            this._containerList.add(emptyLabel);
            return;
        }

        for (let g = 0; g < groups.length; g++) {
            let group = groups[g];

            if (group.name) {
                let groupHeader = this._createGroupHeader(group);
                this._containerList.add(groupHeader, { x_fill: true });
            } else if (groups.length > 1) {
                let standaloneHeader = new St.BoxLayout({ style_class: "docker-group-header" });
                let standaloneLabel = new St.Label({
                    text: "Standalone",
                    style_class: "docker-group-label"
                });
                standaloneHeader.add(standaloneLabel, { expand: true, x_fill: true });
                this._containerList.add(standaloneHeader, { x_fill: true });
            }

            for (let c = 0; c < group.containers.length; c++) {
                let row = this._createContainerRow(group.containers[c]);
                this._containerList.add(row, { x_fill: true });
            }
        }
    },

    _createGroupHeader: function(group) {
        let headerBox = new St.BoxLayout({ style_class: "docker-group-header" });

        let label = new St.Label({
            text: group.name,
            style_class: "docker-group-label"
        });
        headerBox.add(label, { expand: true, x_fill: true, y_align: St.Align.MIDDLE });

        // Determine group state
        let allRunning = true;
        let ids = [];
        for (let i = 0; i < group.containers.length; i++) {
            ids.push(group.containers[i].id);
            if (group.containers[i].state !== "running") allRunning = false;
        }

        let btnLabel = allRunning ? "Stop All" : "Start All";
        let action = allRunning ? "stop" : "start";

        let btn = new St.Button({ style_class: "docker-action-btn" });
        let btnText = new St.Label({
            text: btnLabel,
            style_class: "docker-action-btn-label"
        });
        btn.set_child(btnText);
        btn.connect("clicked", () => {
            if (this._actionInProgress) return;
            btnText.set_text(this._spinnerFrames[0]);
            btn.add_style_class_name("docker-action-btn-loading");
            this._disableAllButtons();
            this._startSpinner(btnText);
            this._runDockerAction(action, ids);
        });

        headerBox.add(btn, { y_align: St.Align.MIDDLE });
        return headerBox;
    },

    _createContainerRow: function(container) {
        let row = new St.BoxLayout({
            style_class: "docker-container-row",
            reactive: true,
            track_hover: true
        });

        // Status dot
        let dotClass = "docker-status-stopped";
        if (container.state === "running") dotClass = "docker-status-running";
        else if (container.state !== "exited" && container.state !== "created") dotClass = "docker-status-other";

        let dot = new St.Label({
            text: "\u25CF ",
            style_class: "docker-status-dot " + dotClass
        });

        // Container name
        let displayName = container.name;
        if (displayName.length > 25) {
            displayName = displayName.substring(0, 22) + "...";
        }
        let nameLabel = new St.Label({
            text: displayName,
            style_class: "docker-container-name"
        });

        // Status text
        let statusLabel = new St.Label({
            text: container.status,
            style_class: "docker-container-status"
        });

        // Action button
        let isRunning = container.state === "running";
        let btn = new St.Button({ style_class: "docker-action-btn" });
        let btnText = new St.Label({
            text: isRunning ? "Stop" : "Start",
            style_class: "docker-action-btn-label"
        });
        btn.set_child(btnText);
        btn.connect("clicked", () => {
            if (this._actionInProgress) return;
            btnText.set_text(this._spinnerFrames[0]);
            btn.add_style_class_name("docker-action-btn-loading");
            this._disableAllButtons();
            this._startSpinner(btnText);
            this._runDockerAction(isRunning ? "stop" : "start", [container.id]);
        });

        row.add(dot, { y_align: St.Align.MIDDLE });
        row.add(nameLabel, { expand: true, x_fill: true, y_align: St.Align.MIDDLE });
        row.add(statusLabel, { y_align: St.Align.MIDDLE });
        row.add(btn, { y_align: St.Align.MIDDLE });

        // Tooltip via Cinnamon's Tooltips module
        let tooltipText = container.name + "\n" + container.image;
        if (container.ports) tooltipText += "\n" + container.ports;
        let tooltip = new Tooltips.Tooltip(row, tooltipText);
        this._tooltips.push(tooltip);

        return row;
    },

    _runDockerAction: function(action, ids) {
        this._actionInProgress = true;
        let cmd = "timeout 30 docker " + action + " " + ids.join(" ");
        try {
            Util.spawnCommandLineAsyncIO(
                "/bin/bash -c \"" + cmd + "\"",
                () => {
                    this._actionInProgress = false;
                    this._stopSpinner();
                    this._fetchContainers();
                }
            );
        } catch (e) {
            this._actionInProgress = false;
            this._stopSpinner();
            global.logError(UUID + ": Failed to run docker " + action + ": " + e.message);
            this._fetchContainers();
        }
    },

    _showError: function(message) {
        this._clearContainerList();
        this._countLabel.set_text("");

        let errorLabel = new St.Label({
            text: message,
            style_class: "docker-error-label"
        });

        let retryBtn = new St.Button({ style_class: "docker-retry-btn" });
        let retryLabel = new St.Label({
            text: "Retry",
            style_class: "docker-retry-btn-label"
        });
        retryBtn.set_child(retryLabel);
        retryBtn.connect("clicked", () => {
            this._fetchContainers();
        });

        this._containerList.add(errorLabel);
        this._containerList.add(retryBtn);
    },

    on_desklet_removed: function() {
        this._stopTimer();
        this._stopSpinner();
        for (let i = 0; i < this._tooltips.length; i++) {
            this._tooltips[i].destroy();
        }
        this._tooltips = [];
    }
};

function main(metadata, desklet_id) {
    return new DockerManagerDesklet(metadata, desklet_id);
}
