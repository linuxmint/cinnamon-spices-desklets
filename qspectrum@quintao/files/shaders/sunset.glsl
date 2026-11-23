// Sunset — synthwave sunset over water: retro striped sun, spectrum-driven
// mountain ridges and a rippled reflection on the sea.
// QSpectrum advanced preset. Original GLSL. Noise/hash sources: see
// ATTRIBUTIONS.md.
//
// Layout: `p` spans the canvas with y = -1 at the top and y = +1 at the bottom,
// divided by ZOOM so the whole scene sits closer to the camera; the horizon is
// at y = HORIZON. The canvas is 16:9 (see PRESET_ASPECT in
// QAdvancedVisualizer.js). Nothing is drawn outside the canvas, so the scene
// never clamps against an edge.
//
// Reactivity: the ridges follow the spectrum as a continuous curve, like the
// Bars preset in "area" mode; the sun reacts to beats only.

uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
uniform float u_bars;
uniform float u_level;
uniform float u_centroid;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;                    // decaying onset envelope (0..1)
uniform float u_frame;                   // 1 = keep the desklet background/border
uniform vec2  u_resolution;
uniform vec3  u_color_from;
uniform vec3  u_color_to;
uniform vec3  u_accent;
uniform float u_spectrum[64];

const float TAU = 6.283185307179586;
const float ZOOM = 1.30;                 // > 1 pulls the whole view closer
const float HORIZON = 0.12;              // horizon line (p.y)

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

// Fractional Brownian motion (4 octaves). https://iquilezles.org/articles/fbm/
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// Spectrum sample: 64 bands uploaded as a float array, linearly interpolated,
// so a continuous sweep across it traces the Bars "area" curve.
float spectrum(float u) {
  float f = clamp(u, 0.0, 1.0) * 63.0;
  float v = 0.0;
  for (int i = 0; i < 64; i++) {
    v += u_spectrum[i] * clamp(1.0 - abs(float(i) - f), 0.0, 1.0);
  }
  return v;
}

// Narrow peak (a mountain spike). Gaussian falloff, no pow() of a negative base.
float peak(float x, float cx, float w, float h) {
  float d = (x - cx) / w;
  return h * exp(-d * d);
}

void main() {
  vec2 uv = cogl_tex_coord_in[0].st;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0 / ZOOM;

  float t = u_time * max(u_speed, 0.01);
  float level = clamp(u_level, 0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);

  float in_sky = 1.0 - step(HORIZON, p.y);
  float ground = step(HORIZON, p.y);

  // --- sky ------------------------------------------------------------------
  // Gradient spans the visible frame, from the top edge down to the horizon.
  float sky_top = -1.0 / ZOOM;
  float sy = clamp((p.y - sky_top) / (HORIZON - sky_top), 0.0, 1.0);
  vec3 sky_col = mix(vec3(0.07, 0.01, 0.20), vec3(0.34, 0.02, 0.33), smoothstep(0.0, 0.6, sy));
  sky_col = mix(sky_col, vec3(0.80, 0.07, 0.38), smoothstep(0.55, 1.0, sy));

  // --- sun: beats only ------------------------------------------------------
  vec2 sc = vec2(p.x, p.y - HORIZON);
  float Rs = 0.34 * (1.0 + 0.13 * beat);
  float sd = length(sc);

  // Broad atmospheric glow plus a tighter core, both breathing with the beat.
  sky_col += vec3(1.0, 0.20, 0.40) * exp(-max(sd - Rs, 0.0) * 2.2)
           * (0.20 + 0.45 * beat) * in_sky;
  sky_col += vec3(1.0, 0.42, 0.42) * exp(-max(sd - Rs, 0.0) * 9.0)
           * (0.14 + 0.30 * beat) * in_sky;

  // Radial speed lines drifting outward.
  float ra = atan(sc.y, sc.x);
  float ac = fract(ra / TAU * 110.0) - 0.5;
  float thin = 1.0 - smoothstep(0.0, 0.08, abs(ac));
  float hh = hash21(vec2(floor(ra / TAU * 110.0), 1.3));
  float dash = fract(sd * 1.4 - t * 1.3 - hh * 5.0);
  float dmask = smoothstep(0.0, 0.25, dash) * (1.0 - smoothstep(0.75, 1.0, dash));
  float streaks = thin * dmask * step(0.82, hh)
                * smoothstep(Rs * 1.05, Rs * 1.30, sd)
                * (1.0 - smoothstep(0.85, 1.55, sd));
  sky_col += vec3(1.0, 0.32, 0.52) * streaks * (0.30 + 0.30 * level) * in_sky;

  // Retro striped disc: yellow on top fading to magenta, with cut bands that
  // widen toward the bottom and drift upward.
  float uy = sc.y / max(Rs, 0.001);
  float disc = 1.0 - smoothstep(Rs - 0.006, Rs + 0.006, sd);
  float bands = fract(uy * 7.0 + 0.5 - t * 0.15);
  float gap = smoothstep(0.0, 0.9, abs(uy));
  disc *= 1.0 - step(bands, gap * 0.75);
  float sg = clamp(uy * 0.5 + 0.5, 0.0, 1.0);
  vec3 sun_col = mix(vec3(1.0, 0.93, 0.40), vec3(1.0, 0.10, 0.55), sg);
  sky_col = mix(sky_col, sun_col, disc);

  // --- mountains ------------------------------------------------------------
  // Area-mode ridges: the spectrum traced as one continuous curve across the
  // width, mirrored horizontally like the Vertical bars mode (lowest
  // frequencies in the middle, highest at the edges), with fbm rock detail and
  // a couple of tall peaks so it reads as terrain, not a graph.
  float sx = clamp(p.x / max(aspect, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  float amp = spectrum(abs(sx - 0.5) * 2.0);
  float rock = fbm(vec2(sx * 9.0, 1.7 + t * 0.12)) * 0.5
             + fbm(vec2(sx * 26.0, 5.3 + t * 0.20)) * 0.22;

  float far_h = 0.045 + 0.200 * amp + 0.014 * rock;
  float near_h = 0.025 + 0.130 * amp + 0.010 * rock;
  // The ridges and peaks follow the spectrum only, so the skyline is a pure
  // read-out of the music.
  far_h += peak(p.x, -1.15, 0.16, 0.30)
         + peak(p.x,  1.05, 0.14, 0.26);
  near_h += peak(p.x, -0.80, 0.10, 0.11)
          + peak(p.x,  0.88, 0.11, 0.13);

  float far_line = HORIZON - far_h;
  float near_line = HORIZON - near_h;
  float far_m = in_sky * smoothstep(far_line - 0.004, far_line + 0.004, p.y);
  float near_m = in_sky * smoothstep(near_line - 0.004, near_line + 0.004, p.y);

  vec3 far_col = mix(vec3(0.05, 0.00, 0.09), vec3(0.28, 0.05, 0.28), 0.22);
  vec3 near_col = mix(vec3(1.00, 0.55, 0.06), vec3(0.40, 0.03, 0.12),
                      clamp((p.y - near_line) / max(near_h, 0.001), 0.0, 1.0));
  near_col += vec3(1.0, 0.55, 0.15) * exp(-max(p.y - near_line, 0.0) * 45.0) * 0.9;
  near_col *= 0.82 + 0.36 * rock;   // rock shading, so it is not a flat fill

  sky_col = mix(sky_col, far_col, far_m);
  sky_col = mix(sky_col, near_col, near_m);

  // Atmospheric haze: softens the horizon and pushes the range back, but stays
  // thin right around the sun so the disc keeps its punch.
  float haze = exp(-abs(p.y - HORIZON) * 5.0)
             * (0.35 + 0.65 * smoothstep(Rs * 0.8, Rs * 1.9, sd));
  sky_col = mix(sky_col, vec3(0.95, 0.35, 0.45), haze * 0.20 * in_sky);

  // --- water ----------------------------------------------------------------
  // No grid: the floor is the sea. The plane recedes to the horizon, so the
  // ripple domain is compressed with distance (1 / distance) and the ripples
  // grow toward the camera - that is what stops the reflection reading as a
  // flat sticker.
  float below = max(p.y - HORIZON, 0.0);
  float persp = 1.0 / (below + 0.16);          // large far away, small up close
  float nearness = below / (below + 0.30);     // 0 at the horizon, 1 close up

  // x converges on the vanishing point, y crowds toward the horizon.
  vec2 wq = vec2(p.x * persp, persp);
  float rip1 = fbm(wq * 1.6 + vec2(0.0, -t * 1.00));
  float rip2 = fbm(wq * 4.2 + vec2(3.0, -t * 1.90));
  float swell = fbm(vec2(p.x * 2.4, persp * 0.8 - t * 0.45)) - 0.5;

  float ripple_amp = 0.006 + 0.085 * nearness * nearness;
  float rx = (rip1 - 0.5) * ripple_amp * 2.4 + swell * 0.05 * nearness;
  float ry = (rip2 - 0.5) * ripple_amp;

  // The sun mirrored below the horizon, stretched and broken by the ripples.
  vec2 wsc = vec2(p.x + rx, (HORIZON - p.y) * 0.62 + ry);
  float wsd = length(wsc);
  float wuy = wsc.y / max(Rs, 0.001);
  float wdisc = 1.0 - smoothstep(Rs - 0.02, Rs + 0.02, wsd);
  float wbands = fract(wuy * 7.0 + 0.5 - t * 0.15);
  float wgap = smoothstep(0.0, 0.9, abs(wuy));
  wdisc *= 1.0 - step(wbands, wgap * 0.75);
  float wsg = clamp(wuy * 0.5 + 0.5, 0.0, 1.0);
  vec3 wsun = mix(vec3(1.0, 0.90, 0.40), vec3(1.0, 0.12, 0.55), wsg);

  float refl = clamp(wdisc * 0.85 * exp(-below * 1.1), 0.0, 1.0);

  vec3 water = vec3(0.05, 0.02, 0.13);
  water = mix(water, wsun, refl);
  // Warm ambient light spilling from the sky, plus a bright horizon line.
  water += vec3(1.0, 0.25, 0.45) * exp(-abs(p.x) * 1.2) * exp(-below * 2.2)
         * (0.10 + 0.25 * level);
  water += vec3(1.0, 0.42, 0.50) * exp(-below * 34.0) * 0.22;
  // Wave shading: crests catch the light, more so close to the camera.
  water *= 0.90 + 0.20 * rip2 * nearness;
  // Glitter path: sparkles that shrink and crowd toward the horizon.
  float glit = fbm(vec2(p.x * persp * 3.2, persp * 2.4 - t * 2.0));
  float sparkle = smoothstep(0.58, 0.95, glit)
                * exp(-abs(p.x) * 1.6) * exp(-below * 1.2);
  water += vec3(1.0, 0.72, 0.52) * sparkle * (0.25 + 0.45 * level + 0.45 * beat);
  // Atmospheric haze on the far water, then a slight darkening up close.
  water = mix(water, vec3(0.32, 0.09, 0.30), exp(-below * 6.0) * 0.35);
  water *= 1.0 - 0.25 * smoothstep(HORIZON, 1.0, p.y);

  vec3 col = mix(sky_col, water, ground);

  // A touch of dither kills the banding in the big smooth gradients.
  col += (hash21(uv * 1024.0 + t) - 0.5) * (1.0 / 255.0);

  float frame = 1.0;
  if (u_frame > 0.5) {
    float inset_lt = 2.0;                 // px: 1px border + 1px actor offset
    float inset_rb = 1.0;                 // px: 1px border
    float radius = 4.0;                   // px: nested inside the 4px border-radius
    vec2 lt = vec2(inset_lt);
    vec2 rb = vec2(inset_rb);
    vec2 centre = u_resolution * 0.5 + (lt - rb) * 0.5;
    vec2 half_size = max(u_resolution * 0.5 - (lt + rb) * 0.5, vec2(0.5));
    vec2 d = abs(uv * u_resolution - centre) - half_size + vec2(radius);
    float dist = length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - radius;
    frame = 1.0 - smoothstep(-0.5, 0.5, dist);
  }

  // The scene is a full frame; intensity fades it out below 1.0.
  float a = clamp(u_intensity, 0.0, 1.0) * frame;
  cogl_color_out = vec4(col, a);
}
