import type { App } from '../components';
import { Toggle, card, earSelector, fmtDb, fmtHz, gate, h, note, okBox, slider, warnBox } from '../components';
import type { Ear } from '../../data/store';

const MML_BW_OCT = 1 / 3;

export function renderMml(root: HTMLElement, app: App): void {
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
    root.append(gate('MML needs an octave-confirmed pitch match.', 'Go to Pitch', () => app.go('pitch')));
    return;
  }

  const cp = app.store.consensusPitchHz()!;
  const f = cp.hz;
  let ear: Ear = m.mmlEar ?? m.loudnessEar ?? m.pitchEar ?? 'both';

  const lvl = slider({
    label: 'Noise level (dB rel ref)',
    min: -50, max: app.engine.comfortCeilingRelDb, step: 0.5,
    value: m.mmlDbRelRef ?? -40,
    format: fmtDb,
    onInput: (v) => toggle.voiceRef?.setLevel(v),
  });
  const toggle = new Toggle('Play narrowband noise', () =>
    app.engine.playNoiseBand({ centerHz: f, bwOct: MML_BW_OCT, levelRelDb: lvl.get(), ear }),
  );

  root.append(card(
    'Minimum masking level (MML)',
    note(`A ⅓-octave noise band centered on ${fmtHz(f)}. Start low and raise slowly until the noise JUST covers your tinnitus — the lowest level at which you can no longer hear it. Save at that point.`),
    cp.n > 1 ? note(`Using the consensus pitch across ${cp.n} sessions.`) : null,
    earSelector(ear, (e) => { ear = e; if (toggle.playing) { toggle.stop(); toggle.start(); } }),
    toggle.root,
    lvl.root,
    h('button', {
      class: 'btn good', text: 'Tinnitus is just masked — save MML',
      onclick: () => {
        toggle.stop();
        const v = lvl.get();
        app.store.update((x) => {
          x.measurements.mmlDbRelRef = v;
          x.measurements.mmlEar = ear;
        });
        app.refresh();
      },
    }),
    note('If you hit your comfort ceiling and the tinnitus is still audible, do not push the ceiling. Save nothing and note it in the session log — "not maskable within comfort" is itself a data point.'),
    m.mmlDbRelRef != null ? okBox(`Saved: ${fmtDb(m.mmlDbRelRef)} rel ref${m.mmlEar && m.mmlEar !== 'both' ? ` (${m.mmlEar} ear)` : ''}.`) : null,
    m.mmlDbRelRef != null && m.mmlDbRelRef >= app.engine.comfortCeilingRelDb - 0.5
      ? warnBox('MML sits at your comfort ceiling — the RI stimulus cannot go the usual +10 dB above it. RI trials will run at the ceiling.')
      : null,
    m.mmlDbRelRef != null
      ? h('button', { class: 'btn primary', text: 'Continue → RI test', onclick: () => app.go('ri') })
      : null,
  ));
}
