// Stimulus-shape search space for the RI optimizer. Level is deliberately NOT
// a dimension — louder trivially gives longer RI, so it is held fixed
// (MML + 10 dB, ceiling-capped) and the optimizer searches *shape* only.

import { expectedImprovement, fitGp } from './gp';
import type { OptObservation } from '../data/store';

export interface OptParams {
  centerOffsetOct: number; // offset from the session's confirmed pitch
  amHz: number;
  amDepth: number;
  bwOct: number;
}

const OFF = { min: -0.5, max: 0.5 };
const AM = { min: 2, max: 40 }; // log-scaled
const BW = { min: 1 / 6, max: 1 };
const LENGTHSCALES = [0.25, 0.3, 0.35, 0.35];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function normalize(p: OptParams): number[] {
  return [
    (p.centerOffsetOct - OFF.min) / (OFF.max - OFF.min),
    Math.log(p.amHz / AM.min) / Math.log(AM.max / AM.min),
    p.amDepth,
    (p.bwOct - BW.min) / (BW.max - BW.min),
  ].map(clamp01);
}

export function denormalize(x: number[]): OptParams {
  return {
    centerOffsetOct: Math.round((OFF.min + x[0] * (OFF.max - OFF.min)) * 1000) / 1000,
    amHz: Math.round(AM.min * Math.pow(AM.max / AM.min, x[1]) * 2) / 2,
    amDepth: Math.round(clamp01(x[2]) * 100) / 100,
    bwOct: Math.round((BW.min + x[3] * (BW.max - BW.min)) * 1000) / 1000,
  };
}

/**
 * Initial space-filling design. First point = the literature prior
 * (10 Hz AM, deep modulation, ⅓-octave band on the pitch).
 */
export const SEED_DESIGN: OptParams[] = [
  { centerOffsetOct: 0, amHz: 10, amDepth: 0.8, bwOct: 1 / 3 },
  { centerOffsetOct: 0, amHz: 10, amDepth: 0.4, bwOct: 2 / 3 },
  { centerOffsetOct: -0.25, amHz: 5, amDepth: 0.9, bwOct: 1 / 6 },
  { centerOffsetOct: 0.25, amHz: 20, amDepth: 0.6, bwOct: 1 / 2 },
  { centerOffsetOct: -0.1, amHz: 40, amDepth: 1, bwOct: 1 },
];

/** Objective: normalized duration × depth. Human ratings are noisy — the GP models that. */
export function objective(durationS: number, depth: number): number {
  const v = (Math.min(durationS, 120) / 120) * (depth / 10);
  return Math.round(v * 1000) / 1000;
}

export interface Proposal {
  params: OptParams;
  x: number[];
  source: 'seed' | 'ei' | 'anchor';
}

const xKey = (x: number[]) => x.map((v) => v.toFixed(3)).join(',');

/**
 * Empirical trial-to-trial noise from repeated runs of identical stimuli
 * (anchor trials): pooled within-group variance of y. Falls back to a
 * conservative prior when no repeats exist yet.
 */
export function estimateNoise(obs: OptObservation[]): number {
  const groups = new Map<string, number[]>();
  for (const o of obs) {
    const k = xKey(o.x);
    const g = groups.get(k);
    if (g) g.push(o.y);
    else groups.set(k, [o.y]);
  }
  let ss = 0;
  let dof = 0;
  for (const ys of groups.values()) {
    if (ys.length < 2) continue;
    const m = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const y of ys) ss += (y - m) * (y - m);
    dof += ys.length - 1;
  }
  if (!dof) return 0.02;
  return Math.min(0.1, Math.max(0.005, ss / dof));
}

/** Every 5th post-seed trial re-tests the best stimulus so far to measure noise. */
function anchorDue(obs: OptObservation[]): boolean {
  const postSeed = obs.length - SEED_DESIGN.length;
  return postSeed >= 0 && postSeed % 5 === 4;
}

export function proposeNext(obs: OptObservation[], rand: () => number = Math.random): Proposal {
  if (obs.length < SEED_DESIGN.length) {
    const p = SEED_DESIGN[obs.length];
    return { params: p, x: normalize(p), source: 'seed' };
  }
  if (anchorDue(obs)) {
    const bestObs = obs.reduce((a, b) => (b.y > a.y ? b : a));
    return { params: denormalize(bestObs.x), x: [...bestObs.x], source: 'anchor' };
  }
  const gp = fitGp(obs.map((o) => o.x), obs.map((o) => o.y), LENGTHSCALES, estimateNoise(obs));
  const bestObs = obs.reduce((a, b) => (b.y > a.y ? b : a));
  const cands: number[][] = [];
  for (let i = 0; i < 1500; i++) cands.push([rand(), rand(), rand(), rand()]);
  for (let i = 0; i < 500; i++) {
    cands.push(bestObs.x.map((v) => clamp01(v + (rand() - 0.5) * 0.2)));
  }
  let bestX = cands[0];
  let bestEi = -Infinity;
  for (const c of cands) {
    const ei = expectedImprovement(gp.predict(c), gp.best);
    if (ei > bestEi) {
      bestEi = ei;
      bestX = c;
    }
  }
  return { params: denormalize(bestX), x: bestX, source: 'ei' };
}

export interface Recommendation {
  params: OptParams;
  expectedY: number;
  source: 'model' | 'best-observed';
}

/** Final answer: GP posterior-mean argmax once there is enough data, else best observed. */
export function recommend(
  obs: OptObservation[],
  rand: () => number = Math.random,
): Recommendation | null {
  if (!obs.length) return null;
  const bestObs = obs.reduce((a, b) => (b.y > a.y ? b : a));
  if (obs.length < 6) {
    return { params: denormalize(bestObs.x), expectedY: bestObs.y, source: 'best-observed' };
  }
  const gp = fitGp(obs.map((o) => o.x), obs.map((o) => o.y), LENGTHSCALES, estimateNoise(obs));
  const cands: number[][] = obs.map((o) => o.x);
  for (let i = 0; i < 3000; i++) cands.push([rand(), rand(), rand(), rand()]);
  let bestX = cands[0];
  let bestMu = -Infinity;
  for (const c of cands) {
    const { mu } = gp.predict(c);
    if (mu > bestMu) {
      bestMu = mu;
      bestX = c;
    }
  }
  return { params: denormalize(bestX), expectedY: Math.round(bestMu * 1000) / 1000, source: 'model' };
}
