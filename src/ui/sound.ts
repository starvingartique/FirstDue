// Game feedback sounds, implemented from scratch Nov 3. Tiny WebAudio
// blips, no assets: a soft click for buttons, a done chime when an action
// completes, a low alert for traps and arrest. Two gains, master and
// alerts, driven live by the settings menu. Everything is guarded: no
// AudioContext, blocked autoplay, or headless run ever throws or logs.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let alertsGain: GainNode | null = null;
let masterLevel = 0.6;
let alertsLevel = 0.8;

function ensureCtx(): AudioContext | null {
  try {
    if (ctx !== null) {
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    }
    const ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (ctor === undefined) return null;
    ctx = new ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterLevel;
    alertsGain = ctx.createGain();
    alertsGain.gain.value = alertsLevel;
    masterGain.connect(ctx.destination);
    alertsGain.connect(masterGain);
    return ctx;
  } catch {
    return null;
  }
}

/** Live gain levels, 0 to 1. Applied to the running context at once. */
export function setSoundLevels(master: number, alerts: number): void {
  masterLevel = Math.min(1, Math.max(0, master));
  alertsLevel = Math.min(1, Math.max(0, alerts));
  try {
    if (masterGain !== null) masterGain.gain.value = masterLevel;
    if (alertsGain !== null) alertsGain.gain.value = alertsLevel;
  } catch {
    // Audio unavailable: settings still persist, sound stays silent.
  }
}

function blip(dest: GainNode | null, freqHz: number, durMs: number, whenMs: number, type: OscillatorType): void {
  const ac = ensureCtx();
  if (ac === null || dest === null) return;
  try {
    const t0 = ac.currentTime + whenMs / 1000;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.value = freqHz;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(env);
    env.connect(dest);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {
    // Never let a blip break the game.
  }
}

/** Soft UI click. Master gain only. */
export function playClick(): void {
  if (masterLevel <= 0) return;
  blip(masterGain, 660, 60, 0, "sine");
}

/** Action completed. Master gain only. */
export function playDone(): void {
  if (masterLevel <= 0) return;
  blip(masterGain, 520, 90, 0, "sine");
  blip(masterGain, 780, 120, 90, "sine");
}

/** Trap sprung or arrest. Alerts gain under master. */
export function playAlert(): void {
  if (masterLevel <= 0 || alertsLevel <= 0) return;
  blip(alertsGain, 196, 220, 0, "triangle");
  blip(alertsGain, 147, 260, 200, "triangle");
}

/** One delegated listener: every button press clicks softly. */
export function initClickSounds(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("button") !== null) {
        playClick();
      }
    },
    { passive: true }
  );
}
