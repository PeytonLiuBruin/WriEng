import {useEffect, useRef, useState} from 'react';
import {Check, Minus, Plus, RotateCcw, Box, Map as MapIcon} from 'lucide-react';
import JourneyArt from './JourneyArt';
import type {WorldHandle} from './WorldScene';
import './world.css';

export interface JourneyMilestone {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  /** Actual evidence progress, 0–1. A visual goal, never a mastery score. */
  progress: number;
}
type Reason = 'ready'|'loading'|'reduced-motion'|'low-power'|'manual'|'unavailable'|'context-lost';

function readPreference() {
  try { return localStorage.getItem('wrieng-map-mode') === '2d'; } catch { return false; }
}
function isLowPower() {
  const memory = (navigator as Navigator & {deviceMemory?:number}).deviceMemory;
  return (memory !== undefined && memory <= 2) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2);
}

export default function JourneyMap3D({milestones, reducedMotion, onSelect}:{milestones:JourneyMilestone[];reducedMotion:boolean;onSelect?:(id:string)=>void}) {
  const mount = useRef<HTMLDivElement>(null);
  const world = useRef<WorldHandle|null>(null);
  const markerRefs = useRef(new Map<string,HTMLButtonElement>());
  const [selected, setSelected] = useState(milestones[0]?.id ?? '');
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [manual2D, setManual2D] = useState(readPreference);
  const [force3D, setForce3D] = useState(false);
  const [failure, setFailure] = useState<'unavailable'|'context-lost'|null>(null);
  const [ready, setReady] = useState(false);
  const [systemReduced, setSystemReduced] = useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hasReducedMotion = reducedMotion || systemReduced;
  const lowPower = isLowPower() && !force3D;
  const enabled = !hasReducedMotion && !manual2D && !lowPower && !failure;
  const reason:Reason = hasReducedMotion ? 'reduced-motion' : manual2D ? 'manual' : lowPower ? 'low-power' : failure ?? (ready?'ready':'loading');
  const active = milestones.find(item=>item.id===selected) ?? milestones[0];
  const milestoneKey = JSON.stringify(milestones);

  useEffect(()=> {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = ()=>setSystemReduced(query.matches);
    query.addEventListener('change', change);
    return ()=>query.removeEventListener('change', change);
  }, []);

  const choose = (id:string) => {
    setSelected(id);
    world.current?.select(id);
    onSelect?.(id);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(()=> {
    if (!enabled || !mount.current) { setReady(false); return; }
    let cancelled = false;
    let handle:WorldHandle|null = null;
    setReady(false);
    import('./WorldScene').then(({createWorld})=> {
      if (cancelled || !mount.current) return;
      handle = createWorld(mount.current, milestones, {
        onSelect:id=>chooseRef.current(id),
        onReady:()=> { if(!cancelled) setReady(true); },
        onLost:()=> { if (!cancelled) setFailure('context-lost'); },
        onProject:points=>points.forEach(point=> {
          const element = markerRefs.current.get(point.id);
          if (element) {
            element.style.left = `${point.x}px`;
            element.style.top = `${point.y}px`;
            element.style.visibility = point.visible ? 'visible' : 'hidden';
          }
        })
      });
      if (cancelled) { handle.dispose(); return; }
      world.current = handle;
      handle.select(selectedRef.current, false);
    }).catch(()=> { if (!cancelled) setFailure('unavailable'); });
    return ()=> { cancelled=true; handle?.dispose(); world.current=null; };
    // Milestone evidence changes rebuild this small, on-demand scene; selection does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, milestoneKey]);

  const toggle = ()=> {
    if (hasReducedMotion) return;
    const next2D = enabled;
    setManual2D(next2D);
    if (!next2D) { setForce3D(true); setFailure(null); }
    try { localStorage.setItem('wrieng-map-mode',next2D?'2d':'3d'); } catch { /* preference is optional */ }
  };

  return <section className="world-map" data-testid="journey-map" data-mode={enabled?'3d':'2d'} data-reason={reason} aria-label="词汇邮局旅程地图">
    <div className="world-map-top"><div><span className="world-eyebrow">MEMORY IS AN ADVENTURE</span><h2>下一站，想得起来。</h2></div><button type="button" className="world-view-toggle" onClick={toggle} disabled={hasReducedMotion} aria-label={enabled?'切换为二维地图':'切换为三维地图'}>{enabled?<MapIcon size={16}/>:<Box size={16}/>} {enabled?'二维地图':'三维地图'}</button></div>
    <div className={`world-stage ${!enabled?'world-stage-flat':''}`}>
      {enabled ? <><div className="world-canvas-mount" ref={mount}/>{!ready&&<div className="world-loading" role="status">阿忆正在给小岛通电…</div>}<div className="world-badge"><span/> WEBGL · 可交互小岛</div><div className="world-markers" aria-label="地图站点">{milestones.slice(0,4).map((item,index)=><button type="button" key={item.id} ref={element=> { if(element) markerRefs.current.set(item.id,element); else markerRefs.current.delete(item.id); }} className={`world-marker ${item.complete?'is-complete':''} ${selected===item.id?'is-selected':''}`} data-testid={`journey-node-${item.id}`} aria-label={`${item.label}，${item.complete?'已达成':'进行中'}`} aria-pressed={selected===item.id} onClick={()=>choose(item.id)}><span>{item.complete?<Check size={14}/>:String(index+1).padStart(2,'0')}</span><strong>{item.label}</strong></button>)}</div><div className="world-camera-tools"><button type="button" aria-label="放大地图" onClick={()=>world.current?.zoom(.84)}><Plus size={17}/></button><button type="button" aria-label="缩小地图" onClick={()=>world.current?.zoom(1.19)}><Minus size={17}/></button><button type="button" aria-label="重置视角" onClick={()=>world.current?.reset()}><RotateCcw size={16}/></button></div><div className="world-touch-note">拖动看小岛 · 双指缩放 · 点站牌看进度</div></> : <><JourneyArt compact/><div className="world-flat-badge"><MapIcon size={14}/> 二维地图</div></>}
    </div>
    {!enabled&&<p className="world-fallback-note" role="status">{reason==='reduced-motion'?'已按减少动态效果偏好显示静态地图。':reason==='low-power'?'此设备优先使用轻量二维地图，也可手动试用三维。':reason==='context-lost'?'图形上下文暂时中断，已切回二维地图；学习进度不受影响。':reason==='unavailable'?'当前浏览器无法创建 WebGL 2，已显示二维地图。':'已使用轻量二维地图。'} 所有站点都可在下方选择。</p>}
    <div className="world-node-menu" aria-label="旅程站点列表">{milestones.slice(0,4).map((item,index)=><button type="button" className={`${selected===item.id?'is-selected':''} ${item.complete?'is-complete':''}`} key={item.id} data-testid={`journey-menu-${item.id}`} aria-pressed={selected===item.id} onClick={()=>choose(item.id)}><span className="world-node-number">{item.complete?<Check size={15}/>:String(index+1).padStart(2,'0')}</span><span><strong>{item.label}</strong><small>{item.complete?'已达成':'进行中'} · {Math.round(Math.min(1,Math.max(0,item.progress))*100)}%</small></span><span className="world-node-progress" style={{'--node-progress':`${Math.min(1,Math.max(0,item.progress))*100}%`} as React.CSSProperties}/></button>)}</div>
    {active&&<div className="world-node-detail" role="status" aria-live="polite"><span className="world-detail-dot"/><div><strong>{active.label}</strong><p>{active.description}</p></div><span className="world-node-status">{active.complete?'已达成':'旅程进行中'}</span></div>}
    <p className="world-character-note">邮差阿忆戴着信封帽，总把包裹背得比自己大。<span>地图记录练习证据，不代表永久掌握。</span></p>
  </section>;
}
