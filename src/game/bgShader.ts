// Full-screen ocean shader: depth-graded water, drifting god rays, caustics,
// murk, a procedural seafloor, and dynamic light from the player.

export const BG_FRAG = `
precision mediump float;
uniform float uTime;
uniform vec2 uSize;
uniform vec2 uPlayer;
uniform float uDepth;
uniform float uFlash;
uniform float uSurge;
uniform float uHue;
varying vec2 outTexCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = outTexCoord;                       // y = 1 at top
  vec2 w = vec2(uv.x * uSize.x, (1.0 - uv.y) * uSize.y);
  vec2 p = w / 600.0;
  float d = clamp(uDepth, 0.0, 1.2);

  vec3 deep = mix(vec3(0.006, 0.016, 0.045), vec3(0.014, 0.085, 0.130), min(d, 1.0));
  vec3 top  = mix(vec3(0.035, 0.100, 0.200), vec3(0.130, 0.500, 0.580), min(d, 1.0));
  // endless mode hue drift toward violet
  deep = mix(deep, vec3(0.020, 0.004, 0.035), uHue);
  top = mix(top, vec3(0.090, 0.020, 0.140), uHue);
  vec3 col = mix(deep, top, pow(uv.y, 1.7 - d * 0.7));

  // god rays
  float ang = p.x + (1.0 - uv.y) * 0.45;
  float rays = (sin(ang * 6.0 + uTime * 0.21) * 0.5 + 0.5) * (sin(ang * 11.0 - uTime * 0.13 + 1.3) * 0.5 + 0.5);
  rays = pow(rays, 3.0) * smoothstep(0.05, 1.0, uv.y);
  rays *= 0.55 + 0.45 * noise(vec2(ang * 2.5, uTime * 0.08));
  col += vec3(0.22, 0.55, 0.62) * rays * (0.13 + d * 0.38);
  // a broad halo of light from far above
  col += vec3(0.05, 0.12, 0.16) * pow(uv.y, 3.0) * (0.6 + 0.4 * sin(uTime * 0.2 + p.x));

  // caustics
  vec2 cp = p * 2.6 + vec2(uTime * 0.04, uTime * 0.025);
  float c = abs(sin(fbm(cp) * 9.0 + uTime * 0.5));
  c = pow(1.0 - c, 7.0);
  float playerD = length((w - uPlayer) / 600.0);
  float pl = exp(-playerD * playerD * 14.0);
  col += vec3(0.35, 0.75, 0.85) * c * ((0.012 + 0.14 * d) * smoothstep(0.15, 1.0, uv.y) + pl * 0.07);

  // drifting murk
  float m = fbm(p * 1.4 + vec2(uTime * 0.015, -uTime * 0.01));
  col *= 0.72 + 0.56 * m;

  // seafloor silhouette (visible in the deep)
  float floorH = 0.07 + 0.09 * fbm(vec2(p.x * 1.1, 2.0)) + 0.03 * noise(vec2(p.x * 6.0, 7.0));
  float fy = 1.0 - (w.y / uSize.y);
  float floorMask = smoothstep(floorH + 0.004, floorH - 0.004, fy) * (1.0 - min(d, 1.0) * 0.85);
  vec3 floorCol = vec3(0.004, 0.008, 0.02) + vec3(0.03, 0.10, 0.14) * smoothstep(floorH - 0.03, floorH, fy) * 0.5;
  col = mix(col, floorCol, floorMask);

  // dynamic light from the player
  vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.95, 0.7), uSurge);
  col += warm * pl * (0.09 + uSurge * 0.18);
  col += warm * exp(-playerD * playerD * 2.2) * 0.025;

  col += vec3(0.55, 0.03, 0.08) * uFlash;
  // gentle dithering against banding
  col += (hash(w + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
