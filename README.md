# Tinnitus Lab

Personal, single-user tinnitus assessment & self-experimentation tool.
Client-side only — no backend, no analytics, no PII. All data lives in
`localStorage` on the device and is exportable as JSON/CSV.

**Not a medical device. No treatment claims.** It measures (pitch, loudness,
MML, residual inhibition), personalizes a therapeutic stimulus, and gives
control — it does not cure tinnitus.

## Run it

```bash
npm install
npm run dev            # local
npm run dev -- --host  # open on the iPhone over LAN (http://<mac-ip>:5173)
npm run build          # static bundle in dist/ — host anywhere (GitHub Pages, etc.)
```

Best used on the iPhone with AirPods Pro/Max. **Install it to the Home Screen**
(Safari share menu → Add to Home Screen): the app is a PWA with a service
worker, so once installed it works offline — and, critically, installation
exempts its storage from iOS's ~7-day browser-data eviction. The Session
screen nags about JSON backups if you haven't exported in 5 days; on iPhone
the "Back up JSON" button opens the share sheet, where **Save to Files →
iCloud Drive** is the intended one-tap backup path (there is no programmatic
iCloud API for web apps — this is the honest equivalent).

A screen wake lock is held automatically during RI trials and therapy
playback (iOS suspends Web Audio when the screen locks).

## Session protocol (why the app nags you)

AirPods make absolute SPL unknowable: Adaptive EQ, volume-dependent EQ curves,
lossy Bluetooth, seal-dependent HF response. So the design only ever uses
**relative, within-session comparisons at a fixed system volume**:

1. Set iOS volume to ~50% and don't touch it again. All level changes happen
   through internal Web Audio gain.
2. Fixed Noise Control mode (not Adaptive/Transparency), Headphone
   Accommodations and custom EQ off.
3. One continuous wear = one session. Removing/reinserting the buds changes
   the seal → end the session and start a new one.
4. Calibration anchors everything to a user-set comfortable 1 kHz reference
   ("dB rel ref"), plus a comfort ceiling and a same-day HF-rolloff estimate
   (8→16 kHz sweep).

Measurement flow per session: **Calibrate → Pitch match (2AFC + fine adjust +
mandatory octave-confusion check) → Loudness match → MML → RI trials (2–4 max,
washout enforced) → optional therapy listening**. Repeat across sessions and
average; a single pitch match can be an octave off even on good hardware.

Three methodological upgrades are wired in:

- **Per-ear testing.** Every stimulus (pitch, loudness, MML, RI, optimizer,
  therapy) can target left, right, or both ears (StereoPanner). Tinnitus from
  acoustic trauma is usually lateralized; the ear used is stored with each
  measurement and exported in the CSVs.
- **Consensus pitch.** Downstream modules (loudness, MML, RI, optimizer,
  therapy defaults) use the median log-frequency of *all* octave-confirmed
  matches across sessions, not the current session's single noisy match.
- **Reliability anchors.** Every 5th post-seed optimizer trial exactly
  repeats the best stimulus so far. Repeat-pairs give an empirical estimate
  of trial-to-trial noise, which feeds the GP's noise parameter instead of a
  guessed constant.

## Safety rails (wired in, not optional)

- Master gain hard cap + DynamicsCompressor limiter on the whole output.
- Every start/stop fades (≥80 ms); therapy ramps in over 1.5 s.
- User-set comfort ceiling clamps every stimulus, everywhere.
- Therapy session timer: break prompt at 30 min, forced stop at 60 min.
- RI stimulus level = MML + 10 dB, clamped to the ceiling.
- Bedtime mode: optional sleep timer fades therapy to silence over 10–45 min
  and stops (no break nagging in that mode; keep the screen on, dimmed).
- Comfort-ceiling trend chart on Trends — a session-over-session
  sound-tolerance (hyperacusis) proxy.

## Device profiles

Session setup knows the actual hardware (AirPods Pro 3, AirPods Max 2, older
Pro/Max, other) and adjusts the calibration checklist and hints:

- **AirPods Pro 3** — foam-infused tips make the seal dominate HF response
  (Ear Tip Fit Test reminder); extra treble energy ~10–14 kHz vs Pro 2, so
  HF tones sound sharper than expected; Adaptive EQ can't be fully disabled,
  so the locked-volume rule matters even more.
- **AirPods Max 2** — supports **24-bit/48 kHz lossless over USB-C**: wired
  sessions remove Bluetooth AAC from the chain entirely (recommended; log
  wired vs BT, they're not comparable). Placement-consistency improved vs
  gen 1, but the per-session sweep still rules.

Profiles are qualitative only — they never substitute for the per-session
reference + sweep, because none of these devices has a fixed response.

## Stage 3 — Bayesian optimizer (built)

`Optimizer` tab: GP regression (RBF-ARD kernel, explicit observation noise,
from-scratch Cholesky — no deps) + expected-improvement acquisition over
stimulus **shape**: `{center offset ±½ oct, AM rate 2–40 Hz (log), AM depth,
bandwidth ⅙–1 oct}`. Level is held fixed at MML+10 (ceiling-capped) so it
can't "win" by being louder. First 5 trials are a space-filling seed design
whose first point is the literature prior (10 Hz AM, ⅓-oct band on the
pitch). Objective = normalized RI duration × depth. Observations persist in
`optimizerState` across sessions; trials share the same washout gate and
hold-button protocol as manual RI trials. After enough data it emits a
posterior-mean recommendation you can save as a therapy preset.

Caveat by design: only a few trials per session (washout is real); expect
~20–30 trials over days before trusting the recommendation.

## Layout

- `src/audio/engine.ts` — Web Audio graph: tones, sweeps, white/pink noise,
  narrowband (bandpass²) and shaped (HP+LP+peaking) stimuli, ~10 Hz AM LFO
  stage, cap + limiter, fades, relative-level mapping.
- `src/data/store.ts` — versioned schema (v1, localStorage), sessions,
  RI trials, presets, optimizer observations, JSON export/import, CSV dumps.
- `src/data/devices.ts` — headphone profiles (checklist extras, rolloff hints).
- `src/optimizer/` — GP (`gp.ts`) + search space/acquisition (`space.ts`).
- `src/ui/trialRunner.ts` — shared stimulus→hold→rate RI protocol.
- `src/ui/screens/` — session home & somatic log, calibration wizard,
  pitch/loudness/MML, RI test, optimizer, therapy generator, trends.
- `src/ui/charts.ts` + `screens/trends.ts` — dependency-free SVG charts:
  RI over trials, pitch/loudness/MML stability, bother & stress over time.

## Possible later

- IndexedDB migration if localStorage gets tight (schema is already
  versioned; the JSON export is the real backup either way).
- Notched-noise A/B experiment (secondary, explicitly not the primary).
