const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;

const UUID = 'stock-price-chart@v-radev';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(`${DESKLET_DIR}/lib`);
const LoggerModule = imports['logger'];
const logger = new LoggerModule.LoggerClass();

class ChartClassDeclaration {
  _canvas = null;

  _labels = null;
  _values = null;
  _chartSettings = null;

  _MARGIN = { left: 50, right: 25, top: 30, bottom: 50 };

  constructor(labels, values, chartSettings) {
    Clutter.init(null);

    this._labels = labels;
    this._values = values;
    this._chartSettings = chartSettings;
  }

  drawCanvas(canvasWidth, canvasHeight, unitSize) {
    const that = this;

    logger.log('--- Start drawing chart canvas.');

    this._canvas = new Clutter.Canvas();
    this._canvas.set_size(canvasWidth, canvasHeight);

    this._canvas.connect('draw', function(canvas, cr, width, height) {
      // Chart geometry
      const chartW = width - that._MARGIN.left - that._MARGIN.right;
      const chartH = height - that._MARGIN.top - that._MARGIN.bottom;

      // Draw background
      that._drawChartBackground(cr, canvasWidth, canvasHeight, unitSize);

      // Draw X and Y scales
      that._drawAxes(cr, chartW, chartH);

      // Draw chart line
      that._drawChartLine(cr, chartW, chartH);

      // Draw data points
      that._drawDataPoints(cr, chartW, chartH);

      // Draw chart title
      that._drawChartTitle(cr, chartW, chartH);

      return false; // Signal handled
    });

    return this._canvas;
  }

  _drawChartBackground(canvasContext, canvasWidth, canvasHeight, unitSize) {
    logger.log('--- Start drawing chart background.');

    const transparency = String(this._chartSettings.backgroundTransparency);
    const backgroundColor = this._parseRgbaValues(this._chartSettings.backgroundColor, transparency);
    const radius = 2 * unitSize / 3;
    const degrees = Math.PI / 180.0;

    // Chart background with rounded corners
    canvasContext.setSourceRGBA(backgroundColor[0], backgroundColor[1], backgroundColor[2], backgroundColor[3]);
    canvasContext.newSubPath();
    canvasContext.arc(canvasWidth - radius, radius, radius, -90 * degrees, 0 * degrees);
    canvasContext.arc(canvasWidth - radius, canvasHeight - radius, radius, 0 * degrees, 90 * degrees);
    canvasContext.arc(radius, canvasHeight - radius, radius, 90 * degrees, 180 * degrees);
    canvasContext.arc(radius, radius, radius, 180 * degrees, 270 * degrees);
    canvasContext.closePath();
    canvasContext.fill();
  }

  _drawAxes(canvasContext, chartWidth, chartHeight) {
    logger.log('--- Start drawing chart axes.');

    const originX = this._MARGIN.left;
    const originY = this._MARGIN.top + chartHeight;
    const numberOfLabels = this._labels.length;
    const fontColor = this._parseRgbaValues(this._chartSettings.fontColor, 1);
    const midlineColor = this._parseRgbaValues(this._chartSettings.chartMidlinesColor, 1);
    const axesColor = this._parseRgbaValues(this._chartSettings.chartAxesColor, 1);

    // Y scale (money)
    const minValue = Math.min.apply(null, this._values);
    const maxValue = Math.max.apply(null, this._values);
    const yMax = Math.ceil(maxValue + maxValue * 0.1);
    const yMin = Math.floor(minValue - minValue * 0.1);
    const YScaleStepCalculation = (yMax - yMin) / 6;
    const YScaleStep = 1 > YScaleStepCalculation ? YScaleStepCalculation.toFixed(2) : Math.floor(YScaleStepCalculation);

    // Draw chart X and Y lines
    canvasContext.setLineWidth(2);
    canvasContext.setSourceRGBA(axesColor[0], axesColor[1], axesColor[2], axesColor[3]);
    canvasContext.moveTo(originX, originY);
    canvasContext.lineTo(originX + chartWidth, originY); // X axis
    canvasContext.moveTo(originX, originY);
    canvasContext.lineTo(originX, originY - chartHeight); // Y axis
    canvasContext.stroke();

    // Set grid size and font settings
    canvasContext.setLineWidth(1);
    canvasContext.selectFontFace('Sans', Cairo.FONT_SLANT_NORMAL, Cairo.FONT_WEIGHT_NORMAL);
    canvasContext.setFontSize(8);

    // Y ticks and Y labels
    for (let y = yMin; y <= yMax; y += YScaleStep) {
      let t = (y - yMin) / (yMax - yMin); // 0..1
      let py = originY - t * chartHeight;

      // Horizontal grid
      canvasContext.setSourceRGBA(midlineColor[0], midlineColor[1], midlineColor[2], midlineColor[3]);
      canvasContext.moveTo(originX, py);
      canvasContext.lineTo(originX + chartWidth, py);
      canvasContext.stroke();

      // Y tick
      canvasContext.setSourceRGBA(axesColor[0], axesColor[1], axesColor[2], axesColor[3]);
      canvasContext.moveTo(originX - 6, py);
      canvasContext.lineTo(originX, py);
      canvasContext.stroke();

      // Y label
      canvasContext.setSourceRGBA(fontColor[0], fontColor[1], fontColor[2], fontColor[3]);
      canvasContext.moveTo(originX - 35, py + 4);
      canvasContext.showText(`$${y}`);
    }

    // X ticks and X labels
    for (let i = 0; i < numberOfLabels; i++) {
      let px = originX + (i / (numberOfLabels - 1)) * chartWidth;

      // X tick
      canvasContext.setSourceRGBA(axesColor[0], axesColor[1], axesColor[2], axesColor[3]);
      canvasContext.moveTo(px, originY);
      canvasContext.lineTo(px, originY + 6);
      canvasContext.stroke();

      // X label (centered)
      canvasContext.setSourceRGBA(fontColor[0], fontColor[1], fontColor[2], fontColor[3]);
      const ext = canvasContext.textExtents(this._labels[i]);
      canvasContext.moveTo(px - ext.width / 2, originY + 11 + ext.height);
      canvasContext.showText(this._labels[i]);
    }
  }

  _drawChartLine(canvasContext, chartWidth, chartHeight) {
    logger.log('--- Start drawing chart lines.');

    const originX = this._MARGIN.left;
    const originY = this._MARGIN.top + chartHeight;
    const lineColor = this._parseRgbaValues(this._chartSettings.chartLineColor, 1);

    // Y scale (money)
    const minValue = Math.min.apply(null, this._values);
    const maxValue = Math.max.apply(null, this._values);
    const yMin = Math.floor(minValue - minValue * 0.1);
    const yMax = Math.ceil(maxValue + maxValue * 0.1);
    const numberOfLabels = this._labels.length;

    canvasContext.setLineWidth(1.5);
    canvasContext.setSourceRGBA(lineColor[0], lineColor[1], lineColor[2], lineColor[3]);

    for (let i = 0; i < numberOfLabels; i++) {
      let t = (this._values[i] - yMin) / (yMax - yMin);
      let px = originX + (i / (numberOfLabels - 1)) * chartWidth;
      let py = originY - t * chartHeight;

      if (0 === i) {
        canvasContext.moveTo(px, py);
      } else {
        canvasContext.lineTo(px, py);
      }
    }

    canvasContext.stroke();
  }

  _drawDataPoints(canvasContext, chartWidth, chartHeight) {
    logger.log('--- Start drawing chart data points.');

    const originX = this._MARGIN.left;
    const originY = this._MARGIN.top + chartHeight;
    const lineColor = this._parseRgbaValues(this._chartSettings.chartLineColor, 1);

    // Y scale (money)
    const minValue = Math.min.apply(null, this._values);
    const maxValue = Math.max.apply(null, this._values);
    const yMin = Math.floor(minValue - minValue * 0.1);
    const yMax = Math.ceil(maxValue + maxValue * 0.1);

    const numberOfLabels = this._labels.length;
    const pointRadius = 2;

    // In a future version add option to show price number near the point
    canvasContext.setLineWidth(2.5);
    canvasContext.setSourceRGBA(lineColor[0], lineColor[1], lineColor[2], lineColor[3]);

    for (let i = 0; i < numberOfLabels; i++) {
      let t = (this._values[i] - yMin) / (yMax - yMin);
      let px = originX + (i / (numberOfLabels - 1)) * chartWidth;
      let py = originY - t * chartHeight;

      canvasContext.arc(px, py, pointRadius, 0, 2 * Math.PI);
      canvasContext.fill();
    }
  }

  _drawChartTitle(canvasContext, chartWidth, chartHeight) {
    logger.log('--- Start drawing chart title.');

    const titleText = this._chartSettings.titleDisplay || 'Ticker Symbol Name';
    const titleExtents = canvasContext.textExtents(titleText);
    const centerX = chartWidth / 2 - titleExtents.width / 2 + this._MARGIN.left / 2;
    const fontColor = this._parseRgbaValues(this._chartSettings.fontColor, 1);

    canvasContext.setFontSize(12);
    canvasContext.selectFontFace('Sans', Cairo.FONT_SLANT_NORMAL, Cairo.FONT_WEIGHT_BOLD);
    canvasContext.setSourceRGBA(fontColor[0], fontColor[1], fontColor[2], fontColor[3]);
    canvasContext.moveTo(centerX, 16);
    canvasContext.showText(titleText);
  }

  _parseRgbaValues(colorString, fallbackAlpha) {
    const colors = colorString.match(/\((.*?)\)/)[1].split(",");
    const r = parseInt(colors[0])/255;
    const g = parseInt(colors[1])/255;
    const b = parseInt(colors[2])/255;
    let a = fallbackAlpha;

    if (colors.length > 3) {
      a = colors[3]
    }

    return [r, g, b, a];
  }
}

// Export
var ChartClass = ChartClassDeclaration;
