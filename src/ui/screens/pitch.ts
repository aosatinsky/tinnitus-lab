// Pitch matching: 2AFC staircase on a log-frequency ladder, then a fine
// method-of-adjustment slider, then a MANDATORY octave-confusion check.
// Nothing is saved as the pitch match until the octave check passes twice
// consecutively.

import type { App } from '../components';
import { card, earSelector, fmtHz, gate, h, note, okBox, pulseButton, slider, warnBox } from '../components';
import type { Ear } from '../../data/store';

const SPREAD_START = 0.5; // half-spread in octaves each side of the estimate
const SPREAD_SHRINK = 0.72;
const SPREAD_MIN = 1 / 24;
const FINE_RANGE_OCT = 0.25;

interface PitchState {
  sessionId: string;
  phase: 'afc' | 'fine' | 'octave';
  lo: number;
  hi: number;
  est: number;
  spread: number;
  trial: number;
  cand: number;
  streak: number;
  octaveOrder: number[]; // shuffled option frequencies for current round
  toneLevel: number; // dB rel ref for test tones
  ear: Ear;
}

let st: PitchState | null = null;

function totalTrials(): number {
  let n = 0;
  for (let sp = SPREAD_START; sp >= SPREAD_MIN; sp *= SPREAD_SHRINK) n++;
  return n;
}

function initState(sessionId: string, lo: number, hi: number): PitchState {
  return {
    sessionId,
    phase: 'afc',
    lo,
    hi,
    est: Math.sqrt(lo * hi),
    spread: SPREAD_START,
    trial: 0,
    cand: 0,
    streak: 0,
    octaveOrder: [],
    toneLevel: -15,
    ear: 'both',
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function renderPitch(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first.', 'Go to Session', () => app.go('home')));
    return;
  }
  if (!s.calibrated) {
    root.append(gate('Calibrate this session before measuring.', 'Go to Calibrate', () => app.go('calibrate')));
    return;
  }

  const maxHz = app.engine.maxUsableHz();
  if (!st || st.sessionId !== s.id) {
    st = initState(s.id, 3000, Math.min(14000, maxHz));
  }

  const saved = s.measurements;
  if (saved.pitchMatchHz != null && saved.pitchOctaveConfirmed) {
    const cp = app.store.consensusPitchHz();
    root.append(card(
      'Pitch match (confirmed)',
      okBox(`This session's confirmed pitch: ${fmtHz(saved.pitchMatchHz)}${saved.pitchEar && saved.pitchEar !== 'both' ? ` (${saved.pitchEar} ear)` : ''} (octave check passed).`),
      cp && cp.n > 1
        ? note(`Consensus across ${cp.n} sessions: ${fmtHz(cp.hz)} — downstream modules use this, not any single match.`)
        : null,
      s.hfRolloffHz != null && saved.pitchMatchHz > s.hfRolloffHz
        ? warnBox(`Your match is above today's AirPods rolloff (${fmtHz(s.hfRolloffHz)}) — treat it with extra skepticism.`)
        : null,
      note('Pitch matches are noisy (an octave of variation is normal). Repeat across sessions and average — never trust a single number.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'Continue → Loudness', onclick: () => app.go('loudness') }),
        h('button', {
          class: 'btn', text: 'Redo pitch match',
          onclick: () => {
            app.store.update((x) => {
              x.measurements.pitchMatchHz = undefined;
              x.measurements.pitchOctaveConfirmed = undefined;
            });
            st = initState(s.id, 3000, Math.min(14000, maxHz));
            app.refresh();
          },
        }),
      ),
    ));
    return;
  }

  const lvlSlider = slider({
    label: 'Test tone level (dB rel ref)',
    min: -40, max: Math.min(10, app.engine.comfortCeilingRelDb), step: 1,
    value: st.toneLevel,
    format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} dB`,
    onInput: (v) => { st!.toneLevel = v; },
  });
  const earRow = earSelector(st.ear, (e) => { st!.ear = e; });
  const tone = (f: number) => app.engine.playTone(f, st!.toneLevel, { ear: st!.ear });

  const rolloffWarn = (f: number) =>
    s.hfRolloffHz != null && f > s.hfRolloffHz
      ? warnBox(`${fmtHz(f)} is above today's rolloff (${fmtHz(s.hfRolloffHz)}) — it may be inaudible or distorted on AirPods.`)
      : null;

  if (st.phase === 'afc') {
    const fA = Math.max(st.lo, st.est * Math.pow(2, -st.spread));
    const fB = Math.min(st.hi, st.est * Math.pow(2, st.spread));
    const choose = (f: number) => {
      app.engine.stopAll();
      st!.est = f;
      st!.spread *= SPREAD_SHRINK;
      st!.trial++;
      if (st!.spread < SPREAD_MIN) {
        st!.phase = 'fine';
        st!.cand = st!.est;
      }
      app.refresh();
    };
    root.append(card(
      `Pitch match — trial ${st.trial + 1} of ~${totalTrials()}`,
      note('Play A and B, then pick whichever is closer to your tinnitus pitch. Neither needs to be exact — just pick the closer one. Replay as often as you like. If your tinnitus is lateralized, test the affected ear.'),
      earRow,
      lvlSlider.root,
      h('div', { class: 'btn-row' },
        pulseButton('▶ Play A', app, () => tone(fA)),
        pulseButton('▶ Play B', app, () => tone(fB)),
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'A is closer', onclick: () => choose(fA) }),
        h('button', { class: 'btn primary', text: 'B is closer', onclick: () => choose(fB) }),
      ),
      rolloffWarn(fB),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn small', text: 'Start over',
          onclick: () => { st = initState(s.id, 3000, Math.min(14000, maxHz)); app.refresh(); },
        }),
      ),
    ));
    return;
  }

  if (st.phase === 'fine') {
    const base = st.cand;
    const freqOf = (oct: number) => Math.min(maxHz, base * Math.pow(2, oct));
    const readout = h('div', { class: 'big-readout' }, fmtHz(base), h('small', { text: 'fine adjust — drag while the tone plays' }));
    let voiceSetFreq: ((hz: number) => void) | null = null;
    const fine = slider({
      label: `Fine adjust (±${FINE_RANGE_OCT} octave)`,
      min: -FINE_RANGE_OCT, max: FINE_RANGE_OCT, step: 1 / 96,
      value: 0,
      format: (v) => `${v >= 0 ? '+' : ''}${(v * 12).toFixed(1)} semitones`,
      onInput: (v) => {
        const f = freqOf(v);
        readout.replaceChildren(document.createTextNode(fmtHz(f)), h('small', { text: 'fine adjust' }));
        voiceSetFreq?.(f);
      },
    });
    const playBtn = h('button', { class: 'btn primary', text: '▶ Play (continuous)' }) as HTMLButtonElement;
    let playing = false;
    playBtn.onclick = () => {
      if (playing) {
        app.engine.stopAll();
        voiceSetFreq = null;
        playing = false;
        playBtn.textContent = '▶ Play (continuous)';
        playBtn.classList.remove('active');
      } else {
        const v = app.engine.playTone(freqOf(fine.get()), st!.toneLevel, { ear: st!.ear });
        voiceSetFreq = (hz) => v.setFreq(hz);
        playing = true;
        playBtn.textContent = 'Stop';
        playBtn.classList.add('active');
      }
    };
    root.append(card(
      'Pitch match — fine adjustment',
      note('Optional: nudge the tone until it sits exactly on your tinnitus. Then confirm — the octave check comes next.'),
      readout,
      earRow,
      lvlSlider.root,
      playBtn,
      fine.root,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn good', text: 'Confirm this pitch → octave check',
          onclick: () => {
            app.engine.stopAll();
            st!.cand = freqOf(fine.get());
            st!.streak = 0;
            st!.octaveOrder = [];
            st!.phase = 'octave';
            app.refresh();
          },
        }),
        h('button', { class: 'btn', text: 'Back to A/B trials', onclick: () => { st!.phase = 'afc'; st!.spread = SPREAD_START * Math.pow(SPREAD_SHRINK, 4); app.refresh(); } }),
      ),
    ));
    return;
  }

  // phase: octave — MANDATORY confusion check
  const cand = st.cand;
  const opts = [cand / 2, cand];
  if (cand * 2 <= maxHz) opts.push(cand * 2);
  if (!st.octaveOrder.length) st.octaveOrder = shuffle(opts);
  const letters = ['A', 'B', 'C'];

  const pick = (f: number) => {
    app.engine.stopAll();
    if (f === cand) {
      st!.streak++;
      if (st!.streak >= 2) {
        const final = Math.round(cand);
        const ear = st!.ear;
        app.store.update((x) => {
          x.measurements.pitchMatchHz = final;
          x.measurements.pitchOctaveConfirmed = true;
          x.measurements.pitchEar = ear;
        });
        st = null;
        app.refresh();
        return;
      }
    } else {
      // switching counts as this frequency's first confirmation
      st!.cand = f;
      st!.streak = 1;
    }
    st!.octaveOrder = [];
    app.refresh();
  };

  root.append(card(
    'Octave-confusion check (mandatory)',
    note('Pitch matches routinely land an octave off. The tones below include your candidate and its octave neighbors, in random order. Pick whichever truly matches your tinnitus. The same frequency must win twice in a row to be accepted.'),
    h('div', { class: 'kv-grid' },
      h('span', { class: 'k', text: 'Confirmations' }),
      h('span', { class: 'v', text: `${st.streak} of 2` }),
    ),
    earRow,
    lvlSlider.root,
    ...st.octaveOrder.map((f, i) =>
      h('div', { class: 'btn-row' },
        pulseButton(`▶ Play ${letters[i]}`, app, () => tone(f), 1200),
        h('button', { class: 'btn primary', text: `${letters[i]} matches best`, 'data-freq': String(Math.round(f)), onclick: () => pick(f) }),
      ),
    ),
    cand * 2 > maxHz ? note(`The upper octave (${fmtHz(cand * 2)}) exceeds what these headphones can reproduce, so only the lower octave is tested.`) : null,
    rolloffWarn(cand),
  ));
}
