import './styles.css';
import { AudioEngine } from './audio/engine';
import { Store } from './data/store';
import type { App, ScreenId } from './ui/components';
import { h } from './ui/components';
import { renderHome } from './ui/screens/home';
import { renderCalibrate } from './ui/screens/calibrate';
import { renderPitch } from './ui/screens/pitch';
import { renderLoudness } from './ui/screens/loudness';
import { renderMml } from './ui/screens/mml';
import { renderRi } from './ui/screens/ri';
import { renderOptimizer } from './ui/screens/optimizer';
import { renderTherapy } from './ui/screens/therapy';
import { renderTrends } from './ui/screens/trends';

const engine = new AudioEngine();
const store = new Store();

// Restore session anchors after a reload mid-session.
{
  const cur = store.current();
  if (cur?.referenceLevelDb != null) engine.referenceDb = cur.referenceLevelDb;
  if (cur?.comfortCeilingDbRelRef != null) engine.comfortCeilingRelDb = cur.comfortCeilingDbRelRef;
}

const screens: Record<ScreenId, (root: HTMLElement, app: App) => void> = {
  home: renderHome,
  calibrate: renderCalibrate,
  pitch: renderPitch,
  loudness: renderLoudness,
  mml: renderMml,
  ri: renderRi,
  optimizer: renderOptimizer,
  therapy: renderTherapy,
  trends: renderTrends,
};

const NAV: [ScreenId, string][] = [
  ['home', 'Session'],
  ['calibrate', 'Calibrate'],
  ['pitch', 'Pitch'],
  ['loudness', 'Loudness'],
  ['mml', 'MML'],
  ['ri', 'RI test'],
  ['optimizer', 'Optimizer'],
  ['therapy', 'Therapy'],
  ['trends', 'Trends'],
];

let current: ScreenId = 'home';
let cleanup: (() => void) | null = null;

const app: App = {
  engine,
  store,
  go(id: ScreenId) {
    current = id;
    render();
  },
  refresh(opts) {
    render(opts?.keepAudio ?? false);
  },
  setCleanup(fn) {
    cleanup = fn;
  },
};

const rootEl = document.getElementById('app')!;
const badge = h('span', { class: 'session-badge' });
const nav = h('nav', { class: 'tabs' });
const content = h('main', {});

rootEl.append(
  h('header', { class: 'app-header' }, h('h1', { text: 'Tinnitus Lab' }), badge),
  nav,
  content,
  h('footer', { class: 'safety' },
    h('span', { text: 'Output hard-capped + limited · every start/stop fades · levels are relative, never absolute SPL · not a medical device' })),
);

function render(keepAudio = false): void {
  cleanup?.();
  cleanup = null;
  if (!keepAudio) engine.stopAll();

  const s = store.current();
  badge.textContent = s
    ? `session active · ${s.calibrated ? 'calibrated' : 'uncalibrated'}`
    : 'no session';
  badge.classList.toggle('on', !!s);

  nav.replaceChildren(
    ...NAV.map(([id, label]) =>
      h('button', {
        class: id === current ? 'current' : '',
        text: label,
        onclick: () => app.go(id),
      })),
  );

  content.replaceChildren();
  screens[current](content, app);
  window.scrollTo(0, 0);
}

render();

// Offline + home-screen install support. Not registered in dev (clashes with HMR).
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // offline support is best-effort; the app works without it
  });
}
