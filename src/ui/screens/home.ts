import type { App } from '../components';
import { card, fmtDb, fmtHz, gate, h, note, shareOrDownload, warnBox } from '../components';
import type { Headphones, RiTrial, Session } from '../../data/store';
import { DEVICE_PROFILES, profileFor } from '../../data/devices';

function bestRi(s: Session): RiTrial | null {
  return s.measurements.ri.reduce<RiTrial | null>(
    (b, t) => (!b || t.durationS * t.depth > b.durationS * b.depth ? t : b),
    null,
  );
}

function kv(k: string, v: string): HTMLElement[] {
  return [h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })];
}

function activeSessionCard(app: App, s: Session): HTMLElement {
  const m = s.measurements;
  const best = bestRi(s);
  const grid = h(
    'div',
    { class: 'kv-grid' },
    ...kv('Started', new Date(s.startedAt).toLocaleString()),
    ...kv('Headphones', profileFor(s.headphones).label),
    ...kv('Calibrated', s.calibrated ? 'yes' : 'not yet'),
    ...kv('Reference (1 kHz)', s.referenceLevelDb != null ? `${s.referenceLevelDb.toFixed(1)} dB internal` : '—'),
    ...kv('Comfort ceiling', s.comfortCeilingDbRelRef != null ? fmtDb(s.comfortCeilingDbRelRef) + ' rel ref' : '—'),
    ...kv('HF rolloff', s.hfRolloffHz != null ? fmtHz(s.hfRolloffHz) : '—'),
    ...kv('Pitch match', m.pitchMatchHz != null ? `${fmtHz(m.pitchMatchHz)}${m.pitchOctaveConfirmed ? ' ✓ octave-checked' : ' (unconfirmed)'}` : '—'),
    ...kv('Loudness match', m.loudnessMatchDbRelRef != null ? fmtDb(m.loudnessMatchDbRelRef) + ' rel ref' : '—'),
    ...kv('MML', m.mmlDbRelRef != null ? fmtDb(m.mmlDbRelRef) + ' rel ref' : '—'),
    ...kv('RI trials', m.ri.length ? `${m.ri.length} (best: ${best!.durationS.toFixed(0)} s, depth ${best!.depth})` : '—'),
  );

  const nextStep = !s.calibrated
    ? { label: 'Continue → Calibrate', go: 'calibrate' as const }
    : !m.pitchOctaveConfirmed
      ? { label: 'Continue → Pitch match', go: 'pitch' as const }
      : m.loudnessMatchDbRelRef == null
        ? { label: 'Continue → Loudness', go: 'loudness' as const }
        : m.mmlDbRelRef == null
          ? { label: 'Continue → MML', go: 'mml' as const }
          : { label: 'Continue → RI test', go: 'ri' as const };

  return card(
    'Active session',
    warnBox('Do not remove/reinsert the AirPods or touch iOS volume during this session — that invalidates calibration. If it happened, end this session and start a new one.'),
    grid,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: nextStep.label, onclick: () => app.go(nextStep.go) }),
      h('button', {
        class: 'btn danger',
        text: 'End session',
        onclick: () => {
          app.engine.stopAll();
          app.store.endSession();
          app.refresh();
        },
      }),
    ),
  );
}

function ratingAndSomaticCard(app: App, s: Session): HTMLElement {
  const save = (fn: (sess: Session) => void) => app.store.update(fn);

  const rating = h('input', {
    type: 'range', min: '0', max: '10', step: '1',
    value: String(s.subjectiveRating ?? 5),
  }) as HTMLInputElement;
  const ratingVal = h('span', { class: 'slider-val', text: String(s.subjectiveRating ?? '—') });
  rating.oninput = () => { ratingVal.textContent = rating.value; };
  rating.onchange = () => save((x) => { x.subjectiveRating = Number(rating.value); });

  const jaw = h('select', {},
    ...(['unsure', 'yes', 'no'] as const).map((v) =>
      h('option', { value: v, text: v, selected: (s.somatic.jawModulates ?? 'unsure') === v }),
    ),
  ) as HTMLSelectElement;
  jaw.onchange = () => save((x) => { x.somatic.jawModulates = jaw.value as Session['somatic']['jawModulates']; });

  const stress = h('input', { type: 'number', min: '0', max: '10', step: '1', value: s.somatic.stress != null ? String(s.somatic.stress) : '' }) as HTMLInputElement;
  stress.onchange = () => save((x) => { x.somatic.stress = stress.value === '' ? undefined : Number(stress.value); });

  const sleep = h('input', { type: 'number', min: '0', max: '14', step: '0.5', value: s.somatic.sleepHours != null ? String(s.somatic.sleepHours) : '' }) as HTMLInputElement;
  sleep.onchange = () => save((x) => { x.somatic.sleepHours = sleep.value === '' ? undefined : Number(sleep.value); });

  const notes = h('textarea', { placeholder: 'Jaw clench / neck modulation observations, bruxism, anything worth correlating later…' }) as HTMLTextAreaElement;
  notes.value = s.somatic.notes ?? '';
  notes.onchange = () => save((x) => { x.somatic.notes = notes.value || undefined; });

  return card(
    'Today: bother rating & somatic log',
    h('div', { class: 'slider-row' },
      h('div', { class: 'slider-head' },
        h('span', { class: 'slider-label', text: 'Tinnitus bother today (0 = none, 10 = worst)' }),
        ratingVal),
      rating),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: 'Jaw clench shifts pitch today?' }), jaw),
      h('div', { class: 'field' }, h('label', { text: 'Stress (0–10)' }), stress),
      h('div', { class: 'field' }, h('label', { text: 'Sleep last night (h)' }), sleep),
    ),
    h('div', { class: 'field' }, h('label', { text: 'Notes' }), notes),
  );
}

function startCard(app: App): HTMLElement {
  const hp = h('select', {},
    ...DEVICE_PROFILES.map((p) => h('option', { value: p.id, text: p.label })),
  ) as HTMLSelectElement;
  return card(
    'New session',
    note('One session = one continuous wear of the headphones at one locked iOS volume. Calibration, measurements and RI trials are only comparable within a session.'),
    h('div', { class: 'field' }, h('label', { text: 'Headphones' }), hp),
    h('button', {
      class: 'btn primary',
      text: 'Start session',
      onclick: () => {
        app.store.startSession(hp.value as Headphones);
        app.go('calibrate');
      },
    }),
  );
}

const LAST_EXPORT_KEY = 'tinnitus-lab-last-export';
const BACKUP_NUDGE_DAYS = 5;

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function backupNudge(app: App): HTMLElement | null {
  if (!app.store.data.sessions.length) return null;
  const last = Number(localStorage.getItem(LAST_EXPORT_KEY) ?? 0);
  const stale = Date.now() - last > BACKUP_NUDGE_DAYS * 24 * 3600e3;
  if (!stale) return null;
  return warnBox(
    isInstalled()
      ? `No backup in over ${BACKUP_NUDGE_DAYS} days. Tap "Back up JSON" below — on iPhone the share sheet's "Save to Files" puts it straight into iCloud Drive.`
      : `Your data lives in browser storage, and iOS DELETES it after ~7 days of not visiting unless the app is installed. Add to Home Screen (Safari share menu), then "Back up JSON" → Save to Files → iCloud Drive.`,
  );
}

function historyCard(app: App): HTMLElement {
  const past = [...app.store.data.sessions].reverse();
  const rows = past.map((s) => {
    const m = s.measurements;
    const best = bestRi(s);
    return h('tr', {},
      h('td', { text: new Date(s.startedAt).toLocaleDateString() }),
      h('td', { text: m.pitchMatchHz != null ? fmtHz(m.pitchMatchHz) + (m.pitchOctaveConfirmed ? ' ✓' : '') : '—' }),
      h('td', { text: m.loudnessMatchDbRelRef != null ? fmtDb(m.loudnessMatchDbRelRef) : '—' }),
      h('td', { text: m.mmlDbRelRef != null ? fmtDb(m.mmlDbRelRef) : '—' }),
      h('td', { text: best ? `${best.durationS.toFixed(0)} s / ${best.depth}` : '—' }),
      h('td', { text: s.subjectiveRating != null ? String(s.subjectiveRating) : '—' }),
    );
  });

  const importInput = h('input', { type: 'file', accept: 'application/json', style: 'display:none' }) as HTMLInputElement;
  importInput.onchange = async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    const text = await f.text();
    if (!window.confirm('Importing REPLACES all local data with the file contents. Continue?')) return;
    const res = app.store.importJson(text);
    if (!res.ok) window.alert(`Import failed: ${res.error}`);
    app.refresh();
  };

  const day = new Date().toISOString().slice(0, 10);
  return card(
    'History & data',
    rows.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {},
              h('th', { text: 'Date' }), h('th', { text: 'Pitch' }), h('th', { text: 'Loudness' }),
              h('th', { text: 'MML' }), h('th', { text: 'Best RI (s/depth)' }), h('th', { text: 'Bother' }))),
            h('tbody', {}, ...rows)))
      : note('No sessions yet.'),
    backupNudge(app),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn primary', text: 'Back up JSON',
        onclick: async () => {
          const done = await shareOrDownload(`tinnitus-${day}.json`, app.store.exportJson());
          if (done) {
            localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
            app.refresh();
          }
        },
      }),
      h('button', { class: 'btn', text: 'Export sessions CSV', onclick: () => void shareOrDownload(`tinnitus-sessions-${day}.csv`, app.store.csvSessions(), 'text/csv') }),
      h('button', { class: 'btn', text: 'Export RI trials CSV', onclick: () => void shareOrDownload(`tinnitus-ri-${day}.csv`, app.store.csvRiTrials(), 'text/csv') }),
      h('button', { class: 'btn', text: 'Import JSON…', onclick: () => importInput.click() }),
      importInput,
    ),
  );
}

export function renderHome(root: HTMLElement, app: App): void {
  root.replaceChildren();
  const s = app.store.current();
  if (s) {
    root.append(activeSessionCard(app, s), ratingAndSomaticCard(app, s));
  } else {
    root.append(
      gate('No active session. Everything is measured relative to a per-session calibration, so start one first.'),
      startCard(app),
    );
  }
  root.append(historyCard(app));
  root.append(card(
    'What this is',
    note('A personal measurement & self-experimentation tool: pitch/loudness/MML assessment, residual-inhibition testing, and a shaped-noise + 10 Hz AM therapeutic stimulus. It reduces distress and gives control; it is not a medical device and does not cure tinnitus. Loudness reduction is uncertain, especially at high frequencies.'),
  ));
}
