/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;

const QUtils = require('js/QUtils.js');
const {ShadesEffect, SHADE_MODES} = require("js/QShades.js");
const {qLOG} = require('js/QUtils.js');

// Ballistics: per-frame step of the "gravity" falloff counter.
const FALLOFF_KNOCK = 0.028;

const BASE_DEFAULTS = {
  bars:               128,
  max_fps:            60,
  noise_reduction:    0.77,
  smooth_filter:      'off',
  smooth_amount:      0.5,
  autosens:           1,
  sensitivity:        100,
  cap_fall:           0.15,
  cap_fall_animation: "ease_out",
  caps:               true,
  glow:               true,
  glow_strength:      1.0,
  glow_radius:        12,
  glow_core:          0.35,
  shade:              "none",
  shade_intensity:    0.5,
  shade_speed:        1.0
};

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// Accepts CSS-ish color strings: rgb()/rgba() (that is what Cinnamon's color
// chooser stores), hex #rgb/#rgba/#rrggbb/#rrggbbaa, and named colors. Returns
// [r, g, b, a] with every channel normalized to 0..1.
function parse_color(str) {
  if (typeof str !== 'string') return [1, 1, 1, 1];
  const s = str.trim();
  
  const rgb = s.match(/^rgba?\(([^)]*)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => parseFloat(p));
    const r = (parts[0] || 0) / 255;
    const g = (parts[1] || 0) / 255;
    const b = (parts[2] || 0) / 255;
    const a = (parts.length > 3 && !isNaN(parts[3])) ? parts[3] : 1;
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }
  
  if (s.charAt(0) === '#') {
    let hex = s.slice(1);
    let a = 1;
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    } else if (hex.length === 4) {
      a = parseInt(hex.charAt(3) + hex.charAt(3), 16) / 255;
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    } else if (hex.length === 8) {
      a = parseInt(hex.slice(6, 8), 16) / 255;
      hex = hex.slice(0, 6);
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r, g, b, clamp01(a)];
    }
    return [1, 1, 1, 1];
  }
  
  try {
    const [parsed, color] = Clutter.Color.from_string(s);
    if (parsed) return [color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255];
  } catch (e) { }
  return [1, 1, 1, 1];
}

class QVisualizer {
  
  constructor(opts) {
    this.opts = Object.assign({}, BASE_DEFAULTS, opts || {});
    this._shades = null;
    this._time = 0;
    this._reset_state();
    this._sens = 1.0;
    this._sensInit = true;
    this._centroid = 0.5;
    this._dt_s = 1 / this.opts.max_fps;
    this._last_tick_us = 0;
    this._angle = 0;
    this._timer_id = 0;
    this._draw_id = 0;
    this._build();
  }
  
  // ---- hooks for subclasses ----
  _canvas_size() {
    const s = this.opts.size || 300;
    return [s, s];
  }
  
  _draw(cr, width, height) {}
  
  _animate(dt) { return false; }  // return true when a redraw is needed
  
  _reset_state() {
    const n = this.opts.bars;
    this._last = new Array(n).fill(0);
    this._curr = new Array(n).fill(0);   // temporal (gravity+integrator) state
    this._disp = new Array(n).fill(0);   // displayed value (after freq filter)
    this._prev_curr = new Array(n).fill(0);
    
    this._peaks_time = 0;
    this._peaks_prev = new Array(n).fill(0);
    this._peaks_prog = new Array(n).fill(1);
    this._peaks = new Array(n).fill(0);
    
    this._cmem = new Array(n).fill(0);
    this._cpeak = new Array(n).fill(0);
    this._cfall = new Array(n).fill(0);
    this._cprev = new Array(n).fill(0);
  }
  
  _build() {
    this._build_surface();
    this._sync_shades();
  }
  
  // Subclasses override to present without a Cairo canvas (e.g. a GPU shader
  // effect on a plain St.Widget). Base builds the Clutter.Canvas path.
  _build_surface() {
    const size = this._canvas_size();
    const w = size[0], h = size[1];
    
    this.canvas = new Clutter.Canvas();
    this.canvas.set_size(w, h);
    this._draw_id = this.canvas.connect('draw', this._on_draw.bind(this));
    
    this.actor = new St.Widget({width: w, height: h});
    this.actor.set_content(this.canvas);
    
    this.canvas.invalidate();
  }
  
  // Subclasses override to trigger their own repaint (e.g. queue_repaint()).
  _present() {
    if (this.canvas) this.canvas.invalidate();
  }
  
  start() {
    this.stop();
    const period = Math.max(8, Math.round(1000 / this.opts.max_fps));
    this._last_tick_us = GLib.get_monotonic_time();
    this._timer_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, period, () => {
      const now = GLib.get_monotonic_time();
      let dt = (now - this._last_tick_us) / 1e6;
      this._last_tick_us = now;
      // Guard against pauses/glitches so smoothing stays well behaved.
      if (!(dt > 0) || dt > 0.25) dt = period / 1000;
      this._dt_s = dt;
      this._time += dt;
      const anim = this._animate(dt);
      const changed = this._smooth() || anim;
      if (changed) this._present();
      if (this._shades) {
        const animated = this._shade_is_animated(this.opts.shade);
        this._shades.set_time(this._time, this._audio_level(), animated && !changed);
      }
      return true;
    });
  }
  
  stop() {
    if (this._timer_id) {
      GLib.source_remove(this._timer_id);
      this._timer_id = 0;
    }
  }
  
  set_bands(amps) {
    if (!amps) return;
    const n = this.opts.bars;
    for (let i = 0; i < n; i++) {
      this._last[i] = clamp01(amps[i] || 0);
    }
  }
  
  set_centroid(c) {
    this._centroid = (typeof c === 'number') ? c : 0.5;
  }
  
  set_options(opts) {
    opts = opts || {};
    const prev = this._canvas_size();
    const bars_changed = (opts.bars !== undefined && opts.bars !== this.opts.bars);
    const fps_changed = (opts.max_fps !== undefined && opts.max_fps !== this.opts.max_fps);
    
    Object.assign(this.opts, opts);
    
    const next = this._canvas_size();
    const size_changed = (next[0] !== prev[0] || next[1] !== prev[1]);
    
    if (bars_changed) this._reset_state();
    if (bars_changed || size_changed) this._resize(next[0], next[1]);
    if (fps_changed && this._timer_id) this.start();
    this._sync_shades();
  }
  
  _resize(w, h) {
    this._resize_surface(w, h);
    this._update_shades_params();
  }
  
  _resize_surface(w, h) {
    if (this.canvas) {
      this.canvas.set_size(w, h);
      this.canvas.invalidate();
    }
    if (this.actor) this.actor.set_size(w, h);
  }
  
  _shade_is_animated(mode) {
    return ["crt", "haze", "glitch", "hue", "grain", "flash"].includes(mode);
  }
  
  _audio_level() {
    const n = this._disp.length;
    if (n === 0) return 0;
    let level = 0;
    for (let i = 0; i < n; i++) level += this._disp[i];
    return clamp01(level / n);
  }
  
  _sync_shades() {
    if (!this.actor) return;
    const shade = this.opts.shade || "none";
    const want = Clutter.feature_available(Clutter.FeatureFlags.SHADERS_GLSL)
      && (this.opts.glow !== false || shade !== "none");
    
    if (want) {
      if (!this._shades) {
        this._shades = new ShadesEffect();
        this.actor.add_effect_with_name("qshades", this._shades);
      }
      this._update_shades_params();
      return;
    }
    
    if (this._shades) {
      try {
        this.actor.remove_effect(this._shades);
      } catch (e) { /* actor may already be gone */ }
      this._shades = null;
    }
  }
  
  _update_shades_params() {
    if (!this._shades) return;
    const size = this._canvas_size();
    const tint = parse_color(this.opts.color_to);
    this._shades.set_params({
      glow:          this.opts.glow !== false,
      glow_strength: this.opts.glow_strength,
      glow_radius:   this.opts.glow_radius,
      glow_core:     this.opts.glow_core,
      tint:          [tint[0], tint[1], tint[2]],
      mode:          SHADE_MODES[this.opts.shade] || 0,
      intensity:     this.opts.shade_intensity,
      speed:         this.opts.shade_speed,
      width:         size[0],
      height:        size[1]
    });
    if (this.canvas) this.canvas.invalidate();
  }
  
  _on_draw(canvas, cr, width, height) {
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    this._draw(cr, width, height);
    return true;
  }
  
  _freq_smooth(src, mode, amount) {
    const num_bars = src.length;
    const out = this._disp;
    const clamped_amount = Math.min(Math.max(amount, 0), 1);
    
    for (let i = 0; i < num_bars; i++) out[i] = src[i];
    
    
    if (mode === 'monstercat') {
      // Monstercat-style peak-envelope spread: each band bleeds into its
      // neighbors with geometric decay. Source: CAVA by Karl Stavestrand.
      const decay_base = 2.5 - 1.3 * clamped_amount;
      
      for (let z = 0; z < num_bars; z++) {
        for (let y = z - 1; y >= 0; y--) {
          const neighbor_val = out[z] / Math.pow(decay_base, z - y);
          if (neighbor_val > out[y]) out[y] = neighbor_val;
        }
        for (let y = z + 1; y < num_bars; y++) {
          const neighbor_val = out[z] / Math.pow(decay_base, y - z);
          if (neighbor_val > out[y]) out[y] = neighbor_val;
        }
      }
    } else if (mode === 'skirt') {
      // Linear peak skirt: 1D grayscale morphological dilation with a linear
      // triangular structuring element, replicating the sloped skirts of
      // vintage hardware RTA displays (Matheron/Serra).
      // https://en.wikipedia.org/wiki/Mathematical_morphology
      const drop_per_bar = 0.35 - 0.28 * clamped_amount;
      
      for (let z = 0; z < num_bars; z++) {
        for (let y = z - 1; y >= 0; y--) {
          const neighbor_val = out[z] - drop_per_bar * (z - y);
          if (neighbor_val > out[y]) out[y] = neighbor_val;
          else break;
        }
        for (let y = z + 1; y < num_bars; y++) {
          const neighbor_val = out[z] - drop_per_bar * (y - z);
          if (neighbor_val > out[y]) out[y] = neighbor_val;
          else break;
        }
      }
    } else if (mode === 'smooth') {
      // 3-tap FIR weighted moving average; [1,2,1]/4 is the binomial kernel.
      // https://en.wikipedia.org/wiki/Binomial_filter
      const side_weight = 0.25 * clamped_amount;
      const center_weight = 1.0 - 2 * side_weight;
      
      for (let z = 0; z < num_bars; z++) {
        const left_val = z > 0 ? src[z - 1] : src[z];
        const right_val = z < num_bars - 1 ? src[z + 1] : src[z];
        out[z] = left_val * side_weight + src[z] * center_weight + right_val * side_weight;
      }
    } else if (mode === 'gaussian') {
      // 1D Gaussian kernel convolution (Gauss, 1809).
      // https://en.wikipedia.org/wiki/Gaussian_blur
      const sigma = 0.5 + clamped_amount * 2.5;
      const kernel_radius = Math.ceil(sigma * 2.5);
      const two_sigma_sq = 2 * sigma * sigma;
      
      for (let z = 0; z < num_bars; z++) {
        let weighted_sum = 0;
        let weight_total = 0;
        const start_idx = Math.max(0, z - kernel_radius);
        const end_idx = Math.min(num_bars - 1, z + kernel_radius);
        
        for (let y = start_idx; y <= end_idx; y++) {
          const distance = z - y;
          const weight = Math.exp(-(distance * distance) / two_sigma_sq);
          weighted_sum += src[y] * weight;
          weight_total += weight;
        }
        out[z] = weighted_sum / weight_total;
      }
    }
    
    return out;
  }
  
  
  _smooth() {
    let changed = false;
    const o = this.opts;
    const curr = this._curr;
    const disp = this._disp;
    const peaks = this._peaks;
    const dt = this._dt_s || (1 / o.max_fps);
    const N = curr.length;
    
    // Time-domain ballistics: gravity falloff, leaky integrator and autosens,
    // scaled by the current sensitivity.
    const nr = clamp01(o.noise_reduction);
    // Frame-rate normalization (local tuning) keeps the feel steady across FPS.
    const framerate_mod = 66 / o.max_fps;
    const gravity_mod = Math.pow(framerate_mod, 2.5) * 2 / Math.max(0.001, nr);
    const integral_mod = Math.pow(framerate_mod, 0.1);
    const autosens = o.autosens | 0;
    
    let overshoot = false;
    let silent = true;
    
    for (let i = 0; i < N; i++) {
      const raw = this._last[i];
      if (raw > 0.0001) silent = false;
      let v = raw * this._sens;
      
      // -- falloff: peak-hold ballistics - hang at the peak, then accelerate
      //    down ("gravity"). https://en.wikipedia.org/wiki/VU_meter
      if (v < this._cprev[i] && nr > 0.1) {
        v = this._cpeak[i] * (1.0 - this._cfall[i] * this._cfall[i] * gravity_mod);
        if (v < 0) v = 0;
        this._cfall[i] += FALLOFF_KNOCK;
      } else {
        this._cpeak[i] = v;
        this._cfall[i] = 0.0;
      }
      this._cprev[i] = v;
      
      // -- leaky integrator (one-pole IIR); autosens renormalizes the gain.
      //    https://en.wikipedia.org/wiki/Exponential_smoothing
      v = this._cmem[i] * nr / integral_mod + v;
      this._cmem[i] = v;
      if (v < 0) v = 0;
      if (autosens && v > 1.0) {
        overshoot = true;
        v = 1.0;
      }
      
      if (Math.abs(v - this._prev_curr[i]) > 0.0001) changed = true;
      this._prev_curr[i] = v;
      curr[i] = v;
    }
    
    // -- autosens (AGC): nudge the sensitivity toward filling the range.
    //    https://en.wikipedia.org/wiki/Automatic_gain_control
    if (autosens) {
      if (overshoot) {
        this._sens *= (1 - 0.02 * framerate_mod);
        this._sensInit = false;
      } else if (!silent) {
        this._sens *= (1 + 0.001 * framerate_mod * autosens);
        if (this._sensInit) this._sens *= (1 + 0.1 * framerate_mod);
      }
    } else {
      this._sens = Math.max(0.001, o.sensitivity / 10);
    }
    
    // Frequency-domain smoothing on the display values (not fed back).
    if (["monstercat", "gaussian", "smooth", "skirt"].includes(o.smooth_filter)) {
      this._freq_smooth(curr, o.smooth_filter, o.smooth_amount);
    } else {
      for (let i = 0; i < N; i++) disp[i] = curr[i];
    }
    
    
    const CAP_FALL_MAX_SECS = 4.5;
    const CAP_FALL_MIN_SECS = 0.5;
    const fall_secs = QUtils.lerp(CAP_FALL_MAX_SECS, CAP_FALL_MIN_SECS, clamp01(o.cap_fall));
    const step = dt / fall_secs;
    
    
    for (let i = 0; i < N; i++) {
      const bar = disp[i];
      if (bar >= peaks[i]) {
        peaks[i] = bar;
        this._peaks_prev[i] = bar;
        this._peaks_prog[i] = 0;
        continue;
      }
      
      this._peaks_prog[i] = Math.min(1, this._peaks_prog[i] + step);
      
      let e = QUtils.Easing.linear_interpolation(this._peaks_prog[i]);
      
      switch (this.opts.cap_fall_animation) {
        case "ease_out":
          e = QUtils.Easing.cubic_ease_out(this._peaks_prog[i]);
          break;
        case "ease_in_out":
          e = QUtils.Easing.cubic_ease_in_out(this._peaks_prog[i]);
          break;
        case "ease_out_bounce":
          e = QUtils.Easing.bounce_ease_out(this._peaks_prog[i]);
          break;
      }
      
      let p = QUtils.lerp(this._peaks_prev[i], 0, e);
      
      if (Math.abs(p - this._peaks[i]) > 0.0001) {
        changed = true;
      }
      
      this._peaks[i] = p;
    }
    
    
    
    return changed;
  }
  
  
  destroy() {
    this.stop();
    if (this._shades && this.actor) {
      try { this.actor.remove_effect(this._shades); } catch (e) { /* gone */ }
      this._shades = null;
    }
    if (this.canvas && this._draw_id) {
      try { this.canvas.disconnect(this._draw_id); } catch (e) { /* gone */ }
      this._draw_id = 0;
    }
    if (this.actor) {
      try { this.actor.destroy(); } catch (e) { /* gone */ }
    }
    this.canvas = null;
    this.actor = null;
  }
}

module.exports = {
  QVisualizer: QVisualizer,
  clamp01:     clamp01,
  parse_color: parse_color
};
