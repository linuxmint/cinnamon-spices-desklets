const Desklet = imports.ui.desklet;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Extension = imports.ui.extension;

// Cinnamon 6.8 deprecates require() in favour of getCurrentExtension(), which older versions lack.
// Pass the whole path as one name: Cinnamon can't clear imports.helpers on reload.
function loadHelper(path) {
    if (Extension.getCurrentExtension) {
        return Extension.getCurrentExtension().imports[path];
    }
    return require(path);
}

const ChartScale = loadHelper("./helpers/chart-scale");
const CustomAppearance = loadHelper("./helpers/custom-appearance");
const { PredictionFetcher } = loadHelper("./helpers/prediction-fetcher");
const { RefreshSchedule } = loadHelper("./helpers/refresh-schedule");
const TideApi = loadHelper("./helpers/tide-api");
const TideChart = loadHelper("./helpers/tide-chart");
const TideReading = loadHelper("./helpers/tide-reading");

// The real UUID even when running as a devtest- copy, because translations install under it.
const UUID = "tide-times@alexmakessoftware";

// A minute moves the curve by under a pixel, so updating more often would show nothing.
const CLOCK_TICK_SECONDS = 60;

const MILLISECONDS_PER_SECOND = 1000;

const FAR_STATION_KM = 50;

const SHOW_TENTHS_BELOW_KM = 10;

const SECONDARY_TEXT_STYLE = "font-size: 90%;";
const WARNING_TEXT_STYLE = `${SECONDARY_TEXT_STYLE} color: #ff9933;`;
const TITLE_STYLE = "font-weight: bold;";

// A label needs some text to keep its height, which stops the layout shifting.
const EMPTY_LINE = " ";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

class TideTimesDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader(_("Tide Times"));

        this._state = { predictions: null, error: null };
        this._axis = null;
        this._timeZone = GLib.TimeZone.new_local();

        this._bindSettings(metadata.uuid, deskletId);
        this._buildUi();

        this._fetcher = new PredictionFetcher(TideApi, ChartScale.HOURS_EITHER_SIDE_OF_NOW);
        this._schedule = new RefreshSchedule({
            fetchPredictions: (location, onDone) => this._fetcher.fetchPredictions(location, onDone),
            runAfter: (delayMs, callback) => this._runAfter(delayMs, callback),
            onStateChanged: (state) => this._onStateChanged(state),
        });

        this._clockTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CLOCK_TICK_SECONDS, () => {
            this._updateStatus();
            this._chart.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });

        if (TideApi.isUsableLocation(this._location)) {
            this._schedule.start(this._location);
        }
        this._updateStatus();
    }

    // On a reload, on_desklet_removed runs after the new instance has registered its
    // settings under the same ID. Finalizing that late would unregister the new instance,
    // and the settings dialog could then no longer reach it.
    on_desklet_reloaded() {
        this._finalizeSettings();
    }

    on_desklet_removed() {
        this._schedule.stop();
        this._fetcher.destroy();
        GLib.source_remove(this._clockTickId);
        this._clockTickId = 0;
        this._finalizeSettings();
    }

    _finalizeSettings() {
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }

    _bindSettings(uuid, deskletId) {
        this.settings = new Settings.DeskletSettings(this, uuid, deskletId);
        this.settings.bind("locationName", "locationName", () => this._updateTitle());
        this.settings.bind("latitude", "latitude", () => this._onLocationChanged());
        this.settings.bind("longitude", "longitude", () => this._onLocationChanged());
        this.settings.bind("chartWidth", "chartWidth", () => this._applyChartSize());
        this.settings.bind("chartHeight", "chartHeight", () => this._applyChartSize());
        ["overrideTheme", "backgroundOpacity", "textColour", "backgroundColour", "cornerRadius"]
            .forEach((key) => this.settings.bind(key, key, () => this._applyAppearance()));
    }

    get _location() {
        return { latitude: this.latitude, longitude: this.longitude };
    }

    _buildUi() {
        this._titleLabel = new St.Label({ style: TITLE_STYLE });
        this._stationLabel = this._createWrappingLabel();
        this._chart = new St.DrawingArea();
        this._chart.connect("repaint", (area) => this._drawChart(area));
        this._statusLabel = this._createWrappingLabel();
        this._noticeLabel = this._createWrappingLabel();
        this._noticeLabel.set_style(WARNING_TEXT_STYLE);
        this._labels = [this._titleLabel, this._stationLabel, this._statusLabel, this._noticeLabel];

        this._container = new St.BoxLayout({ vertical: true });
        [this._titleLabel, this._stationLabel, this._chart, this._statusLabel, this._noticeLabel]
            .forEach((actor) => this._container.add_child(actor));
        this.setContent(this._container);

        this._updateTitle();
        this._applyChartSize();
        this._applyAppearance();
    }

    _createWrappingLabel() {
        const label = new St.Label({ text: EMPTY_LINE, style: SECONDARY_TEXT_STYLE });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        return label;
    }

    _applyChartSize() {
        const scale = global.ui_scale;
        this._chart.set_size(this.chartWidth * scale, this.chartHeight * scale);
        this._labels.forEach((label) => label.set_width(this.chartWidth * scale));
    }

    // The labels and the chart inherit the text colour. Warnings set their own, so they stay orange.
    _applyAppearance() {
        this._updateDecoration();
        this._container.set_style(this.overrideTheme ? CustomAppearance.containerStyle(this) : null);
        this._chart.queue_repaint();
    }

    // Overrides the base class, which also calls this when the desktop's decoration setting changes.
    // The theme's border and header would otherwise surround the custom background.
    _updateDecoration() {
        if (this.overrideTheme) {
            this._header.hide();
            this.content.style_class = "desklet";
        } else {
            super._updateDecoration();
        }
    }

    _runAfter(delayMs, callback) {
        const delaySeconds = Math.ceil(delayMs / MILLISECONDS_PER_SECOND);
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => {
            callback();
            return GLib.SOURCE_REMOVE;
        });
        return () => GLib.source_remove(sourceId);
    }

    _onLocationChanged() {
        if (TideApi.isUsableLocation(this._location)) {
            this._schedule.setLocation(this._location);
        } else {
            this._schedule.stop();
            this._onStateChanged({ predictions: null, error: null });
        }
    }

    _onStateChanged(state) {
        const hasNewPredictions = state.predictions !== this._state.predictions;
        this._state = state;
        if (hasNewPredictions) {
            // Scaling to all the fetched data, not just the visible part, stops the
            // axis jumping as the window moves along.
            this._axis = state.predictions
                ? ChartScale.heightAxis(state.predictions.samples.map((sample) => sample.level))
                : null;
            this._chart.queue_repaint();
        }
        this._updateStation();
        this._updateStatus();
    }

    _updateTitle() {
        this._titleLabel.set_text(this.locationName || _("Tide Times"));
    }

    _updateStation() {
        const predictions = this._state.predictions;
        const isFar = predictions?.distanceKm > FAR_STATION_KM;
        this._stationLabel.set_text(this._describeStation(predictions, isFar));
        this._stationLabel.set_style(isFar ? WARNING_TEXT_STYLE : SECONDARY_TEXT_STYLE);
    }

    _describeStation(predictions, isFar) {
        if (!predictions || predictions.stationName === null) {
            return EMPTY_LINE;
        }
        if (predictions.distanceKm === null) {
            return _("Station: %s").format(predictions.stationName);
        }
        const distance = predictions.distanceKm.toFixed(predictions.distanceKm < SHOW_TENTHS_BELOW_KM ? 1 : 0);
        const template = isFar
            ? _("Warning: nearest station is %s, %s km away")
            : _("Station: %s, %s km away");
        return template.format(predictions.stationName, distance);
    }

    _updateStatus() {
        const { predictions, error } = this._state;
        const isShowingError = error && !predictions;
        this._statusLabel.set_text(this._describeTide());
        this._statusLabel.set_style(isShowingError ? WARNING_TEXT_STYLE : SECONDARY_TEXT_STYLE);
        this._noticeLabel.set_text(this._describeNotice());
    }

    _describeTide() {
        const { predictions, error } = this._state;
        if (!TideApi.isUsableLocation(this._location)) {
            return _("Right-click and choose Configure to set a location.");
        }
        if (!predictions) {
            return error ? this._describeError(error) : _("Fetching tide predictions...");
        }

        const reading = TideReading.readTide(predictions.samples, predictions.extremes, Date.now());
        if (!reading) {
            return _("No prediction is available for the current time.");
        }
        return this._describeReading(reading);
    }

    _describeReading({ level, isRising, nextExtreme }) {
        const height = level.toFixed(1);
        if (!nextExtreme) {
            return (isRising ? _("%s m, rising") : _("%s m, falling")).format(height);
        }
        const time = ChartScale.formatLocalTime(nextExtreme.timeMs, this._timeZone);
        const template = nextExtreme.isHigh ? _("%s m, rising \u00b7 high at %s") : _("%s m, falling \u00b7 low at %s");
        return template.format(height, time);
    }

    _describeNotice() {
        const { predictions, error } = this._state;
        return predictions && error ? _("Could not refresh, so this may be out of date.") : EMPTY_LINE;
    }

    _describeError(error) {
        switch (error.kind) {
        case TideApi.ErrorKind.INVALID_LOCATION:
            return _("Open Waters rejected these coordinates.");
        case TideApi.ErrorKind.NO_STATION:
            return _("No tide station has predictions for this location.");
        case TideApi.ErrorKind.RATE_LIMITED:
            return _("Open Waters is limiting requests. Trying again later.");
        case TideApi.ErrorKind.NETWORK:
            return _("Could not reach Open Waters. Trying again soon.");
        case TideApi.ErrorKind.SERVICE_UNAVAILABLE:
            return _("Open Waters is unavailable. Trying again soon.");
        default:
            return _("Unexpected reply from Open Waters. Trying again soon.");
        }
    }

    _drawChart(area) {
        const cr = area.get_context();
        const predictions = this._state.predictions;
        if (predictions) {
            const [width, height] = area.get_surface_size();
            TideChart.drawTideChart(cr, {
                samples: predictions.samples,
                axis: this._axis,
                nowMs: Date.now(),
                timeZone: this._timeZone,
                textColour: area.get_theme_node().get_foreground_color(),
                surfaceSize: { width, height },
                uiScale: global.ui_scale,
                formatHeight: (metres) => _("%s m").format(metres),
            });
        }
        cr.$dispose();
    }
}

function main(metadata, deskletId) {
    return new TideTimesDesklet(metadata, deskletId);
}
