// Audio engine. Every level in the app is expressed in dB *relative to the
// session reference* (a user-set comfortable 1 kHz tone). Internally that maps
// to a dBFS-ish gain, hard-capped well below full scale, and the whole output
// runs through a limiter. iOS system volume must never be touched mid-session
// (AirPods apply volume-dependent EQ); this engine is the only level control.

export const HARD_CAP_DB = -10; // absolute internal ceiling
export const MIN_DB = -90;
export const FADE_S = 0.08; // minimum fade on every start/stop (no transients)

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export type NoiseKind = 'white' | 'pink';
export type Ear = 'left' | 'both' | 'right';

function panOf(ear: Ear | undefined): number {
  return ear === 'left' ? -1 : ear === 'right' ? 1 : 0;
}

type LevelMapper = (relDb: number) => number;

export interface Voice {
  readonly active: boolean;
  setLevel(relDb: number): void;
  stop(fadeS?: number): void;
}

export interface ToneVoice extends Voice {
  setFreq(hz: number): void;
}

export interface SweepVoice extends Voice {
  freqNow(): number;
}

export interface NoiseBandParams {
  centerHz: number;
  bwOct: number;
  levelRelDb: number;
  amHz?: number;
  amDepth?: number; // 0..1
  noise?: NoiseKind;
  ear?: Ear;
  durationS?: number;
  onEnded?: () => void;
}

export interface ShapedNoiseParams {
  centerHz: number;
  bwOct: number; // band half-width in octaves each side of center
  peakGainDb: number;
  amHz: number;
  amDepth: number;
  levelRelDb: number;
  noise?: NoiseKind;
  ear?: Ear;
}

interface VoiceOpts {
  durationS?: number;
  onEnded?: () => void;
  fadeS?: number;
  extraGainDb?: number; // filter-loss makeup, applied inside the cap
  ear?: Ear;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffers = new Map<NoiseKind, AudioBuffer>();
  private live = new Set<Voice>();

  /** Session anchor: internal dB of the user's comfortable 1 kHz reference. */
  referenceDb = -45;
  /** Max allowed level above reference (user-set comfort ceiling, dB rel ref). */
  comfortCeilingRelDb = 15;

  ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 1;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  maxUsableHz(): number {
    const sr = this.ctx?.sampleRate ?? 48000;
    return Math.min(16000, Math.floor(sr * 0.45));
  }

  relToAbs(relDb: number, opts: { ignoreCeiling?: boolean } = {}): number {
    const rel = opts.ignoreCeiling ? relDb : Math.min(relDb, this.comfortCeilingRelDb);
    return Math.min(HARD_CAP_DB, Math.max(MIN_DB, this.referenceDb + rel));
  }

  private absMapper(opts: { ignoreCeiling?: boolean } = {}): LevelMapper {
    return (rel) => this.relToAbs(rel, opts);
  }

  private rawMapper(): LevelMapper {
    return (db) => Math.min(HARD_CAP_DB, Math.max(MIN_DB, db));
  }

  private makeVoice(
    tail: AudioNode,
    sources: AudioScheduledSourceNode[],
    map: LevelMapper,
    levelRelDb: number,
    opts: VoiceOpts = {},
  ): Voice {
    const ctx = this.ctx!;
    const fade = Math.max(FADE_S, opts.fadeS ?? FADE_S);
    const extra = opts.extraGainDb ?? 0;
    // extra makeup may not push the final gain past a fixed lid; the limiter
    // downstream is the last line of defense.
    const gainFor = (rel: number) => dbToGain(Math.min(map(rel) + extra, -4));

    const g = ctx.createGain();
    g.gain.value = 0;
    tail.connect(g);
    const pan = panOf(opts.ear);
    if (pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      g.connect(panner);
      panner.connect(this.master!);
    } else {
      g.connect(this.master!);
    }

    const now = ctx.currentTime;
    for (const s of sources) s.start(now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gainFor(levelRelDb), now + fade);

    let active = true;
    let endTimer: number | undefined;

    const cleanup = () => {
      if (!active) return;
      active = false;
      this.live.delete(voice);
      window.clearTimeout(endTimer);
      window.setTimeout(() => {
        try { g.disconnect(); } catch { /* already gone */ }
      }, 400);
    };

    if (opts.durationS != null) {
      const tEnd = now + opts.durationS;
      g.gain.setValueAtTime(gainFor(levelRelDb), Math.max(now + fade, tEnd - fade));
      g.gain.linearRampToValueAtTime(0, tEnd);
      for (const s of sources) {
        try { s.stop(tEnd + 0.05); } catch { /* ok */ }
      }
      endTimer = window.setTimeout(() => {
        const cb = opts.onEnded;
        cleanup();
        cb?.();
      }, Math.max(0, (tEnd - ctx.currentTime) * 1000));
    }

    const voice: Voice = {
      get active() { return active; },
      setLevel: (rel: number) => {
        if (!active) return;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(gainFor(rel), t, 0.03);
      },
      stop: (fadeS = fade) => {
        if (!active) return;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + fadeS);
        for (const s of sources) {
          try { s.stop(t + fadeS + 0.05); } catch { /* already stopped */ }
        }
        cleanup();
      },
    };
    this.live.add(voice);
    return voice;
  }

  stopAll(fadeS = FADE_S): void {
    for (const v of [...this.live]) v.stop(fadeS);
  }

  // ---- tones ----

  playTone(
    freqHz: number,
    levelRelDb: number,
    opts: { ignoreCeiling?: boolean; ear?: Ear } = {},
  ): ToneVoice {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqHz;
    const v = this.makeVoice(osc, [osc], this.absMapper(opts), levelRelDb, { ear: opts.ear });
    return {
      get active() { return v.active; },
      setLevel: v.setLevel,
      stop: v.stop,
      setFreq: (hz: number) => {
        osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.01);
      },
    };
  }

  /** Calibration only: level is raw internal dB, not relative to the reference. */
  playToneRaw(freqHz: number, absDb: number): Voice {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqHz;
    return this.makeVoice(osc, [osc], this.rawMapper(), absDb);
  }

  playSweep(
    f0: number,
    f1: number,
    durationS: number,
    levelRelDb: number,
    onEnded?: () => void,
  ): SweepVoice {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + durationS);
    const v = this.makeVoice(osc, [osc], this.absMapper(), levelRelDb, { durationS, onEnded });
    return {
      get active() { return v.active; },
      setLevel: v.setLevel,
      stop: v.stop,
      freqNow: () => {
        const frac = Math.min(1, Math.max(0, (ctx.currentTime - t0) / durationS));
        return f0 * Math.pow(f1 / f0, frac);
      },
    };
  }

  // ---- noise ----

  private noiseBuffer(kind: NoiseKind): AudioBuffer {
    const ctx = this.ctx!;
    const cached = this.noiseBuffers.get(kind);
    if (cached && cached.sampleRate === ctx.sampleRate) return cached;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    } else {
      // Paul Kellett pink noise approximation
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    this.noiseBuffers.set(kind, buf);
    return buf;
  }

  private noiseSource(kind: NoiseKind): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(kind);
    src.loop = true;
    return src;
  }

  private amStage(
    input: AudioNode,
    amHz: number,
    amDepth: number,
  ): { tail: AudioNode; sources: AudioScheduledSourceNode[] } {
    const ctx = this.ctx!;
    const depth = Math.min(1, Math.max(0, amDepth));
    // g(t) = (1 - depth/2) + (depth/2)·sin — stays in [1-depth, 1], never negative
    const am = ctx.createGain();
    am.gain.value = 1 - depth / 2;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = amHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth / 2;
    lfo.connect(lfoGain);
    lfoGain.connect(am.gain);
    input.connect(am);
    return { tail: am, sources: [lfo] };
  }

  private bandwidthQ(bwOct: number): number {
    const r = Math.pow(2, bwOct);
    return Math.sqrt(r) / (r - 1);
  }

  /** Narrowband noise for MML / RI stimuli (bandpass², optional AM). */
  playNoiseBand(p: NoiseBandParams): Voice {
    const ctx = this.ensure();
    const src = this.noiseSource(p.noise ?? 'white');
    const q = this.bandwidthQ(p.bwOct);
    const center = Math.min(p.centerHz, this.maxUsableHz());
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = center;
    bp1.Q.value = q;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = center;
    bp2.Q.value = q;
    src.connect(bp1);
    bp1.connect(bp2);

    let tail: AudioNode = bp2;
    const sources: AudioScheduledSourceNode[] = [src];
    if (p.amHz && p.amDepth) {
      const am = this.amStage(tail, p.amHz, p.amDepth);
      tail = am.tail;
      sources.push(...am.sources);
    }

    // Makeup for bandpass energy loss so slider values sit near tone values.
    const bwHz = center * (Math.pow(2, p.bwOct / 2) - Math.pow(2, -p.bwOct / 2));
    const makeup = Math.min(12, 10 * Math.log10((ctx.sampleRate / 2) / Math.max(50, bwHz)));

    return this.makeVoice(tail, sources, this.absMapper(), p.levelRelDb, {
      durationS: p.durationS,
      onEnded: p.onEnded,
      extraGainDb: makeup,
      ear: p.ear,
    });
  }

  /** Therapy stimulus: band-bounded noise, peak boost at tinnitus pitch, AM. */
  playShapedNoise(p: ShapedNoiseParams): Voice {
    const ctx = this.ensure();
    const maxHz = this.maxUsableHz();
    const center = Math.min(p.centerHz, maxHz);
    const lo = Math.max(100, center * Math.pow(2, -p.bwOct));
    const hi = Math.min(maxHz, center * Math.pow(2, p.bwOct));

    const src = this.noiseSource(p.noise ?? 'pink');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = lo;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = hi;
    lp.Q.value = 0.7;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = center;
    peak.gain.value = Math.min(12, Math.max(0, p.peakGainDb));
    peak.Q.value = 3;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(peak);

    let tail: AudioNode = peak;
    const sources: AudioScheduledSourceNode[] = [src];
    if (p.amDepth > 0) {
      const am = this.amStage(tail, p.amHz, p.amDepth);
      tail = am.tail;
      sources.push(...am.sources);
    }

    return this.makeVoice(tail, sources, this.absMapper(), p.levelRelDb, {
      extraGainDb: 6,
      fadeS: 1.5, // therapy always ramps in gently
      ear: p.ear,
    });
  }
}
