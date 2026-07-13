// Stage 3 — Bayesian optimizer. Treats the owner as the objective function:
// GP + expected improvement over stimulus SHAPE (center offset, AM rate, AM
// depth, bandwidth) at a FIXED level (MML + 10, ceiling-capped), maximizing
// measured residual inhibition. State persists across sessions.

import type { App } from '../components';
import { card, earSelector, fmtClock, fmtDb, fmtHz, gate, h, note, okBox, warnBox } from '../components';
import { chart } from '../charts';
import { runTrial, washoutReadyAt } from '../trialRunner';
import { objective, proposeNext, recommend, SEED_DESIGN, normalize } from '../../optimizer/space';
import type { OptParams } from '../../optimizer/space';
import type { Ear, StimulusParams } from '../../data/store';

const TRIAL_DURATION_S = 60;
const LEVEL_OVER_MML = 10;

interface OptUi {
  sessionId: string;
  running: boolean;
  ear: Ear;
}

let st: OptUi | null = null;

function describeParams(p: OptParams, pitchHz: number, maxHz: number): { center: number; rows: [string, string][] } {
  const center = Math.min(maxHz, Math.round(pitchHz * Math.pow(2, p.centerOffsetOct)));
  return {
    center,
    rows: [
      ['Center', `${fmtHz(center)} (pitch ${p.centerOffsetOct >= 0 ? '+' : ''}${p.centerOffsetOct.toFixed(2)} oct)`],
      ['AM rate', `${p.amHz} Hz`],
      ['AM depth', p.amDepth.toFixed(2)],
      ['Bandwidth', `${p.bwOct.toFixed(2)} oct`],
    ],
  };
}

export function renderOptimizer(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first.', 'Go to Session', () => app.go('home')));
    return;
  }
  const m = s.measurements;
  if (!s.calibrated || m.pitchMatchHz == null || !m.pitchOctaveConfirmed || m.mmlDbRelRef == null) {
    root.append(gate('The optimizer needs calibration, a confirmed pitch, and an MML in this session.', 'Go to Session', () => app.go('home')));
    return;
  }

  if (!st || st.sessionId !== s.id) {
    st = { sessionId: s.id, running: false, ear: m.mmlEar ?? m.pitchEar ?? 'both' };
  }
  st.running = false;

  const cp = app.store.consensusPitchHz()!;
  const pitch = cp.hz;
  const mml = m.mmlDbRelRef;
  const ceiling = app.engine.comfortCeilingRelDb;
  const level = Math.min(mml + LEVEL_OVER_MML, ceiling);
  const maxHz = app.engine.maxUsableHz();

  const obs = app.store.observations();
  const proposal = proposeNext(obs);
  const desc = describeParams(proposal.params, pitch, maxHz);

  let ticker = 0;
  const stopTicker = () => { window.clearInterval(ticker); ticker = 0; };
  app.setCleanup(stopTicker);

  // washout shared with manual RI trials (both write into measurements.ri)
  const last = m.ri[m.ri.length - 1];
  const readyAt = washoutReadyAt(last);
  const washRemaining = () => Math.max(0, (readyAt - Date.now()) / 1000);

  const startBtn = h('button', { class: 'btn primary', text: `▶ Run trial ${obs.length + 1} (60 s stimulus)` }) as HTMLButtonElement;
  const washLine = h('div', { class: 'timer-line' });
  const baseCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const needWashout = m.ri.length > 0;
  const updateGate = () => {
    const rem = washRemaining();
    washLine.replaceChildren(
      h('span', { class: 'muted', text: 'Washout' }),
      h('span', { text: rem > 0 ? `${fmtClock(rem)} remaining` : 'elapsed ✓' }),
    );
    startBtn.disabled = st!.running || (needWashout && (rem > 0 || !baseCb.checked));
  };
  baseCb.onchange = updateGate;
  updateGate();
  if (needWashout && washRemaining() > 0) ticker = window.setInterval(updateGate, 500);

  startBtn.onclick = () => {
    stopTicker();
    st!.running = true;
    const params: StimulusParams = {
      kind: 'nbn',
      centerHz: desc.center,
      bwOct: proposal.params.bwOct,
      amHz: proposal.params.amHz,
      amDepth: proposal.params.amDepth,
      levelDbRelRef: level,
      durationS: TRIAL_DURATION_S,
      noise: 'white',
      ear: st!.ear,
    };
    root.replaceChildren();
    const runner = runTrial(root, app, params, {
      onComplete: (trial) => {
        app.store.addRiTrial(trial);
        // Store the observation with x recomputed from the ACTUAL stimulus
        // (the center may have been clamped to the usable range).
        const actual: OptParams = {
          centerOffsetOct: Math.log2(params.centerHz / pitch),
          amHz: params.amHz,
          amDepth: params.amDepth,
          bwOct: params.bwOct,
        };
        app.store.addObservation({
          at: trial.at,
          sessionId: s.id,
          x: normalize(actual),
          params,
          durationS: trial.durationS,
          depth: trial.depth,
          y: objective(trial.durationS, trial.depth),
        });
        st!.running = false;
        app.refresh();
      },
      onAbort: () => {
        st!.running = false;
        app.refresh();
      },
    });
    app.setCleanup(() => runner.dispose());
  };

  root.append(card(
    'Bayesian RI optimizer',
    note(`Searches stimulus shape — center offset, AM rate, AM depth, bandwidth — to maximize your measured residual inhibition. Level is held fixed at MML+${LEVEL_OVER_MML} dB (${fmtDb(level)} rel ref this session) so it finds genuinely better shapes, not just "louder". One trial per washout; a few per session; ~20–30 total across days.`),
    h('div', { class: 'kv-grid' },
      h('span', { class: 'k', text: 'Trials so far' }),
      h('span', { class: 'v', text: `${obs.length} (${Math.max(0, SEED_DESIGN.length - obs.length)} seed trials remaining before GP kicks in)` }),
      h('span', { class: 'k', text: 'Next candidate' }),
      h('span', {
        class: 'v',
        text: proposal.source === 'seed'
          ? 'space-filling seed design'
          : proposal.source === 'anchor'
            ? 'reliability anchor (repeat of best)'
            : 'GP expected-improvement',
      }),
      h('span', { class: 'k', text: 'Pitch anchor' }),
      h('span', { class: 'v', text: `${fmtHz(pitch)}${cp.n > 1 ? ` (consensus, ${cp.n} sessions)` : ''}` }),
    ),
  ));

  root.append(card(
    `Proposed stimulus (trial ${obs.length + 1})`,
    h('div', { class: 'kv-grid' },
      ...desc.rows.flatMap(([k, v]) => [h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })]),
      h('span', { class: 'k', text: 'Level (fixed)' }),
      h('span', { class: 'v', text: `${fmtDb(level)} rel ref` }),
      h('span', { class: 'k', text: 'Duration (fixed)' }),
      h('span', { class: 'v', text: `${TRIAL_DURATION_S} s` }),
    ),
    proposal.source === 'anchor'
      ? note('This is a reliability anchor: an exact repeat of your best stimulus so far. The difference between repeats measures your trial-to-trial noise and feeds the model\'s noise estimate — run it like any other trial.')
      : null,
    earSelector(st.ear, (e) => { st!.ear = e; }),
    s.hfRolloffHz != null && desc.center > s.hfRolloffHz
      ? warnBox(`Candidate center is above today's rolloff (${fmtHz(s.hfRolloffHz)}) — the outcome will reflect what actually reaches your ear.`)
      : null,
    needWashout
      ? h('div', {},
          washLine,
          h('label', { class: 'check' }, baseCb, document.createTextNode('My tinnitus is back to baseline (previous suppression fully gone).')))
      : null,
    startBtn,
  ));

  if (obs.length) {
    let best = -Infinity;
    const yPts = obs.map((o, i) => ({ x: i + 1, y: o.y }));
    const bestPts = obs.map((o, i) => { best = Math.max(best, o.y); return { x: i + 1, y: best }; });
    root.append(card(
      'Convergence',
      chart({
        series: [
          { label: 'trial objective (duration × depth)', color: '#4da3ff', points: yPts, line: false },
          { label: 'best so far', color: '#7bd88f', points: bestPts },
        ],
        yMin: 0,
        yFmt: (v) => v.toFixed(2),
        xFmt: (v) => `trial ${Math.round(v)}`,
      }),
    ));

    const rec = recommend(obs);
    if (rec) {
      const rdesc = describeParams(rec.params, pitch, maxHz);
      root.append(card(
        'Current recommendation',
        note(rec.source === 'model'
          ? 'GP posterior-mean optimum — the model’s best guess at your ideal stimulus shape given all trials so far.'
          : 'Best single observed trial (the GP model takes over after 6 trials).'),
        h('div', { class: 'kv-grid' },
          ...rdesc.rows.flatMap(([k, v]) => [h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })]),
          h('span', { class: 'k', text: 'Expected objective' }),
          h('span', { class: 'v', text: rec.expectedY.toFixed(2) }),
        ),
        h('button', {
          class: 'btn good',
          text: 'Save as therapy preset',
          onclick: () => {
            app.store.savePreset(`Optimizer rec (${obs.length} trials)`, {
              centerHz: rdesc.center,
              bwOct: rec.params.bwOct,
              amHz: rec.params.amHz,
              amDepth: rec.params.amDepth,
              peakGainDb: 6,
              levelDbRelRef: Math.max(-45, mml - 5),
              noise: 'white',
              ear: st!.ear,
            });
            root.append(okBox('Preset saved — find it on the Therapy screen.'));
          },
        }),
      ));
    }
  }
}
