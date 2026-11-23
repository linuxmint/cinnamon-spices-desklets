/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const ByteArray = imports.byteArray;

const QUtils = require("js/QUtils.js");
const {qLOG} = QUtils;

// Cinnamon.GLSLEffect caches its shader source per class, so each advanced
// preset gets its own effect class. Shader files live in
// <desklet>/shaders/<preset>.glsl and are read on demand (first use), then
// cached for the session.
//
// Shader contract: GLSLEffect blends with SRC_COLOR * SRC_A, so shaders must
// write straight (non-premultiplied) color plus coverage to cogl_color_out.
//
// The spectrum arrives as a 64-band `uniform float u_spectrum[64]`: GLSLEffect
// only sets float uniforms and Cinnamon exposes no usable Cogl context for a
// texture layer, so an array is the portable route (same as BlurCinnamon).

let _seq = Math.floor(Math.random() * 10000);
const _text_cache = {};
const _class_cache = {};

function num(v, d) {
  return (v === undefined || v === null) ? d : v;
}

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function load_shader_text(shader_dir, preset) {
  const path = `${shader_dir}/${preset}.glsl`;
  if (_text_cache[path] !== undefined) return _text_cache[path];
  let text = null;
  try {
    const res = GLib.file_get_contents(path);
    if (res && res[0]) text = ByteArray.toString(res[1]);
  } catch (e) {
    qLOG.e("QAdvancedEffect: cannot read shader", path, `${e}`);
  }
  if (text === null) qLOG.e("QAdvancedEffect: shader missing", path);
  _text_cache[path] = text;
  return text;
}

// Split a full shader file into the snippet declarations (everything before
// main) and the main body (the statements Cogl splices into its own main).
function split_shader(text) {
  const m = text.match(/void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/);
  if (!m) return {decls: text, code: ""};
  const decls = text.slice(0, m.index);
  const open = m.index + m[0].length;
  const close = text.lastIndexOf("}");
  return {decls: decls, code: text.slice(open, close)};
}

const UNIFORMS = [
  "u_time", "u_intensity", "u_speed", "u_bars", "u_level", "u_centroid",
  "u_bass", "u_treble", "u_beat", "u_frame", "u_resolution", "u_color_from",
  "u_color_to", "u_accent", "u_spectrum"
];

function get_effect_class(preset, shader_dir) {
  // Preset keys may be written with dashes; shader files are snake_case.
  const name = String(preset || "").replace(/-/g, "_");
  if (_class_cache[name]) return _class_cache[name];
  const text = load_shader_text(shader_dir, name);
  if (text === null) return null;
  const parts = split_shader(text);
  const safe = name.replace(/[^a-zA-Z0-9]/g, "_");
  
  // Unique per module load so shader edits take effect on an extension reload
  // (a stable GTypeName would keep the old cached shader).
  const Klass = GObject.registerClass({
    GTypeName: `QspectrumAdvancedEffect_${safe}_${Date.now()}_${_seq++}`
  }, class QAdvancedEffect extends Cinnamon.GLSLEffect {
    _init(params) {
      super._init(params);
      this._loc = {};
      for (const name of UNIFORMS) this._loc[name] = this.get_uniform_location(name);
    }
    
    vfunc_build_pipeline() {
      this.add_glsl_snippet(Cinnamon.SnippetHook.FRAGMENT, parts.decls, parts.code, true);
    }
    
    _set(name, value) {
      const loc = this._loc[name];
      if (loc >= 0) this.set_uniform_float(loc, 1, [value]);
    }
    
    _set_vec(name, arr) {
      const loc = this._loc[name];
      if (loc >= 0) this.set_uniform_float(loc, arr.length, arr);
    }
    
    set_uniforms(o) {
      o = o || {};
      this._set("u_time", num(o.time, 0));
      this._set("u_intensity", Math.max(0, num(o.intensity, 1)));
      this._set("u_speed", Math.max(0, num(o.speed, 1)));
      this._set("u_bars", Math.max(1, num(o.bars, 64)));
      this._set("u_level", clamp01(num(o.level, 0)));
      this._set("u_centroid", clamp01(num(o.centroid, 0.5)));
      this._set("u_bass", clamp01(num(o.bass, 0)));
      this._set("u_treble", clamp01(num(o.treble, 0)));
      this._set("u_beat", clamp01(num(o.beat, 0)));
      this._set("u_frame", o.frame ? 1 : 0);
      this._set_vec("u_resolution", [num(o.width, 1), num(o.height, 1)]);
      this._set_vec("u_color_from", o.color_from || [1, 1, 1]);
      this._set_vec("u_color_to", o.color_to || [1, 1, 1]);
      this._set_vec("u_accent", o.accent || [1, 1, 1]);
    }
    
    // Upload the 64 spectrum bands. set_uniform_float passes the whole array:
    // GIR hides `(array length=total_count)`, so total_count = value.length.
    set_spectrum(values) {
      const loc = this._loc.u_spectrum;
      if (loc >= 0 && values && values.length) this.set_uniform_float(loc, 1, values);
    }
  });
  
  _class_cache[name] = Klass;
  return Klass;
}

module.exports = {
  get_effect_class: get_effect_class
};
