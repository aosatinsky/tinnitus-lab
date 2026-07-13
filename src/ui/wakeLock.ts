// Screen wake lock: iOS suspends Web Audio when the screen locks, which would
// cut RI trials and therapy sessions short. Requested while sound-critical
// work runs, re-acquired on tab re-focus, released when done.

let wanted = false;
let sentinel: WakeLockSentinel | null = null;

async function request(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // denied (low battery / not visible) — nothing to do
  }
}

export function setWakeLock(on: boolean): void {
  wanted = on;
  if (on && !sentinel) void request();
  if (!on && sentinel) {
    sentinel.release().catch(() => {});
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible' && !sentinel) void request();
});
