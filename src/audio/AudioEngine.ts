// Fully synthesized audio: a generative ambient score plus all sound effects.
// No audio files are shipped; everything is built from Web Audio nodes.

type MusicMode = 'off' | 'menu' | 'play' | 'boss' | 'victory' | 'gameover';

// D minor pentatonic-ish palette (MIDI note numbers)
const PENTA = [0, 3, 5, 7, 10]; // relative to D
const ROOT = 50; // D3

const CHORDS_PLAY: number[][] = [
  [0, 3, 7, 10, 14], // Dm9
  [-4, 0, 3, 7, 10], // Bbmaj7
  [3, 7, 10, 14, 17], // Fmaj7
  [-2, 2, 5, 9, 12], // C(add9)
];
const CHORDS_BOSS: number[][] = [
  [0, 3, 7, 12], // Dm
  [1, 5, 8, 13], // Eb
  [-2, 1, 5, 10], // Bbm/C
  [0, 3, 6, 10], // Dm7b5
];
const CHORDS_VICTORY: number[][] = [
  [0, 4, 7, 11, 14], // Dmaj9
  [-5, -1, 2, 6, 9], // Gmaj7/B
  [-3, 0, 4, 7, 11], // Bm-ish -> A
  [2, 6, 9, 13, 16], // E(add9)
];

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicVol = 0.6;
  private sfxVol = 0.8;
  private mode: MusicMode = 'off';
  private intensity = 0;
  private schedTimer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private ducked = false;
  private lastPlay: Record<string, number> = {};

  /** Must be called from a user gesture (pointerdown / keydown). Idempotent. */
  unlock(): void {
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      /* Web Audio unavailable: game remains silent */
    }
  }

  private init(): void {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // iOS 17+: let the game be heard like a media app once the player starts it.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* ignore */
    }
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    // Reverb: generated impulse response (long, dark, underwater)
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(3.6, 2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    const revLp = ctx.createBiquadFilter();
    revLp.type = 'lowpass';
    revLp.frequency.value = 3200;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv);
    conv.connect(revLp);
    revLp.connect(revOut);
    revOut.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 0.5;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol * 0.5;
    this.musicFilter.connect(this.musicBus);
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.nextBeat = ctx.currentTime + 0.1;
    this.schedTimer = window.setInterval(() => this.schedule(), 60);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.ducked ? music * 0.2 : music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.beat = 0;
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  /** Muffles the score (pause menus, upgrade screens). */
  duck(on: boolean): void {
    this.ducked = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(on ? 500 : 2400, t, 0.15);
    this.musicBus.gain.setTargetAtTime(on ? this.musicVol * 0.2 : this.musicVol * 0.5, t, 0.15);
  }

  /** Called when the page is hidden/shown. */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ------------------------------------------------------------------ music

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.25;
    if (this.nextBeat < ctx.currentTime - 0.5) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ahead) {
      this.playBeat(this.nextBeat, this.beat);
      const bpm = this.mode === 'boss' ? 92 : this.mode === 'play' ? 76 + this.intensity * 10 : 66;
      this.nextBeat += 60 / bpm / 2; // eighth notes
      this.beat++;
    }
  }

  private playBeat(t: number, b: number): void {
    if (this.mode === 'off') return;
    const eighthsPerChord = 16;
    const chords =
      this.mode === 'boss' ? CHORDS_BOSS : this.mode === 'victory' ? CHORDS_VICTORY : CHORDS_PLAY;
    const chordIdx = Math.floor(b / eighthsPerChord) % chords.length;
    const chord = chords[chordIdx];
    const bpm = this.mode === 'boss' ? 92 : 76;
    const chordDur = (eighthsPerChord * 60) / bpm / 2;

    if (b % eighthsPerChord === 0) {
      // Pad + drone
      const padGain = this.mode === 'gameover' ? 0.035 : 0.05;
      for (const n of chord) this.padVoice(mtof(ROOT + n), t, chordDur + 1.5, padGain);
      this.padVoice(mtof(ROOT - 12 + chord[0]), t, chordDur + 1.5, 0.07, 'sine');
    }
    if (this.mode === 'gameover') return;

    // Sparse bell melody
    const density =
      this.mode === 'menu' ? 0.18 : this.mode === 'victory' ? 0.5 : 0.22 + this.intensity * 0.35;
    if (Math.random() < density) {
      const deg = PENTA[Math.floor(Math.random() * PENTA.length)];
      const oct = Math.random() < 0.3 ? 24 : 12;
      const scaleShift = this.mode === 'victory' ? 4 : 0;
      const note = ROOT + oct + deg + (deg === 3 && scaleShift ? 1 : 0);
      this.bell(mtof(note), t, 0.045 + Math.random() * 0.03, (Math.random() - 0.5) * 1.4);
    }

    // Pulse when the action heats up
    if ((this.mode === 'play' && this.intensity > 0.25) || this.mode === 'boss') {
      if (b % 4 === 0) this.thump(t, this.mode === 'boss' ? 0.32 : 0.18 + this.intensity * 0.12);
      if (this.mode === 'boss' && b % 2 === 1) this.hat(t, 0.025);
      if (this.mode === 'play' && this.intensity > 0.6 && b % 4 === 2) this.hat(t, 0.018);
    }
  }

  private padVoice(freq: number, t: number, dur: number, gain: number, type: OscillatorType = 'sawtooth'): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420 + this.intensity * 900 + (this.mode === 'victory' ? 900 : 0);
    f.Q.value = 0.7;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(2.2, dur * 0.35));
    g.gain.setTargetAtTime(0, t + dur - 1.5, 0.6);
    f.connect(g);
    g.connect(this.musicFilter);
    g.connect(this.reverbIn);
    const detunes = type === 'sine' ? [0] : [-7, 7];
    for (const dt of detunes) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = dt;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 2);
    }
  }

  private bell(freq: number, t: number, gain: number, pan: number, dest?: AudioNode, decay = 1.6): void {
    const ctx = this.ctx!;
    const out = dest ?? this.musicFilter;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(out);
    p.connect(this.reverbIn);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    // light FM for a glassy timbre
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    mod.frequency.value = freq * 3.5;
    modG.gain.setValueAtTime(freq * 0.6, t);
    modG.gain.exponentialRampToValueAtTime(1, t + decay * 0.6);
    mod.connect(modG);
    modG.connect(o.frequency);
    o.connect(g);
    o.start(t);
    mod.start(t);
    o.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  private thump(t: number, gain: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(dest ?? this.musicFilter);
    o.start(t);
    o.stop(t + 0.4);
  }

  private hat(t: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicFilter);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.08);
  }

  // ------------------------------------------------------------------ sfx helpers

  private ready(key: string, minGap: number): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if ((this.lastPlay[key] ?? -1) > now - minGap) return false;
    this.lastPlay[key] = now;
    return true;
  }

  private tone(
    freq: number,
    endFreq: number,
    type: OscillatorType,
    t: number,
    dur: number,
    gain: number,
    reverb = 0.3,
    pan = 0,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g);
    g.connect(p);
    p.connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s);
      s.connect(this.reverbIn);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    t: number,
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q = 1,
    reverb = 0.2,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s);
      s.connect(this.reverbIn);
    }
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ sfx

  capture(count: number, chain: number, big: boolean): void {
    if (!this.ready('capture', 0.05)) return;
    const t = this.ctx!.currentTime;
    const notes = Math.min(7, 2 + count);
    const base = ROOT + 12 + Math.min(chain - 1, 8) * 2;
    for (let i = 0; i < notes; i++) {
      const deg = PENTA[i % PENTA.length] + Math.floor(i / PENTA.length) * 12;
      this.bell(mtof(base + deg), t + i * 0.045, 0.11, (i / notes - 0.5) * 1.2, this.sfxBus, 1.3);
    }
    this.noise(t, 0.5, 0.08, 'highpass', 5000, 9000, 0.7, 0.6);
    this.tone(220, 55, 'sine', t, 0.45, big ? 0.35 : 0.2, 0.2);
  }

  loopClose(): void {
    if (!this.ready('loop', 0.05)) return;
    const t = this.ctx!.currentTime;
    this.tone(1400, 2200, 'sine', t, 0.18, 0.06, 0.5);
  }

  pearl(step: number): void {
    if (!this.ready('pearl', 0.025)) return;
    const t = this.ctx!.currentTime;
    const deg = PENTA[step % 5] + Math.floor(step / 5) * 12;
    this.tone(mtof(ROOT + 24 + Math.min(deg, 24)), mtof(ROOT + 24 + Math.min(deg, 24)), 'sine', t, 0.25, 0.07, 0.5);
  }

  hurt(): void {
    if (!this.ready('hurt', 0.1)) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.35, 0.5, 'lowpass', 1800, 200, 1, 0.3);
    this.tone(180, 40, 'sine', t, 0.5, 0.6, 0.1);
    this.tone(320, 120, 'sawtooth', t, 0.25, 0.08, 0.1);
  }

  sever(): void {
    if (!this.ready('sever', 0.12)) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.3, 0.3, 'bandpass', 4000, 400, 3, 0.3);
    for (let i = 0; i < 4; i++) this.tone(2400 - i * 300, 900, 'square', t + i * 0.03, 0.04, 0.03, 0);
  }

  crack(): void {
    if (!this.ready('crack', 0.08)) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.18, 0.4, 'highpass', 2500, 1200, 1, 0.3);
    this.tone(140, 70, 'triangle', t, 0.3, 0.3, 0.2);
  }

  telegraph(): void {
    if (!this.ready('tele', 0.15)) return;
    const t = this.ctx!.currentTime;
    this.tone(260, 820, 'sine', t, 0.6, 0.05, 0.4);
  }

  dash(): void {
    if (!this.ready('dash', 0.1)) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.35, 0.14, 'bandpass', 600, 2400, 2, 0.2);
  }

  orbFire(): void {
    if (!this.ready('orb', 0.08)) return;
    const t = this.ctx!.currentTime;
    this.tone(700, 260, 'triangle', t, 0.3, 0.07, 0.5);
  }

  bossHit(): void {
    if (!this.ready('bossHit', 0.2)) return;
    const t = this.ctx!.currentTime;
    this.tone(90, 28, 'sine', t, 1.1, 0.7, 0.3);
    this.noise(t, 0.8, 0.3, 'lowpass', 3000, 120, 1, 0.5);
    for (let i = 0; i < 4; i++) this.bell(mtof(ROOT + 12 + PENTA[i] + 12), t + i * 0.07, 0.09, (i - 1.5) * 0.4, this.sfxBus, 2);
  }

  bossRoar(): void {
    if (!this.ready('roar', 1)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.9);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    f.connect(g);
    g.connect(this.sfxBus);
    const s = ctx.createGain();
    s.gain.value = 0.6;
    g.connect(s);
    s.connect(this.reverbIn);
    for (const [fr, dt] of [
      [46, 0],
      [46, 13],
      [69, -9],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = dt;
      o.connect(f);
      o.start(t);
      o.stop(t + 2.7);
    }
    this.noise(t, 2.2, 0.08, 'bandpass', 300, 900, 2, 0.5);
  }

  bossDie(): void {
    if (!this.ready('bossDie', 1)) return;
    const t = this.ctx!.currentTime;
    this.tone(70, 20, 'sine', t, 2.2, 0.8, 0.4);
    this.noise(t, 2, 0.35, 'lowpass', 5000, 80, 1, 0.8);
    for (let i = 0; i < 8; i++) {
      const deg = PENTA[i % 5] + Math.floor(i / 5) * 12;
      this.bell(mtof(ROOT + 12 + deg), t + 0.3 + i * 0.09, 0.1, (i / 8 - 0.5) * 1.6, this.sfxBus, 2.5);
    }
  }

  waveStart(boss: boolean): void {
    if (!this.ready('wave', 0.5)) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 1.4, 0.12, 'bandpass', 200, 3000, 1.5, 0.7);
    const notes = boss ? [0, 1, 7] : [0, 7, 12];
    notes.forEach((n, i) => this.bell(mtof(ROOT + n + 12), t + 0.4 + i * 0.12, 0.08, 0, this.sfxBus, 2.2));
  }

  upgrade(): void {
    if (!this.ready('upg', 0.1)) return;
    const t = this.ctx!.currentTime;
    [0, 4, 7, 12, 16].forEach((n, i) => this.bell(mtof(ROOT + 24 + n), t + i * 0.06, 0.08, (i - 2) * 0.3, this.sfxBus, 1.6));
  }

  ui(): void {
    if (!this.ready('ui', 0.03)) return;
    const t = this.ctx!.currentTime;
    this.tone(1250, 1500, 'sine', t, 0.08, 0.05, 0.25);
  }

  surge(): void {
    if (!this.ready('surge', 0.5)) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 6; i++) {
      this.tone(mtof(ROOT + 12 + PENTA[i % 5] + 12 * Math.floor(i / 5)), mtof(ROOT + 36 + PENTA[i % 5]), 'sine', t + i * 0.05, 1.1, 0.05, 0.8, (i - 3) * 0.3);
    }
    this.noise(t, 1.2, 0.12, 'highpass', 1500, 8000, 0.7, 0.8);
  }

  surgeEnd(): void {
    if (!this.ready('surgeEnd', 0.5)) return;
    const t = this.ctx!.currentTime;
    this.tone(900, 300, 'sine', t, 0.6, 0.06, 0.6);
  }

  heartbeat(): void {
    if (!this.ready('hb', 0.6)) return;
    const t = this.ctx!.currentTime;
    this.thump(t, 0.35, this.sfxBus);
    this.thump(t + 0.18, 0.25, this.sfxBus);
  }

  heal(): void {
    if (!this.ready('heal', 0.2)) return;
    const t = this.ctx!.currentTime;
    [7, 12, 19].forEach((n, i) => this.bell(mtof(ROOT + 24 + n), t + i * 0.08, 0.08, 0, this.sfxBus, 1.4));
  }

  gameOver(): void {
    if (!this.ready('over', 1)) return;
    const t = this.ctx!.currentTime;
    [12, 10, 7, 3, 0].forEach((n, i) => this.bell(mtof(ROOT + n), t + i * 0.28, 0.12, 0, this.sfxBus, 2.6));
    this.tone(110, 30, 'sine', t, 2.5, 0.4, 0.5);
  }

  victory(): void {
    if (!this.ready('victory', 1)) return;
    const t = this.ctx!.currentTime;
    [0, 4, 7, 11, 14, 19, 23, 26].forEach((n, i) =>
      this.bell(mtof(ROOT + 12 + n), t + i * 0.11, 0.1, (i / 8 - 0.5) * 1.4, this.sfxBus, 3),
    );
  }

  destroy(): void {
    if (this.schedTimer !== null) clearInterval(this.schedTimer);
    void this.ctx?.close();
  }
}

export const audio = new AudioEngine();
