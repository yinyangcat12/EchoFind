import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { initCommon, api, toast, requireSession } from './common.js';
initCommon();
const container=document.querySelector('#room-viewport'),loading=document.querySelector('#viewport-loading');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer,scene,camera,controls,room,grid,light,ambient,tween=null,furniture=[],walls=[];
let itemMarkerGroup, itemPollTimer, itemPollErrorShown = false, itemPollRunning = false, lastItemSync = null;
// A new layout seed is created only when the page is loaded/reloaded.
// Keep it unchanged for polling, visibility changes and connection recovery.
const placementSeed = crypto.randomUUID();
const itemMarkers = new Map();
const settings={light:80,lighting:true,furniture:true,walls:true,grid:true};
const presets={perspective:{position:[17,20,19],target:[0,.7,0],label:'自由视角'},top:{position:[0,26,.01],target:[0,0,0],label:'俯视视角'},front:{position:[0,9,26],target:[0,1,0],label:'正面视角'}};
function transition(position,target){if(!camera)return;controls.autoRotate=false;document.querySelector('#auto-rotate').classList.remove('active');document.querySelector('#auto-rotate').setAttribute('aria-pressed','false');tween={from:camera.position.clone(),to:new THREE.Vector3(...position),fromTarget:controls.target.clone(),toTarget:new THREE.Vector3(...target),start:performance.now(),duration:reducedMotion?0:650};}
function setView(name){const preset=presets[name];if(!preset)return;transition(preset.position,preset.target);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));document.querySelector('#view-label').textContent=preset.label;}
function applyLighting(){if(!light)return;const f=settings.lighting?settings.light/80:.12;light.intensity=2.1*f;ambient.intensity=.8*Math.max(f,.35);scene.environmentIntensity=.38*Math.max(f,.25);}
function createItemMarker(item){
 const marker=new THREE.Group();marker.name=`RoomItem_${item.id}`;
 // Respect depth so floor markers cannot be drawn over a wall surface.
 const core=new THREE.Mesh(new THREE.SphereGeometry(.105,16,12),new THREE.MeshBasicMaterial({color:0xef4444,depthTest:true,depthWrite:false,toneMapped:false}));
 const glow=new THREE.Mesh(new THREE.SphereGeometry(.22,16,12),new THREE.MeshBasicMaterial({color:0xff6b6b,transparent:true,opacity:.16,depthTest:true,depthWrite:false,toneMapped:false}));
 core.renderOrder=22;glow.renderOrder=21;marker.add(glow,core);
 marker.userData.phase=Math.random()*Math.PI*2;updateItemMarker(marker,item);return marker;
}
function updateItemMarker(marker,item){
 marker.userData.item=item;marker.position.set(item.position.x,item.position.y,item.position.z);
}
function removeItemMarker(id){
 const marker=itemMarkers.get(id);if(!marker)return;
 marker.removeFromParent();marker.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());else object.material?.dispose();});itemMarkers.delete(id);
}
function signalStatus(text,state='pending'){
 const el=document.querySelector('#signal-status');if(!el)return;el.textContent=text;el.dataset.state=state;
}
async function refreshRoomItems(){
 if(!itemMarkerGroup||itemPollRunning||document.hidden)return;
 itemPollRunning=true;
 try{
  const payload=await api('/api/room-items?placementSeed='+encodeURIComponent(placementSeed),{signal:AbortSignal.timeout(20000)});
  if(!Array.isArray(payload.items))throw new Error('物品数据格式无效');
  const incoming=new Map(payload.items.filter(item=>item?.id&&item.position&&['x','y','z'].every(axis=>Number.isFinite(item.position[axis]))).map(item=>[String(item.id),item]));
  for(const [id,item] of incoming){const marker=itemMarkers.get(id);if(marker)updateItemMarker(marker,item);else{const next=createItemMarker(item);itemMarkerGroup.add(next);itemMarkers.set(id,next);}}
  for(const id of itemMarkers.keys())if(!incoming.has(id))removeItemMarker(id);
  itemPollErrorShown=false;lastItemSync=payload.updatedAt;
  if(payload.source==='feishu'){
   const time=new Date(payload.updatedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
   signalStatus(`${incoming.size} 个信号物品 · ${time} 同步 · 手动刷新随机`,'live');
  }else signalStatus('尚未配置飞书物品数据','pending');
 }catch(error){
  signalStatus(lastItemSync?'同步中断 · 保留上次位置':'飞书连接失败 · 正在重试','error');
  if(!itemPollErrorShown){toast(`物品信号暂时无法更新：${error.message}`);itemPollErrorShown=true;}
 }finally{itemPollRunning=false;}
}
function initMarkerInteraction(){
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),tooltip=document.querySelector('#signal-tooltip');
 renderer.domElement.addEventListener('pointermove',event=>{
  if(!tooltip||event.buttons){if(tooltip)tooltip.hidden=true;return;}
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const cores=[...itemMarkers.values()].map(marker=>marker.children[1]);const hit=raycaster.intersectObjects(cores,false)[0];
  if(!hit){tooltip.hidden=true;return;}
  const item=hit.object.parent.userData.item;
  tooltip.textContent=`${item.name}\n编号：${item.number}\n强度：${item.strength} / 100\n基站：${item.station==='LeftUpper'?'左上角':'右下角'}（${item.stationSource==='record'?'表格指定':'当前数据来源'}）\n信号距离模拟位置，非精确坐标`;
  tooltip.hidden=false;tooltip.style.left=`${Math.max(8,Math.min(rect.width-235,event.clientX-rect.left+12))}px`;tooltip.style.top=`${Math.max(8,Math.min(rect.height-140,event.clientY-rect.top+12))}px`;
 });
 renderer.domElement.addEventListener('pointerleave',()=>{if(tooltip)tooltip.hidden=true;});
 controls.addEventListener('start',()=>{if(tooltip)tooltip.hidden=true;});
}
function fallbackRoom(){
 const group=new THREE.Group(),floorMaterial=new THREE.MeshStandardMaterial({color:0xd5c5a8,roughness:.85});
 function box(name,size,pos,color){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),color?new THREE.MeshStandardMaterial({color,roughness:.9}):floorMaterial);m.name=name;m.position.set(...pos);m.castShadow=m.receiveShadow=true;group.add(m);return m;}
 box('Structure_Floor',[12,.24,12],[0,-.12,0]);
 box('Wall_Back',[12.32,2.4,.16],[0,1.2,-6.08],0xe9e8dd);
 box('Wall_Front',[12.32,2.4,.16],[0,1.2,6.08],0xe9e8dd);
 box('Wall_Left',[.16,2.4,12],[-6.08,1.2,0],0xe9e8dd);
 box('Wall_Right',[.16,2.4,12],[6.08,1.2,0],0xe9e8dd);
 box('Wall_Partition_Main',[.16,2.4,9.6],[0,1.2,-1.2],0xe9e8dd);
 box('Furniture_Living_Sofa',[3.45,.8,1.15],[-3,.45,-3.25],0x77907a);
 box('Furniture_Living_CoffeeTable',[1.4,.1,1.4],[-3,.5,-1.35],0xa48154);
 box('Furniture_Bedroom_Bed',[2.6,.8,3.35],[3,.4,-2.95],0xe0e4d8);
 box('Furniture_Bedroom_Headboard',[2.91,1.56,.18],[3,.87,-4.69],0x77907a);
 for(const [label,x,z] of [['LeftUpper',-5.62,-5.62],['RightLower',5.62,5.62]]){
  box(`Signal_${label}_Body`,[.48,.4,.48],[x,.224,z],0x344f40);
  box(`Signal_${label}_Top`,[.4,.06,.4],[x,.454,z],0x7e9673);
  box(`Signal_${label}_Mast`,[.036,.19,.036],[x,.58,z],0x1e3026);
  box(`Signal_${label}_Beacon`,[.13,.035,.13],[x,.70,z],0x3ed06b);
 }
 return group;
}
async function init(){
 try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{loading.hidden=true;document.querySelector('#webgl-error').hidden=false;document.querySelector('#model-status').textContent='静态预览';return;}
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xeff1e9);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);
 scene=new THREE.Scene();scene.background=new THREE.Color(0xeff1e9);camera=new THREE.PerspectiveCamera(38,1,.1,220);camera.position.set(...presets.perspective.position);
 controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...presets.perspective.target);controls.enableDamping=!reducedMotion;controls.dampingFactor=.075;controls.minDistance=6;controls.maxDistance=56;controls.maxPolarAngle=Math.PI/2-.015;controls.autoRotateSpeed=.6;controls.zoomSpeed=.75;controls.panSpeed=.65;
 controls.addEventListener('start',()=>{tween=null;document.querySelector('#view-label').textContent='自由视角';document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));});
 ambient=new THREE.HemisphereLight(0xffffff,0xc4c8b8,.8);scene.add(ambient);light=new THREE.DirectionalLight(0xfff7e7,3.1);light.position.set(3,14,8);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.5,far:40});light.shadow.bias=-.0003;light.shadow.normalBias=.025;light.shadow.radius=3;scene.add(light);
 const fill=new THREE.DirectionalLight(0xe3ecde,.8);fill.position.set(-10,7,-8);scene.add(fill);
 const pmrem=new THREE.PMREMGenerator(renderer),environment=new RoomEnvironment();const envMap=pmrem.fromScene(environment,.04);scene.environment=envMap.texture;scene.environmentIntensity=.5;environment.dispose();pmrem.dispose();
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:0xeff1e9,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.26;ground.receiveShadow=true;scene.add(ground);
 grid=new THREE.GridHelper(32,32,0xd1d8c5,0xdde2d2);grid.position.y=-.251;grid.material.transparent=true;grid.material.opacity=.42;scene.add(grid);
 const resize=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(38)/2)/Math.min(camera.aspect,1)));camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(container);resize();
 try{const gltf=await new GLTFLoader().loadAsync('/assets/models/room.glb');room=gltf.scene;document.querySelector('#model-status').textContent='BLENDER GLB · v2.0';window.roomosModelSource='blender';}
 catch(error){room=fallbackRoom();document.querySelector('#model-status').textContent='备用模型 · GLB 加载失败';window.roomosModelSource='fallback';toast('Blender 模型暂时不可用，已载入备用房间。');}
 room.traverse(object=>{if(object.isMesh){object.castShadow=object.receiveShadow=true;if(object.name.startsWith('Furniture_')||object.name.startsWith('Plant_')||object.name.startsWith('Decor_'))furniture.push(object);if(object.name.startsWith('Wall_'))walls.push(object);}});scene.add(room);
 itemMarkerGroup=new THREE.Group();itemMarkerGroup.name='RoomItemMarkers';scene.add(itemMarkerGroup);
 loading.hidden=true;applyLighting();initMarkerInteraction();
 itemPollTimer=setInterval(refreshRoomItems,5000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRoomItems();});
 window.addEventListener('pagehide',()=>clearInterval(itemPollTimer));
 window.addEventListener('pageshow',event=>{if(event.persisted){itemPollTimer=setInterval(refreshRoomItems,5000);void refreshRoomItems();}});
 window.roomos3d={camera,controls,room,renderer,settings,modelSource:window.roomosModelSource,itemMarkers};
 renderer.setAnimationLoop(now=>{if(tween){const t=tween.duration===0?1:Math.min((now-tween.start)/tween.duration,1),e=1-Math.pow(1-t,3);camera.position.lerpVectors(tween.from,tween.to,e);controls.target.lerpVectors(tween.fromTarget,tween.toTarget,e);if(t===1)tween=null;}if(!reducedMotion)for(const marker of itemMarkers.values())marker.children[0].scale.setScalar(1+Math.sin(now*.003+marker.userData.phase)*.08);controls.update();renderer.render(scene,camera);});
 void refreshRoomItems();
 renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();toast('3D 上下文暂时丢失，请刷新页面恢复。');});
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
document.querySelector('#reset-view').addEventListener('click',()=>setView('perspective'));
function zoom(scale){if(!camera)return;tween=null;const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*scale,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();}
document.querySelector('#zoom-in').addEventListener('click',()=>zoom(.85));document.querySelector('#zoom-out').addEventListener('click',()=>zoom(1.18));
document.querySelector('#auto-rotate').addEventListener('click',event=>{if(!controls)return;controls.autoRotate=!controls.autoRotate;event.currentTarget.classList.toggle('active',controls.autoRotate);event.currentTarget.setAttribute('aria-pressed',String(controls.autoRotate));});
document.querySelector('#toggle-grid').addEventListener('click',event=>{if(!grid)return;settings.grid=!settings.grid;grid.visible=settings.grid;event.currentTarget.classList.toggle('active',settings.grid);event.currentTarget.setAttribute('aria-pressed',String(settings.grid));});
function toggle(id,key,callback){document.querySelector(id).addEventListener('click',event=>{if(!room)return;settings[key]=!settings[key];event.currentTarget.classList.toggle('on',settings[key]);event.currentTarget.setAttribute('aria-checked',String(settings[key]));callback();});}
toggle('#lighting-toggle','lighting',applyLighting);toggle('#furniture-toggle','furniture',()=>furniture.forEach(item=>item.visible=settings.furniture));toggle('#walls-toggle','walls',()=>walls.forEach(item=>item.visible=settings.walls));
document.querySelector('#light-intensity').addEventListener('input',event=>{settings.light=Number(event.target.value);document.querySelector('#light-value').textContent=settings.light+'%';applyLighting();});
document.querySelector('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('#viewport-card').requestFullscreen();}catch{toast('当前浏览器暂不支持全屏显示。');}});
container.addEventListener('keydown',event=>{if(event.key==='Home'){setView('perspective');event.preventDefault();}if(event.key==='+'||event.key==='='){zoom(.85);event.preventDefault();}if(event.key==='-'){zoom(1.18);event.preventDefault();}});
try{await requireSession();await init();}catch(error){loading.hidden=true;toast('场景初始化失败：'+error.message);document.querySelector('#webgl-error').hidden=false;}

