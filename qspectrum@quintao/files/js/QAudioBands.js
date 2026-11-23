/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Gst = imports.gi.Gst;
const GLib = imports.gi.GLib;
const Signals = imports.signals;
const System = imports.system;

const QUtils = require('js/QUtils.js');
const {qLOG} = QUtils;

// The spectrum element posts a fresh magnitude list every interval (up to
// max_fps times a second). Each message is a large boxed array, so the parser
// churns out a lot of short-lived garbage. Cinnamon's GJS heap is big and its
// collector is lazy, so without a nudge the RSS balloons into the gigabytes
// while audio plays (measured ~16 MB/s -> freezes / OOM). Calling gc() on a
// timer -- but only while bands are actually flowing -- keeps the heap bounded.
const GC_INTERVAL_MS = 5000;

// Gst.init wants an argv array; it is safe to call repeatedly, but we only do it
// once and remember whether it worked so callers can degrade gracefully.
let GST_READY = false;
try {
  Gst.init(null);
  GST_READY = true;
} catch (e) {
  qLOG.e('QAudioBands: GStreamer init failed', e);
}

const RETRY_MS = 4000;
const WATCHDOG_MS = 3000;

// By the Nyquist theorem, a sample rate of 24000 Hz captures frequencies up to 12,000 Hz.
// Music has almost nothing over ~10kHz/~12kHz, so lower to 24000Hz is safe and use 50% less resources.

// const RATE = 44100;
// const RATE = 48000;
const RATE = 24000;
const FFT_BANDS = 2048;
const FMIN = 50;
const FMAX = 10000;


class QAudioBands {
  
  constructor(opts) {
    opts = opts || {};
    
    this.display_bars = opts.display_bars || opts.bars || 128;
    this.threshold = (opts.threshold === undefined) ? -80 : opts.threshold;
    this.interval_ms = opts.interval_ms || 16.66;
    this.source = opts.source || '';
    this.fold = opts.fold || 'none';   // 'none' | 'half' (2-fold) | 'quad' (4-fold)
    
    this._enabled = false;
    this._pipeline = null;
    this._bus = null;
    this._bus_id = 0;
    this._watchdog_id = 0;
    this._retry_id = 0;
    this._candidate = -1;
    this._got_bands = false;
    this._switching = false;
    this._candidates = [];
    this._gc_id = 0;
    this._bands_since_gc = 0;
  }
  
  get available() {
    return GST_READY;
  }
  
  // Always request the same high-resolution FFT; display bars are produced by
  // grouping these linearly-spaced bands logarithmically.
  _requested_bands() {
    return FFT_BANDS;
  }
  
  _used_bands() {
    const M = this.display_bars;
    if (this.fold === 'quad') return Math.floor(M / 4) + 1;
    if (this.fold === 'half-centre') return Math.ceil(M / 2);
    return M;
  }
  
  // Log-spaced (octave-band style) edges over FMIN...FMAX. Bands overlap the
  // linear FFT bins (not by bin center) so narrow low bands always include at
  // least one bin and no bar comes out empty.
  _build_bin_map() {
    const U = this._used_bands();
    const ratio = Math.pow(FMAX / FMIN, 1 / U);
    const edges = new Array(U + 1);
    for (let k = 0; k <= U; k++) edges[k] = FMIN * Math.pow(ratio, k);
    this._edges = edges;
  }
  
  // gst-launch style pipeline strings. Band analysis is GStreamer's `spectrum`
  // element (LGPL); candidates differ only in the capture source. Order
  // matters: pipewire-pulse answers @DEFAULT_MONITOR@ at idle, while
  // pipewiresrc needs a running sink.
  _build_candidates() {
    const pulse_props = 'latency-time=20000 buffer-time=40000';
    
    this._build_bin_map();
    const interval_ns = Math.round(Math.max(10, this.interval_ms) * 1000000);
    const bands = this._requested_bands();
    const tail = '! audioconvert ! audioresample '
      + `! audio/x-raw,format=F32LE,channels=1,rate=${RATE} `
      + `! audiocheblimit mode=high-pass cutoff=${FMIN} `
      + `! spectrum bands=${bands} interval=${interval_ns} `
      + `threshold=${this.threshold} post-messages=true `
      + '! fakesink sync=false qos=false';
    
    const list = [];
    // if (this.source) list.push(`pulsesrc device="${this.source}" ${tail}`);
    // list.push(`pulsesrc device="@DEFAULT_MONITOR@" ${tail}`);
    // list.push('pipewiresrc stream-properties="props,stream.capture.sink=true,'
    //   + `client.name=QSpectrum" ${tail}`);
    
    if (this.source) list.push(`pulsesrc device="${this.source}" ${pulse_props} ${tail}`);
    list.push(`pulsesrc device="@DEFAULT_MONITOR@" ${pulse_props} ${tail}`);
    list.push('pipewiresrc stream-properties="props,stream.capture.sink=true,'
      + `client.name=QSpectrum,node.latency=512/48000" ${tail}`);
    
    return list;
  }
  
  start() {
    if (!GST_READY) {
      this.emit('error', 'GStreamer not available');
      return;
    }
    this._enabled = true;
    this._candidates = this._build_candidates();
    this._candidate = -1;
    this._start_gc();
    this._next();
  }
  
  stop() {
    this._enabled = false;
    this._clear_retry();
    this._clear_watchdog();
    this._clear_gc();
    this._teardown();
  }
  
  set_display_bars(n) {
    n = Math.max(8, n | 0);
    if (n === this.display_bars) return;
    this.display_bars = n;
    this._restart();
  }
  
  set_threshold(db) {
    if (db === this.threshold) return;
    this.threshold = db;
    this._restart();
  }
  
  set_source(src) {
    src = src || '';
    if (src === this.source) return;
    this.source = src;
    this._restart();
  }
  
  set_interval_ms(ms) {
    ms = Math.max(10, ms | 0);
    if (ms === this.interval_ms) return;
    this.interval_ms = ms;
    this._restart();
  }
  
  set_fold(fold) {
    fold = fold || 'none';
    if (fold === this.fold) return;
    this.fold = fold;
    this._restart();
  }
  
  _restart() {
    if (!this._enabled) return;
    this._clear_retry();
    this._candidates = this._build_candidates();
    this._candidate = -1;
    this._defer_next();
  }
  
  // Tears down the running pipeline safely from within a bus callback: the
  // actual switch happens on the next idle so we never free the pipeline under
  // the emission that triggered it.
  _defer_next() {
    if (this._switching) return;
    this._switching = true;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._switching = false;
      if (this._enabled) this._next();
      return false;
    });
  }
  
  _next() {
    if (!this._enabled) return;
    
    this._clear_watchdog();
    this._teardown();
    this._candidate++;
    
    if (this._candidate >= this._candidates.length) {
      qLOG.e('QAudioBands: no working capture source');
      this.emit('error', 'no working capture source');
      this.emit('bands', new Array(this.display_bars).fill(0), 0.5);
      this._schedule_retry();
      return;
    }
    
    const desc = this._candidates[this._candidate];
    let pipeline;
    try {
      pipeline = Gst.parse_launch(desc);
    } catch (e) {
      qLOG.e('QAudioBands: parse failed', this._candidate, `${e}`);
      this._defer_next();
      return;
    }
    
    this._pipeline = pipeline;
    this._bus = pipeline.get_bus();
    this._bus.add_signal_watch();
    this._bus_id = this._bus.connect('message', this._on_message.bind(this));
    
    const ret = pipeline.set_state(Gst.State.PLAYING);
    qLOG.w('QAudioBands: playing candidate', this._candidate, ret);
    
    this._watchdog_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCHDOG_MS, () => {
      this._watchdog_id = 0;
      if (this._got_bands) return false;
      qLOG.i('QAudioBands: watchdog, candidate silent', this._candidate);
      this._next();
      return false;
    });
  }
  
  _on_message(bus, msg) {
    const type = msg.type;
    
    if (type === Gst.MessageType.ELEMENT) {
      const s = msg.get_structure();
      if (!s || s.get_name() !== 'spectrum') return;
      
      this._got_bands = true;
      this._bands_since_gc++;
      
      // get_list gives [ok, GObject.ValueArray]; get_nth returns the float
      // directly (already unmarshalled by GJS).
      const res = s.get_list('magnitude');
      if (!res || !res[0] || !res[1]) return;
      const arr = res[1];
      const n = arr.n_values;
      
      const M = this.display_bars;
      const U = this._used_bands();
      const edges = this._edges;
      const bw = (RATE / 2) / FFT_BANDS;
      const floor_amp = Math.pow(10, this.threshold / 20);
      
      // spectrum posts dBFS magnitudes; average each band's linear amplitude
      // after subtracting the noise floor.
      const base = new Array(U);
      for (let k = 0; k < U; k++) {
        let i0 = Math.floor(edges[k] / bw);
        let i1 = Math.ceil(edges[k + 1] / bw) - 1;
        if (i0 < 0) i0 = 0;
        if (i1 > n - 1) i1 = n - 1;
        if (i1 < i0) i1 = i0;
        let sum = 0, cnt = 0;
        for (let i = i0; i <= i1; i++) {
          let a = Math.pow(10, arr.get_nth(i) / 20);   // dBFS -> linear amplitude
          a = a > floor_amp ? a - floor_amp : 0;       // gate out the floor
          sum += a;
          cnt++;
        }
        const f = Math.sqrt(edges[k] * edges[k + 1]);  // geometric band center
        // base[k] = cnt > 0 ? (sum / cnt) * Math.pow(f / 1000, 0.85) : 0;
        
        // Pink-noise (1/f) tilt: +4.5 dB/octave. 0.7475 = 4.5 / 6.0206.
        const tilted = cnt > 0 ? (sum / cnt) * Math.pow(f / 1000, 0.7475) : 0;
        base[k] = tilted;
        
        // 2. Clamp to [0, 1] and apply 0.8 dynamic compression curve
        base[k] = Math.pow(Math.min(tilted, 1.0), 0.8);
      }
      
      // Spectral centroid of the unique bands (0 = all bass, 1 = all treble).
      // https://en.wikipedia.org/wiki/Spectral_centroid
      let cnum = 0, cden = 0;
      for (let k = 0; k < U; k++) {
        cnum += k * base[k];
        cden += base[k];
      }
      const centroid = cden > 0 ? (cnum / cden) / Math.max(1, U - 1) : 0.5;
      
      // QUtils.DEBOUNCE(() => {
      //   qLOG.t("centroid", centroid);
      // }, 60000)()
      
      // Fold the unique bands across the display: 'quad' mirrors in both axes
      // (ring), 'half-center' mirrors left/right with lows in the center (bars),
      // 'none' is linear.
      const out = new Array(M);
      if (this.fold === 'quad') {
        for (let i = 0; i < M; i++) {
          let k = ((i % M) + M) % M;
          k = Math.min(k, M - k);
          k = Math.min(k, M / 2 - k);
          if (k > U - 1) k = U - 1;
          out[i] = base[k];
        }
      } else if (this.fold === 'half-centre') {
        // left/right mirror with the lowest frequencies in the center
        for (let i = 0; i < M; i++) {
          const k = (U - 1) - Math.min(i, M - 1 - i);
          out[i] = base[k < 0 ? 0 : (k > U - 1 ? U - 1 : k)];
        }
      } else {
        for (let i = 0; i < M; i++) out[i] = base[i < U ? i : U - 1];
      }
      
      this.emit('bands', out, centroid);
      return;
    }
    
    if (type === Gst.MessageType.ERROR) {
      let m = 'error';
      try { m = `${msg.parse_error()[0].message}`; } catch (e) { /* ignore */ }
      qLOG.e('QAudioBands: pipeline error', m);
      this._defer_next();
      return;
    }
    
    if (type === Gst.MessageType.EOS) {
      qLOG.e('QAudioBands: EOS');
      this._defer_next();
    }
  }
  
  _teardown() {
    if (this._bus) {
      try { this._bus.disconnect(this._bus_id); } catch (e) { /* gone */ }
      try { this._bus.remove_signal_watch(); } catch (e) { /* gone */ }
      this._bus = null;
    }
    this._bus_id = 0;
    if (this._pipeline) {
      try { this._pipeline.set_state(Gst.State.NULL); } catch (e) { /* gone */ }
      this._pipeline = null;
    }
    this._got_bands = false;
  }
  
  _clear_watchdog() {
    if (this._watchdog_id) {
      GLib.source_remove(this._watchdog_id);
      this._watchdog_id = 0;
    }
  }
  
  _start_gc() {
    if (this._gc_id) return;
    this._bands_since_gc = 0;
    this._gc_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GC_INTERVAL_MS, () => {
      if (this._bands_since_gc > 0) {
        this._bands_since_gc = 0;
        System.gc();
      }
      return true;
    });
  }
  
  _clear_gc() {
    if (this._gc_id) {
      GLib.source_remove(this._gc_id);
      this._gc_id = 0;
    }
    this._bands_since_gc = 0;
  }
  
  _clear_retry() {
    if (this._retry_id) {
      GLib.source_remove(this._retry_id);
      this._retry_id = 0;
    }
  }
  
  _schedule_retry() {
    this._clear_retry();
    if (!this._enabled) return;
    this._retry_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_MS, () => {
      this._retry_id = 0;
      this._candidate = -1;
      if (this._enabled) this._next();
      return false;
    });
  }
}

Signals.addSignalMethods(QAudioBands.prototype);

module.exports = {
  QAudioBands
};
