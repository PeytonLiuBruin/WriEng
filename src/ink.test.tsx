import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InkPad, hasMeaningfulInk } from './InkPad';
import { Pronunciation, selectEnglishVoice } from './Pronunciation';

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const createURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  if (createURLDescriptor) Object.defineProperty(URL, 'createObjectURL', createURLDescriptor);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (revokeURLDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeURLDescriptor);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('handwriting is an input signal, never a recognition score', () => {
  let context: Record<string, ReturnType<typeof vi.fn> | string | number>;
  let width: number;
  let resized: (() => void) | undefined;

  beforeEach(() => {
    width = 600;
    context = Object.fromEntries(['setTransform', 'clearRect', 'beginPath', 'moveTo', 'arc', 'fill', 'quadraticCurveTo', 'lineTo', 'stroke'].map(key => [key, vi.fn()]));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0, top: 0, right: width, bottom: 220, width, height: 220, x: 0, y: 0, toJSON: () => ({}),
    }));
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() { /* The test controls resizing. */ }
      disconnect() { /* No native observer. */ }
    });
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerId: number;
      pointerType: string;
      pressure: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'pen';
        this.pressure = init.pressure ?? 0.5;
      }
    });
  });

  function stroke(canvas: HTMLElement, from = 10, to = 120) {
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: from, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: to, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to, clientY: 60 });
  }

  it('rejects empty, single-point, stationary, and very short input', () => {
    expect(hasMeaningfulInk([])).toBe(false);
    expect(hasMeaningfulInk([[{ x: 0.2, y: 0.2 }]])).toBe(false);
    expect(hasMeaningfulInk([[{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }]])).toBe(false);
    expect(hasMeaningfulInk([[{ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.2 }]])).toBe(false);
    expect(hasMeaningfulInk([[{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.2 }]])).toBe(true);
  });

  it('reports real strokes, and undo/clear restore a blank input', () => {
    const onChange = vi.fn();
    render(<InkPad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: '手写回忆区' });
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.getByText('再写完整一点')).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(false);
    stroke(canvas);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '撤销一笔' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    stroke(canvas);
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText('还没有笔迹')).toBeTruthy();
  });

  it('retains normalized strokes when the canvas width and DPR change', () => {
    const onChange = vi.fn();
    render(<InkPad onChange={onChange} />);
    const canvas = screen.getByRole('img') as HTMLCanvasElement;
    stroke(canvas);
    expect(canvas.width).toBe(1200);
    width = 300;
    resized?.();
    expect(canvas.width).toBe(600);
    const lineTo = context.lineTo as ReturnType<typeof vi.fn>;
    expect(lineTo.mock.lastCall?.[0]).toBeCloseTo(60);
    expect(lineTo.mock.lastCall?.[1]).toBeCloseTo(60);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('ignores disabled input and additional pointers', () => {
    const onChange = vi.fn();
    const { rerender } = render(<InkPad onChange={onChange} disabled />);
    const canvas = screen.getByRole('img');
    stroke(canvas);
    expect(onChange).toHaveBeenLastCalledWith(false);
    rerender(<InkPad onChange={onChange} />);
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 400, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, default: false, localService: true };
}

function installSpeech(voices = [voice('Test US', 'en-US')]) {
  const synth = { getVoices: vi.fn(() => voices), cancel: vi.fn(), speak: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    constructor(text: string) { this.text = text; }
  });
  return synth;
}

describe('honest device pronunciation and local-only self comparison', () => {
  it('prefers an American voice and only falls back to an English voice', () => {
    const british = voice('UK', 'en-GB');
    const american = voice('US', 'en_US');
    expect(selectEnglishVoice([voice('Chinese', 'zh-CN'), british, american])).toBe(american);
    expect(selectEnglishVoice([british])).toBe(british);
    expect(selectEnglishVoice([voice('Chinese', 'zh-CN')])).toBeUndefined();
  });

  it('uses en-US, lower speed, actual example text, and cancels repeated playback', () => {
    const synth = installSpeech();
    render(<Pronunciation word="parcel" ipa="/ˈpɑrsəl/" example="The parcel arrived." />);
    fireEvent.click(screen.getByRole('button', { name: '整词慢速播放' }));
    expect(synth.speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'parcel', lang: 'en-US', rate: 0.65, voice: expect.objectContaining({ lang: 'en-US' }) }));
    fireEvent.click(screen.getByRole('button', { name: '听例句' }));
    expect(synth.speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'The parcel arrived.', rate: 0.95 }));
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '停止朗读' }));
    expect(synth.cancel).toHaveBeenCalledTimes(3);
  });

  it('announces when American voice is unavailable and refreshes on voiceschanged', () => {
    const synth = installSpeech([voice('UK', 'en-GB')]);
    render(<Pronunciation word="parcel" ipa="/ˈpɑrsəl/" />);
    expect(screen.getByText(/设备暂无美式音色/)).toBeTruthy();
    expect(synth.addEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
    synth.getVoices.mockReturnValue([voice('New US', 'en-US')]);
    const refresh = synth.addEventListener.mock.calls[0][1] as () => void;
    act(() => refresh());
    expect(screen.getByText('美式英语 · New US')).toBeTruthy();
  });

  it('requests microphone only on explicit start and explains denied permission', async () => {
    installSpeech();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', class {});
    render(<Pronunciation word="parcel" ipa="/ˈpɑrsəl/" />);
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('录下自己，听听差别'));
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('麦克风权限未获允许'));
    expect((screen.getByRole('button', { name: '开始录音' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates local playback, stops the microphone, and revokes a deleted recording', async () => {
    installSpeech();
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    const createObjectURL = vi.fn().mockReturnValue('blob:local-recording');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['sample']) }); this.onstop?.(); }
    });
    render(<Pronunciation word="parcel" ipa="/ˈpɑrsəl/" />);
    fireEvent.click(screen.getByText('录下自己，听听差别'));
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /停止录音/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /停止录音/ }));
    expect(stop).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(screen.getByLabelText('播放我的录音').getAttribute('src')).toBe('blob:local-recording');
    fireEvent.click(screen.getByRole('button', { name: '删除录音' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-recording');
    expect(screen.queryByLabelText('播放我的录音')).toBeNull();
  });

  it('releases a late microphone grant after the user has changed words', async () => {
    installSpeech();
    let grant: (stream: { getTracks: () => { stop: () => void }[] }) => void = () => {};
    const getUserMedia = vi.fn().mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const recorderConstructor = vi.fn();
    vi.stubGlobal('MediaRecorder', class { constructor() { recorderConstructor(); } });
    const { rerender } = render(<Pronunciation word="parcel" ipa="/ˈpɑrsəl/" />);
    fireEvent.click(screen.getByText('录下自己，听听差别'));
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    rerender(<Pronunciation word="postage" ipa="/ˈpoʊstɪdʒ/" />);
    const stop = vi.fn();
    await act(async () => grant({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recorderConstructor).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '开始录音' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
