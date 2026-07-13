// Tiny dependency-free SVG charts for longitudinal views.

import { h, note } from './components';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  label: string;
  color: string;
  points: ChartPoint[];
  line?: boolean;
}

export interface ChartOpts {
  series: ChartSeries[];
  yFmt?: (v: number) => string;
  xFmt?: (v: number) => string;
  height?: number;
  yMin?: number;
  yMax?: number;
}

export function chart(opts: ChartOpts): HTMLElement {
  const all = opts.series.flatMap((s) => s.points);
  if (!all.length) return note('No data yet.');

  const W = 640;
  const H = opts.height ?? 220;
  const P = { l: 52, r: 12, t: 12, b: 26 };
  const yFmt = opts.yFmt ?? ((v: number) => v.toFixed(1));
  const xFmt = opts.xFmt ?? ((v: number) => String(Math.round(v)));

  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  let yMin = opts.yMin ?? Math.min(...all.map((p) => p.y));
  let yMax = opts.yMax ?? Math.max(...all.map((p) => p.y));
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const pad = (yMax - yMin) * 0.06;
  if (opts.yMin == null) yMin -= pad;
  if (opts.yMax == null) yMax += pad;

  const sx = (x: number) => xMax === xMin
    ? (P.l + (W - P.l - P.r) / 2)
    : P.l + ((x - xMin) / (xMax - xMin)) * (W - P.l - P.r);
  const sy = (y: number) => H - P.b - ((y - yMin) / (yMax - yMin)) * (H - P.t - P.b);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto;display:block' });

  // gridlines + y tick labels (min / mid / max)
  for (const v of [yMin, (yMin + yMax) / 2, yMax]) {
    svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: sy(v), y2: sy(v), stroke: '#2c3542', 'stroke-width': 1 }));
    const t = svgEl('text', { x: P.l - 6, y: sy(v) + 4, 'text-anchor': 'end', fill: '#8b96a5', 'font-size': 11 });
    t.textContent = yFmt(v);
    svg.append(t);
  }
  // x labels (min / max)
  for (const v of xMax === xMin ? [xMin] : [xMin, xMax]) {
    const t = svgEl('text', { x: sx(v), y: H - 8, 'text-anchor': 'middle', fill: '#8b96a5', 'font-size': 11 });
    t.textContent = xFmt(v);
    svg.append(t);
  }

  for (const s of opts.series) {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (s.line !== false && pts.length > 1) {
      svg.append(svgEl('polyline', {
        points: pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' '),
        fill: 'none',
        stroke: s.color,
        'stroke-width': 1.5,
        opacity: 0.75,
      }));
    }
    for (const p of pts) {
      svg.append(svgEl('circle', { cx: sx(p.x).toFixed(1), cy: sy(p.y).toFixed(1), r: 3.5, fill: s.color }));
    }
  }

  const legend = h('div', { class: 'btn-row small' },
    ...opts.series.map((s) =>
      h('span', { class: 'muted' },
        h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:5px;background:${s.color};margin-right:5px` }),
        s.label,
      )),
  );

  const wrap = h('div', {});
  wrap.append(svg, legend);
  return wrap;
}
