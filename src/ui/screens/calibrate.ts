import type { App } from '../components';
import { Toggle, card, fmtDb, fmtHz, gate, h, note, okBox, slider, warnBox } from '../components';
import { profileFor } from '../../data/devices';

interface CalState {
  sessionId: string;
  step: number; // 0 checklist, 1 reference, 2 ceiling, 3 sweep
  checks: boolean[];
  rolloffHz: number | null;
}

const BASE_CHECKLIST = [
  'iOS volume is set to ~50% and I will NOT touch it for the rest of this session.',
  'Noise Control is set to a fixed mode (ANC on or Off) — not Adaptive, not Transparency.',
  'Headphone Accommodations and any custom EQ are OFF (Settings → Accessibility → Audio/Visual).',
  'Quiet room; headphones seated well; I will not remove them during the session.',
  'I understand all levels here are relative comparisons, never absolute SPL.',
];

let st: CalState | null = null;

export function renderCalibrate(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first.', 'Go to Session', () => app.go('home')));
    return;
  }

  const profile = profileFor(s.headphones);
  const checklist = [...BASE_CHECKLIST, ...profile.checklistExtras];
  if (!st || st.sessionId !== s.id || st.checks.length !== checklist.length) {
    st = { sessionId: s.id, step: 0, checks: checklist.map(() => false), rolloffHz: s.hfRolloffHz ?? null };
  }

  if (s.calibrated) {
    root.append(card(
      'Calibration complete',
      okBox('This session is calibrated. All levels are stored relative to your 1 kHz reference.'),
      h('div', { class: 'kv-grid' },
        h('span', { class: 'k', text: 'Reference (1 kHz)' }),
        h('span', { class: 'v', text: `${s.referenceLevelDb!.toFixed(1)} dB internal` }),
        h('span', { class: 'k', text: 'Comfort ceiling' }),
        h('span', { class: 'v', text: `${fmtDb(s.comfortCeilingDbRelRef!)} rel ref` }),
        h('span', { class: 'k', text: 'HF rolloff today' }),
        h('span', { class: 'v', text: s.hfRolloffHz != null ? fmtHz(s.hfRolloffHz) : '—' }),
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'Continue → Pitch match', onclick: () => app.go('pitch') }),
        h('button', {
          class: 'btn', text: 'Redo calibration',
          onclick: () => {
            app.store.update((x) => { x.calibrated = false; });
            st = null;
            app.refresh();
          },
        }),
      ),
    ));
    return;
  }

  const step = st.step;
  const goStep = (n: number) => { st!.step = n; app.engine.stopAll(); app.refresh(); };

  if (step === 0) {
    const cont = h('button', {
      class: 'btn primary', text: 'Continue → Reference level',
      disabled: !st.checks.every(Boolean),
      onclick: () => goStep(1),
    }) as HTMLButtonElement;
    root.append(card(
      `Step 1 of 4 — Pre-flight checklist (${profile.label})`,
      note('AirPods apply volume-dependent EQ and adaptive processing. These settings must be pinned or every measurement is garbage.'),
      ...profile.notes.map((n) => note(`ℹ ${n}`)),
      ...checklist.map((label, i) => {
        const cb = h('input', { type: 'checkbox', checked: st!.checks[i] }) as HTMLInputElement;
        cb.onchange = () => {
          st!.checks[i] = cb.checked;
          cont.disabled = !st!.checks.every(Boolean);
        };
        return h('label', { class: 'check' }, cb, document.createTextNode(label));
      }),
      cont,
    ));
    return;
  }

  if (step === 1) {
    const lvl = slider({
      label: 'Reference level (internal dB)',
      min: -70, max: -15, step: 0.5,
      value: s.referenceLevelDb ?? -45,
      format: (v) => `${v.toFixed(1)} dB`,
      onInput: (v) => toggle.voiceRef?.setLevel(v),
    });
    const toggle = new Toggle('Play 1 kHz tone', () => app.engine.playToneRaw(1000, lvl.get()));
    root.append(card(
      'Step 2 of 4 — Set your reference level',
      note('Adjust until the 1 kHz tone is clearly audible and comfortable — a level you could listen to for minutes without strain. Every other level this session is stored relative to this anchor ("dB rel ref").'),
      toggle.root,
      lvl.root,
      h('button', {
        class: 'btn good', text: 'This is my comfortable reference',
        onclick: () => {
          toggle.stop();
          const v = lvl.get();
          app.store.update((x) => { x.referenceLevelDb = v; });
          app.engine.referenceDb = v;
          goStep(2);
        },
      }),
    ));
    return;
  }

  if (step === 2) {
    const lvl = slider({
      label: 'Level above reference',
      min: 0, max: 30, step: 0.5,
      value: s.comfortCeilingDbRelRef ?? 10,
      format: (v) => `${fmtDb(v)} rel ref`,
      onInput: (v) => toggle.voiceRef?.setLevel(v),
    });
    const toggle = new Toggle('Play 1 kHz tone', () =>
      app.engine.playTone(1000, lvl.get(), { ignoreCeiling: true }),
    );
    root.append(card(
      'Step 3 of 4 — Set your comfort ceiling',
      note('Slowly raise the tone to the loudest level you would accept during testing — not painful, not startling. Nothing in the app will ever play above this. Acoustic-trauma ears often have reduced tolerance: err low.'),
      warnBox('Raise slowly. Output is hard-capped and limited regardless, but set this honestly.'),
      toggle.root,
      lvl.root,
      h('button', {
        class: 'btn good', text: 'Set as my comfort ceiling',
        onclick: () => {
          toggle.stop();
          const v = lvl.get();
          app.store.update((x) => { x.comfortCeilingDbRelRef = v; });
          app.engine.comfortCeilingRelDb = v;
          goStep(3);
        },
      }),
    ));
    return;
  }

  // step 3 — HF sweep
  const maxHz = app.engine.maxUsableHz();
  const DUR = 16;
  const readout = h('div', { class: 'big-readout' },
    st.rolloffHz != null ? fmtHz(st.rolloffHz) : '—',
    h('small', { text: st.rolloffHz != null ? 'last audible frequency (today)' : 'sweep not run yet' }),
  );
  let ticker = 0;
  const stopTicker = () => { window.clearInterval(ticker); ticker = 0; };
  app.setCleanup(stopTicker);

  const goneBtn = h('button', { class: 'btn good', text: "It's gone (mark rolloff)", disabled: true }) as HTMLButtonElement;
  const sweepToggle = new Toggle(`Play sweep 8 kHz → ${fmtHz(maxHz)} (${DUR} s)`, () => {
    const v = app.engine.playSweep(8000, maxHz, DUR, 0, () => {
      // heard to the end
      stopTicker();
      st!.rolloffHz = maxHz;
      goneBtn.disabled = true;
      sweepToggle.stop();
      app.refresh();
    });
    goneBtn.disabled = false;
    ticker = window.setInterval(() => {
      if (!v.active) return;
      readout.replaceChildren(document.createTextNode(fmtHz(v.freqNow())), h('small', { text: 'sweeping…' }));
    }, 100);
    goneBtn.onclick = () => {
      st!.rolloffHz = v.freqNow();
      stopTicker();
      sweepToggle.stop();
      goneBtn.disabled = true;
      app.refresh();
    };
    return v;
  });

  root.append(card(
    'Step 4 of 4 — High-frequency self-test',
    note(`AirPods high-frequency response depends on today's seal. The sweep rises from 8 kHz; tap the button the moment you can no longer hear it. If you hear it all the way, your rolloff is recorded as ${fmtHz(maxHz)}.`),
    readout,
    h('div', { class: 'btn-row' }, sweepToggle.root, goneBtn),
    st.rolloffHz != null ? okBox(`Rolloff today: ${fmtHz(st.rolloffHz)}. You can re-run the sweep to refine it.`) : null,
    st.rolloffHz != null && st.rolloffHz < profile.typicalRolloffHz - 2000
      ? warnBox(`That is well below what a good ${profile.label} seal typically reaches (~${fmtHz(profile.typicalRolloffHz)}). Consider reseating (${profile.kind === 'in_ear' ? 'tips/seal' : 'earcup placement'}) and re-running the sweep — or accept it as today's reality.`)
      : null,
    h('button', {
      class: 'btn primary', text: 'Finish calibration',
      disabled: st.rolloffHz == null,
      onclick: () => {
        app.engine.stopAll();
        stopTicker();
        const hz = st!.rolloffHz!;
        app.store.update((x) => {
          x.hfRolloffHz = Math.round(hz);
          x.calibrated = true;
        });
        app.refresh();
      },
    }),
  ));
}
