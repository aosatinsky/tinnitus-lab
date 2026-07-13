// Residual Inhibition test. Stimulus = narrowband noise (optionally 10 Hz AM)
// at MML + offset (capped by the comfort ceiling), fixed duration, fades.
// The measurement protocol itself lives in trialRunner.ts (shared with the
// optimizer). A washout gate blocks the next trial until suppression from the
// previous one has fully decayed.

import type { App } from '../components';
import { card, earSelector, fmtClock, fmtDb, fmtHz, gate, h, note, slider, warnBox } from '../components';
import { runTrial, washoutReadyAt } from '../trialRunner';
import type { Ear, RiTrial, StimulusParams } from '../../data/store';

interface RiConfig {
  sessionId: string;
  durationS: number;
  amOn: boolean;
  amHz: number;
  amDepth: number;
  bwOct: number;
  offsetOverMml: number;
  ear: Ear;
  baselineConfirmed: boolean;
  running: boolean;
}

let st: RiConfig | null = null;

function initConfig(sessionId: string, ear: Ear): RiConfig {
  return {
    sessionId,
    durationS: 60,
    amOn: true,
    amHz: 10,
    amDepth: 0.8,
    bwOct: 1 / 3,
    offsetOverMml: 10,
    ear,
    baselineConfirmed: false,
    running: false,
  };
}

export function trialsTable(trials: RiTrial[]): HTMLElement | null {
  if (!trials.length) return null;
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', { text: '#' }), h('th', { text: 'Center' }), h('th', { text: 'AM' }),
        h('th', { text: 'Level' }), h('th', { text: 'RI duration' }), h('th', { text: 'Depth' }))),
      h('tbody', {}, ...trials.map((t, i) =>
        h('tr', {},
          h('td', { text: String(i + 1) }),
          h('td', { text: fmtHz(t.stimulusParams.centerHz) }),
          h('td', { text: t.stimulusParams.amDepth > 0 ? `${t.stimulusParams.amHz} Hz` : 'off' }),
          h('td', { text: fmtDb(t.stimulusParams.levelDbRelRef) }),
          h('td', { text: `${t.durationS.toFixed(1)} s` }),
          h('td', { text: String(t.depth) }),
        )))),
  );
}

export function renderRi(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first.', 'Go to Session', () => app.go('home')));
    return;
  }
  const m = s.measurements;
  if (!s.calibrated || m.pitchMatchHz == null || !m.pitchOctaveConfirmed || m.mmlDbRelRef == null) {
    root.append(gate('The RI test needs calibration, a confirmed pitch, and an MML.', 'Go to Session', () => app.go('home')));
    return;
  }

  if (!st || st.sessionId !== s.id) {
    st = initConfig(s.id, m.mmlEar ?? m.pitchEar ?? 'both');
  }
  st.running = false;

  const cp = app.store.consensusPitchHz()!;
  const f = cp.hz;
  const mml = m.mmlDbRelRef;
  const ceiling = app.engine.comfortCeilingRelDb;

  let ticker = 0;
  const stopTicker = () => { window.clearInterval(ticker); ticker = 0; };
  app.setCleanup(stopTicker);

  const last = m.ri[m.ri.length - 1];
  const readyAt = washoutReadyAt(last);
  const washRemaining = () => Math.max(0, (readyAt - Date.now()) / 1000);

  const durSel = h('select', {},
    ...[30, 60, 90].map((d) => h('option', { value: String(d), text: `${d} s`, selected: st!.durationS === d })),
  ) as HTMLSelectElement;
  durSel.onchange = () => { st!.durationS = Number(durSel.value); };

  const amCb = h('input', { type: 'checkbox', checked: st.amOn }) as HTMLInputElement;
  amCb.onchange = () => { st!.amOn = amCb.checked; };

  const amHzIn = h('input', { type: 'number', min: '2', max: '40', step: '1', value: String(st.amHz) }) as HTMLInputElement;
  amHzIn.onchange = () => { st!.amHz = Math.min(40, Math.max(2, Number(amHzIn.value) || 10)); };

  const offsetSl = slider({
    label: 'Level: MML + offset (capped by ceiling)',
    min: 0, max: 15, step: 1,
    value: st.offsetOverMml,
    format: (v) => `MML ${v >= 0 ? '+' : ''}${v.toFixed(0)} dB → ${fmtDb(Math.min(mml + v, ceiling))} rel ref`,
    onInput: (v) => { st!.offsetOverMml = v; },
  });

  const startBtn = h('button', { class: 'btn primary', text: '▶ Start RI trial' }) as HTMLButtonElement;
  const washLine = h('div', { class: 'timer-line' });
  const baseCb = h('input', { type: 'checkbox', checked: st.baselineConfirmed }) as HTMLInputElement;
  baseCb.onchange = () => { st!.baselineConfirmed = baseCb.checked; updateGate(); };

  const needWashout = m.ri.length > 0;
  const updateGate = () => {
    const rem = washRemaining();
    washLine.replaceChildren(
      h('span', { class: 'muted', text: 'Washout' }),
      h('span', { text: rem > 0 ? `${fmtClock(rem)} remaining` : 'elapsed ✓' }),
    );
    startBtn.disabled = st!.running || (needWashout && (rem > 0 || !st!.baselineConfirmed));
  };
  updateGate();
  if (needWashout && washRemaining() > 0) ticker = window.setInterval(updateGate, 500);

  startBtn.onclick = () => {
    stopTicker();
    st!.running = true;
    const params: StimulusParams = {
      kind: 'nbn',
      centerHz: f,
      bwOct: st!.bwOct,
      amHz: st!.amOn ? st!.amHz : 0,
      amDepth: st!.amOn ? st!.amDepth : 0,
      levelDbRelRef: Math.min(mml + st!.offsetOverMml, ceiling),
      durationS: st!.durationS,
      noise: 'white',
      ear: st!.ear,
    };
    root.replaceChildren();
    const runner = runTrial(root, app, params, {
      onComplete: (trial) => {
        app.store.addRiTrial(trial);
        st!.baselineConfirmed = false;
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
    'Residual inhibition trial',
    note(`Stimulus: ⅓-octave noise at ${fmtHz(f)}, ${st.amOn ? `${st.amHz} Hz amplitude modulation, ` : 'unmodulated, '}${st.durationS} s, at ${fmtDb(Math.min(mml + st.offsetOverMml, ceiling))} rel ref. When it stops, immediately press and HOLD the button for as long as your tinnitus is reduced.`),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: 'Stimulus duration' }), durSel),
      h('div', { class: 'field' }, h('label', { text: 'AM rate (Hz)' }), amHzIn),
    ),
    h('label', { class: 'check' }, amCb, document.createTextNode('Amplitude modulation on (10 Hz AM is the evidence-backed default)')),
    earSelector(st.ear, (e) => { st!.ear = e; }),
    cp.n > 1 ? note(`Using the consensus pitch across ${cp.n} sessions: ${fmtHz(f)}.`) : null,
    offsetSl.root,
    mml + st.offsetOverMml > ceiling ? warnBox('MML + offset exceeds your comfort ceiling; the stimulus is clamped to the ceiling.') : null,
    needWashout
      ? h('div', {},
          washLine,
          h('label', { class: 'check' }, baseCb, document.createTextNode('My tinnitus is back to its usual baseline (previous suppression fully gone).')))
      : null,
    startBtn,
  ));
  root.append(card('Trials this session',
    trialsTable(m.ri) ?? note('None yet. Aim for 2–4 clean trials per session, no more — washout takes time.')));
}
