/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Cairo = imports.cairo;
const Cinnamon = imports.gi.Cinnamon;
const GObject = imports.gi.GObject;

function num(v, d) {
  return (v === undefined || v === null) ? d : v;
}

// ---- GPU shades ----------------------------------------------------------

// One-pass post-process shaders. Every shade only transforms or adds pixels
// to the canvas that was already drawn, so the visualizers need no changes.
const SHADE_MODES = {
  none:      0,
  chroma:    1,
  crt:       2,
  haze:      3,
  glitch:    4,
  hue:       5,
  outline:   6,
  vignette:  7,
  scanlines: 8,
  grain:     9,
  flash:     10
};

// Unique per module load. A stable GTypeName cached in `global` would keep the
// old shader closure after an extension reload, so shader edits would not take
// effect until Cinnamon restarts.
let shades_effect_seq = Math.floor(Math.random() * 10000);

const SHADES_DECLS = `
uniform float u_glow;
uniform float u_glow_strength;
uniform float u_glow_radius;
uniform float u_glow_core;
uniform vec3 u_glow_tint;
uniform vec2 u_texel;
uniform float u_mode;
uniform float u_intensity;
uniform float u_speed;
uniform float u_time;
uniform float u_level;

// Canonical sine-fract hash. https://thebookofshaders.com/10/
float shade_hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 hue_rotate(vec3 c, float angle) {
  // Rodrigues rotation around the RGB grey axis.
  // https://en.wikipedia.org/wiki/Rodrigues%27_rotation_formula
  const vec3 k = vec3(0.5773502691896258);
  float ca = cos(angle);
  float sa = sin(angle);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
`;

const SHADES_CODE = `
vec2 uv = cogl_tex_coord_in[0].st;
float aspect = u_texel.y / u_texel.x;   // width / height

// UV-warping shades first, so the glow/sampling below sees the displaced uv.
if (abs(u_mode - 4.0) < 0.5) {
  // Glitch: time-hashed horizontal band displacement.
  float tick = floor(u_time * u_speed * (4.0 + 12.0 * u_intensity));
  float band = floor(uv.y * 24.0);
  float h = shade_hash(vec2(band, tick));
  float active = step(0.8 - 0.3 * u_intensity, h);
  uv.x += (h - 0.5) * 0.2 * u_intensity * active;
}

if (abs(u_mode - 3.0) < 0.5) {
  // Heat haze: level-driven wobbly displacement.
  float t = u_time * u_speed;
  float n1 = sin(uv.y * 40.0 + t * 3.0 + sin(uv.x * 13.0 + t));
  float n2 = cos(uv.x * 31.0 + t * 2.3 + cos(uv.y * 17.0));
  uv += vec2(n1, n2) * (0.002 + 0.010 * u_intensity) * (0.5 + u_level);
}

vec4 src;
if (abs(u_mode - 1.0) < 0.5) {
  // Chromatic aberration: aspect-aware horizontal channel offsets.
  float d = (0.001 + 0.008 * u_intensity) * (0.5 + u_level);
  vec2 ox = vec2(d / max(aspect, 0.001), 0.0);
  src = vec4(
    texture2D(cogl_sampler0, uv + ox).r,
    texture2D(cogl_sampler0, uv).g,
    texture2D(cogl_sampler0, uv - ox).b,
    texture2D(cogl_sampler0, uv).a
  ) * cogl_color_in;
} else if (abs(u_mode - 4.0) < 0.5) {
  // Glitch: RGB split on top of the displaced uv.
  float s = 0.006 * u_intensity;
  src = vec4(
    texture2D(cogl_sampler0, uv + vec2(s, 0.0)).r,
    texture2D(cogl_sampler0, uv).g,
    texture2D(cogl_sampler0, uv - vec2(s, 0.0)).b,
    texture2D(cogl_sampler0, uv).a
  ) * cogl_color_in;
} else {
  src = texture2D(cogl_sampler0, uv) * cogl_color_in;
}

vec4 blur = vec4(0.0);
if (u_glow > 0.5) {
  float wsum = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    float rr = (float(ring) / 3.0) * u_glow_radius;
    float w = 1.0 / float(ring);
    for (int i = 0; i < 8; i++) {
      float a = 6.28318530718 * float(i) / 8.0;
      vec2 off = vec2(cos(a), sin(a)) * rr * u_texel;
      blur += texture2D(cogl_sampler0, uv + off) * w;
      wsum += w;
    }
  }
  blur /= wsum;
}

float thin = clamp((src.a - blur.a) * 2.5, 0.0, 1.0);
float core_mask = smoothstep(0.05, 0.6, src.a) * thin;
float core_amount = clamp(u_glow_core, 0.0, 1.0) * clamp(u_glow_strength, 0.0, 1.0) * u_glow;
vec3 hot = src.rgb * (1.0 + core_amount * core_mask * 0.9);
float out_a = max(src.a, blur.a * u_glow_strength * u_glow);

float blur_a = max(blur.a, 0.0001);
vec3 halo = blur.rgb / blur_a;
  // Rec. 709 luma coefficients.
  float halo_lum = dot(halo, vec3(0.2126, 0.7152, 0.0722));
halo = clamp(mix(vec3(halo_lum), halo, 1.35), 0.0, 1.0);
float chroma = max(halo.r, max(halo.g, halo.b)) - min(halo.r, min(halo.g, halo.b));
float whiteish = 1.0 - smoothstep(0.04, 0.20, chroma);
halo = mix(halo, u_glow_tint, whiteish * 0.85);
vec3 out_rgb = hot + halo * blur.a * u_glow_strength * 1.8;

if (abs(u_mode - 6.0) < 0.5) {
  // Outline: Sobel edge magnitude on the alpha channel (Feldman, 1968).
  // https://en.wikipedia.org/wiki/Sobel_operator
  vec2 e = u_texel * (1.0 + 3.0 * u_intensity);
  float tl = texture2D(cogl_sampler0, uv + vec2(-e.x, -e.y)).a;
  float tm = texture2D(cogl_sampler0, uv + vec2( 0.0, -e.y)).a;
  float tr = texture2D(cogl_sampler0, uv + vec2( e.x, -e.y)).a;
  float ml = texture2D(cogl_sampler0, uv + vec2(-e.x,  0.0)).a;
  float mr = texture2D(cogl_sampler0, uv + vec2( e.x,  0.0)).a;
  float bl = texture2D(cogl_sampler0, uv + vec2(-e.x,  e.y)).a;
  float bm = texture2D(cogl_sampler0, uv + vec2( 0.0,  e.y)).a;
  float br = texture2D(cogl_sampler0, uv + vec2( e.x,  e.y)).a;
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
  float edge = clamp(length(vec2(gx, gy)) * 3.0, 0.0, 1.0) * u_intensity;
  out_rgb += vec3(edge);
  out_a = max(out_a, edge);
}

if (abs(u_mode - 5.0) < 0.5) {
  out_rgb = hue_rotate(out_rgb, u_time * u_speed * (0.5 + u_intensity) + u_level * 2.0);
}

if (abs(u_mode - 2.0) < 0.5) {
  // CRT: device-pixel scanlines + aspect-correct barrel vignette + a little grain.
  float scan = 0.5 + 0.5 * sin((uv.y / u_texel.y) * 1.5707963);
  out_rgb *= mix(1.0, scan, u_intensity * 0.7);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  out_rgb *= 1.0 - dot(p, p) * (1.4 * u_intensity);
  float g = shade_hash(uv * 1024.0 + vec2(u_time * 60.0 * u_speed, 0.0));
  out_rgb += (g - 0.5) * 0.12 * u_intensity * out_a;
}

if (abs(u_mode - 7.0) < 0.5) {
  // Vignette: aspect-correct radial falloff.
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  out_rgb *= 1.0 - dot(p, p) * (1.4 * u_intensity);
}

if (abs(u_mode - 8.0) < 0.5) {
  // Scanlines: pitch in device pixels.
  float scan = 0.5 + 0.5 * sin((uv.y / u_texel.y) * 1.5707963);
  out_rgb *= mix(1.0, scan, u_intensity * 0.8);
}

if (abs(u_mode - 9.0) < 0.5) {
  // Film grain: pixel-space, animated.
  float g = shade_hash(uv * 1024.0 + vec2(u_time * 60.0 * u_speed, 0.0));
  out_rgb += (g - 0.5) * 0.18 * u_intensity * out_a;
}

if (abs(u_mode - 10.0) < 0.5) {
  // Beat flash: brightness scales with the audio level.
  out_rgb *= 1.0 + u_level * (0.5 + 2.0 * u_intensity);
}

cogl_color_out = vec4(out_rgb, out_a);
`;

const ShadesEffect = GObject.registerClass({
  GTypeName: `QspectrumShadesEffect_${Date.now()}_${shades_effect_seq++}`
}, class ShadesEffect extends Cinnamon.GLSLEffect {
  _init(params) {
    super._init(params);
    this._loc = {};
    const names = [
      "u_glow", "u_glow_strength", "u_glow_radius", "u_glow_core", "u_glow_tint",
      "u_texel", "u_mode", "u_intensity", "u_speed", "u_time", "u_level"
    ];
    for (let i = 0; i < names.length; i++) {
      this._loc[names[i]] = this.get_uniform_location(names[i]);
    }
  }
  
  vfunc_build_pipeline() {
    this.add_glsl_snippet(Cinnamon.SnippetHook.FRAGMENT, SHADES_DECLS, SHADES_CODE, true);
  }
  
  _set(name, value) {
    const loc = this._loc[name];
    if (loc >= 0) this.set_uniform_float(loc, 1, [value]);
  }
  
  set_params(opts) {
    opts = opts || {};
    const width = Math.max(1, num(opts.width, 1));
    const height = Math.max(1, num(opts.height, 1));
    
    this._set("u_glow", opts.glow ? 1 : 0);
    this._set("u_glow_strength", Math.max(0, num(opts.glow_strength, 1)));
    this._set("u_glow_radius", Math.max(0, num(opts.glow_radius, 12)));
    this._set("u_glow_core", num(opts.glow_core, 0.35));
    this._set("u_mode", num(opts.mode, 0));
    this._set("u_intensity", Math.max(0, Math.min(1, num(opts.intensity, 0.5))));
    this._set("u_speed", Math.max(0, num(opts.speed, 1)));
    const tint = opts.tint || [1, 1, 1];
    const tint_loc = this._loc.u_glow_tint;
    if (tint_loc >= 0) this.set_uniform_float(tint_loc, 3, tint);
    if (this._loc.u_texel >= 0) {
      this.set_uniform_float(this._loc.u_texel, 2, [1 / width, 1 / height]);
    }
    this.queue_repaint();
  }
  
  set_time(time, level, repaint) {
    this._set("u_time", time);
    this._set("u_level", level);
    if (repaint) this.queue_repaint();
  }
});

module.exports = {
  SHADE_MODES:   SHADE_MODES,
  ShadesEffect:  ShadesEffect
};
