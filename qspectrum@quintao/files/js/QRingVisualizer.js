/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */
const Cairo = imports.cairo;
const {QVisualizer, clamp01, parse_color} = require('js/QVisualizer.js');
const QUtils = require('js/QUtils.js');

const TAU = Math.PI * 2;
const RING_GAP = 2;
const CAP_GAP = 2;
const EDGE_MARGIN = 8;

const RING_DEFAULTS = {
  size:              300,      // square canvas
  ring_radius:       5,        // inner ring radius (% of size)
  ring_width:        3,        // inner ring / line stroke width
  bar_fill:          0.9,      // bar width fraction of each slot
  min_length:        3,        // baseline stub length (px)
  rotation_speed:    0,        // deg/s (constant base)
  rotation_react:    0.0,      // beat/onset spin-up amount
  rotation_spectral: 0.6,      // spectral-centroid bias amount
  color_from:        'rgba(204,40,149,0.8)',
  color_to:          'rgba(255,208,65,1)',
  accent_color:      'rgba(255,255,255,0.2)',
  cap_size:          2,
  cap_color:         'rgba(255,255,255,0.2)',
  caps:              true,
  substyle:          'bars'
};

class QRingVisualizer extends QVisualizer {
  
  constructor(opts) {
    super(Object.assign({}, RING_DEFAULTS, opts || {}));
    this._omega = 0;       // beat-driven angular velocity (deg/s)
    this._levelPrev = 0;
  }
  
  _canvas_size() {
    const s = this.opts.size;
    return [s, s];
  }
  
  _animate(dt) {
    const o = this.opts;
    const base = o.rotation_speed || 0;
    const N = this._disp.length;
    
    // Onset detection (half-wave-rectified energy rise): a jump in the low
    // bands spins the ring up, then exponential friction coasts it down.
    // https://en.wikipedia.org/wiki/Onset_(audio)
    let level = 0;
    const lo = Math.max(4, Math.floor(N * 0.2));
    for (let i = 0; i < lo; i++) level += this._disp[i];
    level /= lo;
    const onset = Math.max(0, level - this._levelPrev);
    this._levelPrev = level;
    this._omega += onset * (o.rotation_react || 0) * 250;
    this._omega *= Math.pow(0.25, dt);
    
    // Spectral centroid biases the speed (and direction).
    const spectral = (this._centroid - 0.5) * 2 * (o.rotation_spectral || 0) * 90;
    
    const speed = base + this._omega + spectral;
    if (Math.abs(speed) > 0.01) {
      this._angle += (speed * Math.PI / 180) * dt;
      return true;
    }
    return false;
  }
  
  _draw(cr, width, height) {
    const o = this.opts;
    const s = o.size;
    
    if (o.substyle === 'area') {
      this._draw_area_mode(cr, s);
      return;
    }
    
    cr.save();
    cr.translate(width / 2, height / 2);
    cr.rotate(this._angle);
    
    const ring_r = s * (o.ring_radius / 100);
    const max_len = s / 2 - ring_r - EDGE_MARGIN;
    
    this._draw_ring(cr, ring_r);
    this._draw_bars(cr, ring_r, max_len);
    if (o.caps !== false) this._draw_caps(cr, ring_r, max_len);
    
    cr.restore();
  }
  
  // 'area' substyle: a filled band growing from the inner ring along an
  // interpolated spectrum curve, with the peak traced as a stroked line loop.
  _draw_area_mode(cr, s) {
    const o = this.opts;
    cr.save();
    cr.translate(s / 2, s / 2);
    cr.rotate(this._angle);
    
    const ring_r = s * (o.ring_radius / 100);
    const max_len = s / 2 - ring_r - EDGE_MARGIN;
    
    this._draw_ring(cr, ring_r);
    this._paint_area(cr, ring_r, max_len);
    if (o.caps !== false) this._draw_area_cap(cr, ring_r, max_len);
    
    cr.restore();
  }
  
  // Lerp the band array at a wrapped fractional position (linear interp, so the
  // area's top edge reads as a continuous curve rather than stepped bars).
  _sample(vals, u, M) {
    const f = u * M;
    const base = Math.floor(f);
    const i0 = ((base % M) + M) % M;
    const i1 = (i0 + 1) % M;
    const tt = f - base;
    return clamp01(vals[i0] * (1 - tt) + vals[i1] * tt);
  }
  
  _paint_area(cr, ring_r, max_len) {
    const o = this.opts;
    const M = o.bars;
    const r0 = ring_r + o.ring_width / 2 + RING_GAP;
    const min_len = o.min_length;
    const col_range = Math.max(0, max_len - min_len);
    const P = Math.max(M * 6, 360);
    
    const c_from = parse_color(o.color_from);
    const c_to = parse_color(o.color_to);
    const grad = new Cairo.RadialGradient(0, 0, r0, 0, 0, Math.max(1, r0 + max_len));
    grad.addColorStopRGBA(0, c_from[0], c_from[1], c_from[2], c_from[3]);
    grad.addColorStopRGBA(1, c_to[0], c_to[1], c_to[2], c_to[3]);
    
    const a0 = -Math.PI / 2;
    cr.newPath();
    let a_last = a0;
    for (let q = 0; q <= P; q++) {
      const u = q / P;
      const amp = this._sample(this._disp, u, M);
      const a = u * TAU + a0;
      const r = r0 + min_len + amp * col_range;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (q === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
      a_last = a;
    }
    // Close the band against the ring by tracing the inner arc back to start.
    cr.arcNegative(0, 0, r0, a_last, a0);
    cr.closePath();
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSource(grad);
    cr.fill();
  }
  
  _draw_area_cap(cr, ring_r, max_len) {
    const o = this.opts;
    const M = o.bars;
    const r0 = ring_r + o.ring_width / 2 + RING_GAP + o.cap_size / 2 + CAP_GAP;
    const min_len = o.min_length;
    const col_range = Math.max(0, max_len - min_len);
    const P = Math.max(M * 6, 360);
    const cc = parse_color(o.cap_color);
    
    const a0 = -Math.PI / 2;
    cr.newPath();
    for (let q = 0; q <= P; q++) {
      const u = q / P;
      const amp = this._sample(this._peaks, u, M);
      const a = u * TAU + a0;
      const r = r0 + min_len + amp * col_range;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (q === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
    }
    cr.closePath();
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(Math.max(0.5, o.cap_size));
    cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
    cr.stroke();
  }
  
  _draw_ring(cr, ring_r) {
    const o = this.opts;
    const rc = parse_color(o.accent_color);
    cr.arc(0, 0, ring_r, 0, TAU);
    cr.setSourceRGBA(rc[0], rc[1], rc[2], rc[3]);
    cr.setLineWidth(o.ring_width);
    cr.stroke();
  }
  
  _draw_bars(cr, ring_r, max_len) {
    const o = this.opts;
    const bars = o.bars;
    const step = TAU / bars;
    const half = step * o.bar_fill / 2;
    const r0 = ring_r + o.ring_width / 2 + RING_GAP;
    const min_len = o.min_length;          // px
    const col_range = max_len - min_len;
    const r_end = r0 + max_len; // gradient spans the full possible bar length
    
    const c_from = parse_color(o.color_from);
    const c_to = parse_color(o.color_to);
    
    for (let i = 0; i < bars; i++) {
      const amp = clamp01(this._disp[i]);
      const r1 = r0 + min_len + amp * col_range;
      const a = i * step - Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      
      // const grad = new Cairo.LinearGradient(ca * r0, sa * r0, ca * r_end, sa * r_end);
      // grad.addColorStopRGBA(0, c_from[0], c_from[1], c_from[2], c_from[3]);
      // grad.addColorStopRGBA(1, c_to[0], c_to[1], c_to[2], c_to[3]);
      
      let color = [
        QUtils.lerp(c_from[0], c_to[0], amp),
        QUtils.lerp(c_from[1], c_to[1], amp),
        QUtils.lerp(c_from[2], c_to[2], amp),
        QUtils.lerp(c_from[3], c_to[3], amp),
      ];
      
      cr.newPath();
      cr.arc(0, 0, r0, a - half, a + half);
      cr.arcNegative(0, 0, r1, a + half, a - half);
      cr.closePath();
      // cr.setSource(grad);
      cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
      cr.fill();
    }
  }
  
  _draw_caps(cr, ring_r, max_len) {
    const o = this.opts;
    const bars = o.bars;
    const step = TAU / bars;
    const half = step * o.bar_fill / 2;
    const min_len = o.min_length;          // px
    const col_range = max_len - min_len;
    const half_t = o.cap_size / 2;
    const r0 = ring_r + o.ring_width / 2 + RING_GAP + half_t + CAP_GAP;
    
    const cc = parse_color(o.cap_color);
    
    for (let i = 0; i < bars; i++) {
      const amp = clamp01(this._peaks[i]);
      const pr = r0 + min_len + amp * col_range;
      const a = i * step - Math.PI / 2;
      
      let ri = pr - half_t;
      if (ri < r0) ri = r0;
      const ro = pr + half_t;
      
      cr.newPath();
      cr.arc(0, 0, ri, a - half, a + half);
      cr.arcNegative(0, 0, ro, a + half, a - half);
      cr.closePath();
      cr.setSourceRGBA(cc[0], cc[1], cc[2], cc[3]);
      cr.fill();
    }
  }
}

module.exports = {
  QRingVisualizer
};
