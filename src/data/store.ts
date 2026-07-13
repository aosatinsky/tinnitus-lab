// Persistence: versioned JSON in localStorage (v1), full export/import,
// CSV dumps for notebook analysis. No network, no PII beyond what the owner
// types himself.

export const SCHEMA_VERSION = 1;

export type Headphones =
  | 'airpods_pro'
  | 'airpods_pro_3'
  | 'airpods_max'
  | 'airpods_max_2'
  | 'other';
export type NoiseKind = 'white' | 'pink';
export type Ear = 'left' | 'both' | 'right';

export interface StimulusParams {
  kind: 'nbn' | 'shaped';
  centerHz: number;
  bwOct: number;
  amHz: number;
  amDepth: number;
  levelDbRelRef: number;
  durationS: number;
  noise: NoiseKind;
  ear?: Ear;
}

export interface RiTrial {
  at: string; // ISO timestamp of stimulus offset
  stimulusParams: StimulusParams;
  durationS: number; // how long suppression lasted (0 = none)
  depth: number; // 0 = no change .. 10 = silent
}

export interface Measurements {
  pitchMatchHz?: number;
  pitchOctaveConfirmed?: boolean;
  pitchEar?: Ear;
  loudnessMatchDbRelRef?: number;
  loudnessEar?: Ear;
  mmlDbRelRef?: number;
  mmlEar?: Ear;
  ri: RiTrial[];
}

export interface Somatic {
  jawModulates?: 'yes' | 'no' | 'unsure';
  stress?: number; // 0-10
  sleepHours?: number;
  notes?: string;
}

export interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  headphones: Headphones;
  calibrated: boolean;
  referenceLevelDb?: number;
  comfortCeilingDbRelRef?: number;
  hfRolloffHz?: number;
  measurements: Measurements;
  subjectiveRating?: number; // 0-10 bother
  somatic: Somatic;
}

export interface TherapyPresetParams {
  centerHz: number;
  bwOct: number;
  amHz: number;
  amDepth: number;
  peakGainDb: number;
  levelDbRelRef: number;
  noise: NoiseKind;
  ear?: Ear;
}

export interface TherapyPreset {
  id: string;
  name: string;
  createdAt: string;
  params: TherapyPresetParams;
}

/** One Bayesian-optimization observation: normalized point, actual stimulus, outcome. */
export interface OptObservation {
  at: string;
  sessionId: string;
  x: number[]; // normalized [0,1]^4 — see optimizer/space.ts
  params: StimulusParams;
  durationS: number;
  depth: number;
  y: number; // objective value
}

export interface OptimizerState {
  observations: OptObservation[];
}

export interface DataFile {
  schemaVersion: number;
  sessions: Session[];
  presets: TherapyPreset[];
  optimizerState: OptimizerState | null;
}

const KEY = 'tinnitus-lab-v1';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function fresh(): DataFile {
  return { schemaVersion: SCHEMA_VERSION, sessions: [], presets: [], optimizerState: null };
}

function normalize(parsed: DataFile): void {
  parsed.presets ??= [];
  for (const s of parsed.sessions) {
    s.measurements ??= { ri: [] };
    s.measurements.ri ??= [];
    s.somatic ??= {};
  }
  if (parsed.optimizerState && !Array.isArray(parsed.optimizerState.observations)) {
    parsed.optimizerState = null;
  }
}

function csvEscape(cell: unknown): string {
  const s = cell == null ? '' : String(cell);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

export class Store {
  data: DataFile;

  constructor() {
    this.data = this.load();
  }

  private load(): DataFile {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as DataFile;
      if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.sessions)) {
        return fresh();
      }
      normalize(parsed);
      return parsed;
    } catch {
      return fresh();
    }
  }

  save(): void {
    localStorage.setItem(KEY, JSON.stringify(this.data));
  }

  current(): Session | undefined {
    return [...this.data.sessions].reverse().find((s) => !s.endedAt);
  }

  startSession(headphones: Headphones): Session {
    const open = this.current();
    if (open) open.endedAt = new Date().toISOString();
    const s: Session = {
      id: uuid(),
      startedAt: new Date().toISOString(),
      headphones,
      calibrated: false,
      measurements: { ri: [] },
      somatic: {},
    };
    this.data.sessions.push(s);
    this.save();
    return s;
  }

  endSession(): void {
    const s = this.current();
    if (s) {
      s.endedAt = new Date().toISOString();
      this.save();
    }
  }

  update(fn: (s: Session) => void): void {
    const s = this.current();
    if (!s) return;
    fn(s);
    this.save();
  }

  addRiTrial(trial: RiTrial): void {
    this.update((s) => s.measurements.ri.push(trial));
  }

  /**
   * Median (in log-frequency) of every octave-confirmed pitch match across
   * sessions — the "repeat and average" principle enforced: downstream modules
   * work from this, not from any single session's noisy match.
   */
  consensusPitchHz(): { hz: number; n: number } | null {
    const logs = this.data.sessions
      .filter((s) => s.measurements.pitchMatchHz != null && s.measurements.pitchOctaveConfirmed)
      .map((s) => Math.log2(s.measurements.pitchMatchHz!))
      .sort((a, b) => a - b);
    if (!logs.length) return null;
    const mid = Math.floor(logs.length / 2);
    const med = logs.length % 2 ? logs[mid] : (logs[mid - 1] + logs[mid]) / 2;
    return { hz: Math.round(Math.pow(2, med)), n: logs.length };
  }

  addObservation(o: OptObservation): void {
    (this.data.optimizerState ??= { observations: [] }).observations.push(o);
    this.save();
  }

  observations(): OptObservation[] {
    return this.data.optimizerState?.observations ?? [];
  }

  savePreset(name: string, params: TherapyPresetParams): void {
    this.data.presets.push({ id: uuid(), name, createdAt: new Date().toISOString(), params });
    this.save();
  }

  deletePreset(id: string): void {
    this.data.presets = this.data.presets.filter((p) => p.id !== id);
    this.save();
  }

  // ---- export / import ----

  exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  importJson(text: string): { ok: boolean; error?: string } {
    try {
      const parsed = JSON.parse(text) as DataFile;
      if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.sessions)) {
        return { ok: false, error: 'Unrecognized file: wrong schemaVersion or missing sessions.' };
      }
      normalize(parsed);
      this.data = parsed;
      this.save();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Parse error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  csvSessions(): string {
    const rows: unknown[][] = [[
      'startedAt', 'endedAt', 'headphones', 'referenceLevelDb', 'comfortCeilingDbRelRef',
      'hfRolloffHz', 'pitchMatchHz', 'pitchOctaveConfirmed', 'pitchEar',
      'loudnessMatchDbRelRef', 'loudnessEar', 'mmlDbRelRef', 'mmlEar',
      'riTrials', 'riBestDurationS', 'riBestDepth', 'subjectiveRating',
      'jawModulates', 'stress', 'sleepHours', 'somaticNotes',
    ]];
    for (const s of this.data.sessions) {
      const m = s.measurements;
      const best = m.ri.reduce<RiTrial | null>(
        (b, t) => (!b || t.durationS * t.depth > b.durationS * b.depth ? t : b),
        null,
      );
      rows.push([
        s.startedAt, s.endedAt, s.headphones, s.referenceLevelDb, s.comfortCeilingDbRelRef,
        s.hfRolloffHz, m.pitchMatchHz, m.pitchOctaveConfirmed, m.pitchEar,
        m.loudnessMatchDbRelRef, m.loudnessEar, m.mmlDbRelRef, m.mmlEar,
        m.ri.length, best?.durationS, best?.depth, s.subjectiveRating,
        s.somatic.jawModulates, s.somatic.stress, s.somatic.sleepHours, s.somatic.notes,
      ]);
    }
    return toCsv(rows);
  }

  csvRiTrials(): string {
    const rows: unknown[][] = [[
      'sessionStartedAt', 'at', 'kind', 'centerHz', 'bwOct', 'amHz', 'amDepth',
      'levelDbRelRef', 'ear', 'stimulusDurationS', 'riDurationS', 'depth',
    ]];
    for (const s of this.data.sessions) {
      for (const t of s.measurements.ri) {
        const p = t.stimulusParams;
        rows.push([
          s.startedAt, t.at, p.kind, p.centerHz, p.bwOct, p.amHz, p.amDepth,
          p.levelDbRelRef, p.ear ?? 'both', p.durationS, t.durationS, t.depth,
        ]);
      }
    }
    return toCsv(rows);
  }
}
