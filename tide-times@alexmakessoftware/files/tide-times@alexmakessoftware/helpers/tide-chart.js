const Cairo = imports.cairo;
const Extension = imports.ui.extension;

// Same choice as loadHelper in desklet.js, which explains why.
const ChartScale = Extension.getCurrentExtension
    ? Extension.getCurrentExtension().imports["./helpers/chart-scale"]
    : require("./helpers/chart-scale");

const CHART_MARGIN_LEFT = 34;
const CHART_MARGIN_RIGHT = 10;
const CHART_MARGIN_TOP = 8;
const CHART_MARGIN_BOTTOM = 20;

const CHART_FONT_SIZE = 11;
const TIME_LABEL_OFFSET = 14;
// Centres the height labels vertically on their grid lines.
const HEIGHT_LABEL_NUDGE = 4;
const HEIGHT_LABEL_GAP = 5;

const CURVE_LINE_WIDTH = 2;
const MARKER_LINE_WIDTH = 1.5;
const GRID_LINE_WIDTH = 1;

const CURVE_RGB = [0.36, 0.72, 0.96];
const CURVE_FILL_ALPHA = 0.22;
const MARKER_RGB = [1, 0.6, 0.2];
const GRID_ALPHA = 0.15;
const COLOUR_CHANNEL_MAX = 255;

function drawTideChart(cr, { samples, axis, nowMs, timeZone, textColour, surfaceSize, uiScale, formatHeight }) {
    cr.scale(uiScale, uiScale);
    const plot = {
        left: CHART_MARGIN_LEFT,
        top: CHART_MARGIN_TOP,
        width: surfaceSize.width / uiScale - CHART_MARGIN_LEFT - CHART_MARGIN_RIGHT,
        height: surfaceSize.height / uiScale - CHART_MARGIN_TOP - CHART_MARGIN_BOTTOM,
    };
    const window = ChartScale.timeWindow(nowMs);
    const chart = {
        cr,
        plot,
        textRgb: [textColour.red, textColour.green, textColour.blue].map((channel) => channel / COLOUR_CHANNEL_MAX),
        xFor: (timeMs) => plot.left + ChartScale.fractionWithin(timeMs, window.startMs, window.endMs) * plot.width,
        yFor: (level) => plot.top + plot.height - ChartScale.fractionWithin(level, axis.min, axis.max) * plot.height,
    };

    cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
    cr.setFontSize(CHART_FONT_SIZE);
    _drawHeightAxis(chart, axis.ticks, formatHeight);
    _drawTimeAxis(chart, ChartScale.hourTicks(window.startMs, window.endMs, timeZone));
    _drawCurve(chart, samples);
    _drawNowMarker(chart, nowMs);
}

function _drawHeightAxis({ cr, plot, textRgb, yFor }, heights, formatHeight) {
    cr.setLineWidth(GRID_LINE_WIDTH);
    for (const height of heights) {
        const y = yFor(height);
        cr.setSourceRGBA(...textRgb, GRID_ALPHA);
        cr.moveTo(plot.left, y);
        cr.lineTo(plot.left + plot.width, y);
        cr.stroke();

        const label = formatHeight(height);
        cr.setSourceRGB(...textRgb);
        cr.moveTo(plot.left - cr.textExtents(label).width - HEIGHT_LABEL_GAP, y + HEIGHT_LABEL_NUDGE);
        cr.showText(label);
    }
}

function _drawTimeAxis({ cr, plot, textRgb, xFor }, ticks) {
    cr.setSourceRGB(...textRgb);
    for (const tick of ticks) {
        const labelWidth = cr.textExtents(tick.label).width;
        const centredX = xFor(tick.timeMs) - labelWidth / 2;
        const x = Math.min(Math.max(centredX, plot.left), plot.left + plot.width - labelWidth);
        cr.moveTo(x, plot.top + plot.height + TIME_LABEL_OFFSET);
        cr.showText(tick.label);
    }
}

function _drawCurve({ cr, plot, xFor, yFor }, samples) {
    cr.save();
    cr.rectangle(plot.left, plot.top, plot.width, plot.height);
    cr.clip();

    // Points outside the window are cut off by the clip.
    samples.forEach((sample, index) => {
        const x = xFor(sample.timeMs);
        const y = yFor(sample.level);
        if (index === 0) {
            cr.moveTo(x, y);
        } else {
            cr.lineTo(x, y);
        }
    });
    cr.setSourceRGB(...CURVE_RGB);
    cr.setLineWidth(CURVE_LINE_WIDTH);
    cr.strokePreserve();

    const floorY = plot.top + plot.height;
    cr.lineTo(xFor(samples[samples.length - 1].timeMs), floorY);
    cr.lineTo(xFor(samples[0].timeMs), floorY);
    cr.closePath();
    cr.setSourceRGBA(...CURVE_RGB, CURVE_FILL_ALPHA);
    cr.fill();
    cr.restore();
}

function _drawNowMarker({ cr, plot, xFor }, nowMs) {
    const x = xFor(nowMs);
    cr.setSourceRGB(...MARKER_RGB);
    cr.setLineWidth(MARKER_LINE_WIDTH);
    cr.moveTo(x, plot.top);
    cr.lineTo(x, plot.top + plot.height);
    cr.stroke();
}
