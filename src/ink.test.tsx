import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InkPad, hasMeaningfulInk } from './InkPad';
import { Pronunciation, selectEnglishVoice } from './Pronunciation';

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const createURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');

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
  if (fullscreenElementDescriptor) Object.defineProperty(document, 'fullscreenElement', fullscreenElementDescriptor);
  else Reflect.deleteProperty(document, 'fullscreenElement');
  if (requestFullscreenDescriptor) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', requestFullscreenDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  if (exitFullscreenDescriptor) Object.defineProperty(document, 'exitFullscreen', exitFullscreenDescriptor);
  else Reflect.deleteProperty(document, 'exitFullscreen');
});

describe('handwriting is an input signal, never a recognition score', () => {
  let context: Record<string, ReturnType<typeof vi.fn> | string | number>;
  let width: number;
  let height: number;
  let resized: (() => void) | undefined;

  beforeEach(() => {
    width = 600;
    height = 220;
    context = Object.fromEntries(['setTransform', 'clearRect', 'beginPath', 'moveTo', 'arc', 'fill', 'quadraticCurveTo', 'lineTo', 'stroke'].map(key => [key, vi.fn()]));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
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

  it('captures only the drawing pointer, prevents drag defaults, and stops canceled strokes', () => {
    const onChange = vi.fn();
    render(<InkPad onChange={onChange} />);
    const canvas = screen.getByRole('img');
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(canvas, { setPointerCapture: { value: capture }, releasePointerCapture: { value: release } });
    const down = new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 20, bubbles: true, cancelable: true });
    fireEvent(canvas, down);
    expect(down.defaultPrevented).toBe(true);
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerCancel(canvas, { pointerId: 7, clientX: 300, clientY: 100 });
    expect(release).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 300, clientY: 100 });
    expect(onChange).toHaveBeenLastCalledWith(false);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(canvas, menu);
    expect(menu.defaultPrevented).toBe(true);
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    fireEvent(canvas, drag);
    expect(drag.defaultPrevented).toBe(true);
    expect(canvas.getAttribute('draggable')).toBe('false');
    stroke(canvas);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps a usable fullscreen board and submit control when the native API rejects', async () => {
    const request = vi.fn().mockRejectedValue(new DOMException('Unavailable', 'NotAllowedError'));
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<InkPad onChange={onChange} onSubmit={onSubmit} prompt="包裹；邮包" />);
    const canvas = screen.getByRole('img');
    fireEvent.click(screen.getByTestId('ink-fullscreen-toggle'));
    await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog').getAttribute('data-fullscreen')).toBe('true');
    expect(screen.getByTestId('ink-fullscreen-prompt').textContent).toBe('包裹；邮包');
    expect(screen.getByRole('img')).toBe(canvas);
    expect(document.body.style.overflow).toBe('hidden');
    const submit = screen.getByTestId('ink-fullscreen-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    stroke(canvas);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('img')).toBe(canvas);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('replays strokes through fullscreen viewport rotation without replacing the canvas', () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 700, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const onChange = vi.fn();
    render(<InkPad onChange={onChange} onSubmit={() => {}} />);
    const canvas = screen.getByRole('img') as HTMLCanvasElement;
    stroke(canvas);
    fireEvent.click(screen.getByTestId('ink-fullscreen-toggle'));
    const panel = screen.getByRole('dialog');
    expect(panel.style.getPropertyValue('--ink-viewport-height')).toBe('700px');
    width = 844;
    height = 250;
    Object.assign(viewport, { width: 844, height: 390, offsetTop: 4, offsetLeft: 3 });
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(panel.style.getPropertyValue('--ink-viewport-width')).toBe('844px');
    expect(panel.style.getPropertyValue('--ink-viewport-height')).toBe('390px');
    expect(panel.style.getPropertyValue('--ink-viewport-top')).toBe('4px');
    expect(panel.style.getPropertyValue('--ink-viewport-left')).toBe('3px');
    expect(canvas.width).toBe(1688);
    expect(canvas.height).toBe(500);
    expect((context.lineTo as ReturnType<typeof vi.fn>).mock.lastCall?.[0]).toBeCloseTo(168.8);
    expect((context.lineTo as ReturnType<typeof vi.fn>).mock.lastCall?.[1]).toBeCloseTo(60 / 220 * 250);
    fireEvent.click(screen.getByTestId('ink-fullscreen-exit'));
    expect(screen.getByRole('img')).toBe(canvas);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '撤销一笔' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('follows a native browser fullscreen exit and restores page scrolling', async () => {
    let nativeElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => nativeElement });
    const request = vi.fn(function(this: HTMLElement) {
      nativeElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
    render(<InkPad onChange={() => {}} />);
    const canvas = screen.getByRole('img');
    fireEvent.click(screen.getByTestId('ink-fullscreen-toggle'));
    await act(async () => { await Promise.resolve(); });
    expect(nativeElement).toBe(screen.getByRole('dialog'));
    act(() => { nativeElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.getByRole('img')).toBe(canvas);
  });

  it('closes with Escape, keeps focus inside fullscreen, and releases its page locks on unmount', () => {
    const { unmount } = render(<><input aria-label="普通输入" /><InkPad onChange={() => {}} /></>);
    const entry = screen.getByTestId('ink-fullscreen-toggle');
    fireEvent.click(entry);
    const exit = screen.getByTestId('ink-fullscreen-exit');
    expect(document.activeElement).toBe(exit);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(exit);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('ink-fullscreen-toggle'));
    const input = screen.getByLabelText('普通输入') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'normal input still works' } });
    expect(input.value).toBe('normal input still works');
    fireEvent.click(screen.getByTestId('ink-fullscreen-toggle'));
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.documentElement.style.overflow).not.toBe('hidden');
  });

  it('releases capture when disabled mid-stroke and respects the parent submit gate', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<InkPad onChange={onChange} onSubmit={onSubmit} submitDisabled />);
    const canvas = screen.getByRole('img');
    const release = vi.fn();
    Object.defineProperty(canvas, 'releasePointerCapture', { value: release });
    stroke(canvas);
    fireEvent.click(screen.getByTestId('ink-fullscreen-toggle'));
    fireEvent.click(screen.getByTestId('ink-fullscreen-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { pointerId: 9, clientX: 10, clientY: 10 });
    rerender(<InkPad onChange={onChange} onSubmit={onSubmit} disabled />);
    expect(release).toHaveBeenCalledWith(9);
    expect((screen.getByTestId('ink-fullscreen-submit') as HTMLButtonElement).disabled).toBe(true);
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
