// M8 — longitudinal views: RI across all trials, pitch/loudness/MML stability
// across sessions, bother/stress over time. Read-only; feeds the "repeat and
// average, never trust one measurement" principle.

import type { App } from '../components';
import { card, fmtHz, note } from '../components';
import { chart } from '../charts';
import { objective } from '../../optimizer/space';

export function renderTrends(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const sessions = app.store.data.sessions;
  if (!sessions.length) {
    root.append(card('Trends', note('No data yet — run a few sessions first.')));
    return;
  }

  const dayFmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // --- RI objective across every trial, chronological ---
  const allTrials = sessions
    .flatMap((s) => s.measurements.ri)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let best = -Infinity;
  const riPts = allTrials.map((t, i) => ({ x: i + 1, y: objective(t.durationS, t.depth) }));
  const bestPts = riPts.map((p) => { best = Math.max(best, p.y); return { x: p.x, y: best }; });

  root.append(card(
    'Residual inhibition over trials',
    note('Objective = normalized suppression duration × depth, every RI trial across all sessions (manual + optimizer).'),
    allTrials.length
      ? chart({
          series: [
            { label: 'trial', color: '#4da3ff', points: riPts, line: false },
            { label: 'best so far', color: '#7bd88f', points: bestPts },
          ],
          yMin: 0,
          yFmt: (v) => v.toFixed(2),
          xFmt: (v) => `#${Math.round(v)}`,
        })
      : note('No RI trials yet.'),
  ));

  // --- pitch stability across sessions ---
  const pitchPts = sessions
    .filter((s) => s.measurements.pitchMatchHz != null && s.measurements.pitchOctaveConfirmed)
    .map((s) => ({ x: Date.parse(s.startedAt), y: Math.log2(s.measurements.pitchMatchHz!) }));
  root.append(card(
    'Pitch match across sessions',
    note('Log-frequency scale. Scatter of ±1 octave across sessions is normal — the average is the signal.'),
    chart({
      series: [{ label: 'confirmed pitch', color: '#e8b34b', points: pitchPts }],
      yFmt: (v) => fmtHz(Math.pow(2, v)),
      xFmt: dayFmt,
    }),
  ));

  // --- loudness & MML across sessions ---
  const loudPts = sessions
    .filter((s) => s.measurements.loudnessMatchDbRelRef != null)
    .map((s) => ({ x: Date.parse(s.startedAt), y: s.measurements.loudnessMatchDbRelRef! }));
  const mmlPts = sessions
    .filter((s) => s.measurements.mmlDbRelRef != null)
    .map((s) => ({ x: Date.parse(s.startedAt), y: s.measurements.mmlDbRelRef! }));
  root.append(card(
    'Loudness match & MML across sessions',
    note('dB relative to each session\'s own reference — comparable only as within-session anchored values.'),
    chart({
      series: [
        { label: 'loudness match', color: '#4da3ff', points: loudPts },
        { label: 'MML', color: '#e06c5a', points: mmlPts },
      ],
      yFmt: (v) => `${v.toFixed(0)} dB`,
      xFmt: dayFmt,
    }),
  ));

  // --- comfort ceiling over sessions (sound-tolerance / hyperacusis proxy) ---
  const ceilPts = sessions
    .filter((s) => s.comfortCeilingDbRelRef != null)
    .map((s) => ({ x: Date.parse(s.startedAt), y: s.comfortCeilingDbRelRef! }));
  root.append(card(
    'Comfort ceiling across sessions',
    note('Your self-set "loudest acceptable" level, relative to each session\'s reference. A rising line over weeks suggests improving sound tolerance (hyperacusis easing) — this can improve even when the tinnitus itself doesn\'t.'),
    chart({
      series: [{ label: 'comfort ceiling (dB rel ref)', color: '#7bd88f', points: ceilPts }],
      yFmt: (v) => `+${v.toFixed(0)} dB`,
      xFmt: dayFmt,
    }),
  ));

  // --- bother & stress over time ---
  const botherPts = sessions
    .filter((s) => s.subjectiveRating != null)
    .map((s) => ({ x: Date.parse(s.startedAt), y: s.subjectiveRating! }));
  const stressPts = sessions
    .filter((s) => s.somatic.stress != null)
    .map((s) => ({ x: Date.parse(s.startedAt), y: s.somatic.stress! }));
  root.append(card(
    'Bother & stress over time',
    chart({
      series: [
        { label: 'tinnitus bother (0–10)', color: '#e06c5a', points: botherPts },
        { label: 'stress (0–10)', color: '#8b96a5', points: stressPts },
      ],
      yMin: 0,
      yMax: 10,
      yFmt: (v) => v.toFixed(0),
      xFmt: dayFmt,
    }),
  ));
}
