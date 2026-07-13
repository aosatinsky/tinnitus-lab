// Therapeutic stimulus: spectrally-shaped noise + ~10 Hz amplitude modulation
// (primary intervention; notched music is deliberately NOT offered as primary —
// no evidence above ~8 kHz). Session timer with break prompt and hard stop.

import type { App } from '../components';
import { Toggle, card, earSelector, fmtClock, fmtDb, fmtHz, gate, h, note, slider, warnBox } from '../components';
import { setWakeLock } from '../wakeLock';
import type { NoiseKind, TherapyPresetParams } from '../../data/store';

const BREAK_AT_S = 30 * 60;
const HARD_STOP_S = 60 * 60;
const SLEEP_FLOOR_DB = -50; // bedtime fade target: inaudible

let startedAtMs: number | null = null;
let sleepMin = 0;

export function renderTherapy(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first — therapy levels are relative to session calibration.', 'Go to Session', () => app.go('home')));
    return;
  }
  if (!s.calibrated) {
    root.append(gate('Calibrate first.', 'Go to Calibrate', () => app.go('calibrate')));
    return;
  }

  const m = s.measurements;
  const cp = app.store.consensusPitchHz();
  const defaults: TherapyPresetParams = {
    centerHz: cp?.hz ?? m.pitchMatchHz ?? 8000,
    bwOct: 0.5,
    amHz: 10,
    amDepth: 0.8,
    peakGainDb: 6,
    levelDbRelRef: m.mmlDbRelRef != null ? Math.max(-45, m.mmlDbRelRef - 5) : -25,
    noise: 'pink',
    ear: 'both',
  };
  const p: TherapyPresetParams = { ...defaults };

  let ticker = 0;
  const stopTicker = () => {
    window.clearInterval(ticker);
    ticker = 0;
    startedAtMs = null;
  };
  app.setCleanup(() => { stopTicker(); });

  const timerLine = h('div', { class: 'timer-line' },
    h('span', { class: 'muted', text: 'Elapsed' }), h('span', { text: '0:00' }));
  const breakBox = h('div', {});

  const toggle = new Toggle('▶ Start therapy stimulus', () => {
    startedAtMs = Date.now();
    const startLevel = p.levelDbRelRef;
    setWakeLock(true);
    breakBox.replaceChildren();
    ticker = window.setInterval(() => {
      if (startedAtMs == null) return;
      const el = (Date.now() - startedAtMs) / 1000;
      timerLine.replaceChildren(
        h('span', { class: 'muted', text: 'Elapsed' }),
        h('span', { text: sleepMin > 0 ? `${fmtClock(el)} · sleep fade ${fmtClock(Math.max(0, sleepMin * 60 - el))}` : fmtClock(el) }),
      );
      if (sleepMin > 0) {
        const frac = Math.min(1, el / (sleepMin * 60));
        toggle.voiceRef?.setLevel(startLevel + (SLEEP_FLOOR_DB - startLevel) * frac);
        if (frac >= 1) {
          toggle.stop();
          breakBox.replaceChildren(note('Sleep fade complete — stimulus stopped. Good night.'));
        }
        return; // no break nagging in bedtime mode
      }
      if (el >= BREAK_AT_S && !breakBox.hasChildNodes()) {
        breakBox.append(warnBox('30 minutes — consider a break. Give your ears (and the RI effect) room to breathe.'));
      }
      if (el >= HARD_STOP_S) {
        toggle.stop();
        breakBox.replaceChildren(warnBox('60-minute limit reached — stimulus stopped. Take a real break.'));
      }
    }, 1000);
    return app.engine.playShapedNoise({
      centerHz: p.centerHz,
      bwOct: p.bwOct,
      peakGainDb: p.peakGainDb,
      amHz: p.amHz,
      amDepth: p.amDepth,
      levelRelDb: p.levelDbRelRef,
      noise: p.noise,
      ear: p.ear,
    });
  });
  const origStop = toggle.stop.bind(toggle);
  toggle.stop = () => {
    origStop();
    stopTicker();
    setWakeLock(false);
    timerLine.replaceChildren(h('span', { class: 'muted', text: 'Elapsed' }), h('span', { text: '0:00' }));
  };

  const restartIfPlaying = () => {
    if (toggle.playing) {
      toggle.stop();
      toggle.start();
    }
  };

  const centerIn = h('input', { type: 'number', min: '500', max: '16000', step: '50', value: String(Math.round(p.centerHz)) }) as HTMLInputElement;
  centerIn.onchange = () => { p.centerHz = Number(centerIn.value) || defaults.centerHz; rolloffCheck(); restartIfPlaying(); };

  const noiseSel = h('select', {},
    h('option', { value: 'pink', text: 'pink', selected: p.noise === 'pink' }),
    h('option', { value: 'white', text: 'white', selected: p.noise === 'white' }),
  ) as HTMLSelectElement;
  noiseSel.onchange = () => { p.noise = noiseSel.value as NoiseKind; restartIfPlaying(); };

  const earBox = h('div', {});
  const renderEar = () => {
    earBox.replaceChildren(earSelector(p.ear ?? 'both', (e) => { p.ear = e; restartIfPlaying(); }));
  };
  renderEar();

  const sleepSel = h('select', {},
    ...[0, 10, 20, 30, 45].map((min) =>
      h('option', { value: String(min), text: min === 0 ? 'off' : `${min} min fade-out`, selected: sleepMin === min })),
  ) as HTMLSelectElement;
  sleepSel.onchange = () => { sleepMin = Number(sleepSel.value); };

  const bwSl = slider({
    label: 'Band half-width (octaves each side)',
    min: 1 / 6, max: 1, step: 1 / 12, value: p.bwOct,
    format: (v) => `${v.toFixed(2)} oct`,
    onInput: (v) => { p.bwOct = v; },
  });
  bwSl.root.onchange = restartIfPlaying;

  const amHzSl = slider({
    label: 'AM rate',
    min: 2, max: 40, step: 1, value: p.amHz,
    format: (v) => `${v.toFixed(0)} Hz`,
    onInput: (v) => { p.amHz = v; },
  });
  amHzSl.root.onchange = restartIfPlaying;

  const amDepthSl = slider({
    label: 'AM depth',
    min: 0, max: 1, step: 0.05, value: p.amDepth,
    format: (v) => v.toFixed(2),
    onInput: (v) => { p.amDepth = v; },
  });
  amDepthSl.root.onchange = restartIfPlaying;

  const peakSl = slider({
    label: 'Peak boost at tinnitus pitch',
    min: 0, max: 12, step: 1, value: p.peakGainDb,
    format: (v) => `+${v.toFixed(0)} dB`,
    onInput: (v) => { p.peakGainDb = v; },
  });
  peakSl.root.onchange = restartIfPlaying;

  const lvlSl = slider({
    label: 'Level (dB rel ref) — live',
    min: -45, max: app.engine.comfortCeilingRelDb, step: 0.5,
    value: p.levelDbRelRef,
    format: fmtDb,
    onInput: (v) => {
      p.levelDbRelRef = v;
      toggle.voiceRef?.setLevel(v);
    },
  });

  const rolloffMsg = h('div', {});
  const rolloffCheck = () => {
    rolloffMsg.replaceChildren();
    if (s.hfRolloffHz != null && p.centerHz > s.hfRolloffHz) {
      rolloffMsg.append(warnBox(`Center ${fmtHz(p.centerHz)} is above today's AirPods rolloff (${fmtHz(s.hfRolloffHz)}); energy up there will not reach your ear. Consider centering at or below the rolloff.`));
    }
  };
  rolloffCheck();

  const applyParams = (q: TherapyPresetParams) => {
    Object.assign(p, q);
    centerIn.value = String(Math.round(p.centerHz));
    noiseSel.value = p.noise;
    bwSl.set(p.bwOct);
    amHzSl.set(p.amHz);
    amDepthSl.set(p.amDepth);
    peakSl.set(p.peakGainDb);
    lvlSl.set(Math.min(p.levelDbRelRef, app.engine.comfortCeilingRelDb));
    renderEar();
    rolloffCheck();
    restartIfPlaying();
  };

  const nameIn = h('input', { type: 'text', placeholder: 'Preset name…' }) as HTMLInputElement;
  const presetList = h('div', {});
  const renderPresets = () => {
    presetList.replaceChildren(
      ...app.store.data.presets.map((pr) =>
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', text: `Load: ${pr.name}`, onclick: () => applyParams(pr.params) }),
          h('button', {
            class: 'btn danger', text: '✕',
            onclick: () => { app.store.deletePreset(pr.id); renderPresets(); },
          }),
        )),
    );
    if (!app.store.data.presets.length) presetList.append(note('No presets saved yet.'));
  };
  renderPresets();

  root.append(card(
    'Therapy — shaped noise + amplitude modulation',
    note(`Band-limited ${p.noise} noise around your tinnitus region with a peak boost at the pitch and ~10 Hz AM (modulated sound produces stronger residual inhibition than steady noise). Defaults come from this session's measurements. Start low; a gentle, clearly-audible-but-not-masking level is the guide for longer listening.`),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: 'Center frequency (Hz)' }), centerIn),
      h('div', { class: 'field' }, h('label', { text: 'Noise type' }), noiseSel),
    ),
    earBox,
    bwSl.root, amHzSl.root, amDepthSl.root, peakSl.root, lvlSl.root,
    h('div', { class: 'field' }, h('label', { text: 'Sleep timer (bedtime mode: level fades to silence, then stops)' }), sleepSel),
    rolloffMsg,
    h('div', { class: 'btn-row' }, toggle.root),
    timerLine,
    breakBox,
    note('Dose guide from the masking literature (informational, not a prescription): earlier in the day, nearer masking level; later, drop to a soft sub-tinnitus level. 30–60 min blocks with breaks.'),
    note('Bedtime caveat: iOS suspends web audio when the screen locks. The app holds a wake lock while playing — leave the phone face-down with the screen on (it dims by itself), or the fade will be cut short.'),
  ));

  root.append(card(
    'Presets',
    h('div', { class: 'field' }, h('label', { text: 'Save current parameters as' }), nameIn),
    h('button', {
      class: 'btn', text: 'Save preset',
      onclick: () => {
        const name = nameIn.value.trim() || `Preset ${app.store.data.presets.length + 1}`;
        app.store.savePreset(name, { ...p });
        nameIn.value = '';
        renderPresets();
      },
    }),
    presetList,
  ));
}
