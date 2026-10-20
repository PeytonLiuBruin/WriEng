import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AudioModule from './study-audio';

class FakeParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn();
}
class FakeOscillator {
  frequency = new FakeParam();
  type = 'sine';
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

describe('quiet study operation cues', () => {
  let audio: typeof AudioModule;
  let contexts: FakeAudioContext[];
  let initialState: AudioContextState;
  let resumeResult: (() => Promise<void>) | undefined;

  class FakeAudioContext {
    state: AudioContextState = initialState;
    currentTime = 0;
    destination = {};
    oscillators: FakeOscillator[] = [];
    gains: FakeGain[] = [];
    constructor() { contexts.push(this); }
    createOscillator = vi.fn(() => { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator; });
    createGain = vi.fn(() => { const gain = new FakeGain(); this.gains.push(gain); return gain; });
    resume = vi.fn(() => resumeResult ? resumeResult() : Promise.resolve().then(() => { this.state = 'running'; }));
    close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.resetModules();
    contexts = [];
    initialState = 'running';
    resumeResult = undefined;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', undefined);
    audio = await import('./study-audio');
  });

  afterEach(() => {
    cleanup();
    audio.setStudySoundPreferences({ soundEnabled: false });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is silent on import, preference updates, unmute and volume changes', () => {
    expect(contexts).toHaveLength(0);
    audio.setStudySoundPreferences({ soundEnabled: true });
    audio.setStudySoundPreferences({ soundEnabled: false, soundVolume: 0.4 });
    audio.setStudySoundPreferences({ soundEnabled: true, soundVolume: 0.2 });
    vi.advanceTimersByTime(30_000);
    expect(contexts).toHaveLength(0);
  });

  it('creates short gently enveloped audio only for explicit play and defaults to volume .12', () => {
    audio.playStudySound('preview', { soundEnabled: true });
    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains[0].gain.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(0.18 * 0.12);
    expect(context.gains[0].gain.setValueAtTime.mock.calls[0][0]).toBe(0);
    const oscillator = context.oscillators[0];
    const start = oscillator.start.mock.calls[0][0];
    const stop = oscillator.stop.mock.calls[0][0];
    expect(stop - start).toBeLessThan(0.1);
    oscillator.onended?.();
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
    expect(context.gains[0].disconnect).toHaveBeenCalledOnce();
  });

  it('does not create audio while muted or at zero volume, and clamps excessive volume', () => {
    audio.playStudySound('skip', { soundEnabled: false, soundVolume: 1 });
    audio.playStudySound('skip', { soundEnabled: true, soundVolume: 0 });
    audio.playStudySound('back', { soundEnabled: true, soundVolume: -1 });
    expect(contexts).toHaveLength(0);
    audio.playStudySound('grade', { soundEnabled: true, soundVolume: 99 });
    const peak = contexts[0].gains[0].gain.linearRampToValueAtTime.mock.calls[0][0];
    expect(peak).toBe(0.18);
    audio.setStudySoundPreferences({ soundEnabled: false, soundVolume: 1 });
    expect(contexts[0].gains[0].gain.cancelScheduledValues).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('invalidates a pending resume when muted so no delayed cue starts', async () => {
    initialState = 'suspended';
    let grant: () => void = () => {};
    resumeResult = () => new Promise(resolve => { grant = resolve; });
    audio.playStudySound('submit', { soundEnabled: true, soundVolume: 0.12 });
    const context = contexts[0];
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.oscillators).toHaveLength(0);
    audio.setStudySoundPreferences({ soundEnabled: false, soundVolume: 0.12 });
    context.state = 'running';
    grant();
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(0);
    audio.setStudySoundPreferences({ soundEnabled: true, soundVolume: 0.12 });
    expect(context.resume).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(1);
  });

  it('rate-limits held keys and releases an existing cue before starting another', () => {
    audio.playStudySound('skip', { soundEnabled: true });
    const context = contexts[0];
    const first = context.oscillators[0];
    audio.playStudySound('skip', { soundEnabled: true });
    vi.advanceTimersByTime(60);
    audio.playStudySound('back', { soundEnabled: true });
    expect(context.oscillators).toHaveLength(1);
    expect(first.stop.mock.lastCall?.[0]).toBeCloseTo(0.008);
    vi.advanceTimersByTime(60);
    audio.playStudySound('back', { soundEnabled: true });
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[1].start.mock.calls[0][0]).toBeGreaterThanOrEqual(first.stop.mock.lastCall![0]);
    expect(contexts).toHaveLength(1);
  });

  it('stops on volume changes without creating or resuming audio and closes idle contexts', () => {
    audio.playStudySound('back', { soundEnabled: true });
    const context = contexts[0];
    audio.setStudySoundPreferences({ soundEnabled: true, soundVolume: 0.3 });
    expect(context.oscillators[0].stop).toHaveBeenCalledTimes(2);
    expect(context.resume).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    expect(context.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);
    expect(contexts).toHaveLength(1);
    audio.playStudySound('preview', { soundEnabled: true, soundVolume: 0.3 });
    expect(contexts).toHaveLength(2);
  });

  it('treats unavailable, blocked or broken audio as a silent optional enhancement', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => audio.playStudySound('skip', { soundEnabled: true })).not.toThrow();
    vi.advanceTimersByTime(120);
    vi.stubGlobal('AudioContext', class { constructor() { throw new DOMException('Blocked', 'NotAllowedError'); } });
    expect(() => audio.playStudySound('skip', { soundEnabled: true })).not.toThrow();
    vi.advanceTimersByTime(120);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    initialState = 'suspended';
    resumeResult = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
    audio.playStudySound('preview', { soundEnabled: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(contexts[0].oscillators).toHaveLength(0);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120);
    initialState = 'running';
    resumeResult = undefined;
    audio.playStudySound('skip', { soundEnabled: true });
    const context = contexts[1];
    context.createOscillator.mockImplementation(() => { throw new Error('Unavailable device'); });
    vi.advanceTimersByTime(120);
    expect(() => audio.playStudySound('back', { soundEnabled: true })).not.toThrow();
  });

  it('offers accessible mute and volume controls without playing on settings changes', async () => {
    const { SoundSettings } = await import('./SoundSettings');
    const onChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(createElement(SoundSettings, { settings: { soundEnabled: true, soundVolume: 0.12 }, onChange }));
    expect(screen.getByRole('slider', { name: /音效音量/ }).getAttribute('aria-valuetext')).toBe('12%');
    expect(contexts).toHaveLength(0);
    await act(async () => fireEvent.change(screen.getByTestId('sound-volume'), { target: { value: '35' } }));
    expect(onChange).toHaveBeenLastCalledWith({ soundVolume: 0.35 });
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: '静音' })));
    expect(onChange).toHaveBeenLastCalledWith({ soundEnabled: false });
    expect(contexts).toHaveLength(0);
    rerender(createElement(SoundSettings, { settings: { soundEnabled: false, soundVolume: 0.35 }, onChange }));
    expect((screen.getByTestId('sound-preview') as HTMLButtonElement).disabled).toBe(true);
    rerender(createElement(SoundSettings, { settings: { soundEnabled: true, soundVolume: 0.35 }, onChange }));
    fireEvent.click(screen.getByTestId('sound-preview'));
    expect(contexts).toHaveLength(1);
    expect(contexts[0].gains[0].gain.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(0.18 * 0.35);
  });
});
