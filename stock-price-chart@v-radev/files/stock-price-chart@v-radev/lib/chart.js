const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;

class ChartClassDeclaration {
  _canvas = null;

  _labels = null;
  _values = null;

  _MARGIN = { left: 30, right: 10, top: 10, bottom: 30 };

  constructor(labels, values) {
    Clutter.init(null);

    this._labels = labels;
    this._values = values;
  }

  drawCanvas(canvasWidth, canvasHeight) {
    this._canvas = new Clutter.Canvas();
    this._canvas.set_size(canvasWidth, canvasHeight);

    this._canvas.connect('draw', function(canvas, cr, width, height) {
      // Clear background
      cr.setSourceRGB(1, 1, 1);
      cr.rectangle(0, 0, width, height);
      cr.fill();

      // Chart geometry
      let chartW = width - this._MARGIN.left - this._MARGIN.right;
      let chartH = height - this._MARGIN.top - this._MARGIN.bottom;
      let originX = this._MARGIN.left;
      let originY = this._MARGIN.top + chartH;

      // Axes
      cr.setLineWidth(2);
      cr.setSourceRGB(0, 0, 0);
      cr.moveTo(originX, originY);
      cr.lineTo(originX + chartW, originY); // X axis
      cr.moveTo(originX, originY);
      cr.lineTo(originX, originY - chartH); // Y axis
      cr.stroke();

      //TODO dynamic scaling
      // Y scale (money) - fixed from 100 to 150
      let yMin = 100;
      let yMax = 150;

      // Draw horizontal grid lines & Y labels
      cr.setLineWidth(1);
      cr.selectFontFace('Sans', Cairo.FONT_SLANT_NORMAL, Cairo.FONT_WEIGHT_NORMAL);
      cr.setFontSize(8);

      let tickStep = 10;

      for (let y = yMin; y <= yMax; y += tickStep) {
        let t = (y - yMin) / (yMax - yMin); // 0..1
        let py = originY - t * chartH;

        // faint grid
        cr.setSourceRGBA(0, 0, 0, 0.06);
        cr.moveTo(originX, py);
        cr.lineTo(originX + chartW, py);
        cr.stroke();

        // tick and label
        cr.setSourceRGBA(0, 0, 0, 0.8);
        cr.moveTo(originX - 6, py);
        cr.lineTo(originX, py);
        cr.stroke();

        cr.moveTo(originX - 60, py + 4);
        cr.showText(`$${y}`);
      }

      // X ticks and labels
      let n = this._labels.length;

      for (let i = 0; i < n; i++) {
        let px = originX + (i / (n - 1)) * chartW;

        // tick
        cr.moveTo(px, originY);
        cr.lineTo(px, originY + 6);
        cr.stroke();

        // label (centered)
        let ext = cr.textExtents(this._labels[i]);
        cr.moveTo(px - ext.width / 2, originY + 22 + ext.height);
        cr.showText(this._labels[i]);
      }

      // Draw the line
      cr.setLineWidth(2.5);
      cr.setSourceRGBA(0.2, 0.6, 0.9, 0.7); // blue-ish

      for (let i = 0; i < n; i++) {
        let t = (this._values[i] - yMin) / (yMax - yMin);
        let px = originX + (i / (n - 1)) * chartW;
        let py = originY - t * chartH;
        if (i === 0)
          cr.moveTo(px, py);
        else
          cr.lineTo(px, py);
      }
      cr.stroke();

      // Draw data points
      for (let i = 0; i < n; i++) {
        let t = (this._values[i] - yMin) / (yMax - yMin);
        let px = originX + (i / (n - 1)) * chartW;
        let py = originY - t * chartH;
        cr.arc(px, py, 4, 0, 2 * Math.PI);
        cr.fill();
      }

      // Optional: small title
      cr.setFontSize(10);
      cr.moveTo(this._MARGIN.left, 16);
      cr.showText('Price over days ($)');

      return false; // Signal handled
    });

    return this._canvas;
  }
}

// Export
var ChartClass = ChartClassDeclaration;
