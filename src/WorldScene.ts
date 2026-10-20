import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {JourneyMilestone} from './JourneyMap3D';

export interface WorldHandle {
  select(id:string, animate?:boolean):void;
  reset():void;
  zoom(factor:number):void;
  dispose():void;
}
interface WorldCallbacks {
  onSelect:(id:string)=>void;
  onReady:()=>void;
  onLost:()=>void;
  onProject:(points:{id:string;x:number;y:number;visible:boolean}[])=>void;
}
/** Shared policy: no idle render loop, at most 30 render submissions/sec. */
export const WORLD_FRAME_INTERVAL = 1000 / 30;
export const WORLD_PIXEL_RATIO = {mobile:1.5,desktop:1.75} as const;
export const WORLD_NODE_POSITIONS = [[-3.55,.75],[-.5,2.1],[3.25,.05],[.6,-3.15]] as const;

/** All visuals are original procedural geometry; no network assets or textures. */
export function createWorld(host:HTMLDivElement, milestones:JourneyMilestone[], callbacks:WorldCallbacks):WorldHandle {
  const small = host.clientWidth < 700;
  let narrow = small;
  const canvas = document.createElement('canvas');
  canvas.dataset.testid='journey-webgl';
  canvas.dataset.renderer='webgl2';
  canvas.dataset.frameCount='0';
  canvas.setAttribute('aria-label','三维邮局小岛，拖动旋转，双指缩放。使用站点列表可键盘操作。');
  canvas.setAttribute('role','img');
  const context = canvas.getContext('webgl2',{alpha:true,antialias:!small,powerPreference:'low-power'});
  if (!context) throw new Error('WebGL 2 unavailable');
  const renderer = new T.WebGLRenderer({canvas,context,alpha:true,antialias:!small,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small?WORLD_PIXEL_RATIO.mobile:WORLD_PIXEL_RATIO.desktop));
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.14;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;
  renderer.shadowMap.needsUpdate=true;
  host.appendChild(canvas);

  const scene = new T.Scene();
  try {
  scene.fog=new T.Fog(0xdfece3,23,45);
  const camera=new T.PerspectiveCamera(small?42:38,1,.1,65);
  const origin=new T.Vector3(0,.6,-.35);
  const homeCamera=new T.Vector3(small?10.8:8.8,small?10.2:8.3,small?12.75:10.4);
  camera.position.copy(homeCamera);
  const controls=new OrbitControls(camera,canvas);
  controls.target.copy(origin);
  controls.enableDamping=false;
  controls.enablePan=false;
  controls.minDistance=11;
  controls.maxDistance=27;
  controls.minPolarAngle=Math.PI/6;
  controls.maxPolarAngle=Math.PI/2.55;
  controls.rotateSpeed=.65;
  controls.zoomSpeed=.7;
  controls.update();
  const ambient=new T.HemisphereLight(0xfff5d7,0x829c8a,3.0);
  scene.add(ambient);
  const sun=new T.DirectionalLight(0xffedce,3.25);
  sun.position.set(-4.5,12,7);
  sun.castShadow=true;
  sun.shadow.mapSize.set(small?512:1024,small?512:1024);
  Object.assign(sun.shadow.camera,{left:-10,right:10,top:9,bottom:-9,near:1,far:30});
  sun.shadow.normalBias=.045;
  sun.shadow.bias=-.00015;
  sun.shadow.radius=3;
  scene.add(sun);
  const fill=new T.DirectionalLight(0xd7f1ff,1.0);
  fill.position.set(5,5,-8);
  scene.add(fill);

  const materials=new Map<string,T.MeshStandardMaterial>();
  function mat(color:string) {
    let material=materials.get(color);
    if(!material) { material=new T.MeshStandardMaterial({color,roughness:.88,metalness:0,flatShading:true}); materials.set(color,material); }
    return material;
  }
  const palette={grass:'#b7cc8f',soil:'#aab58c',edge:'#d8ddad',path:'#f3e4bc',wood:'#bc936a',darkwood:'#7d8062',cream:'#fff1cd',roof:'#cd825d',roofLight:'#e9a579',green:'#567d65',dark:'#305b50',white:'#fffbed',blue:'#9dbeb5',gold:'#dcb45f',pink:'#e7a091',ink:'#31483d'};
  const world=new T.Group();
  scene.add(world);
  const geometries=new Set<T.BufferGeometry>();
  function mesh(geometry:T.BufferGeometry,color:string,parent:T.Object3D=world,x=0,y=0,z=0,sx=1,sy=1,sz=1) {
    geometries.add(geometry);
    const item=new T.Mesh(geometry,mat(color));
    item.position.set(x,y,z); item.scale.set(sx,sy,sz);
    item.castShadow=true;item.receiveShadow=true;parent.add(item);return item;
  }
  function box(color:string,parent:T.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number) { return mesh(new T.BoxGeometry(1,1,1),color,parent,x,y,z,sx,sy,sz); }
  function ball(color:string,parent:T.Object3D,x:number,y:number,z:number,sx:number,sy=sx,sz=sx) { return mesh(new T.SphereGeometry(1,12,8),color,parent,x,y,z,sx,sy,sz); }
  function cylinder(color:string,parent:T.Object3D,x:number,y:number,z:number,top:number,bottom:number,height:number,segments=18) { return mesh(new T.CylinderGeometry(top,bottom,height,segments),color,parent,x,y,z); }
  function rod(parent:T.Object3D,from:T.Vector3,to:T.Vector3,radius:number,color:string) {
    const direction=to.clone().sub(from);
    const object=cylinder(color,parent,0,0,0,radius,radius,direction.length(),8);
    object.position.copy(from.clone().add(to).multiplyScalar(.5));
    object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize());
    return object;
  }
  function island(x:number,z:number,rx:number,rz:number) {
    const group=new T.Group(); group.position.set(x,0,z); world.add(group);
    cylinder(palette.soil,group,0,-.32,0,1,.82,.65,20).scale.set(rx,1,rz);
    cylinder(palette.edge,group,0,.015,0,1,1,.16,20).scale.set(rx*1.035,1,rz*1.035);
    cylinder(palette.grass,group,0,.12,0,1,1,.15,20).scale.set(rx,1,rz);
    // Small pale stones keep the island silhouette handmade and readable.
    for(let i=0;i<6;i++) { const a=i*Math.PI/3+.2; ball(i%2?palette.edge:palette.soil,group,Math.cos(a)*rx*.91,-.2,Math.sin(a)*rz*.94,.22,.24,.19); }
    return group;
  }
  const islands=[island(-3.55,.75,2.12,1.7),island(-.5,2.1,1.23,1.15),island(3.25,.05,1.8,1.53),island(.6,-3.15,1.5,1.27)];
  const water=mesh(new T.CylinderGeometry(8.65,8.65,.13,64),'#b3cec4',world,0,-.84,0,1,1,.77);
  water.castShadow=false;
  // Discrete waterline rings give depth without an animated ocean shader.
  for(const [radius,x,z] of [[.9,-5.9,-1.8],[.58,5.3,2],[.8,1.8,3.8],[.45,-2.6,-3.6]]) {
    const ripple=mesh(new T.TorusGeometry(radius,.018,4,32),'#d8e8d9',world,x,-.76,z,1,1,.55);
    ripple.rotation.x=-Math.PI/2;ripple.castShadow=false;
  }
  function bridge(from:[number,number],to:[number,number]) {
    const group=new T.Group();
    const length=Math.hypot(to[0]-from[0],to[1]-from[1]);
    group.position.set((from[0]+to[0])/2,.15,(from[1]+to[1])/2);
    group.rotation.y=-Math.atan2(to[1]-from[1],to[0]-from[0]);world.add(group);
    const count=Math.ceil(length/.24);
    for(let i=0;i<count;i++) { const x=-length/2+(i+.5)*length/count; const arch=Math.cos(x/length*Math.PI)*.12;box(i%3?palette.wood:'#d7b488',group,x,arch,0,length/count-.035,.12,.65); }
    for(const z of [-.33,.33]) {
      for(const x of [-length*.4,0,length*.4]) box(palette.darkwood,group,x,.35,z,.055,.55,.055);
      rod(group,new T.Vector3(-length*.46,.54,z),new T.Vector3(length*.46,.54,z),.025,palette.darkwood);
    }
  }
  bridge([-1.9,1.48],[-1.3,1.95]);
  bridge([.48,1.75],[1.95,.75]);
  bridge([2.35,-1],[1.45,-2.38]);
  bridge([-.75,-2.48],[-2.35,-.45]);
  function path(parent:T.Object3D,x:number,z:number,rx:number,rz:number) { const p=cylinder(palette.path,parent,x,.235,z,1,1,.035,22);p.scale.set(rx,1,rz);p.castShadow=false; }
  path(islands[0],0,.4,1.6,.8); path(islands[1],0,0,.95,.65);path(islands[2],0,0,1.3,.9);path(islands[3],0,0,1.1,.8);
  function tree(parent:T.Object3D,x:number,z:number,size=1) {
    const g=new T.Group();g.position.set(x,.2,z);g.scale.setScalar(size);parent.add(g);
    cylinder(palette.darkwood,g,0,.33,0,.065,.08,.66,7);
    mesh(new T.ConeGeometry(.43,.85,7),'#75946d',g,0,.85,0);
    mesh(new T.ConeGeometry(.34,.7,7),'#96ad7c',g,0,1.2,0);
    mesh(new T.ConeGeometry(.24,.58,7),'#aac08d',g,0,1.5,0);
  }
  tree(islands[0],-1.25,-.55,1.05);tree(islands[0],1.55,-.45,.7);
  tree(islands[2],.9,-.8,.9);tree(islands[3],-.9,-.25,.65);

  // A gabled post office, with real roof volume, windows, door, brass envelope and flag.
  const office=new T.Group();islands[0].add(office);office.position.set(.15,.25,-.2);office.rotation.y=.12;
  box(palette.cream,office,0,.75,0,1.65,1.5,1.15);
  box('#e2cda2',office,0,.12,.69,1.83,.22,.4);
  const roofShape=new T.Shape();roofShape.moveTo(-1,0);roofShape.lineTo(0,.7);roofShape.lineTo(1,0);roofShape.closePath();
  const roof=mesh(new T.ExtrudeGeometry(roofShape,{depth:1.45,bevelEnabled:false}),palette.roof,office,0,1.5,-.72);
  // Raised ridge and chimney make the shape read clearly from every orbit angle.
  box(palette.roofLight,office,0,2.2,0,.12,.11,1.56);
  box(palette.cream,office,.57,2,-.28,.22,.69,.27);
  box(palette.roof,office,.57,2.36,-.28,.29,.12,.34);
  box(palette.dark,office,.25,.49,.59,.43,.98,.06);
  ball(palette.gold,office,.4,.5,.65,.035);
  for(const x of [-.5,.58]) {
    box(palette.dark,office,x,1,.599,.39,.38,.045);
    box(palette.cream,office,x,1,.63,.035,.36,.018);
    box(palette.cream,office,x,1,.63,.37,.035,.018);
  }
  for(const z of [-.3,.3]) {box(palette.dark,office,-.833,.95,z,.03,.45,.28);box(palette.cream,office,-.855,.95,z,.02,.035,.28);}
  box(palette.dark,office,0,1.48,.65,1.15,.27,.1);
  box(palette.gold,office,0,1.49,.712,.4,.17,.015);
  const envelopeV=new T.Vector3(0,1.47,.73);
  rod(office,new T.Vector3(-.2,1.56,.731),envelopeV,.013,palette.dark);
  rod(office,new T.Vector3(.2,1.56,.731),envelopeV,.013,palette.dark);
  cylinder(palette.darkwood,office,-.78,2.25,0,.025,.025,1.35,6);
  box(palette.gold,office,-.51,2.79,.015,.52,.25,.025);

  // The bridge stop has a tiny impossible load: a neat stack of giant letters.
  const mailPile=new T.Group();islands[1].add(mailPile);mailPile.position.set(-.18,.4,-.12);mailPile.rotation.y=-.2;
  for(let i=0;i<3;i++) { const envelope=box(i===1?'#edc98a':palette.white,mailPile,i*.07,i*.16,.04*i,.9,.14,.57);envelope.rotation.y=i%2?.12:-.08; }
  box(palette.darkwood,islands[1],.53,.6,-.38,.065,.75,.065);
  box(palette.green,islands[1],.53,.92,-.38,.5,.28,.08);

  // Memory garden: an arched trellis, planter boxes and chunky flowers.
  const garden=islands[2];
  for(const x of [-.65,.65]) box(palette.wood,garden,x,.83,-.35,.11,1.3,.11);
  const arch=mesh(new T.TorusGeometry(.66,.065,6,16,Math.PI),palette.wood,garden,0,1.48,-.35);arch.rotation.z=0;
  for(const z of [.35,.85]) {
    box('#b68763',garden,0,.35,z,1.35,.24,.27);
    box('#8d795d',garden,0,.48,z,1.2,.035,.18);
    for(const x of [-.45,0,.45]) {
      rod(garden,new T.Vector3(x,.48,z),new T.Vector3(x,.86,z),.022,palette.green);
      for(let j=0;j<5;j++) { const a=j*Math.PI*2/5; ball(z>.5?'#e9b7a0':'#ead18a',garden,x+Math.cos(a)*.092,.86+Math.sin(a)*.092,z,.075,.075,.045); }
      ball(palette.gold,garden,x,.86,z+.02,.055);
    }
  }
  // A day-after lighthouse. Its lamp is emissive, never a costly point-light bloom.
  const lighthouse=islands[3];
  cylinder(palette.cream,lighthouse,0,1.13,0,.37,.54,1.8,16);
  cylinder('#df9a72',lighthouse,0,1.38,0,.414,.441,.25,16);
  cylinder(palette.dark,lighthouse,0,2.05,0,.54,.54,.12,16);
  cylinder('#e8c97e',lighthouse,0,2.34,0,.34,.34,.48,12);
  for(const [x,z] of [[-.35,-.18],[.35,-.18],[-.35,.18],[.35,.18]]) box(palette.dark,lighthouse,x,2.34,z,.04,.48,.04);
  mesh(new T.ConeGeometry(.63,.4,12),palette.green,lighthouse,0,2.76,0);
  ball(palette.gold,lighthouse,0,3,0,.07);
  box(palette.dark,lighthouse,0,.56,.5,.29,.57,.035);
  for(const x of [-.75,.75]) ball(palette.edge,lighthouse,x,.26,.4,.26,.16,.19);

  // Original frog postie 阿忆. Enormous eyes, envelope hat, tiny boots, oversized satchel.
  const frog=new T.Group();frog.position.set(-3.72,.25,2.05);frog.rotation.y=.32;world.add(frog);
  ball('#8eac70',frog,0,.51,0,.38,.47,.29);
  ball('#c5d2a0',frog,0,.5,.23,.26,.3,.1);
  for(const x of [-.24,.24]) {
    ball(palette.dark,frog,x,.09,.1,.18,.105,.23);
    ball('#8eac70',frog,x,.2,0,.1,.2,.1);
  }
  ball('#9ab87c',frog,0,1.04,.015,.45,.31,.32);
  for(const x of [-.26,.26]) {
    ball('#a3bf82',frog,x,1.28,.03,.21,.24,.19);
    ball(palette.white,frog,x,1.31,.18,.16,.18,.09);
    ball(palette.ink,frog,x+.025,1.32,.255,.067,.09,.035);
    ball(palette.white,frog,x+.045,1.365,.286,.018);
    ball(palette.pink,frog,x*.95,1,.305,.09,.045,.025);
  }
  // The solemn flat mouth is the joke; the parcel is larger than its postie.
  rod(frog,new T.Vector3(-.09,1.045,.323),new T.Vector3(.1,1.025,.323),.013,palette.dark);
  const hat=new T.Group();hat.position.set(0,1.55,-.015);hat.rotation.z=-.12;frog.add(hat);
  box(palette.white,hat,0,0,0,.76,.23,.31);
  rod(hat,new T.Vector3(-.34,.09,.164),new T.Vector3(0,-.035,.17),.014,'#c9b996');
  rod(hat,new T.Vector3(.34,.09,.164),new T.Vector3(0,-.035,.17),.014,'#c9b996');
  box(palette.roofLight,hat,.245,.035,.17,.11,.11,.02);
  rod(frog,new T.Vector3(-.32,.74,0),new T.Vector3(-.5,.55,.08),.08,'#8eac70');
  rod(frog,new T.Vector3(.3,.75,.04),new T.Vector3(.5,.98,.12),.075,'#8eac70');
  ball('#a3bf82',frog,.52,1,.12,.11,.1,.07);
  box('#bc8f5c',frog,-.4,.62,-.23,.5,.65,.45).rotation.z=-.18;
  box(palette.cream,frog,-.45,.94,-.22,.59,.17,.49).rotation.z=-.18;
  rod(frog,new T.Vector3(-.3,.92,.3),new T.Vector3(.22,.35,.29),.035,palette.wood);

  // Original generated props, including a boat with a letter sail.
  const boat=new T.Group();boat.position.set(3.8,-.65,3.35);boat.rotation.y=-.45;world.add(boat);
  const hull=ball(palette.wood,boat,0,0,0,.55,.12,.23);hull.castShadow=false;
  rod(boat,new T.Vector3(0,.01,0),new T.Vector3(0,.72,0),.018,palette.darkwood);
  box(palette.white,boat,.18,.5,0,.37,.35,.025).rotation.z=.14;
  rod(boat,new T.Vector3(.02,.67,.03),new T.Vector3(.2,.43,.03),.009,palette.wood);
  rod(boat,new T.Vector3(.35,.67,.03),new T.Vector3(.2,.43,.03),.009,palette.wood);

  // Merge the entire static diorama by material. Hundreds of small original props
  // become material batches instead of one draw per petal/roof/eye.
  world.updateMatrixWorld(true);
  const grouped=new Map<T.Material,T.BufferGeometry[]>();
  world.traverse(object=> {
    if(!(object instanceof T.Mesh)) return;
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const material=object.material as T.Material;
    const bucket=grouped.get(material)??[];bucket.push(geometry);grouped.set(material,bucket);
  });
  world.clear();
  geometries.forEach(geometry=>geometry.dispose());geometries.clear();
  grouped.forEach((parts,material)=> {
    const merged=mergeGeometries(parts,false);
    parts.forEach(part=>part.dispose());
    if(!merged) throw new Error('World geometry could not be merged');
    geometries.add(merged);
    const object=new T.Mesh(merged,material);object.castShadow=true;object.receiveShadow=true;world.add(object);
  });

  const nodeRings:T.Mesh[]=[];
  const targets:T.Mesh[]=[];
  const markerPositions:T.Vector3[]=[];
  milestones.slice(0,4).forEach((item,index)=> {
    const [x,z]=WORLD_NODE_POSITIONS[index];
    const ringGeometry=new T.TorusGeometry(index===0?1.85:index===2?1.6:1.16,.035,6,48);
    geometries.add(ringGeometry);
    const ring=new T.Mesh(ringGeometry,new T.MeshStandardMaterial({color:item.complete?'#7b9a60':'#d2b26f',roughness:.7,emissive:item.complete?'#6c844c':'#b08640',emissiveIntensity:.08}));
    ring.rotation.x=-Math.PI/2;ring.position.set(x,.29,z);scene.add(ring);nodeRings.push(ring);
    const targetGeometry=new T.CylinderGeometry(index===0?1.9:1.4,index===0?1.9:1.4,.7,16);geometries.add(targetGeometry);
    const target=new T.Mesh(targetGeometry,new T.MeshBasicMaterial({visible:false}));target.position.set(x,.6,z);target.userData.nodeId=item.id;targets.push(target);scene.add(target);
    markerPositions.push(new T.Vector3(x,index===0?3.2:index===1?1.4:index===2?2.4:3.75,z));
  });

  let disposed=false;
  let lost=false;
  let intersecting=true;
  let frames=0;
  let lastFrame=-Infinity;
  let scheduled=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let selectedIndex=0;
  let animationStart=-Infinity;
  let animationUntil=-Infinity;
  const raycaster=new T.Raycaster();
  const pointer=new T.Vector2();
  const projected=new T.Vector3();
  const isPaused=()=>document.hidden || !intersecting || lost || disposed;
  function telemetry() {
    canvas.dataset.paused=String(isPaused());
    canvas.dataset.frameCount=String(frames);
    canvas.dataset.drawCalls=String(renderer.info.render.calls);
    canvas.dataset.triangles=String(renderer.info.render.triangles);
    canvas.dataset.camera=camera.position.toArray().map(v=>v.toFixed(3)).join(',');
    canvas.dataset.pixelRatio=String(renderer.getPixelRatio());
  }
  function draw(time:number) {
    scheduled=0;
    if(isPaused()) { telemetry();return; }
    lastFrame=time;
    const elapsed=Math.max(0,time-animationStart);
    const pulse=time<animationUntil?Math.sin(Math.min(1,elapsed/480)*Math.PI):0;
    nodeRings.forEach((ring,index)=> {
      const selected=index===selectedIndex;
      const material=ring.material as T.MeshStandardMaterial;
      material.emissiveIntensity=selected?.32+pulse*.25:.04;
      material.color.set(selected?'#e2b650':milestones[index].complete?'#7b9a60':'#c1b48d');
      ring.scale.setScalar(selected?1.03+pulse*.035:1);
      ring.position.y=.29+(selected?pulse*.05:0);
    });
    renderer.render(scene,camera);
    frames++;
    if(frames===1) callbacks.onReady();
    telemetry();
    const width=host.clientWidth,height=host.clientHeight;
    callbacks.onProject(markerPositions.map((point,index)=> {
      projected.copy(point).project(camera);
      return {id:milestones[index].id,x:(projected.x+1)*width/2,y:(1-projected.y)*height/2,visible:projected.z<1 && projected.z>-1 && projected.x>-.95 && projected.x<.95 && projected.y>-.95 && projected.y<.95};
    }));
    if(time<animationUntil) requestDraw();
  }
  function requestDraw() {
    if(isPaused() || scheduled || timer!==undefined) { telemetry();return; }
    const remaining=WORLD_FRAME_INTERVAL-(performance.now()-lastFrame);
    if(remaining>0) timer=setTimeout(()=> { timer=undefined;if(!isPaused()) scheduled=requestAnimationFrame(draw); },remaining);
    else scheduled=requestAnimationFrame(draw);
  }
  function cancelFrame() {
    if(scheduled) cancelAnimationFrame(scheduled);
    scheduled=0;
    if(timer!==undefined) clearTimeout(timer);
    timer=undefined;
  }
  function onVisibility() {
    if(isPaused()) cancelFrame();else requestDraw();
    telemetry();
  }
  function resize() {
    if(disposed) return;
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    const nextNarrow=width<700;
    if(nextNarrow!==narrow) {
      const oldDefaultDistance=homeCamera.distanceTo(origin);
      homeCamera.set(nextNarrow?10.8:8.8,nextNarrow?10.2:8.3,nextNarrow?12.75:10.4);
      const offset=camera.position.clone().sub(controls.target);
      offset.setLength(T.MathUtils.clamp(offset.length()*homeCamera.distanceTo(origin)/oldDefaultDistance,controls.minDistance,controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
      narrow=nextNarrow;
      controls.update();
    }
    const ratio=Math.min(window.devicePixelRatio||1,nextNarrow?WORLD_PIXEL_RATIO.mobile:WORLD_PIXEL_RATIO.desktop);
    if(renderer.getPixelRatio()!==ratio) renderer.setPixelRatio(ratio);
    const shadowSize=nextNarrow?512:1024;
    if(sun.shadow.mapSize.x!==shadowSize) {
      sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;renderer.shadowMap.needsUpdate=true;
    }
    camera.fov=nextNarrow?42:38;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    requestDraw();
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
  const intersectionObserver=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=> {
    intersecting=entries[0]?.isIntersecting??true;onVisibility();
  },{threshold:.01}):null;
  intersectionObserver?.observe(host);
  let downX=0,downY=0;
  function pointerDown(event:PointerEvent) { downX=event.clientX;downY=event.clientY; }
  function pointerUp(event:PointerEvent) {
    if(Math.hypot(event.clientX-downX,event.clientY-downY)>6 || event.button!==0) return;
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const target=raycaster.intersectObjects(targets,false)[0];
    if(target) callbacks.onSelect(target.object.userData.nodeId as string);
  }
  function contextLost(event:Event) { event.preventDefault();lost=true;cancelFrame();telemetry();callbacks.onLost(); }
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('webglcontextlost',contextLost);
  document.addEventListener('visibilitychange',onVisibility);
  controls.addEventListener('change',requestDraw);
  resize();
  telemetry();

  return {
    select(id,animate=true) {
      const index=milestones.findIndex(item=>item.id===id);
      if(index<0 || index>3 || disposed) return;
      selectedIndex=index;
      canvas.dataset.selectedNode=id;
      if(animate) { animationStart=performance.now();animationUntil=animationStart+480; }
      requestDraw();
    },
    reset() { if(disposed)return;camera.position.copy(homeCamera);controls.target.copy(origin);controls.update();requestDraw(); },
    zoom(factor) { if(disposed)return;const offset=camera.position.clone().sub(controls.target);offset.setLength(T.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();requestDraw(); },
    dispose() {
      if(disposed) return;
      disposed=true;cancelFrame();
      resizeObserver.disconnect();intersectionObserver?.disconnect();
      canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('webglcontextlost',contextLost);
      document.removeEventListener('visibilitychange',onVisibility);controls.removeEventListener('change',requestDraw);controls.dispose();
      geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
      nodeRings.forEach(ring=>(ring.material as T.Material).dispose());targets.forEach(target=>(target.material as T.Material).dispose());
      sun.shadow.dispose();renderer.renderLists.dispose();renderer.dispose();
      if(!lost) renderer.forceContextLoss();scene.clear();canvas.remove();
    }
  };
  } catch (error) {
    // Release a partially initialized renderer as well as a successfully mounted one.
    scene.traverse(object=> {
      if(object instanceof T.Mesh) {
        object.geometry.dispose();
        const objectMaterials=Array.isArray(object.material)?object.material:[object.material];
        objectMaterials.forEach(material=>material.dispose());
      }
    });
    scene.clear();renderer.dispose();renderer.forceContextLoss();canvas.remove();
    throw error;
  }
}
