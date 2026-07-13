import type { AudioEngine, Voice } from '../audio/engine';
import type { Ear, Store } from '../data/store';

export type ScreenId =
  | 'home'
  | 'calibrate'
  | 'pitch'
  | 'loudness'
  | 'mml'
  | 'ri'
  | 'optimizer'
  | 'therapy'
  | 'trends';

export interface App {
  engine: AudioEngine;
  store: Store;
  go(id: ScreenId): void;
  /** Re-render the current screen. Audio stops unless keepAudio is set
   *  (used when a re-render must not kill a running timed stimulus). */
  refresh(opts?: { keepAudio?: boolean }): void;
  setCleanup(fn: (() => void) | null): void;
}

type Attrs = Record<string, unknown>;
type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      (e as unknown as Record<string, unknown>)[k] = v;
    } else if (v === true) {
      (e as unknown as Record<string, unknown>)[k] = true;
    } else {
      e.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c !== null && c !== undefined && c !== false) e.append(c);
  }
  return e;
}

export function card(title: string | null, ...children: Child[]): HTMLElement {
  return h('div', { class: 'card' }, title ? h('h2', { text: title }) : null, ...children);
}

export function note(text: string): HTMLElement {
  return h('p', { class: 'note', text });
}

export function warnBox(text: string): HTMLElement {
  return h('div', { class: 'warn-box', text });
}

export function okBox(text: string): HTMLElement {
  return h('div', { class: 'ok-box', text });
}

export function gate(msg: string, actionLabel?: string, action?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'gate' },
    h('div', { text: msg }),
    actionLabel && action ? h('button', { class: 'btn primary', text: actionLabel, onclick: action }) : null,
  );
}

export function fmtHz(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`;
}

export function fmtDb(db: number): string {
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function download(name: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * On iOS, opens the share sheet with the data as a file — "Save to Files"
 * puts it straight into iCloud Drive. Falls back to a plain download where
 * file sharing isn't supported (desktop). Resolves true if the data left the
 * app (shared or downloaded), false if the user cancelled the share sheet.
 */
export async function shareOrDownload(
  name: string,
  text: string,
  mime = 'application/json',
): Promise<boolean> {
  const file = new File([text], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false; // user cancelled
      // any other share failure → fall through to download
    }
  }
  download(name, text, mime);
  return true;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (v: number) => string;
  onInput?: (v: number) => void;
}

export interface SliderHandle {
  root: HTMLElement;
  get(): number;
  set(v: number): void;
}

export function slider(o: SliderOpts): SliderHandle {
  const fmt = o.format ?? ((v: number) => v.toFixed(1));
  const val = h('span', { class: 'slider-val', text: fmt(o.value) });
  const input = h('input', {
    type: 'range',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step ?? 0.5),
    value: String(o.value),
  }) as HTMLInputElement;
  input.oninput = () => {
    const v = Number(input.value);
    val.textContent = fmt(v);
    o.onInput?.(v);
  };
  const root = h(
    'div',
    { class: 'slider-row' },
    h('div', { class: 'slider-head' }, h('span', { class: 'slider-label', text: o.label }), val),
    input,
  );
  return {
    root,
    get: () => Number(input.value),
    set: (v: number) => {
      input.value = String(v);
      val.textContent = fmt(v);
    },
  };
}

/** Play/stop toggle bound to a voice factory. */
export class Toggle {
  root: HTMLButtonElement;
  private voice: Voice | null = null;

  constructor(
    private labelPlay: string,
    private make: () => Voice,
    private labelStop = 'Stop',
  ) {
    this.root = h('button', {
      class: 'btn primary',
      text: labelPlay,
      onclick: () => this.toggle(),
    }) as HTMLButtonElement;
  }

  get playing(): boolean {
    return !!this.voice?.active;
  }

  get voiceRef(): Voice | null {
    return this.voice?.active ? this.voice : null;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.start();
  }

  start(): void {
    this.voice = this.make();
    this.root.textContent = this.labelStop;
    this.root.classList.add('active');
  }

  stop(): void {
    this.voice?.stop();
    this.voice = null;
    this.root.textContent = this.labelPlay;
    this.root.classList.remove('active');
  }
}

/** L / Both / R segmented control. Tinnitus is often lateralized — measuring per ear matters. */
export function earSelector(value: Ear, onChange: (e: Ear) => void): HTMLElement {
  const btns = new Map<Ear, HTMLButtonElement>();
  const set = (e: Ear) => {
    for (const [k, b] of btns) b.classList.toggle('active', k === e);
    onChange(e);
  };
  for (const e of ['left', 'both', 'right'] as Ear[]) {
    btns.set(e, h('button', {
      class: `btn${e === value ? ' active' : ''}`,
      text: e === 'left' ? 'Left ear' : e === 'right' ? 'Right ear' : 'Both',
      onclick: () => set(e),
    }) as HTMLButtonElement);
  }
  return h('div', { class: 'btn-row' }, ...btns.values());
}

/** Button that plays a short (default 1 s) stimulus, stopping anything else. */
export function pulseButton(label: string, app: App, make: () => Voice, ms = 1000): HTMLButtonElement {
  let voice: Voice | null = null;
  let timer = 0;
  const b = h('button', { class: 'btn', text: label }) as HTMLButtonElement;
  b.onclick = () => {
    app.engine.stopAll();
    window.clearTimeout(timer);
    voice = make();
    b.classList.add('active');
    timer = window.setTimeout(() => {
      voice?.stop();
      b.classList.remove('active');
    }, ms);
  };
  return b;
}
