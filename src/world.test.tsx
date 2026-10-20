import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import JourneyMap3D,{type JourneyMilestone} from './JourneyMap3D';

const renderer=vi.hoisted(()=>({
  create:vi.fn(),select:vi.fn(),dispose:vi.fn(),reset:vi.fn(),zoom:vi.fn(),
}));
vi.mock('./WorldScene',()=>({createWorld:renderer.create}));
const milestones:JourneyMilestone[]=[
  {id:'office',label:'词汇邮局',description:'寄出第一封信',complete:true,progress:1},
  {id:'bridge',label:'回忆小桥',description:'五次独立回忆',complete:false,progress:.4},
  {id:'garden',label:'隔日花园',description:'隔一天再想起',complete:false,progress:0},
  {id:'light',label:'记忆灯塔',description:'三次隔日回忆',complete:false,progress:0},
];
let callbacks:{onSelect:(id:string)=>void;onLost:()=>void};
let media:{matches:boolean;addEventListener:ReturnType<typeof vi.fn>;removeEventListener:ReturnType<typeof vi.fn>};
beforeEach(()=> {
  localStorage.clear();
  renderer.create.mockReset();renderer.select.mockClear();renderer.dispose.mockClear();
  renderer.reset.mockClear();renderer.zoom.mockClear();
  media={matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
  vi.stubGlobal('matchMedia',()=>media);
  vi.spyOn(navigator,'hardwareConcurrency','get').mockReturnValue(8);
  renderer.create.mockImplementation((_host,_milestones,next)=> {
    callbacks=next;
    queueMicrotask(()=>next.onReady());
    return {select:renderer.select,dispose:renderer.dispose,reset:renderer.reset,zoom:renderer.zoom};
  });
});
afterEach(()=> { cleanup();vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('accessible journey map and renderer lifecycle',()=> {
  it('keeps all four real-evidence stations usable with reduced motion and never creates a renderer',()=> {
    render(<JourneyMap3D milestones={milestones} reducedMotion/>);
    expect(screen.getByTestId('journey-map').dataset.reason).toBe('reduced-motion');
    expect(screen.getAllByTestId(/^journey-menu-/)).toHaveLength(4);
    fireEvent.click(screen.getByTestId('journey-menu-garden'));
    expect(screen.getByTestId('journey-menu-garden').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('隔一天再想起')).toBeTruthy();
    expect(renderer.create).not.toHaveBeenCalled();
  });

  it('does not rebuild on equal milestone arrays and disposes the WebGL scene on unmount',async()=> {
    const {rerender,unmount}=render(<JourneyMap3D milestones={milestones} reducedMotion={false}/>);
    await waitFor(()=>expect(screen.getByTestId('journey-map').dataset.reason).toBe('ready'));
    rerender(<JourneyMap3D milestones={milestones.map(item=>({...item}))} reducedMotion={false}/>);
    expect(renderer.create).toHaveBeenCalledTimes(1);
    unmount();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('synchronizes scene selection, DOM station selection and external callback',async()=> {
    const onSelect=vi.fn();
    render(<JourneyMap3D milestones={milestones} reducedMotion={false} onSelect={onSelect}/>);
    await waitFor(()=>expect(renderer.create).toHaveBeenCalledTimes(1));
    act(()=>callbacks.onSelect('light'));
    expect(screen.getByTestId('journey-menu-light').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('journey-node-light').getAttribute('aria-pressed')).toBe('true');
    expect(onSelect).toHaveBeenLastCalledWith('light');
    fireEvent.click(screen.getByTestId('journey-menu-bridge'));
    expect(renderer.select).toHaveBeenLastCalledWith('bridge');
    expect(screen.getByText('五次独立回忆')).toBeTruthy();
  });

  it('falls back after context loss without dropping stations or leaving a renderer mounted',async()=> {
    render(<JourneyMap3D milestones={milestones} reducedMotion={false}/>);
    await waitFor(()=>expect(renderer.create).toHaveBeenCalledTimes(1));
    act(()=>callbacks.onLost());
    expect(screen.getByTestId('journey-map').dataset.reason).toBe('context-lost');
    expect(screen.getByTestId('journey-map').dataset.mode).toBe('2d');
    expect(screen.getAllByTestId(/^journey-menu-/)).toHaveLength(4);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('honors a saved lightweight preference, and switching modes releases the previous renderer',async()=> {
    localStorage.setItem('wrieng-map-mode','2d');
    render(<JourneyMap3D milestones={milestones} reducedMotion={false}/>);
    expect(screen.getByTestId('journey-map').dataset.reason).toBe('manual');
    fireEvent.click(screen.getByRole('button',{name:'切换为三维地图'}));
    await waitFor(()=>expect(screen.getByTestId('journey-map').dataset.reason).toBe('ready'));
    expect(localStorage.getItem('wrieng-map-mode')).toBe('3d');
    fireEvent.click(screen.getByRole('button',{name:'切换为二维地图'}));
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('wrieng-map-mode')).toBe('2d');
  });

  it('reacts to an operating-system reduced-motion change and removes its listener on unmount',async()=> {
    const {unmount}=render(<JourneyMap3D milestones={milestones} reducedMotion={false}/>);
    await waitFor(()=>expect(renderer.create).toHaveBeenCalledTimes(1));
    media.matches=true;
    act(()=>media.addEventListener.mock.calls[0][1]());
    expect(screen.getByTestId('journey-map').dataset.reason).toBe('reduced-motion');
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change',expect.any(Function));
  });

  it('recovers an unsupported WebGL setup honestly and retains the accessible station controls',async()=> {
    renderer.create.mockImplementation(()=>{ throw new Error('WebGL 2 unavailable'); });
    render(<JourneyMap3D milestones={milestones} reducedMotion={false}/>);
    await waitFor(()=>expect(screen.getByTestId('journey-map').dataset.reason).toBe('unavailable'));
    expect(screen.getByTestId('journey-map').dataset.mode).toBe('2d');
    fireEvent.click(screen.getByTestId('journey-menu-bridge'));
    expect(screen.getByText('五次独立回忆')).toBeTruthy();
  });
});
