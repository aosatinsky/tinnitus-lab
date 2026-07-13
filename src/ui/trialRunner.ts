// Shared RI-trial runner: plays a timed stimulus, then measures suppression
// with the hold-button protocol and captures a 0–10 depth rating. Used by both
// the manual RI screen and the Bayesian optimizer so the measurement protocol
// is identical everywhere. Renders into its own container and never calls
// app.refresh() mid-trial (a global re-render would stop the audio).

import type { App } from './components';
import { card, fmtClock, h, note, okBox } from './components';
import { setWakeLock } from './wakeLock';
import type { RiTrial, StimulusParams } from '../data/store';

export const MAX_HOLD_S = 600;

/** Earliest time the next RI trial is allowed, given the previous one. */
export function washoutReadyAt(last: RiTrial | undefined): number {
  if (!last) return 0;
  const bufferS = last.durationS + Math.max(90, 2 * last.durationS);
  return Date.parse(last.at) + bufferS * 1000;
}

export interface TrialCallbacks {
  onComplete(t: RiTrial): void;
  onAbort(): void;
}

export interface TrialRunner {
  dispose(): void;
}

export function runTrial(
  container: HTMLElement,
  app: App,
  params: StimulusParams,
  cbs: TrialCallbacks,
): TrialRunner {
  let ticker = 0;
  const stopTicker = () => {
    window.clearInterval(ticker);
    ticker = 0;
  };
  let offsetAtMs = 0;
  let offsetIso = '';
  setWakeLock(true); // iOS kills Web Audio on screen lock — keep it awake for the trial

  const showRating = (durationS: number) => {
    const buttons = Array.from({ length: 11 }, (_, d) =>
      h('button', {
        class: 'btn',
        text: String(d),
        onclick: () => {
          setWakeLock(false);
          cbs.onComplete({
            at: offsetIso,
            stimulusParams: params,
            durationS: Math.round(durationS * 10) / 10,
            depth: d,
          });
        },
      }),
    );
    container.replaceChildren(
      card(
        'Rate the suppression depth',
        okBox(`Suppression lasted ${durationS.toFixed(1)} s.`),
        note('How deep was the suppression at its strongest? 0 = no change, 10 = completely silent.'),
        h('div', { class: 'depth-grid' }, ...buttons),
      ),
    );
  };

  const showMeasuring = () => {
    let holding = false;
    const elapsed = () => (performance.now() - offsetAtMs) / 1000;
    const readout = h('div', { class: 'big-readout' }, '0.0 s', h('small', { text: 'since stimulus offset' }));
    ticker = window.setInterval(() => {
      const e = elapsed();
      readout.replaceChildren(
        document.createTextNode(`${e.toFixed(1)} s`),
        h('small', { text: holding ? 'holding — release at baseline' : 'since stimulus offset' }),
      );
      if (e > MAX_HOLD_S) finish(MAX_HOLD_S);
    }, 100);

    const finish = (durationS: number) => {
      stopTicker();
      showRating(durationS);
    };

    const hold = h('button', { class: 'hold-btn', text: 'HOLD while tinnitus is reduced' }) as HTMLButtonElement;
    hold.oncontextmenu = (e) => e.preventDefault();
    hold.onpointerdown = (e) => {
      e.preventDefault();
      hold.setPointerCapture(e.pointerId);
      holding = true;
      hold.classList.add('holding');
      hold.textContent = 'Release when it returns to baseline';
    };
    const release = () => {
      if (holding) finish(elapsed());
    };
    hold.onpointerup = release;
    hold.onpointercancel = release;

    container.replaceChildren(
      card(
        'Measure suppression',
        note('If your tinnitus dropped or vanished, press and hold NOW. Release the moment it is back to its normal baseline.'),
        readout,
        hold,
        h('button', { class: 'btn', text: 'No suppression at all', onclick: () => finish(0) }),
      ),
    );
  };

  const showPlaying = () => {
    const endAtMs = Date.now() + params.durationS * 1000;
    const line = () => fmtClock((endAtMs - Date.now()) / 1000);
    const readout = h('div', { class: 'big-readout' }, line(), h('small', { text: 'stimulus playing — get ready to respond at silence' }));
    ticker = window.setInterval(() => {
      readout.replaceChildren(
        document.createTextNode(line()),
        h('small', { text: 'stimulus playing — get ready to respond at silence' }),
      );
    }, 250);
    container.replaceChildren(
      card(
        'Stimulus playing',
        readout,
        h('button', {
          class: 'btn danger',
          text: 'Abort trial (no data saved)',
          onclick: () => {
            stopTicker();
            setWakeLock(false);
            app.engine.stopAll();
            cbs.onAbort();
          },
        }),
      ),
    );
  };

  app.engine.playNoiseBand({
    centerHz: params.centerHz,
    bwOct: params.bwOct,
    amHz: params.amHz || undefined,
    amDepth: params.amDepth || undefined,
    levelRelDb: params.levelDbRelRef,
    noise: params.noise,
    ear: params.ear,
    durationS: params.durationS,
    onEnded: () => {
      stopTicker();
      offsetAtMs = performance.now();
      offsetIso = new Date().toISOString();
      showMeasuring();
    },
  });
  showPlaying();

  return {
    dispose: () => {
      stopTicker();
      setWakeLock(false);
    },
  };
}
