/*
 * SpeedPup
 * Copyright (C) 2026 TaskPuppyNatani
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Cairo = imports.cairo;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;

const UUID = "speedpup@taskpuppynatani";

Gettext.bindtextdomain(
    UUID,
    GLib.get_home_dir() + "/.local/share/locale"
);

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const REFRESH_SECONDS = 1;
const GRAPH_WIDTH = 440;
const GRAPH_HEIGHT = 90;

class SpeedPupDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this._deskletPath = metadata.path;

        this.speedTestServer = "auto";
        this.deskletScale = 0.85;

        this.networkInterfaceMode = "auto";
        this.customNetworkInterface = "";

        this.showGraph = true;
        this.graphHistorySeconds = 60;
        this.graphHeight = 90;

        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            deskletId
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "desklet-scale",
            "deskletScale",
            this._onDeskletScaleChanged.bind(this),
            null
        );

        this.settings.bind(
            "speed-test-server",
            "speedTestServer"
        );

        this.settings.bind(
            "network-interface-mode",
            "networkInterfaceMode"
        );

        this.settings.bind(
            "custom-network-interface",
            "customNetworkInterface"
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "show-graph",
            "showGraph",
            this._onGraphSettingsChanged.bind(this),
            null
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "graph-history-seconds",
            "graphHistorySeconds",
            this._onGraphSettingsChanged.bind(this),
            null
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "graph-height",
            "graphHeight",
            this._onGraphSettingsChanged.bind(this),
            null
        );

        this._removed = false;
        this._timerId = 0;
        this._speedTestProcess = null;

        this._lastRxBytes = null;
        this._lastTxBytes = null;
        this._lastSampleTime = null;
        this._activeNetworkKey = null;

        this._downloadHistory = [];
        this._uploadHistory = [];

        this._networkFile = Gio.file_new_for_path("/proc/net/dev");
        this._routeFile = Gio.file_new_for_path("/proc/net/route");

        const stateRoot =
            typeof GLib.get_user_state_dir === "function"
                ? GLib.get_user_state_dir()
                : GLib.build_filenamev([
                    GLib.get_home_dir(),
                    ".local",
                    "state"
                ]);

        this._stateDirectory = GLib.build_filenamev([
            stateRoot,
            "speedpup"
        ]);

        GLib.mkdir_with_parents(
            this._stateDirectory,
            0o700
        );

        this._lastResultFile = Gio.file_new_for_path(
            GLib.build_filenamev([
                this._stateDirectory,
                "last-speed-test.json"
            ])
        );

        this._buildUi();
        this._applyDeskletScale();
        this._applyGraphSettings();
        this._loadLastSpeedTest();
        this._readNetworkStats();

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_SECONDS,
            () => {
                this._readNetworkStats();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _getDeskletScale() {
        const value = Number(this.deskletScale);

        if (!Number.isFinite(value)) {
            return 0.85;
        }

        return Math.max(
            0.5,
            Math.min(1.5, value)
        );
    }

    _onDeskletScaleChanged() {
        this._applyDeskletScale();
    }

    _applyDeskletScale() {
        if (!this._container) {
            return;
        }

        const scale = this._getDeskletScale();
        const px = value =>
            Math.max(1, Math.round(value * scale));

        // Never transform the desklet actor itself. Cinnamon uses the
        // actor allocation for its selection/grab box, so transforming
        // it would make the visible desklet and selection box disagree.
        this.actor.set_scale(1, 1);

        this._container.set_style(
            `padding: ${px(18)}px; ` +
            `min-width: ${px(300)}px; ` +
            `spacing: ${px(7)}px; ` +
            `border-radius: ${px(12)}px;`
        );

        this._title.set_style(
            `font-size: ${px(18)}px;`
        );

        this._liveSection.set_style(
            `padding-top: ${px(6)}px; ` +
            `font-size: ${px(12)}px;`
        );

        this._testSection.set_style(
            `padding-top: ${px(12)}px; ` +
            `font-size: ${px(12)}px;`
        );

        this._downloadLabel.set_style(
            `font-size: ${px(16)}px;`
        );

        this._uploadLabel.set_style(
            `font-size: ${px(16)}px;`
        );

        this._testDownloadLabel.set_style(
            `font-size: ${px(15)}px;`
        );

        this._testUploadLabel.set_style(
            `font-size: ${px(15)}px;`
        );

        this._pingLabel.set_style(
            `font-size: ${px(15)}px;`
        );

        this._graphLegend.set_style(
            `padding-top: ${px(5)}px; ` +
            `spacing: ${px(18)}px;`
        );

        this._graphLegendDownload.set_style(
            `font-size: ${px(11)}px;`
        );

        this._graphLegendUpload.set_style(
            `font-size: ${px(11)}px;`
        );

        this._graphLegendRange.set_style(
            `font-size: ${px(11)}px;`
        );

        this._liveTopRow.set_style(
            `spacing: ${px(18)}px;`
        );

        this._brandLogo.icon_size = px(78);
        this._brandLogo.set_style(
            `margin: ${px(6)}px ${px(10)}px 0 ${px(12)}px;`
        );

        this._testResultsBox.set_style(
            `spacing: ${px(30)}px;`
        );

        this._testNumbersBox.set_style(
            `spacing: ${px(4)}px;`
        );

        this._serverBox.set_style(
            `spacing: ${px(4)}px; ` +
            `min-width: ${px(130)}px;`
        );

        this._serverHeading.set_style(
            `font-size: ${px(12)}px;`
        );

        this._serverLabel.set_style(
            `font-size: ${px(13)}px;`
        );

        this._lastTestedLabel.set_style(
            `padding-top: ${px(3)}px; ` +
            `font-size: ${px(11)}px;`
        );

        this._speedTestButton.set_style(
            `margin-top: ${px(10)}px; ` +
            `padding: ${px(9)}px ${px(14)}px; ` +
            `border-radius: ${px(8)}px;`
        );

        this._networkGraph.width =
            Math.round(GRAPH_WIDTH * scale);

        this._networkGraph.height =
            Math.round(
                this._getGraphHeight() * scale
            );

        this._networkGraph.set_style(
            `margin-top: ${px(2)}px; ` +
            `margin-bottom: ${px(6)}px; ` +
            `border-radius: ${px(6)}px;`
        );

        this._networkGraph.queue_repaint();
    }

    _buildUi() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-container"
        });

        this._title = new St.Label({
            text: "🐾 SpeedPup by TaskPuppyKreations 🐾",
            style_class: "speedpup-title"
        });

        this._liveSection = new St.Label({
            text: _("Live Network Traffic"),
            style_class: "speedpup-section-label"
        });

        this._downloadLabel = new St.Label({
            text: _("↓ Download: measuring..."),
            style_class: "speedpup-speed speedpup-download"
        });

        this._uploadLabel = new St.Label({
            text: _("↑ Upload: measuring..."),
            style_class: "speedpup-speed speedpup-upload"
        });

        this._graphLegend = new St.BoxLayout({
            vertical: false,
            style_class: "speedpup-graph-legend"
        });

        this._graphLegendDownload = new St.Label({
            text: _("↓ Download"),
            style_class: "speedpup-graph-legend-download"
        });

        this._graphLegendUpload = new St.Label({
            text: _("↑ Upload"),
            style_class: "speedpup-graph-legend-upload"
        });

        this._graphLegendRange = new St.Label({
            text: _("• Last %d seconds").format(this.graphHistorySeconds),
            style_class: "speedpup-graph-legend-range"
        });

        this._graphLegend.add_child(this._graphLegendDownload);
        this._graphLegend.add_child(this._graphLegendUpload);
        this._graphLegend.add_child(this._graphLegendRange);

        const logoFile = Gio.file_new_for_path(
            GLib.build_filenamev([
                this._deskletPath,
                "rivet-pixel-logo.png"
            ])
        );

        this._brandLogo = new St.Icon({
            gicon: new Gio.FileIcon({ file: logoFile }),
            icon_size: 78,
            style_class: "speedpup-brand-logo"
        });

        this._liveInfoBox = new St.BoxLayout({
            vertical: true,
            x_expand: true
        });

        this._liveInfoBox.add_child(this._liveSection);
        this._liveInfoBox.add_child(this._downloadLabel);
        this._liveInfoBox.add_child(this._uploadLabel);
        this._liveInfoBox.add_child(this._graphLegend);

        this._liveTopRow = new St.BoxLayout({
            vertical: false,
            style_class: "speedpup-live-top-row"
        });

        this._liveTopRow.add_child(this._liveInfoBox);
        this._liveTopRow.add_child(this._brandLogo);

        this._networkGraph = new St.DrawingArea({
            style_class: "speedpup-network-graph"
        });

        this._networkGraph.width = GRAPH_WIDTH;
        this._networkGraph.height = Number(this.graphHeight) || GRAPH_HEIGHT;

        this._graphRepaintSignal = this._networkGraph.connect(
            "repaint",
            area => this._drawNetworkGraph(area)
        );

        this._testSection = new St.Label({
            text: _("Internet Speed Test"),
            style_class: "speedpup-section-label speedpup-test-section"
        });

        this._testDownloadLabel = new St.Label({
            text: _("↓ Download: --"),
            style_class: "speedpup-result speedpup-download"
        });

        this._testUploadLabel = new St.Label({
            text: _("↑ Upload: --"),
            style_class: "speedpup-result speedpup-upload"
        });

        this._pingLabel = new St.Label({
            text: _("Ping: --"),
            style_class: "speedpup-result"
        });

        this._testResultsBox = new St.BoxLayout({
            vertical: false,
            style_class: "speedpup-test-results"
        });

        this._testNumbersBox = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-test-numbers",
            x_expand: true
        });

        this._serverBox = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-server-box"
        });

        this._serverHeading = new St.Label({
            text: _("Test Server"),
            style_class: "speedpup-server-heading"
        });

        this._serverLabel = new St.Label({
            text: "--",
            style_class: "speedpup-server"
        });

        this._lastTestedLabel = new St.Label({
            text: _("Last tested: --"),
            style_class: "speedpup-last-tested"
        });

        this._testNumbersBox.add_child(this._testDownloadLabel);
        this._testNumbersBox.add_child(this._testUploadLabel);
        this._testNumbersBox.add_child(this._pingLabel);

        this._serverBox.add_child(this._serverHeading);
        this._serverBox.add_child(this._serverLabel);
        this._serverBox.add_child(this._lastTestedLabel);

        this._testResultsBox.add_child(this._testNumbersBox);
        this._testResultsBox.add_child(this._serverBox);

        this._speedTestButtonLabel = new St.Label({
            text: _("▶ Run Speed Test")
        });

        this._speedTestButton = new St.Button({
            style_class: "speedpup-button",
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this._speedTestButton.set_child(this._speedTestButtonLabel);

        this._buttonSignalId = this._speedTestButton.connect(
            "clicked",
            () => this._runSpeedTest()
        );

        this._container.add_child(this._title);
        this._container.add_child(this._liveTopRow);
        this._container.add_child(this._networkGraph);

        this._container.add_child(this._testSection);
        this._container.add_child(this._testResultsBox);
        this._container.add_child(this._speedTestButton);

        this.setContent(this._container);
    }

    _readNetworkStats() {
        if (
            this.networkInterfaceMode === "auto" &&
            this._routeFile
        ) {
            this._routeFile.load_contents_async(
                null,
                (file, result) => {
                    if (this._removed) {
                        return;
                    }

                    let interfaceName = null;

                    try {
                        const [success, contents] =
                            file.load_contents_finish(result);

                        if (success) {
                            interfaceName =
                                this._parseDefaultRouteInterface(
                                    ByteArray.toString(contents)
                                );
                        }
                    } catch (error) {
                        global.logError(
                            `SpeedPup route read failed: ${error}`
                        );
                    }

                    this._readNetworkDeviceStats(interfaceName);
                }
            );

            return;
        }

        this._readNetworkDeviceStats(null);
    }

    _readNetworkDeviceStats(autoInterface) {
        this._networkFile.load_contents_async(
            null,
            (file, result) => {
                if (this._removed) {
                    return;
                }

                try {
                    const [success, contents] =
                        file.load_contents_finish(result);

                    if (!success) {
                        this._showNetworkError(
                            _("Unable to read network statistics")
                        );
                        return;
                    }

                    const text = ByteArray.toString(contents);

                    const totals = this._parseNetworkStats(
                        text,
                        autoInterface
                    );

                    if (totals === null) {
                        this._showNetworkError(
                            _("No matching network interface")
                        );
                        return;
                    }

                    this._updateSpeeds(
                        totals.rx,
                        totals.tx
                    );
                } catch (error) {
                    global.logError(
                        `SpeedPup network read failed: ${error}`
                    );

                    this._showNetworkError(
                        _("Network monitor error")
                    );
                }
            }
        );
    }

    _parseDefaultRouteInterface(text) {
        const lines = text.split("\n");

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/);

            if (parts.length < 4) {
                continue;
            }

            const interfaceName = parts[0];
            const destination = parts[1];
            const flags = parseInt(parts[3], 16);

            if (
                destination === "00000000" &&
                Number.isFinite(flags) &&
                (flags & 0x1) !== 0
            ) {
                return interfaceName;
            }
        }

        return null;
    }

    _parseNetworkStats(text, autoInterface = null) {
        const lines = text.split("\n");

        let totalRx = 0;
        let totalTx = 0;
        let foundInterface = false;

        let targetInterface = null;

        if (this.networkInterfaceMode === "auto") {
            targetInterface = autoInterface;
        } else if (this.networkInterfaceMode === "custom") {
            const custom = String(
                this.customNetworkInterface || ""
            ).trim();

            if (custom !== "") {
                targetInterface = custom;
            }
        }

        let activeNetworkKey;

        if (targetInterface !== null) {
            activeNetworkKey = `interface:${targetInterface}`;
        } else if (this.networkInterfaceMode === "all") {
            activeNetworkKey = "all";
        } else {
            activeNetworkKey = `${this.networkInterfaceMode}:fallback`;
        }

        if (this._activeNetworkKey !== activeNetworkKey) {
            this._activeNetworkKey = activeNetworkKey;
            this._resetNetworkSampling();
        }

        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line) {
                continue;
            }

            const parts = line.split(/[:\s]+/);

            if (parts.length < 10) {
                continue;
            }

            const interfaceName = parts[0];

            if (interfaceName === "lo") {
                continue;
            }

            if (
                targetInterface !== null &&
                interfaceName !== targetInterface
            ) {
                continue;
            }

            const rxBytes = Number(parts[1]);
            const txBytes = Number(parts[9]);

            if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
                continue;
            }

            totalRx += rxBytes;
            totalTx += txBytes;
            foundInterface = true;
        }

        if (!foundInterface) {
            return null;
        }

        return {
            rx: totalRx,
            tx: totalTx
        };
    }

    _resetNetworkSampling() {
        this._lastRxBytes = null;
        this._lastTxBytes = null;
        this._lastSampleTime = null;

        this._downloadHistory = [];
        this._uploadHistory = [];

        if (this._downloadLabel) {
            this._downloadLabel.set_text(
                _("↓ Download: measuring...")
            );
        }

        if (this._uploadLabel) {
            this._uploadLabel.set_text(
                _("↑ Upload: measuring...")
            );
        }

        if (this._networkGraph) {
            this._networkGraph.queue_repaint();
        }
    }

    _updateSpeeds(rxBytes, txBytes) {
        const now = GLib.get_monotonic_time();

        if (
            this._lastRxBytes === null ||
            this._lastTxBytes === null ||
            this._lastSampleTime === null
        ) {
            this._lastRxBytes = rxBytes;
            this._lastTxBytes = txBytes;
            this._lastSampleTime = now;
            return;
        }

        const elapsedSeconds =
            (now - this._lastSampleTime) / 1000000;

        if (elapsedSeconds <= 0) {
            return;
        }

        let rxDelta = rxBytes - this._lastRxBytes;
        let txDelta = txBytes - this._lastTxBytes;

        if (rxDelta < 0) {
            rxDelta = 0;
        }

        if (txDelta < 0) {
            txDelta = 0;
        }

        const downloadBytesPerSecond =
            rxDelta / elapsedSeconds;

        const uploadBytesPerSecond =
            txDelta / elapsedSeconds;

        this._downloadLabel.set_text(
            _("↓ Download: %s").format(
                this._formatRate(downloadBytesPerSecond)
            )
        );

        this._uploadLabel.set_text(
            _("↑ Upload: %s").format(
                this._formatRate(uploadBytesPerSecond)
            )
        );

        this._downloadHistory.push(downloadBytesPerSecond);
        this._uploadHistory.push(uploadBytesPerSecond);

        const historyLimit = this._getGraphHistorySeconds();

        if (this._downloadHistory.length > historyLimit) {
            this._downloadHistory.shift();
        }

        if (this._uploadHistory.length > historyLimit) {
            this._uploadHistory.shift();
        }

        if (this._networkGraph) {
            this._networkGraph.queue_repaint();
        }

        this._lastRxBytes = rxBytes;
        this._lastTxBytes = txBytes;
        this._lastSampleTime = now;
    }

    _getGraphHistorySeconds() {
        const value = Number(this.graphHistorySeconds);

        if (!Number.isFinite(value)) {
            return 60;
        }

        return Math.max(15, Math.min(300, Math.round(value)));
    }

    _getGraphHeight() {
        const value = Number(this.graphHeight);

        if (!Number.isFinite(value)) {
            return 90;
        }

        return Math.max(50, Math.min(200, Math.round(value)));
    }

    _onGraphSettingsChanged() {
        if (!this._networkGraph || !this._graphLegend) {
            return;
        }

        this._applyGraphSettings();
    }

    _applyGraphSettings() {
        if (
            !this._networkGraph ||
            !this._graphLegend ||
            !this._graphLegendRange
        ) {
            return;
        }

        const historySeconds = this._getGraphHistorySeconds();
        const graphHeight = this._getGraphHeight();
        const visible = Boolean(this.showGraph);

        this._networkGraph.visible = visible;
        this._graphLegend.visible = visible;

        this._networkGraph.height = Math.round(
            graphHeight * this._getDeskletScale()
        );

        this._graphLegendRange.set_text(
            _("• Last %d seconds").format(historySeconds)
        );

        if (this._downloadHistory.length > historySeconds) {
            this._downloadHistory =
                this._downloadHistory.slice(-historySeconds);
        }

        if (this._uploadHistory.length > historySeconds) {
            this._uploadHistory =
                this._uploadHistory.slice(-historySeconds);
        }

        this._networkGraph.queue_repaint();
    }

    _drawNetworkGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Dark translucent graph surface.
        cr.setSourceRGBA(0.04, 0.04, 0.05, 0.55);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Subtle horizontal guides.
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.08);

        for (let i = 1; i < 4; i++) {
            const y = (height / 4) * i;

            cr.moveTo(0, y);
            cr.lineTo(width, y);
        }

        cr.stroke();

        if (
            this._downloadHistory.length < 2 &&
            this._uploadHistory.length < 2
        ) {
            return;
        }

        const allValues = this._downloadHistory.concat(
            this._uploadHistory
        );

        // Keep tiny idle traffic visible while still autoscaling
        // upward for downloads and speed tests.
        const maxValue = Math.max(
            1024,
            ...allValues
        );

        this._drawGraphLine(
            cr,
            this._downloadHistory,
            width,
            height,
            maxValue,
            0.54,
            0.89,
            0.20
        );

        this._drawGraphLine(
            cr,
            this._uploadHistory,
            width,
            height,
            maxValue,
            0.72,
            0.35,
            1.00
        );
    }

    _drawGraphLine(
        cr,
        values,
        width,
        height,
        maxValue,
        red,
        green,
        blue
    ) {
        if (values.length < 2) {
            return;
        }

        const padding = 3;
        const graphHeight = height - (padding * 2);

        cr.setLineWidth(2);
        cr.setSourceRGBA(red, green, blue, 0.95);

        for (let i = 0; i < values.length; i++) {
            const historySeconds = this._getGraphHistorySeconds();

            const x =
                (i / Math.max(1, historySeconds - 1)) * width;

            const normalized =
                Math.min(1, Math.max(0, values[i] / maxValue));

            const y =
                height -
                padding -
                (normalized * graphHeight);

            if (i === 0) {
                cr.moveTo(x, y);
            } else {
                cr.lineTo(x, y);
            }
        }

        cr.stroke();
    }

    _formatRate(bytesPerSecond) {
        const units = ["B/s", "KB/s", "MB/s", "GB/s"];

        let value = Math.max(0, bytesPerSecond);
        let unitIndex = 0;

        while (
            value >= 1024 &&
            unitIndex < units.length - 1
        ) {
            value /= 1024;
            unitIndex++;
        }

        if (unitIndex === 0) {
            return `${Math.round(value)} ${units[unitIndex]}`;
        }

        if (value >= 100) {
            return `${value.toFixed(0)} ${units[unitIndex]}`;
        }

        if (value >= 10) {
            return `${value.toFixed(1)} ${units[unitIndex]}`;
        }

        return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    _runSpeedTest() {
        if (this._speedTestProcess !== null) {
            return;
        }

        const python =
            GLib.find_program_in_path("python3");

        if (!python) {
            this._showSpeedTestError(
                _("Python 3 is not available")
            );
            return;
        }

        const helper = GLib.build_filenamev([
            this._deskletPath,
            "speedtest.py"
        ]);

        this._setTestingState(true);

        try {
            const args = [
                python,
                helper,
                "--json"
            ];

            if (
                this.speedTestServer &&
                this.speedTestServer !== "auto"
            ) {
                args.push(
                    "--server",
                    String(this.speedTestServer)
                );
            }

            this._speedTestProcess = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
            );

            this._speedTestProcess.communicate_utf8_async(
                null,
                null,
                (process, result) => {
                    if (this._removed) {
                        return;
                    }

                    try {
                        const [
                            success,
                            stdout,
                            stderr
                        ] = process.communicate_utf8_finish(
                            result
                        );

                        if (
                            !success ||
                            process.get_exit_status() !== 0
                        ) {
                            global.log(
                                `SpeedPup speed test error: ${stderr}`
                            );

                            this._showSpeedTestError(
                                _("Speed test failed")
                            );

                            return;
                        }

                        const data = JSON.parse(
                            stdout.trim()
                        );

                        this._displaySpeedTestResults(
                            data
                        );
                    } catch (error) {
                        global.logError(
                            `SpeedPup speed test failed: ${error}`
                        );

                        this._showSpeedTestError(
                            _("Unable to read speed test result")
                        );
                    } finally {
                        this._speedTestProcess = null;
                        this._setTestingState(false);
                    }
                }
            );
        } catch (error) {
            global.logError(
                `SpeedPup could not start speed test: ${error}`
            );

            this._speedTestProcess = null;
            this._setTestingState(false);

            this._showSpeedTestError(
                _("Unable to start speed test")
            );
        }
    }

    _displaySpeedTestResults(data, saveResult = true) {
        const result = Array.isArray(data) ? data[0] : data;

        if (!result) {
            throw new Error("Speed test returned no results");
        }

        const downloadMbps = Number(result.download);
        const uploadMbps = Number(result.upload);
        const pingMs = Number(result.ping);

        if (
            !Number.isFinite(downloadMbps) ||
            !Number.isFinite(uploadMbps) ||
            !Number.isFinite(pingMs)
        ) {
            throw new Error("Speed test returned invalid result values");
        }

        this._testDownloadLabel.set_text(
            _("↓ Download: %s Mbps").format(
                downloadMbps.toFixed(2)
            )
        );

        this._testUploadLabel.set_text(
            _("↑ Upload: %s Mbps").format(
                uploadMbps.toFixed(2)
            )
        );

        this._pingLabel.set_text(
            _("Ping: %s ms").format(
                pingMs.toFixed(1)
            )
        );

        let serverName = "--";

        if (
            result.server &&
            typeof result.server.name === "string" &&
            result.server.name.trim() !== ""
        ) {
            serverName = result.server.name.trim();
        }

        this._serverLabel.set_text(serverName);

        this._lastTestedLabel.set_text(
            this._formatLastTested(result.timestamp)
        );

        if (saveResult) {
            const timestamp =
                typeof result.timestamp === "string"
                    ? result.timestamp
                    : new Date().toISOString();

            this._saveLastSpeedTest({
                timestamp: timestamp,
                download: downloadMbps,
                upload: uploadMbps,
                ping: pingMs,
                server: {
                    name: serverName
                }
            });
        }
    }

    _loadLastSpeedTest() {
        if (!this._lastResultFile) {
            return;
        }

        this._lastResultFile.load_contents_async(
            null,
            (file, result) => {
                if (this._removed) {
                    return;
                }

                try {
                    const [success, contents] =
                        file.load_contents_finish(result);

                    if (!success) {
                        return;
                    }

                    const text =
                        ByteArray.toString(contents).trim();

                    if (!text) {
                        return;
                    }

                    const savedResult = JSON.parse(text);

                    this._displaySpeedTestResults(
                        savedResult,
                        false
                    );
                } catch (error) {
                    // First run or missing/corrupt state file:
                    // simply leave the display at "--".
                }
            }
        );
    }

    _saveLastSpeedTest(result) {
        if (!this._lastResultFile || this._removed) {
            return;
        }

        const contents = ByteArray.fromString(
            JSON.stringify(result, null, 2)
        );

        this._lastResultFile.replace_contents_async(
            contents,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (file, asyncResult) => {
                try {
                    file.replace_contents_finish(asyncResult);
                } catch (error) {
                    if (!this._removed) {
                        global.logError(
                            `SpeedPup could not save last result: ${error}`
                        );
                    }
                }
            }
        );
    }

    _formatLastTested(timestamp) {
        if (typeof timestamp !== "string" || timestamp.trim() === "") {
            return _("Last tested: --");
        }

        // The speed-test helper may provide nanosecond precision. Trim it to
        // milliseconds so JavaScript Date parsing stays predictable.
        const parseableTimestamp = timestamp.replace(
            /(\.\d{3})\d+([+-]\d{2}:\d{2}|Z)$/,
            "$1$2"
        );

        const date = new Date(parseableTimestamp);

        if (Number.isNaN(date.getTime())) {
            return _("Last tested: --");
        }

        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const suffix = hours >= 12 ? "PM" : "AM";

        hours %= 12;

        if (hours === 0) {
            hours = 12;
        }

        return _("Last tested: %s").format(
            `${hours}:${minutes} ${suffix}`
        );
    }

    _setTestingState(testing) {
        this._speedTestButton.set_reactive(!testing);

        if (testing) {
            this._speedTestButtonLabel.set_text(
                _("Testing connection...")
            );

            this._testDownloadLabel.set_text(
                _("↓ Download: testing...")
            );

            this._testUploadLabel.set_text(
                _("↑ Upload: waiting...")
            );

            this._pingLabel.set_text(
                _("Ping: measuring...")
            );
        } else {
            this._speedTestButtonLabel.set_text(
                _("▶ Run Speed Test")
            );
        }
    }

    _showSpeedTestError(message) {
        this._testDownloadLabel.set_text(message);
        this._testUploadLabel.set_text(
            _("Check Cinnamon logs for details")
        );
        this._pingLabel.set_text(_("Ping: --"));
    }

    _showNetworkError(message) {
        if (this._removed) {
            return;
        }

        this._downloadLabel.set_text(
            _("↓ Download: %s").format(message)
        );

        this._uploadLabel.set_text(
            _("↑ Upload: unavailable")
        );
    }

    on_desklet_removed() {
        this._removed = true;

        if (this._timerId !== 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (
            this._speedTestProcess !== null &&
            !this._speedTestProcess.get_if_exited()
        ) {
            this._speedTestProcess.force_exit();
        }

        if (
            this._speedTestButton &&
            this._buttonSignalId
        ) {
            this._speedTestButton.disconnect(
                this._buttonSignalId
            );
        }

        if (
            this._networkGraph &&
            this._graphRepaintSignal
        ) {
            this._networkGraph.disconnect(
                this._graphRepaintSignal
            );
        }

        this._downloadHistory = [];
        this._uploadHistory = [];

        this._speedTestProcess = null;
        this._networkFile = null;
        this._routeFile = null;
        this._lastResultFile = null;
        this._stateDirectory = null;

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }
}

function main(metadata, deskletId) {
    return new SpeedPupDesklet(metadata, deskletId);
}
