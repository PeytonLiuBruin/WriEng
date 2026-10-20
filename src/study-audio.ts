export type StudySoundKind = 'skip' | 'back' | 'submit' | 'grade' | 'preview';
export interface StudySoundPreferences { soundEnabled: boolean; soundVolume?: number }

const DEFAULT_VOLUME = 0.12;
const MAX_GAIN = 0.18;
const COOLDOWN_MS = 120;
const IDLE_CLOSE_MS = 15_000;
const tones: Record<StudySoundKind, { start: number; end: number; duration: number }> = {
  skip: { start: 980, end: 800, duration: 0.055 },
  back: { start: 740, end: 880, duration: 0.055 },
  submit: { start: 1260, end: 1450, duration: 0.075 },
  grade: { start: 1480, end: 1650, duration: 0.085 },
  preview: { start: 1120, end: 1340, duration: 0.075 },
};

interface Cue { context: AudioContext; oscillator: OscillatorNode; gain: GainNode }
let preferences = { soundEnabled: true, soundVolume: DEFAULT_VOLUME };
let audioContext: AudioContext | null = null;
let activeCue: Cue | null = null;
let generation = 0;
let lastRequestAt = -Infinity;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function normalize(value: StudySoundPreferences) {
  const volume = typeof value.soundVolume === 'number' && Number.isFinite(value.soundVolume) ? value.soundVolume : DEFAULT_VOLUME;
  return { soundEnabled: value.soundEnabled === true, soundVolume: Math.max(0, Math.min(1, volume)) };
}

function clearIdleTimer() {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
}

function stopActiveCue() {
  const cue = activeCue;
  activeCue = null;
  if (!cue) return;
  try {
    const now = cue.context.currentTime;
    cue.gain.gain.cancelScheduledValues(now);
    cue.gain.gain.setTargetAtTime(0, now, 0.002);
    cue.oscillator.stop(now + 0.008);
  } catch { /* A closed or already-ended audio node is already silent. */ }
}

function closeContext(context: AudioContext) {
  if (audioContext === context) audioContext = null;
  clearIdleTimer();
  try { void context.close().catch(() => {}); } catch { /* Unsupported/closed context. */ }
}

function closeWhenIdle(context: AudioContext) {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (audioContext === context) {
      generation++;
      stopActiveCue();
      closeContext(context);
    }
  }, IDLE_CLOSE_MS);
}

/** Silent preference update, including at mount: never creates or resumes an AudioContext. */
export function setStudySoundPreferences(value: StudySoundPreferences): void {
  const next = normalize(value);
  if (next.soundEnabled === preferences.soundEnabled && next.soundVolume === preferences.soundVolume) return;
  preferences = next;
  generation++;
  stopActiveCue();
  if (!next.soundEnabled || next.soundVolume === 0) {
    if (audioContext) closeContext(audioContext);
    lastRequestAt = -Infinity;
  } else if (audioContext) closeWhenIdle(audioContext);
}

export function stopStudySound(): void {
  generation++;
  stopActiveCue();
  if (audioContext) closeWhenIdle(audioContext);
}

function synthesize(context: AudioContext, kind: StudySoundKind, request: number) {
  if (request !== generation || context !== audioContext || context.state !== 'running' || !preferences.soundEnabled || preferences.soundVolume === 0) return;
  let oscillator: OscillatorNode | undefined;
  let gain: GainNode | undefined;
  try {
    const tone = tones[kind];
    // Leave the previous cue's release envelope room to finish before the new note starts.
    const start = context.currentTime + 0.008;
    const end = start + tone.duration;
    oscillator = context.createOscillator();
    gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(tone.start, start);
    oscillator.frequency.exponentialRampToValueAtTime(tone.end, end);
    const peak = MAX_GAIN * preferences.soundVolume;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(Math.min(0.0001, peak / 10), end);
    gain.gain.setValueAtTime(0, end + 0.003);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const cue: Cue = { context, oscillator, gain };
    activeCue = cue;
    oscillator.onended = () => {
      if (activeCue === cue) activeCue = null;
      try { cue.oscillator.disconnect(); cue.gain.disconnect(); } catch { /* Already disconnected. */ }
    };
    oscillator.start(start);
    oscillator.stop(end + 0.005);
  } catch {
    try { oscillator?.disconnect(); gain?.disconnect(); } catch { /* Audio is an optional enhancement. */ }
    activeCue = null;
  }
  closeWhenIdle(context);
}

/** Call only from a user's click/key handler. Skip/back tones acknowledge navigation, never correctness. */
export function playStudySound(kind: StudySoundKind, value: StudySoundPreferences): void {
  setStudySoundPreferences(value);
  stopStudySound();
  if (!preferences.soundEnabled || preferences.soundVolume === 0) return;
  const now = Date.now();
  if (now - lastRequestAt < COOLDOWN_MS) return;
  lastRequestAt = now;
  const request = generation;
  try {
    if (!audioContext || audioContext.state === 'closed') {
      const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Context = browser.AudioContext ?? browser.webkitAudioContext;
      if (!Context) return;
      audioContext = new Context({ latencyHint: 'interactive' });
    }
    const context = audioContext;
    closeWhenIdle(context);
    if (context.state === 'running') synthesize(context, kind, request);
    else {
      // Resume is confined to this explicit interaction; muted/stale requests cannot play later.
      void context.resume().then(() => synthesize(context, kind, request)).catch(() => {
        if (context === audioContext && request === generation) closeContext(context);
      });
    }
  } catch {
    if (audioContext) closeContext(audioContext);
  }
}
