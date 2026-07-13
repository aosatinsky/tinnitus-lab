// Device profiles: qualitative, per-model guidance and defaults. These never
// substitute for the per-session calibration (reference level + HF sweep) —
// AirPods have no fixed frequency response (Adaptive EQ, volume-dependent EQ,
// seal dependence), so profiles only tune checklists, hints and expectations.

import type { Headphones } from './store';

export interface DeviceProfile {
  id: Headphones;
  label: string;
  kind: 'in_ear' | 'over_ear';
  /** Rough upper bound a good seal typically reaches — a hint for the sweep, not truth. */
  typicalRolloffHz: number;
  /** Extra items appended to the calibration checklist. */
  checklistExtras: string[];
  /** Shown as a note during calibration. */
  notes: string[];
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    id: 'airpods_pro_3',
    label: 'AirPods Pro 3',
    kind: 'in_ear',
    typicalRolloffHz: 15000,
    checklistExtras: [
      'Foam-infused tips seated well (run Ear Tip Fit Test if unsure) — HF response lives and dies by the seal. Use the same tips every session.',
    ],
    notes: [
      'Pro 3 measures with extra treble energy around 10–14 kHz vs Pro 2, so high-frequency tones may sound sharper than expected — trust the octave check, not the timbre.',
      'Adaptive EQ cannot be fully disabled on Pro 3; keeping iOS volume locked at ~50% keeps its volume-dependent behavior constant within the session.',
    ],
  },
  {
    id: 'airpods_max_2',
    label: 'AirPods Max 2',
    kind: 'over_ear',
    typicalRolloffHz: 15000,
    checklistExtras: [
      'Strongly consider the USB-C cable: AirPods Max 2 does 24-bit/48 kHz lossless wired, which removes Bluetooth AAC compression from the chain entirely.',
      'Check the earcup seal — hair and glasses change over-ear HF response. Same placement every session.',
    ],
    notes: [
      'Max 2 is more placement-consistent than gen 1 (especially below ~3 kHz), but per-session sweep still applies.',
      'If using the USB-C cable, note it in the session log — wired vs Bluetooth sessions are not directly comparable.',
    ],
  },
  {
    id: 'airpods_pro',
    label: 'AirPods Pro (1st/2nd gen)',
    kind: 'in_ear',
    typicalRolloffHz: 13000,
    checklistExtras: [
      'Ear tips seated with a good seal; same tips every session.',
    ],
    notes: [],
  },
  {
    id: 'airpods_max',
    label: 'AirPods Max (1st gen)',
    kind: 'over_ear',
    typicalRolloffHz: 14000,
    checklistExtras: [
      'Check the earcup seal — hair and glasses change over-ear HF response.',
    ],
    notes: [],
  },
  {
    id: 'other',
    label: 'Other headphones',
    kind: 'over_ear',
    typicalRolloffHz: 12000,
    checklistExtras: [],
    notes: ['Unknown device: rely entirely on the per-session sweep for HF limits.'],
  },
];

export function profileFor(id: Headphones): DeviceProfile {
  return DEVICE_PROFILES.find((p) => p.id === id) ?? DEVICE_PROFILES[DEVICE_PROFILES.length - 1];
}
