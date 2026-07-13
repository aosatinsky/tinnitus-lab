import type { App } from '../components';
import { Toggle, card, earSelector, fmtDb, fmtHz, gate, h, note, okBox, slider } from '../components';
import type { Ear } from '../../data/store';

export function renderLoudness(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (!s) {
    root.append(gate('Start a session first.', 'Go to Session', () => app.go('home')));
    return;
  }
  if (!s.calibrated) {
    root.append(gate('Calibrate first.', 'Go to Calibrate', () => app.go('calibrate')));
    return;
  }
  const m = s.measurements;
  if (m.pitchMatchHz == null || !m.pitchOctaveConfirmed) {
    root.append(gate('Loudness matching needs an octave-confirmed pitch match.', 'Go to Pitch', () => app.go('pitch')));
    return;
  }

  const cp = app.store.consensusPitchHz()!;
  const f = cp.hz;
  let ear: Ear = m.loudnessEar ?? m.pitchEar ?? 'both';

  const lvl = slider({
    label: 'Tone level (dB rel ref)',
    min: -50, max: app.engine.comfortCeilingRelDb, step: 0.5,
    value: m.loudnessMatchDbRelRef ?? -25,
    format: fmtDb,
    onInput: (v) => toggle.voiceRef?.setLevel(v),
  });
  const toggle = new Toggle(`Play tone at ${fmtHz(f)}`, () =>
    app.engine.playTone(f, lvl.get(), { ear }),
  );

  root.append(card(
    'Loudness match',
    note(`Adjust the ${fmtHz(f)} tone until it sounds as loud as your tinnitus. Start from below and creep up. The value is stored relative to your session reference.`),
    cp.n > 1 ? note(`Using the consensus pitch across ${cp.n} sessions (this session matched ${fmtHz(m.pitchMatchHz)}).`) : null,
    earSelector(ear, (e) => { ear = e; if (toggle.playing) { toggle.stop(); toggle.start(); } }),
    toggle.root,
    lvl.root,
    h('button', {
      class: 'btn good', text: 'This matches my tinnitus loudness',
      onclick: () => {
        toggle.stop();
        const v = lvl.get();
        app.store.update((x) => {
          x.measurements.loudnessMatchDbRelRef = v;
          x.measurements.loudnessEar = ear;
        });
        app.refresh();
      },
    }),
    m.loudnessMatchDbRelRef != null
      ? okBox(`Saved: ${fmtDb(m.loudnessMatchDbRelRef)} rel ref${m.loudnessEar && m.loudnessEar !== 'both' ? ` (${m.loudnessEar} ear)` : ''}.`)
      : null,
    m.loudnessMatchDbRelRef != null
      ? h('button', { class: 'btn primary', text: 'Continue → MML', onclick: () => app.go('mml') })
      : null,
  ));
}
