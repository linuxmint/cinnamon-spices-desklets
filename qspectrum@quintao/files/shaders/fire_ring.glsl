// Fire Ring — 64 independent flame tongues around a hoop, each one licking on
// its own and growing with its own spectrum band. Slow, local motion only: no
// global advection, so the ring never spins.
// QSpectrum advanced preset. Original GLSL. Noise/hash/technique sources: see
// ATTRIBUTIONS.md.
//
// Layout: `p` is normalised so the canvas half-height is 1.0, i.e. the nearest
// canvas edge sits at r = 1.0. Every radius below is bounded well inside that
// and the final coverage fades to zero before it, so the animation can never
// clamp against an edge.
//
// Each flame lives in its own frame at angle theta_i: `fd` points radially
// outward (the flame grows along it) and `fn` is lateral. Its tongue is a
// teardrop — thin at the base, widest low, pointed at the tip — warped by two
// per-flame noise octaves so it flickers on its own, with a lean toward the tip
// so it curves. The bases overlap into a continuous sheet while the tips stay
// separate, which reads as a ring made of individual flames.
//
// Temperature comes from the distance to the hoop, not from each flame, so the
// bright edge stays a thin hot line instead of blowing out where flames overlap:
// white at the rim, cooling through yellow and orange to deep red at the tips.
//
// No particles, no smoke, no sparks: just the fire.

uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
uniform float u_bars;
uniform float u_level;
uniform float u_centroid;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;                    // decaying onset envelope (0..1)
uniform vec2  u_resolution;
uniform vec3  u_color_from;
uniform vec3  u_color_to;
uniform vec3  u_accent;
uniform float u_spectrum[64];

const float TAU = 6.283185307179586;
const int   N = 64;                    // number of flames

// Hash without Sine — Dave Hoskins. https://www.shadertoy.com/view/4djSRW
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise, smoothstep interpolation. https://thebookofshaders.com/11/
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// Blackbody-ish ramp: near-black-bluish -> deep red -> orange -> yellow -> white.
// Colors approximate the Planckian locus over a flame's temperature range.
vec4 fire_ramp(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 c = vec4(0.030, 0.002, 0.150, 0.40);
  //  c = mix(c, vec3(0.420, 0.030, 0.003), smoothstep(0.00, 0.18, x));
  //  c = mix(c, vec3(0.850, 0.130, 0.010), smoothstep(0.18, 0.38, x));
  //  c = mix(c, vec3(1.000, 0.360, 0.035), smoothstep(0.38, 0.56, x));
  //  c = mix(c, vec3(1.000, 0.620, 0.100), smoothstep(0.56, 0.72, x));
  //  c = mix(c, vec3(1.000, 0.850, 0.320), smoothstep(0.72, 0.86, x));
  //  c = mix(c, vec3(1.000, 0.850, 0.380), smoothstep(0.77, 0.91, x));
  //
  c = mix(c, vec4(0.920, 0.875, 0.503, 0.50), smoothstep(0.00, 0.13, x));
  c = mix(c, vec4(0.420, 0.030, 0.003, 0.50), smoothstep(0.00, 0.15, x));
  c = mix(c, vec4(0.420, 0.030, 0.003, 0.40), smoothstep(0.00, 0.17, x));
  c = mix(c, vec4(0.850, 0.130, 0.010, 0.90), smoothstep(0.18, 0.38, x));
  c = mix(c, vec4(1.000, 0.360, 0.035, 0.90), smoothstep(0.38, 0.56, x));
  c = mix(c, vec4(1.000, 0.620, 0.100, 0.90), smoothstep(0.56, 0.82, x));
  c = mix(c, vec4(1.000, 0.850, 0.320, 0.90), smoothstep(0.72, 0.86, x));
  //  c = mix(c, vec3(1.000, 0.850, 0.380), smoothstep(0.77, 0.91, x));
  c = mix(c, vec4(1.000, 0.750, 0.380, 1.00), smoothstep(0.82, 0.85, x));
  //  c = mix(c, vec3(1.000, 0.650, 0.380), smoothstep(0.83, 0.90, x));

  c = mix(c, vec4(1.000, 0.875, 0.500, 0.9), smoothstep(0.86, 0.96, x));
  c = mix(c, vec4(0.700, 0.875, 0.600, 0.90), smoothstep(0.87, 0.96, x));
  //  c = mix(c, vec3(1.000, 0.995, 0.960), smoothstep(0.99, 1.00, x));
  return c;
}

void main() {
  vec2 uv = cogl_tex_coord_in[0].st;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  float r = length(p);

  float t = u_time * max(u_speed, 0.01);
  float bass = clamp(u_bass, 0.0, 1.0);
  float treble = clamp(u_treble, 0.0, 1.0);
  float level = clamp(u_level, 0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);
  // Gentle agitation only; the fire should breathe.
  float flick = 1.7;
//  flick += 0.01 * treble;
  float tt = t * flick;

  // --- hoop -----------------------------------------------------------------
  float R = 0.18 + 0.00 * 1;

  float dens = 0.0;

  // Walk the ring, rotating the base direction one slot per step instead of
  // calling sin/cos 64 times per pixel.
  float step_a = TAU / 64.0;
  float ca = cos(step_a);
  float sa = sin(step_a);
  vec2 fd = vec2(cos(step_a * 0.5), sin(step_a * 0.5));

  for (int i = 0; i < N; i++) {
    vec2 fn = vec2(-fd.y, fd.x);          // lateral axis of this flame
    vec2 rel = p - fd * R;                // vector from the flame's base
    float ro = dot(rel, fd);              // distance outward along the flame
    float lat = dot(rel, fn);             // distance across the flame

    float fi = float(i);
    float lvl = clamp(u_spectrum[i], 0.0, 1.0);
    float r1 = hash21(vec2(fi * 1.7, 3.1));
    float r2 = hash21(vec2(fi * 1.7 + 9.3, 7.7));
    float r3 = hash21(vec2(fi * 3.1 + 2.7, 1.3));

    // Geometry: the band's level sets how tall and fat this flame grows, with
    // a stable per-flame random so no two tongues are alike.
    float h = (0.30 + 1.7 * lvl) * (0.35 + 0.30 * level) * (0.75 + 0.55 * r1) + 0.015 * bass;
    h = min(h, 0.92);
    float w0 = 0.050 * (1.0 + 0.125 * lvl) * (0.75 + 0.6 * r2) + 0.015 * treble;

    if (ro > -0.02 && ro < h) {
      float tc = clamp(ro / max(h, 1e-4), 0.0, 1.0);
      float w = w0 * pow(tc, 0.35) * pow(1.0 - tc, 0.55) * 2.4;
      w = max(w, 1e-4);

      // Slow, per-flame turbulence (no global advection) plus a lean that
      // grows toward the tip, so the tongue curves instead of standing straight.
      float n1 = vnoise(vec2(fi * 13.0 + lat * 4.5, ro * 5.0 - tt * 0.7));
      float n2 = vnoise(vec2(fi * 13.0 + lat * 9.0 + 5.0, ro * 9.0 - tt * 1.1));
      float lean = (0.06 + 0.05 * r3) * tc * tc;
      float disp = ((n1 - 0.5) + 0.45 * (n2 - 0.5)) * w * 1.9 + lean;
      w = max(w * (0.65 + 0.7 * n2), 1e-4);
      float q = abs(lat - disp) / w;

      float body = 1.0 - smoothstep(0.40, 1.0, q);
      body *= smoothstep(0.0, 0.07, tc);          // attached at the base
      body *= 1.0 - smoothstep(0.68, 1.0, tc);    // pointed, dissolving tip
      body *= 0.15 + 0.6 * n1 + 1.7 * lvl + 0.3 * level;                    // density flicker
      dens += body;
    }

    fd = vec2(fd.x * ca - fd.y * sa, fd.x * sa + fd.y * ca);
  }

  // --- bright base ring -----------------------------------------------------
  float ring = exp(-pow(abs(r - R) / 0.018, 2.0));
  dens += ring * 0.85;

  // --- temperature & shade --------------------------------------------------
  // Temperature from distance to the hoop: a thin white-hot inner edge cooling
  // outward to red at the tongues. Independent of how many flames overlap, so
  // the core never blows out.
  float heat = dens * (0.08 + 0.15 * exp(-max(r - R, 0.0) * 5.0)) + ring * 0.35 + 0.12 * beat;

  //  float center = smoothstep(0.02, 0.05, r);
  //  dens *= center;
  //  heat *= center;

  vec4 col = fire_ramp(heat);
  float a = 1.0 - exp(-dens * 1.4);             // Beer–Lambert translucency
  a *= u_intensity;
  a = clamp(a, 0.0, 1.0);
  // Safety fade: coverage reaches zero before the nearest canvas edge.
  a *= 1.0 - smoothstep(0.90, 1.0, r);

  // Dither to break gradient banding in the dark.
  col += (hash21(uv * u_resolution + 0.7) - 0.5) * (1.5 / 255.0);

  //  cogl_color_out = vec4(col, a);
  cogl_color_out = col * a;
}
