/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Cairo = imports.cairo;
const {QVisualizer, clamp01, parse_color} = require("js/QVisualizer.js");
const QUtils = require('js/QUtils.js');

const CAP_GAP = 2;
const AREA_MARGIN = {
  W: 6,
  H: 0,
};

const BARS_DEFAULTS = {
  width:      400,
  bar_fill:   0.85,
  min_length: 3,
  mirror:     false,
  substyle:   "bars",
  color_from: "rgba(204,40,149,0.8)",
  color_to:   "rgba(255,208,65,1)",
  cap_size:   2,
  cap_color:  "rgba(255,255,255,0.2)",
  caps:       true,
  line_width: 2
};

class QBarsVisualizer extends QVisualizer {
  
  constructor(opts) {
    super(Object.assign({}, BARS_DEFAULTS, opts || {}));
  }
  
  // Height follows the width: 0.25x, or 0.3x when mirrored (bars grow both ways).
  _canvas_size() {
    const w = this.opts.width;
    return [w, Math.round(w * (this.opts.mirror ? 0.3 : 0.25))];
  }
  
  _draw(cr, width, height) {
    const o = this.opts;
    if (o.substyle === 'area') {
      this._draw_area(cr, width, height);
      return;
    }
    if (o.substyle === 'line') {
      this._draw_line(cr, width, height);
      return;
    }
    
    this._draw_bars(cr, width, height);
  }
  
  _draw_bars(cr, width, height) {
    const o = this.opts;
    const N = o.bars;
    const margin = 2;
    const usable_h = height - margin * 2;
    const bar_w = width / N;
    const gap = bar_w * (1 - o.bar_fill);
    const bw = Math.max(1, bar_w - gap);
    const mirror = !!o.mirror;
    const min_len = o.min_length;
    
    const c_from = parse_color(o.color_from);
    const c_to = parse_color(o.color_to);
    const cc = parse_color(o.cap_color);
    const cap_h = Math.max(1, o.cap_size);
    
    const cy = height / 2;
    const base_y = height - margin;
    const half_usable = usable_h / 2;
    
    for (let i = 0; i < N; i++) {
      const amp = clamp01(this._disp[i]);
      const x = i * bar_w + gap / 2;
      
      let grad, top, h;
      if (mirror) {
        const halfLen = min_len / 2 + (half_usable - min_len / 2) * amp;
        top = cy - halfLen;
        h = halfLen * 2;
        
        grad = new Cairo.LinearGradient(0, cy - half_usable, 0, cy + half_usable);
        grad.addColorStopRGBA(0.0, c_to[0], c_to[1], c_to[2], c_to[3]);
        grad.addColorStopRGBA(0.5, c_from[0], c_from[1], c_from[2], c_from[3]);
        grad.addColorStopRGBA(1.0, c_to[0], c_to[1], c_to[2], c_to[3]);
      } else {
        const len = min_len + (usable_h - min_len) * amp;
        top = base_y - len;
        h = len;
        grad = new Cairo.LinearGradient(0, base_y, 0, base_y - usable_h);
        grad.addColorStopRGBA(0, c_from[0], c_from[1], c_from[2], c_from[3]);
        grad.addColorStopRGBA(1, c_to[0], c_to[1], c_to[2], c_to[3]);
      }
      
      let color = [
        QUtils.lerp(c_from[0], c_to[0], amp),
        QUtils.lerp(c_from[1], c_to[1], amp),
        QUtils.lerp(c_from[2], c_to[2], amp),
        QUtils.lerp(c_from[3], c_to[3], amp),
      ];
      
      cr.newPath();
      // cr.rectangle(x, top, bw, h);
      this._draw_rounded_rectangle(cr, x, top, bw, h, bw / 4);
      cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
      // cr.setSource(grad);
      cr.fill();
    }
    
    if (o.caps !== false) {
      for (let i = 0; i < N; i++) {
        let amp = clamp01(this._peaks[i]);
        let x = i * bar_w + gap / 2;
        // amp = QUtils.Easing.cubic_ease_in(amp);
        
        cr.newPath();
        if (mirror) {
          const half_len = min_len / 2 + (half_usable - min_len / 2) * amp;
          this._draw_rounded_rectangle(cr, x, cy - half_len - cap_h, bw, cap_h, bw / 4);
          this._draw_rounded_rectangle(cr, x, cy + half_len, bw, cap_h, bw / 4);
        } else {
          const len = min_len + (usable_h - min_len) * amp;
          this._draw_rounded_rectangle(cr, x, base_y - len - cap_h, bw, cap_h, bw / 4);
        }
        cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
        cr.fill();
      }
    }
  }
  
  _geom(width, height, mirror = false, area = true, cap = false) {
    const cs = (this.opts.caps === false) ? 0 : this.opts.cap_size;
    let m_w = AREA_MARGIN.W;
    let m_h = AREA_MARGIN.H;
    
    if (mirror && area) {
      m_w += cs + CAP_GAP * 2;
      m_h += cs + CAP_GAP * 2;
      if (!cap) {
        m_w += cs / 2;
        m_h += cs / 2;
      }
    }
    
    let usable_h = height - m_h * 2;
    let usable_w = width - m_w * 2;
    return {
      width:       width - m_w,
      usable_h:    usable_h,
      usable_w:    usable_w,
      base_x:      m_w,
      base_y:      height - m_h,
      cy:          height / 2,
      half_usable: usable_h / 2
    };
  }
  
  // Linear interpolation between adjacent bands.
  // https://en.wikipedia.org/wiki/Linear_interpolation
  _sample_linear(vals, u, N) {
    if (N < 2) return clamp01(vals[0] || 0);
    const f = u * (N - 1);
    const i = Math.min(N - 2, Math.floor(f));
    const tt = f - i;
    return clamp01(vals[i] * (1 - tt) + vals[i + 1] * tt);
  }
  
  _line_gradient(g, mirror, c_from, c_to) {
    if (mirror) {
      const grad = new Cairo.LinearGradient(0, g.cy - g.half_usable, 0, g.cy + g.half_usable);
      grad.addColorStopRGBA(0, c_to[0], c_to[1], c_to[2], c_to[3]);
      grad.addColorStopRGBA(0.5, c_from[0], c_from[1], c_from[2], c_from[3]);
      grad.addColorStopRGBA(1.0, c_to[0], c_to[1], c_to[2], c_to[3]);
      return grad;
    }
    const grad = new Cairo.LinearGradient(0, g.base_y, 0, g.base_y - g.usable_h);
    grad.addColorStopRGBA(0, c_from[0], c_from[1], c_from[2], c_from[3]);
    grad.addColorStopRGBA(1, c_to[0], c_to[1], c_to[2], c_to[3]);
    // grad.addColorStopRGBA(1, c_from[0], c_from[1], c_from[2], c_from[3]);
    return grad;
  }
  
  _trace_curve(cr, vals, g, mirror, min_len) {
    const o = this.opts;
    const N = this.opts.bars;
    const P = Math.max(N * 6, Math.ceil(g.width));
    if (mirror) {
      const range = Math.max(0, g.half_usable - min_len / 2);
      for (let q = 0; q <= P; q++) {
        const u = q / P;
        const amp = this._sample_linear(vals, u, N);
        const y = g.cy - (min_len / 2 + amp * range);
        if (q === 0) cr.moveTo(u * g.usable_w + g.base_x, y); else cr.lineTo(u * g.usable_w + g.base_x, y);
      }
      for (let q = P; q >= 0; q--) {
        const u = q / P;
        const amp = this._sample_linear(vals, u, N);
        const y = g.cy + (min_len / 2 + amp * range);
        cr.lineTo(u * g.usable_w + g.base_x, y);
      }
      cr.closePath();
      return;
    }
    const range = Math.max(0, g.usable_h - min_len);
    for (let q = 0; q <= P; q++) {
      const u = q / P;
      const amp = this._sample_linear(vals, u, N);
      const y = g.base_y - (min_len + amp * range);
      if (q === 0) cr.moveTo(u * g.usable_w + g.base_x, y); else cr.lineTo(u * g.usable_w + g.base_x, y);
    }
  }
  
  _draw_area(cr, width, height) {
    const o = this.opts;
    const mirror = !!o.mirror;
    const g = this._geom(width, height, mirror, true, false);
    const g_cap = mirror ? this._geom(width, height, mirror, true, true) : g;
    const min_len = o.min_length;
    const c_from = parse_color(o.color_from);
    const c_to = parse_color(o.color_to);
    const cc = parse_color(o.cap_color);
    const N = o.bars;
    const P = Math.max(N * 6, Math.ceil(g.width));
    
    cr.newPath();
    if (mirror) {
      const range = Math.max(0, g.half_usable - min_len / 2);
      for (let q = 0; q <= P; q++) {
        const u = q / P;
        const amp = this._sample_linear(this._disp, u, N);
        const y = g.cy - (min_len / 2 + amp * range);
        if (q === 0) cr.moveTo(u * g.usable_w + g.base_x, y); else cr.lineTo(u * g.usable_w + g.base_x, y);
      }
      for (let q = P; q >= 0; q--) {
        const u = q / P;
        const amp = this._sample_linear(this._disp, u, N);
        const y = g.cy + (min_len / 2 + amp * range);
        cr.lineTo(u * g.usable_w + g.base_x, y);
      }
      cr.closePath();
    } else {
      const range = Math.max(0, g.usable_h - min_len);
      cr.moveTo(g.base_x, g.base_y);
      for (let q = 0; q <= P; q++) {
        const u = q / P;
        const amp = this._sample_linear(this._disp, u, N);
        const y = g.base_y - (min_len + amp * range);
        cr.lineTo(u * g.usable_w + g.base_x, y);
      }
      cr.lineTo(g.width, g.base_y);
      cr.closePath();
    }
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSource(this._line_gradient(g, mirror, c_from, c_to));
    cr.fillPreserve();
    
    if (o.caps !== false) {
      cr.newPath();
      this._trace_curve(cr, this._peaks, g_cap, mirror, min_len + o.cap_size / 2 + CAP_GAP);
      cr.setLineJoin(Cairo.LineJoin.ROUND);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setLineWidth(Math.max(1, o.cap_size));
      cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
      cr.stroke();
    }
  }
  
  _trace_mirror_line(cr, vals, g, min_len) {
    const N = Math.max(1, this.opts.bars);
    const range = Math.max(0, g.half_usable - min_len / 2);
    const step = g.width / Math.max(1, N - 0.5);
    const half = step / 2;
    for (let i = 0; i < N; i++) {
      const eh = min_len / 2 + clamp01(vals[i]) * range;
      const x = i * step;
      if (i === 0) cr.moveTo(x, g.cy - eh); else cr.lineTo(x, g.cy - eh);
      cr.lineTo(x + half, g.cy + eh);
    }
  }
  
  _draw_line(cr, width, height) {
    const o = this.opts;
    const g = this._geom(width, height);
    const mirror = !!o.mirror;
    const min_len = o.min_length;
    const c_from = parse_color(o.color_from);
    const c_to = parse_color(o.color_to);
    const cc = parse_color(o.cap_color);
    const lw = Math.max(1, o.line_width);
    const cap_lw = Math.max(1, o.cap_size);
    
    if (mirror) {
      if (o.caps !== false) {
        cr.newPath();
        this._trace_mirror_line(cr, this._peaks, g, min_len);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(cap_lw);
        cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
        cr.stroke();
      }
      cr.newPath();
      this._trace_mirror_line(cr, this._disp, g, min_len);
      cr.setLineJoin(Cairo.LineJoin.ROUND);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setLineWidth(lw);
      cr.setSource(this._line_gradient(g, true, c_from, c_to));
      cr.stroke();
      
      return;
    }
    if (o.caps !== false) {
      cr.newPath();
      this._trace_curve(cr, this._peaks, g, false, min_len);
      cr.setLineJoin(Cairo.LineJoin.ROUND);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setLineWidth(cap_lw);
      cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
      cr.stroke();
    }
    
    cr.newPath();
    this._trace_curve(cr, this._disp, g, false, min_len);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(lw);
    cr.setSource(this._line_gradient(g, false, c_from, c_to));
    cr.stroke();
    
  }
  
  // Rounded rectangle built from four quarter-arcs (Cairo).
  _draw_rounded_rectangle(cr, x, y, width, height, r) {
    if (r > width / 2) r = width / 2;
    if (r > height / 2) r = height / 2;
    
    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
  }
}

module.exports = {
  QBarsVisualizer
};
