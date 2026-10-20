import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './ink.css';

export interface InkPoint { x: number; y: number; pressure?: number }
export type InkStroke = InkPoint[];
export interface InkPadProps {
  onChange: (hasInk: boolean) => void;
  disabled?: boolean;
  onSubmit?: () => void;
  submitDisabled?: boolean;
  prompt?: string;
}

/** Measures movement only. It cannot recognise handwriting or assess vocabulary recall. */
export function hasMeaningfulInk(strokes: ReadonlyArray<ReadonlyArray<InkPoint>>): boolean {
  let length = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      length += Math.hypot((stroke[i].x - stroke[i - 1].x) * 600, (stroke[i].y - stroke[i - 1].y) * 220);
      if (length >= 18) return true;
    }
  }
  return false;
}

export function InkPad({ onChange, disabled = false, onSubmit, submitDisabled = false, prompt }: InkPadProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const strokesRef = useRef<InkStroke[]>([]);
  const activePointer = useRef<number | null>(null);
  const expandedRef = useRef(false);
  const nativeFullscreenRef = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const descriptionId = useId();
  const titleId = useId();

  useEffect(() => { onChange(hasInk); }, [hasInk, onChange]);

  const releasePointer = useCallback(() => {
    const pointer = activePointer.current;
    activePointer.current = null;
    if (pointer !== null) {
      try { canvasRef.current?.releasePointerCapture(pointer); } catch { /* Capture may already be released. */ }
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(bounds.width * ratio);
    const pixelHeight = Math.round(bounds.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      // A rotation ends this stroke; existing normalized points are replayed at the new size.
      releasePointer();
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ink-color').trim() || '#263e36';
    context.fillStyle = context.strokeStyle;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (!stroke.length) continue;
      const averagePressure = stroke.reduce((sum, p) => sum + (p.pressure ?? 0.5), 0) / stroke.length;
      context.lineWidth = 1.6 + averagePressure * 2.4;
      context.beginPath();
      context.moveTo(stroke[0].x * bounds.width, stroke[0].y * bounds.height);
      if (stroke.length === 1) {
        context.arc(stroke[0].x * bounds.width, stroke[0].y * bounds.height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      for (let i = 1; i < stroke.length - 1; i++) {
        const point = stroke[i];
        const next = stroke[i + 1];
        context.quadraticCurveTo(point.x * bounds.width, point.y * bounds.height,
          (point.x + next.x) / 2 * bounds.width, (point.y + next.y) / 2 * bounds.height);
      }
      const last = stroke[stroke.length - 1];
      context.lineTo(last.x * bounds.width, last.y * bounds.height);
      context.stroke();
    }
  }, [releasePointer]);

  const update = useCallback(() => {
    setStrokeCount(strokesRef.current.length);
    setHasInk(hasMeaningfulInk(strokesRef.current));
    redraw();
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
    if (canvas) observer?.observe(canvas);
    redraw();
    const resize = () => {
      const pad = padRef.current;
      const viewport = window.visualViewport;
      const native = document.fullscreenElement === pad;
      if (pad) {
        pad.style.setProperty('--ink-viewport-width', `${native ? window.innerWidth : viewport?.width ?? window.innerWidth}px`);
        pad.style.setProperty('--ink-viewport-height', `${native ? window.innerHeight : viewport?.height ?? window.innerHeight}px`);
        pad.style.setProperty('--ink-viewport-top', `${native ? 0 : viewport?.offsetTop ?? 0}px`);
        pad.style.setProperty('--ink-viewport-left', `${native ? 0 : viewport?.offsetLeft ?? 0}px`);
      }
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, [redraw]);

  useEffect(() => { if (disabled) releasePointer(); }, [disabled, releasePointer]);

  const exitFullscreen = useCallback(() => {
    releasePointer();
    expandedRef.current = false;
    setFullscreen(false);
    if (document.fullscreenElement === padRef.current && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => { /* The app layout can still close if native exit fails. */ });
    }
    fullscreenButtonRef.current?.focus({ preventScroll: true });
  }, [releasePointer]);

  useEffect(() => {
    const pad = padRef.current;
    const changed = () => {
      if (document.fullscreenElement === pad) {
        nativeFullscreenRef.current = true;
      } else if (nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        exitFullscreen();
      }
      window.dispatchEvent(new Event('resize'));
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      expandedRef.current = false;
      releasePointer();
      if (pad && document.fullscreenElement === pad && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [exitFullscreen, releasePointer]);

  useEffect(() => {
    if (!fullscreen) return;
    const oldBodyOverflow = document.body.style.overflow;
    const oldDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    fullscreenButtonRef.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        exitFullscreen();
      } else if (event.key === 'Tab') {
        const controls = Array.from(padRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !padRef.current?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !padRef.current?.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => {
      document.body.style.overflow = oldBodyOverflow;
      document.documentElement.style.overflow = oldDocumentOverflow;
      document.removeEventListener('keydown', keys, true);
    };
  }, [fullscreen, exitFullscreen]);

  function enterFullscreen() {
    releasePointer();
    expandedRef.current = true;
    setFullscreen(true);
    const pad = padRef.current;
    // Invoke within the tap gesture. iPhone and embedded browsers use the same app layout if denied.
    try {
      const request = pad?.requestFullscreen?.();
      void request?.then(() => {
        if (!expandedRef.current && document.fullscreenElement === pad && document.exitFullscreen) {
          void document.exitFullscreen().catch(() => {});
        }
      }).catch(() => { /* The app fullscreen layout is already usable. */ });
    } catch { /* Fullscreen API is optional; never require it to write. */ }
  }

  function pointFrom(event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): InkPoint {
    const bounds = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1))),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / (bounds.height || 1))),
      pressure: event.pointerType === 'pen' ? Math.max(0.1, event.pressure || 0.5) : 0.5,
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || activePointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    strokesRef.current.push([pointFrom(event)]);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture is optional in older browsers. */ }
    update();
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const native = event.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const samples = coalesced.length ? coalesced : [native];
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!stroke) return;
    for (const sample of samples) stroke.push(pointFrom(sample));
    update();
  }

  function finish(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    if (event.type === 'pointerup' && !disabled) {
      const stroke = strokesRef.current[strokesRef.current.length - 1];
      if (stroke) stroke.push(pointFrom(event));
    }
    releasePointer();
    update();
  }

  function undo() {
    releasePointer();
    strokesRef.current.pop();
    update();
  }

  function clear() {
    releasePointer();
    strokesRef.current = [];
    update();
  }

  return <div ref={padRef} className={`ink-pad${disabled ? ' ink-pad-disabled' : ''}${fullscreen ? ' ink-pad-fullscreen' : ''}`}
    data-fullscreen={fullscreen} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined}
    aria-labelledby={fullscreen ? titleId : undefined}>
    <div className="ink-heading">
      <div><strong id={titleId}>{fullscreen ? '全屏手写' : '手写回忆'}</strong>
        {fullscreen && prompt && <span className="ink-fullscreen-prompt" data-testid="ink-fullscreen-prompt">{prompt}</span>}</div>
      <button ref={fullscreenButtonRef} type="button" className="ink-action ink-fullscreen-toggle"
        data-testid={fullscreen ? 'ink-fullscreen-exit' : 'ink-fullscreen-toggle'}
        onClick={fullscreen ? exitFullscreen : enterFullscreen}>{fullscreen ? '退出全屏' : '全屏书写'}</button>
    </div>
    <div className="ink-surface">
      <canvas ref={canvasRef} className="ink-canvas" role="img" aria-label="手写回忆区"
        aria-describedby={descriptionId} aria-disabled={disabled} draggable={false}
        onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
        onLostPointerCapture={event => { if (activePointer.current === event.pointerId) activePointer.current = null; }}>
        你的浏览器不支持画布，请使用键入回忆方式。
      </canvas>
      {strokeCount === 0 && <span className="ink-placeholder" aria-hidden="true">把记忆写在这里…</span>}
    </div>
    <div className="ink-toolbar">
      <span className="ink-state" role="status">{hasInk ? '笔迹已就绪' : strokeCount ? '再写完整一点' : '还没有笔迹'}</span>
      <button type="button" className="ink-action" onClick={undo} disabled={disabled || strokeCount === 0}>撤销一笔</button>
      <button type="button" className="ink-action" onClick={clear} disabled={disabled || strokeCount === 0}>清空</button>
      {fullscreen && onSubmit && <button type="button" className="ink-action ink-fullscreen-submit" data-testid="ink-fullscreen-submit"
        disabled={disabled || submitDisabled || !hasInk} onClick={() => {
          if (disabled || submitDisabled || !hasInk) return;
          exitFullscreen();
          onSubmit();
        }}>提交并揭晓</button>}
    </div>
    <p className="ink-note" id={descriptionId}>{fullscreen ? '横过手机，写得更宽。写完提交后，自己核对拼写。' : '用手指、触控笔或鼠标书写。笔迹只留在本次练习中；揭晓后请自己核对拼写，系统不会自动识字或替你判断掌握。'}</p>
  </div>;
}

export default InkPad;
