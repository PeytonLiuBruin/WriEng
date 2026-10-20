import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface InkPoint { x: number; y: number; pressure?: number }
export type InkStroke = InkPoint[];
export interface InkPadProps { onChange: (hasInk: boolean) => void; disabled?: boolean }

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

export function InkPad({ onChange, disabled = false }: InkPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<InkStroke[]>([]);
  const activePointer = useRef<number | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const descriptionId = useId();

  useEffect(() => { onChange(hasInk); }, [hasInk, onChange]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(bounds.width * ratio);
    const pixelHeight = Math.round(bounds.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
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
  }, []);

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
    window.addEventListener('resize', redraw);
    window.addEventListener('orientationchange', redraw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
      window.removeEventListener('orientationchange', redraw);
    };
  }, [redraw]);

  useEffect(() => { if (disabled) activePointer.current = null; }, [disabled]);

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
    if (event.type === 'pointerup' && !disabled) {
      const stroke = strokesRef.current[strokesRef.current.length - 1];
      if (stroke) stroke.push(pointFrom(event));
    }
    activePointer.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already released by browser. */ }
    update();
  }

  function undo() {
    activePointer.current = null;
    strokesRef.current.pop();
    update();
  }

  function clear() {
    activePointer.current = null;
    strokesRef.current = [];
    update();
  }

  return <div className={`ink-pad${disabled ? ' ink-pad-disabled' : ''}`}>
    <div className="ink-surface">
      <canvas ref={canvasRef} className="ink-canvas" role="img" aria-label="手写回忆区"
        aria-describedby={descriptionId} aria-disabled={disabled}
        style={{ width: '100%', height: 220, display: 'block', touchAction: 'none' }}
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
    </div>
    <p className="ink-note" id={descriptionId}>用手指、触控笔或鼠标书写。笔迹只留在本次练习中；揭晓后请自己核对拼写，系统不会自动识字或替你判断掌握。</p>
  </div>;
}

export default InkPad;
