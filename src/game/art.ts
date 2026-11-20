import Phaser from 'phaser';

// Procedural art. Every creature is painted with Canvas 2D at boot into
// animation frame atlases, in a consistent "glowing ink" bioluminescent style:
// dark translucent bodies, luminous rims, soft bloom via shadowBlur.

export const PAL = {
  player: '#ffd27a',
  playerCore: '#fff8e6',
  trail: 0xffd27a,
  mote: '#b47cff',
  lancer: '#ff4d6d',
  lure: '#ffe066',
  urchin: '#c6ff4d',
  naut: '#7d8bff',
  eel: '#ff3fd0',
  siren: '#ff6a4d',
  orb: '#ff7a4a',
  pearl: '#8ffcff',
  boss1: '#9f7bff',
  boss2: '#ff3b5c',
  boss3: '#ff2fb0',
};

type DrawFn = (ctx: CanvasRenderingContext2D, phase: number, w: number, h: number) => void;

const TAU = Math.PI * 2;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Paints `frames` animation frames of size w×h world units at `scale` pixels per
 * unit into one canvas texture laid out in a grid, and registers an animation.
 */
function makeFrames(
  scene: Phaser.Scene,
  key: string,
  frames: number,
  w: number,
  h: number,
  scale: number,
  draw: DrawFn,
  fps = 12,
): void {
  const pw = Math.ceil(w * scale);
  const ph = Math.ceil(h * scale);
  const cols = Math.max(1, Math.min(frames, Math.floor(4096 / pw)));
  const rows = Math.ceil(frames / cols);
  const tex = scene.textures.createCanvas(key, pw * cols, ph * rows);
  if (!tex) throw new Error('canvas texture failed: ' + key);
  const ctx = tex.getContext();
  for (let i = 0; i < frames; i++) {
    const cx = (i % cols) * pw;
    const cy = Math.floor(i / cols) * ph;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, pw, ph);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    draw(ctx, i / frames, w, h);
    ctx.restore();
    tex.add(i, 0, cx, cy, pw, ph);
  }
  tex.refresh();
  if (frames > 1) {
    scene.anims.create({
      key,
      frames: Array.from({ length: frames }, (_, i) => ({ key, frame: i })),
      frameRate: fps,
      repeat: -1,
    });
  }
}

function glowCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.35, rgba(color, a * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function setGlow(ctx: CanvasRenderingContext2D, color: string, blur: number, scale: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * scale;
}

function noGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

// ------------------------------------------------------------------ creatures

function drawPlayer(S: number): DrawFn {
  return (ctx, p) => {
    const cx = 40;
    const cy = 32;
    glowCircle(ctx, cx, cy, 30, PAL.player, 0.45);
    const wv = Math.sin(p * TAU);
    const wv2 = Math.sin(p * TAU + 1.4);
    // flowing tail ribbons
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy);
      ctx.quadraticCurveTo(cx - 12, cy + k * 13 + wv * 5 * k, cx - 34, cy + k * 6 + wv2 * 7);
      ctx.quadraticCurveTo(cx - 14, cy + k * 4 + wv * 2, cx + 2, cy);
      const g = ctx.createLinearGradient(cx, cy, cx - 34, cy);
      g.addColorStop(0, rgba(PAL.player, 0.85));
      g.addColorStop(1, rgba('#ff8a4a', 0));
      ctx.fillStyle = g;
      setGlow(ctx, PAL.player, 6, S);
      ctx.fill();
    }
    // center streak
    ctx.strokeStyle = rgba(PAL.playerCore, 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx - 14, cy + wv2 * 3, cx - 28, cy + wv * 4);
    ctx.stroke();
    // side fins
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy + k * 4);
      ctx.quadraticCurveTo(cx + 1, cy + k * (12 + wv * 2.5), cx - 5, cy + k * (11 + wv * 3));
      ctx.quadraticCurveTo(cx - 1, cy + k * 6, cx + 4, cy + k * 4);
      ctx.fillStyle = rgba(PAL.player, 0.55);
      ctx.fill();
    }
    // body
    const bg = ctx.createRadialGradient(cx + 6, cy - 2, 1, cx + 3, cy, 11);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.45, PAL.playerCore);
    bg.addColorStop(1, rgba(PAL.player, 0.9));
    ctx.fillStyle = bg;
    setGlow(ctx, PAL.player, 14, S);
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy, 10, 7.5, 0, 0, TAU);
    ctx.fill();
    noGlow(ctx);
    // eye
    ctx.fillStyle = 'rgba(60,30,10,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx + 8, cy - 1.5, 1.6, 1.9, 0, 0, TAU);
    ctx.fill();
  };
}

function drawMote(S: number, color = PAL.mote): DrawFn {
  return (ctx, p) => {
    const cx = 32;
    const by = 26;
    const c = Math.sin(p * TAU);
    const rx = 18 * (1 - 0.09 * c);
    const ry = 15 * (1 + 0.1 * c);
    glowCircle(ctx, cx, by + 6, 30, color, 0.18);
    // tentacles
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x0 = cx + (i - 2) * 6 * (1 - 0.09 * c);
      ctx.beginPath();
      ctx.moveTo(x0, by + 2);
      let x = x0;
      let y = by + 2;
      for (let j = 1; j <= 8; j++) {
        y += 3.8 + c * 0.4;
        x = x0 + Math.sin(p * TAU + j * 0.7 + i * 1.3) * 3.2 * (j / 8);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(color, 0.55);
      ctx.lineWidth = i === 2 ? 2.2 : 1.4;
      setGlow(ctx, color, 4, S);
      ctx.stroke();
    }
    // bell
    ctx.beginPath();
    ctx.ellipse(cx, by + 2, rx, ry, 0, Math.PI, TAU);
    const scal = 7;
    for (let i = 0; i < scal; i++) {
      const x1 = cx + rx - ((i + 1) / scal) * rx * 2;
      const xm = cx + rx - ((i + 0.5) / scal) * rx * 2;
      ctx.quadraticCurveTo(xm, by + 6.5, x1, by + 2);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, by - 6, 1, cx, by, rx + 2);
    g.addColorStop(0, rgba(color, 0.65));
    g.addColorStop(0.55, 'rgba(36,12,64,0.78)');
    g.addColorStop(1, 'rgba(18,6,36,0.9)');
    ctx.fillStyle = g;
    setGlow(ctx, color, 10, S);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    noGlow(ctx);
    // inner veins
    ctx.strokeStyle = rgba(color, 0.35);
    ctx.lineWidth = 0.8;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 2, by - ry + 4);
      ctx.quadraticCurveTo(cx + i * 6, by - 4, cx + i * 7.5, by + 3);
      ctx.stroke();
    }
    // eyes
    setGlow(ctx, '#ffe6ff', 6, S);
    ctx.fillStyle = '#fff0ff';
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + k * 5, by - 3, 1.9, 2.6 + c * 0.3, 0, 0, TAU);
      ctx.fill();
    }
    noGlow(ctx);
  };
}

function drawLancer(S: number): DrawFn {
  const col = PAL.lancer;
  return (ctx, p) => {
    const cy = 34;
    const f = Math.sin(p * TAU);
    glowCircle(ctx, 50, cy, 40, col, 0.14);
    // tail
    ctx.beginPath();
    ctx.moveTo(26, cy);
    ctx.lineTo(8, cy - 11 + f * 5);
    ctx.quadraticCurveTo(14, cy + f * 3, 8, cy + 11 + f * 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(70,8,22,0.85)';
    setGlow(ctx, col, 6, S);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // body
    ctx.beginPath();
    ctx.moveTo(24, cy);
    ctx.bezierCurveTo(34, cy - 18, 60, cy - 20, 76, cy - 6);
    ctx.lineTo(70, cy + 2);
    ctx.lineTo(78, cy + 6);
    ctx.bezierCurveTo(62, cy + 18, 36, cy + 14, 24, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(30, cy - 18, 60, cy + 16);
    g.addColorStop(0, 'rgba(90,14,34,0.92)');
    g.addColorStop(1, 'rgba(26,4,12,0.95)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 10, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    noGlow(ctx);
    // teeth
    ctx.strokeStyle = 'rgba(255,230,230,0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = 64 + i * 2.3;
      ctx.moveTo(x, cy - 3 + i * 0.6);
      ctx.lineTo(x + 1.1, cy + 2.5 + i * 0.6);
    }
    ctx.stroke();
    // lateral glow dots
    for (let i = 0; i < 5; i++) {
      glowCircle(ctx, 34 + i * 7, cy + 4 + Math.sin(i) * 1.5, 2.6, col, 0.9);
    }
    // dorsal spines
    ctx.strokeStyle = rgba(col, 0.7);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(36 + i * 6, cy - 13 - i * 0.6);
      ctx.lineTo(32 + i * 6, cy - 20 - i * 0.4 + f);
      ctx.stroke();
    }
    // eye
    setGlow(ctx, '#ffffff', 6, S);
    ctx.fillStyle = '#fff4dd';
    ctx.beginPath();
    ctx.arc(64, cy - 7, 2.6, 0, TAU);
    ctx.fill();
    noGlow(ctx);
    // lure
    const ly = 8 + Math.sin(p * TAU * 2) * 1.5;
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(56, cy - 17);
    ctx.quadraticCurveTo(66, ly - 4, 82, ly + 2);
    ctx.stroke();
    glowCircle(ctx, 82, ly + 2, 9, PAL.lure, 0.9);
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    ctx.arc(82, ly + 2, 2.2, 0, TAU);
    ctx.fill();
  };
}

function drawUrchin(S: number): DrawFn {
  const col = PAL.urchin;
  return (ctx, p) => {
    const cx = 40;
    const cy = 40;
    glowCircle(ctx, cx, cy, 38, col, 0.16);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = 15 + 4 * Math.sin(p * TAU + i * 1.7);
      const w = 0.16;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * 11, cy + Math.sin(a - w) * 11);
      ctx.lineTo(cx + Math.cos(a) * (12 + len), cy + Math.sin(a) * (12 + len));
      ctx.lineTo(cx + Math.cos(a + w) * 11, cy + Math.sin(a + w) * 11);
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.8);
      setGlow(ctx, col, 5, S);
      ctx.fill();
      // secondary short spikes
      const b = a + TAU / n / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(b) * 12, cy + Math.sin(b) * 12);
      ctx.lineTo(cx + Math.cos(b) * (19 + len * 0.2), cy + Math.sin(b) * (19 + len * 0.2));
      ctx.strokeStyle = rgba(col, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(cx - 4, cy - 4, 1, cx, cy, 14);
    g.addColorStop(0, 'rgba(90,120,20,0.95)');
    g.addColorStop(1, 'rgba(18,30,4,0.98)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 8, S);
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    noGlow(ctx);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996;
      const r = 3 + (i % 3) * 3;
      glowCircle(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2, col, 0.6 + 0.4 * Math.sin(p * TAU + i));
    }
  };
}

function drawNautilus(S: number, cracked: boolean): DrawFn {
  const col = PAL.naut;
  return (ctx, p) => {
    const cx = 36;
    const cy = 40;
    glowCircle(ctx, cx + 6, cy, 42, col, cracked ? 0.1 : 0.16);
    // tentacles
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y0 = cy - 7 + i * 2.3;
      ctx.beginPath();
      ctx.moveTo(cx + 18, y0);
      const len = 20 + (i % 3) * 4;
      for (let j = 1; j <= 6; j++) {
        const x = cx + 18 + (j / 6) * len;
        const y = y0 + (i - 3) * j * 0.8 + Math.sin(p * TAU + j * 0.8 + i) * 2.2;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(col, 0.6);
      ctx.lineWidth = 1.5;
      setGlow(ctx, col, 4, S);
      ctx.stroke();
    }
    noGlow(ctx);
    // hood
    ctx.beginPath();
    ctx.ellipse(cx + 17, cy - 2, 8, 11, 0.2, 0, TAU);
    ctx.fillStyle = 'rgba(30,26,70,0.9)';
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // shell
    const g = ctx.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, 24);
    g.addColorStop(0, cracked ? 'rgba(60,60,110,0.9)' : 'rgba(80,90,170,0.95)');
    g.addColorStop(1, 'rgba(14,14,40,0.97)');
    ctx.fillStyle = g;
    setGlow(ctx, col, cracked ? 5 : 12, S);
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = cracked ? rgba(col, 0.55) : col;
    ctx.lineWidth = cracked ? 1.2 : 2;
    ctx.stroke();
    noGlow(ctx);
    // spiral
    ctx.beginPath();
    for (let t = 0; t <= 4.2 * Math.PI; t += 0.12) {
      const r = 1.6 * Math.exp(0.22 * t);
      const x = cx + 1 + Math.cos(t + 1.2) * r;
      const y = cy + Math.sin(t + 1.2) * r;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(col, cracked ? 0.5 : 0.85);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // chamber ribs + glowing stripes
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 1.2;
      const r0 = 6 + i * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * 21, cy + Math.sin(a) * 21);
      ctx.strokeStyle = rgba(col, cracked ? 0.18 : 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (!cracked) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + p * 0.6;
        glowCircle(ctx, cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, 3, '#c9d0ff', 0.55 + 0.35 * Math.sin(p * TAU + i));
      }
    } else {
      // cracks
      ctx.strokeStyle = 'rgba(235,240,255,0.95)';
      ctx.lineWidth = 1.2;
      setGlow(ctx, '#ffffff', 5, S);
      const cracks = [
        [-18, -8, -8, -3, -4, -10, 4, -6],
        [-4, 18, 0, 8, 8, 10, 12, 2],
        [14, -16, 8, -8, 12, -2],
      ];
      for (const c of cracks) {
        ctx.beginPath();
        ctx.moveTo(cx + c[0], cy + c[1]);
        for (let i = 2; i < c.length; i += 2) ctx.lineTo(cx + c[i], cy + c[i + 1]);
        ctx.stroke();
      }
      noGlow(ctx);
    }
    // eye
    setGlow(ctx, '#ffffff', 6, S);
    ctx.fillStyle = cracked ? '#ffd0e0' : '#eef0ff';
    ctx.beginPath();
    ctx.arc(cx + 19, cy - 6, 2.2, 0, TAU);
    ctx.fill();
    noGlow(ctx);
  };
}

function drawEelHead(S: number): DrawFn {
  const col = PAL.eel;
  return (ctx, p) => {
    const cy = 24;
    const jaw = Math.max(0, Math.sin(p * TAU)) * 4;
    glowCircle(ctx, 28, cy, 26, col, 0.18);
    // lower jaw
    ctx.beginPath();
    ctx.moveTo(12, cy + 2);
    ctx.quadraticCurveTo(32, cy + 10 + jaw, 46, cy + 4 + jaw);
    ctx.lineTo(30, cy + 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,6,50,0.9)';
    setGlow(ctx, col, 6, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.moveTo(6, cy);
    ctx.bezierCurveTo(12, cy - 12, 36, cy - 12, 48, cy - 1);
    ctx.quadraticCurveTo(34, cy + 4, 6, cy + 4);
    ctx.closePath();
    const g = ctx.createLinearGradient(10, cy - 12, 40, cy + 6);
    g.addColorStop(0, 'rgba(110,14,90,0.95)');
    g.addColorStop(1, 'rgba(30,2,26,0.95)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 10, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    noGlow(ctx);
    // fangs
    ctx.strokeStyle = 'rgba(255,235,250,0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(34 + i * 3, cy + 1.5);
      ctx.lineTo(35 + i * 3, cy + 4 + jaw * 0.5);
    }
    ctx.stroke();
    // eyes
    setGlow(ctx, '#ffffff', 6, S);
    ctx.fillStyle = '#fff0fb';
    ctx.beginPath();
    ctx.ellipse(34, cy - 5, 2.6, 1.6, -0.2, 0, TAU);
    ctx.fill();
    noGlow(ctx);
    // crest
    ctx.strokeStyle = rgba(col, 0.75);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(14 + i * 5, cy - 7 - i * 0.5);
      ctx.lineTo(9 + i * 5, cy - 14 - Math.sin(p * TAU + i) * 1.5);
      ctx.stroke();
    }
  };
}

function drawEelSegment(S: number): DrawFn {
  const col = PAL.eel;
  return (ctx, p) => {
    const cx = 20;
    const cy = 20;
    glowCircle(ctx, cx, cy, 18, col, 0.15);
    const fl = Math.sin(p * TAU) * 2;
    // side frills
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + k * 6);
      ctx.quadraticCurveTo(cx - 2, cy + k * (15 + fl), cx + 6, cy + k * 6);
      ctx.fillStyle = rgba(col, 0.3);
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.7);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, 10, 8, 0, 0, TAU);
    const g = ctx.createRadialGradient(cx - 2, cy - 3, 1, cx, cy, 10);
    g.addColorStop(0, 'rgba(110,14,90,0.95)');
    g.addColorStop(1, 'rgba(26,2,22,0.95)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 8, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    noGlow(ctx);
    glowCircle(ctx, cx, cy, 4.5, '#ffb3ee', 0.85);
  };
}

function drawSiren(S: number): DrawFn {
  const col = PAL.siren;
  return (ctx, p) => {
    const cx = 44;
    const cy = 44;
    glowCircle(ctx, cx, cy, 42, col, 0.15);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.sin(p * TAU) * 0.08;
      const len = 26 + Math.sin(p * TAU + i * 1.1) * 4;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const px = -ay;
      const py = ax;
      const curl = Math.sin(p * TAU + i) * 6;
      ctx.beginPath();
      ctx.moveTo(cx + ax * 8 + px * 5, cy + ay * 8 + py * 5);
      ctx.quadraticCurveTo(
        cx + ax * len * 0.6 + px * (9 + curl),
        cy + ay * len * 0.6 + py * (9 + curl),
        cx + ax * len + px * curl,
        cy + ay * len + py * curl,
      );
      ctx.quadraticCurveTo(
        cx + ax * len * 0.6 + px * (-4 + curl),
        cy + ay * len * 0.6 + py * (-4 + curl),
        cx + ax * 8 - px * 5,
        cy + ay * 8 - py * 5,
      );
      ctx.closePath();
      const g = ctx.createLinearGradient(cx, cy, cx + ax * len, cy + ay * len);
      g.addColorStop(0, 'rgba(70,14,6,0.92)');
      g.addColorStop(1, rgba(col, 0.6));
      ctx.fillStyle = g;
      setGlow(ctx, col, 6, S);
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.9);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      glowCircle(ctx, cx + ax * len + px * curl, cy + ay * len + py * curl, 3, '#ffd2a8', 0.9);
    }
    noGlow(ctx);
    // mouth ring
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, TAU);
    ctx.fillStyle = 'rgba(30,6,4,0.95)';
    setGlow(ctx, col, 10, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    noGlow(ctx);
    ctx.strokeStyle = 'rgba(255,220,200,0.85)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 10.5, cy + Math.sin(a) * 10.5);
      ctx.lineTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5);
      ctx.stroke();
    }
  };
}

// ------------------------------------------------------------------ bosses

function drawBossBell(S: number): DrawFn {
  const col = PAL.boss1;
  return (ctx) => {
    const cx = 110;
    const by = 100;
    glowCircle(ctx, cx, by - 20, 110, col, 0.22);
    const rx = 88;
    const ry = 74;
    ctx.beginPath();
    ctx.ellipse(cx, by, rx, ry, 0, Math.PI, TAU);
    const sc = 12;
    for (let i = 0; i < sc; i++) {
      const x1 = cx + rx - ((i + 1) / sc) * rx * 2;
      const xm = cx + rx - ((i + 0.5) / sc) * rx * 2;
      ctx.quadraticCurveTo(xm, by + 16, x1, by);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, by - 50, 4, cx, by - 10, rx);
    g.addColorStop(0, rgba(col, 0.7));
    g.addColorStop(0.5, 'rgba(34,14,72,0.85)');
    g.addColorStop(1, 'rgba(12,4,30,0.95)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 22, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    noGlow(ctx);
    // radial organs
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + (i + 0.5) * (Math.PI / 14);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 18, by - 8 + Math.sin(a) * 14);
      ctx.quadraticCurveTo(
        cx + Math.cos(a) * 50,
        by - 4 + Math.sin(a) * 40,
        cx + Math.cos(a) * (rx - 8),
        by - 2 + Math.sin(a) * (ry - 8),
      );
      ctx.strokeStyle = rgba(col, 0.38);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    // inner crown
    ctx.beginPath();
    ctx.ellipse(cx, by - 18, 34, 22, 0, 0, TAU);
    ctx.fillStyle = 'rgba(80,40,160,0.45)';
    setGlow(ctx, col, 14, S);
    ctx.fill();
    noGlow(ctx);
    // eyes in an arc
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + 0.55 + i * ((Math.PI - 1.1) / 4);
      const ex = cx + Math.cos(a) * 52;
      const ey = by - 6 + Math.sin(a) * 40;
      glowCircle(ctx, ex, ey, 12, '#e8dcff', 0.7);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 4.2, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1a0838';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 1.2, 4, 0, 0, TAU);
      ctx.fill();
    }
  };
}

function drawBossAngler(S: number): DrawFn {
  const col = PAL.boss2;
  return (ctx) => {
    const cy = 100;
    glowCircle(ctx, 120, cy, 120, col, 0.16);
    // tail
    ctx.beginPath();
    ctx.moveTo(40, cy);
    ctx.lineTo(4, cy - 40);
    ctx.quadraticCurveTo(24, cy, 4, cy + 40);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,6,18,0.9)';
    setGlow(ctx, col, 10, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    // body (upper head; jaw drawn separately)
    ctx.beginPath();
    ctx.moveTo(36, cy);
    ctx.bezierCurveTo(60, cy - 78, 170, cy - 92, 214, cy - 8);
    ctx.lineTo(200, cy + 6);
    ctx.bezierCurveTo(150, cy + 30, 80, cy + 50, 36, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(60, cy - 80, 150, cy + 40);
    g.addColorStop(0, 'rgba(100,12,34,0.95)');
    g.addColorStop(1, 'rgba(20,2,8,0.97)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 22, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    noGlow(ctx);
    // upper teeth
    ctx.fillStyle = 'rgba(255,236,236,0.95)';
    for (let i = 0; i < 9; i++) {
      const x = 130 + i * 9;
      const y = cy + 18 - i * 2.2;
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x, y + 12 - (i % 2) * 4);
      ctx.lineTo(x + 3, y);
      ctx.fill();
    }
    // spots
    for (let i = 0; i < 12; i++) {
      const x = 70 + (i % 6) * 16;
      const y = cy - 30 + Math.floor(i / 6) * 22 + Math.sin(i) * 6;
      glowCircle(ctx, x, y, 5, col, 0.75);
    }
    // eye
    glowCircle(ctx, 168, cy - 34, 22, '#ffe6b0', 0.6);
    ctx.fillStyle = '#fff6dc';
    ctx.beginPath();
    ctx.arc(168, cy - 34, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#300410';
    ctx.beginPath();
    ctx.ellipse(170, cy - 34, 3, 7, 0, 0, TAU);
    ctx.fill();
  };
}

function drawBossJaw(S: number): DrawFn {
  const col = PAL.boss2;
  return (ctx) => {
    // pivot at (6, 10)
    ctx.beginPath();
    ctx.moveTo(4, 8);
    ctx.bezierCurveTo(40, 40, 100, 44, 132, 12);
    ctx.lineTo(120, 6);
    ctx.bezierCurveTo(90, 22, 40, 20, 4, 8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(50,4,14,0.95)';
    setGlow(ctx, col, 14, S);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    noGlow(ctx);
    ctx.fillStyle = 'rgba(255,236,236,0.95)';
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 9.5;
      const y = 20 - Math.pow(i - 4, 2) * -0.35 - i * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x, y - 12 + (i % 2) * 4);
      ctx.lineTo(x + 3, y);
      ctx.fill();
    }
  };
}

function drawMotherBody(S: number): DrawFn {
  const col = PAL.boss3;
  return (ctx) => {
    const c = 110;
    glowCircle(ctx, c, c, 110, col, 0.22);
    const g = ctx.createRadialGradient(c - 20, c - 26, 6, c, c, 76);
    g.addColorStop(0, 'rgba(110,18,80,0.95)');
    g.addColorStop(0.7, 'rgba(36,4,30,0.97)');
    g.addColorStop(1, 'rgba(14,0,12,0.98)');
    ctx.fillStyle = g;
    setGlow(ctx, col, 24, S);
    ctx.beginPath();
    // lumpy outline
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      const r = 74 + Math.sin(a * 5) * 3 + Math.sin(a * 9 + 1) * 2;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    noGlow(ctx);
    // veins
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.1;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 40, c + Math.sin(a) * 40);
      ctx.quadraticCurveTo(
        c + Math.cos(a + 0.25) * 56,
        c + Math.sin(a + 0.25) * 56,
        c + Math.cos(a + 0.1) * 70,
        c + Math.sin(a + 0.1) * 70,
      );
      ctx.strokeStyle = rgba(col, 0.5);
      ctx.lineWidth = 1.8;
      setGlow(ctx, col, 6, S);
      ctx.stroke();
    }
    noGlow(ctx);
    // sclera socket
    const s = ctx.createRadialGradient(c, c, 4, c, c, 40);
    s.addColorStop(0, 'rgba(255,230,240,0.98)');
    s.addColorStop(0.75, 'rgba(240,150,200,0.95)');
    s.addColorStop(1, 'rgba(120,20,80,0.95)');
    ctx.fillStyle = s;
    setGlow(ctx, '#ffd0ea', 16, S);
    ctx.beginPath();
    ctx.ellipse(c, c, 40, 36, 0, 0, TAU);
    ctx.fill();
    noGlow(ctx);
    ctx.strokeStyle = 'rgba(160,20,90,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 38, c + Math.sin(a) * 34);
      ctx.quadraticCurveTo(
        c + Math.cos(a + 0.3) * 30,
        c + Math.sin(a + 0.3) * 27,
        c + Math.cos(a + 0.1) * 24,
        c + Math.sin(a + 0.1) * 22,
      );
      ctx.stroke();
    }
  };
}

function drawIris(S: number): DrawFn {
  return (ctx) => {
    const c = 24;
    const g = ctx.createRadialGradient(c, c, 2, c, c, 20);
    g.addColorStop(0, '#fff3a0');
    g.addColorStop(0.5, '#ffb020');
    g.addColorStop(1, '#a02a00');
    ctx.fillStyle = g;
    setGlow(ctx, '#ffcc33', 10, S);
    ctx.beginPath();
    ctx.arc(c, c, 18, 0, TAU);
    ctx.fill();
    noGlow(ctx);
    ctx.strokeStyle = 'rgba(120,30,0,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 6, c + Math.sin(a) * 6);
      ctx.lineTo(c + Math.cos(a) * 17, c + Math.sin(a) * 17);
      ctx.stroke();
    }
    ctx.fillStyle = '#12000a';
    ctx.beginPath();
    ctx.ellipse(c, c, 4, 14, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(c - 6, c - 7, 3, 0, TAU);
    ctx.fill();
  };
}

function drawWhale(): DrawFn {
  return (ctx) => {
    ctx.fillStyle = 'rgba(2,6,16,1)';
    ctx.beginPath();
    ctx.moveTo(20, 80);
    ctx.bezierCurveTo(60, 30, 220, 20, 330, 60);
    ctx.quadraticCurveTo(370, 70, 400, 40);
    ctx.quadraticCurveTo(392, 80, 410, 120);
    ctx.quadraticCurveTo(370, 92, 330, 100);
    ctx.bezierCurveTo(240, 140, 90, 130, 20, 80);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(140, 110);
    ctx.quadraticCurveTo(170, 160, 200, 150);
    ctx.quadraticCurveTo(190, 125, 180, 112);
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      glowCircle(ctx, 70 + i * 18, 92 + Math.sin(i * 1.3) * 8, 3, '#5fd7ff', 0.5);
    }
  };
}

// ------------------------------------------------------------------ fx textures

function fxTextures(scene: Phaser.Scene): void {
  const mk = (key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
    const t = scene.textures.createCanvas(key, size, size);
    if (!t) return;
    draw(t.getContext(), size);
    t.refresh();
  };
  mk('glow', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  mk('spark', 32, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  mk('ring', 256, (ctx, s) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 18, 0, TAU);
    ctx.stroke();
    ctx.stroke();
  });
  mk('star', 64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.quadraticCurveTo(c, c, s, c);
    ctx.quadraticCurveTo(c, c, c, s);
    ctx.quadraticCurveTo(c, c, 0, c);
    ctx.quadraticCurveTo(c, c, c, 0);
    ctx.fill();
  });
  mk('orb', 96, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,220,190,1)');
    g.addColorStop(0.35, rgba(PAL.orb, 0.9));
    g.addColorStop(0.6, rgba(PAL.orb, 0.3));
    g.addColorStop(1, rgba(PAL.orb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  mk('pearl', 64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(220,255,255,1)');
    g.addColorStop(0.4, rgba(PAL.pearl, 0.7));
    g.addColorStop(1, rgba(PAL.pearl, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c, 6);
    ctx.lineTo(c, s - 6);
    ctx.moveTo(6, c);
    ctx.lineTo(s - 6, c);
    ctx.stroke();
  });
}

export function buildArt(scene: Phaser.Scene, scale: number): void {
  const S = scale;
  fxTextures(scene);
  makeFrames(scene, 'player', 10, 80, 64, S, drawPlayer(S), 14);
  makeFrames(scene, 'mote', 10, 64, 64, S, drawMote(S), 10);
  makeFrames(scene, 'lancer', 8, 96, 68, S, drawLancer(S), 12);
  makeFrames(scene, 'urchin', 8, 80, 80, S, drawUrchin(S), 8);
  makeFrames(scene, 'naut', 8, 84, 80, S, drawNautilus(S, false), 9);
  makeFrames(scene, 'nautCracked', 8, 84, 80, S, drawNautilus(S, true), 9);
  makeFrames(scene, 'eelHead', 6, 52, 48, S, drawEelHead(S), 8);
  makeFrames(scene, 'eelSeg', 6, 40, 40, S, drawEelSegment(S), 8);
  makeFrames(scene, 'siren', 8, 88, 88, S, drawSiren(S), 8);
  const BS = Math.max(1.5, S * 0.75);
  makeFrames(scene, 'bossBell', 1, 220, 130, BS, drawBossBell(BS));
  makeFrames(scene, 'bossAngler', 1, 220, 170, BS, drawBossAngler(BS));
  makeFrames(scene, 'bossJaw', 1, 140, 50, BS, drawBossJaw(BS));
  makeFrames(scene, 'mother', 1, 220, 220, BS, drawMotherBody(BS));
  makeFrames(scene, 'iris', 1, 48, 48, S, drawIris(S));
  makeFrames(scene, 'whale', 1, 420, 170, 1, drawWhale());
}
