import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { buildBedrockModel } from './bedrock.js';
import { parseRawFaceModel, buildRawFaceModel, buildTextureAlphaCoverage } from './raw-face-model.js';
import { nextPaint } from './import-progress.js';
import { YsmControllerRuntime, mergeControllerFiles, normalizeControllers } from './ysm-controller.js';
import { bindHandItems, bindItemActionQueries, mainAnimationFor, swingDuration } from './hand-items.js';
import { DEFAULT_LIGHTING, lightDirection } from './lighting.js';
import { YsmSkeleton } from './skeleton.js';
import { createYsmAnimationContext, shareRoamingVariables, advanceYsmPhysics, animationLength, animationLoopMode, evaluateMolang, executeMolangStatement, inspectMolangScopes } from './ysm-animation.js';
import { YsmAudio } from './audio.js';
import { PLAY_VIEWS, bindMovementQueries } from './play-control.js';
import { DEFAULT_STATUS, bindPlayerStatus } from './player-status.js';
import { parseLenientJson } from './json.js';
import { tr } from './i18n.js';

function parseJsonInWorker(file){
  if(typeof Worker==='undefined'||typeof URL.createObjectURL!=='function')return file.text().then(parseLenientJson);
  const workerSource=`const parseLenientJson=${parseLenientJson.toString()};self.onmessage=async e=>{try{const text=await e.data.text();self.postMessage({ok:true,value:parseLenientJson(text)})}catch(error){self.postMessage({ok:false,error:error.message})}}`;
  const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(workerUrl);
  return new Promise((resolve,reject)=>{
    worker.onmessage=event=>{worker.terminate();URL.revokeObjectURL(workerUrl);if(event.data?.ok)resolve(event.data.value);else reject(new Error(event.data?.error||tr('动画 JSON 解析失败')));};
    worker.onerror=event=>{worker.terminate();URL.revokeObjectURL(workerUrl);reject(new Error(event.message||tr('动画 JSON 后台解析失败')));};
    worker.postMessage(file);
  });
}

async function loadLegacyTexture(url,rawGeometry=false) {
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const bitmap=await createImageBitmap(await response.blob());
  const scanCanvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(bitmap.width,bitmap.height):Object.assign(document.createElement('canvas'),{width:bitmap.width,height:bitmap.height});
  const scanContext=scanCanvas.getContext('2d',{willReadFrequently:true});
  scanContext.drawImage(bitmap,0,0);
  const pixels=scanContext.getImageData(0,0,bitmap.width,bitmap.height).data;
  const alphaCoverage=rawGeometry?buildTextureAlphaCoverage(pixels,bitmap.width,bitmap.height):null;
  let hasTranslucency=alphaCoverage?.hasTranslucency??false;
  if(!rawGeometry)for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0&&pixels[i]<255){hasTranslucency=true;break;}
  const texture=new THREE.Texture(bitmap);
  texture.flipY=false;
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;
  texture.minFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;
  texture.needsUpdate=true;
  return {texture,hasTranslucency,alphaCoverage};
}

async function loadCardLayer(file,fallbackFile,declaredPath,id){
  const path=String(declaredPath||'').replaceAll('\\','/').replace(/^\/+/, '');
  if(!path)return null;
  const candidates=[file,fallbackFile].filter(Boolean);
  for(const candidate of candidates){
    let objectUrl;
    try{
      objectUrl=URL.createObjectURL(candidate);
      const image=new Image();image.src=objectUrl;await image.decode();
      return {url:objectUrl,image,owned:true};
    }catch(error){if(objectUrl)URL.revokeObjectURL(objectUrl);console.warn(`Could not load ${id}:`,error);}
  }
  return null;
}

// Keeps the frame's final bone params for the next frame's bone queries
// (bone_rot, bone_pos, bone_pivot_abs …); boneFrame invalidates their caches.
function rememberBoneParams(context,skeleton){
  if(context.previousBoneParams?.length!==skeleton.params.length)context.previousBoneParams=new Float32Array(skeleton.params.length);
  context.previousBoneParams.set(skeleton.params);context.boneFrame=(context.boneFrame||0)+1;
}
// 操控模式 follow camera: default distance and the wheel zoom range.
const PLAY_DISTANCE=6,PLAY_DISTANCE_MIN=1.5,PLAY_DISTANCE_MAX=20;
// The first person camera sits at the vanilla eye height.
const EYE_HEIGHT=1.62,PLAY_GROUND_CLEARANCE=0.1;
// The viewer's own narrow lens, and Minecraft's default FOV (also the hand projection's).
const VIEW_FOV=32,FIRST_PERSON_FOV=70;

export class ModelViewer {
  constructor(canvas, viewport, onTime) {
    this.canvas=canvas; this.viewport=viewport; this.onTime=onTime;
    this.playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.speed=1; this.time=0; this.elapsedTime=0; this.active=false; this.animationName='idle'; this.base=null; this.handItems={mainhand:null,offhand:null}; this.playerStatus=DEFAULT_STATUS;
    // screenshot() reads the canvas right after rendering, so the drawing
    // buffer need not be preserved (keeping it costs a copy every frame).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(VIEW_FOV,1,0.01,100);
    this.controls=new OrbitControls(this.camera,canvas);
    // Match the reference viewer: rotation and dragging stop immediately.
    this.controls.enableDamping=false;
    // The reference viewer handles wheel input itself: normalize the browser
    // delta mode, clamp one event's step, then scale camera distance by 1.15.
    // Disable OrbitControls' own wheel handling so the zoom is only applied once.
    this.controls.enableZoom=false;
    this.controls.minDistance=0.5; this.controls.maxDistance=20;
    this.onWheel=event=>{
      event.preventDefault();
      const unit=event.deltaMode===1?1/3:event.deltaMode===2?1:1/100;
      const exponent=THREE.MathUtils.clamp(event.deltaY*unit,-4,4);
      if(this.play){this.playDistance=THREE.MathUtils.clamp(this.playDistance*Math.pow(1.15,exponent),PLAY_DISTANCE_MIN,PLAY_DISTANCE_MAX);return;}
      const distance=THREE.MathUtils.clamp(this.controls.getDistance()*Math.pow(1.15,exponent),0.5,20);
      const offset=this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(distance);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
      this.interactUntil=performance.now()+250;
    };
    canvas.addEventListener('wheel',this.onWheel,{passive:false});
    // While the user drags or zooms the 3D view, the sidebar card holds its
    // frame so the whole frame budget goes to the view under the pointer.
    this.dragging=false;this.interactUntil=0;
    this.controls.addEventListener('start',()=>{this.dragging=true;});
    this.controls.addEventListener('end',()=>{this.dragging=false;});
    this.controls.autoRotateSpeed=1.3; this.controls.maxPolarAngle=Math.PI*0.92;
    this.grid=new THREE.GridHelper(16,64,0xd3bfd3,0xe3d5e2);
    this.grid.material.transparent=true; this.grid.material.opacity=0.5;
    this.grid.position.y=-0.035; this.scene.add(this.grid);
    this.ambientLight=new THREE.HemisphereLight(0xffffff,0x8d728d,DEFAULT_LIGHTING.ambient);
    this.keyLight=new THREE.DirectionalLight(0xffffff,DEFAULT_LIGHTING.intensity);
    this.lightMarker=createLightMarker();
    this.scene.add(this.ambientLight,this.keyLight,this.lightMarker);
    this.lighting={...DEFAULT_LIGHTING};this.applyLighting();
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(viewport);
    this.lastTime=0; this.tick=this.tick.bind(this); this.frame=0; this.frameToken=0; this.uncapped=false; this.cardRenderedAt=0;
    // 独立窗口 (第 62 节): while this page is hidden (main window minimized) a
    // popped-out card keeps animating on its own window's frames.
    document.addEventListener('visibilitychange',()=>{if(this.frame>0&&this.frameWindow!==this.loopWindow){this.cancelFrame();this.ensureLoop();}});
    // 设置 → 预览光照: light multipliers for normal and ysmGlow parts, shared
    // by both materials' shaders.
    // ysmBloomMask is 1 only while the glow-only bloom pass renders.
    this.lightUniforms={ysmLight:{value:1},ysmGlowLight:{value:1},ysmBloomMask:{value:0}};
    this.bloom={enabled:false};this.bloomPipeline=null;
    // 操控模式 first person: the arm is drawn after the world in view space,
    // over a cleared depth buffer, with the hand projection (FOV 70).
    this.armScene=new THREE.Scene();this.armCamera=new THREE.PerspectiveCamera(FIRST_PERSON_FOV,1,0.05,100);
    this.armAmbient=new THREE.HemisphereLight(0xffffff,0x8d728d,DEFAULT_LIGHTING.ambient);this.armKeyLight=new THREE.DirectionalLight(0xffffff,DEFAULT_LIGHTING.intensity);
    this.armScene.add(this.armAmbient,this.armKeyLight,this.armKeyLight.target);this.arm=null;
    this.applyLighting();
  }

  async load() {
    const source=this.fileMap;
    if(!source?.model)throw new Error(tr('未提供模型文件'));
    this.time=0;this.elapsedTime=0;this.base=null;
    const metadata=source.metadata?await source.metadata.text().then(parseLenientJson):{};
    const props=metadata.properties||metadata.metadata?.properties||{};
    this.releaseCardLayers();
    const cardLayers=await Promise.all([
      loadCardLayer(source.cardBackground,source.cardBackgroundFallback,props.gui_background,'gui_background'),
      loadCardLayer(source.cardForeground,source.cardForegroundFallback,props.gui_foreground,'gui_foreground'),
    ]);
    this.cardLayerObjectUrls=cardLayers.filter(Boolean).map(layer=>layer.url);
    this.cardBackgroundUrl=cardLayers[0]?.url||null;this.cardForegroundUrl=cardLayers[1]?.url||null;
    this.cardBackgroundImage=cardLayers[0]?.image||null;this.cardForegroundImage=cardLayers[1]?.image||null;
    const animationEntries=source.animationFiles?.length?source.animationFiles:[...(source.animation?[{id:'main',file:source.animation}]:[]),...(source.extraAnimation?[{id:'extra',file:source.extraAnimation}]:[])];
    const controllerEntries=source.controllerFiles||[];
    // Progress counts every JSON file as it finishes parsing.
    const progress=this.loadProgress,jsonTotal=1+animationEntries.length+controllerEntries.length+(source.armModel?1:0)+(source.armAnimationFiles?.length||0);
    let jsonDone=0;const parsed=()=>progress?.('parse',++jsonDone,jsonTotal);
    progress?.('parse',0,jsonTotal);
    const loadEntry=async entry=>{
      return entry.file?parseJsonInWorker(entry.file).finally(parsed):(parsed(),null);
    };
    const [model,animationFiles,controllerFiles,armModel,armAnimationFiles]=await Promise.all([
      (source.rawGeometry?source.model.arrayBuffer().then(parseRawFaceModel):source.model.text().then(parseLenientJson)).finally(parsed),
      Promise.all(animationEntries.map(entry=>loadEntry(entry).catch(error=>{console.warn(`Could not load animation file ${entry.path||entry.id}:`,error);return null;}))),
      Promise.all(controllerEntries.map(entry=>loadEntry(entry).catch(error=>{console.warn(`Could not load controller file ${entry.path}:`,error);return null;}))),
      source.armModel?(source.rawArmGeometry?source.armModel.arrayBuffer().then(parseRawFaceModel):source.armModel.text().then(parseLenientJson)).finally(parsed).catch(error=>{console.warn('Could not load the arm model:',error);return null;}):null,
      Promise.all((source.armAnimationFiles||[]).map(entry=>loadEntry(entry).catch(error=>{console.warn(`Could not load arm animation file ${entry.path}:`,error);return null;}))),
    ]);
    const animations={};for(const file of animationFiles)Object.assign(animations,file?.animations||{});
    const controllers=mergeControllerFiles(controllerFiles.filter(Boolean));
    const variants=textureSources(source);let texturesDone=0;
    progress?.('textures',0,variants.length);
    this.textureVariants=(await Promise.all(variants.map(async entry=>{
      let objectUrl;
      try{
        const url=objectUrl=URL.createObjectURL(entry.file);
        return {...entry,...await loadLegacyTexture(url,source.rawGeometry||source.rawArmGeometry)};
      }catch(error){console.warn(`Could not load texture ${entry.label}:`,error);return null;}
      finally{if(objectUrl)URL.revokeObjectURL(objectUrl);progress?.('textures',++texturesDone,variants.length);}
    }))).filter(Boolean);
    if(!this.textureVariants.length)throw new Error(tr('模型包中没有可加载的贴图'));
    const preferred=String(metadata.properties?.default_texture||'').trim().toLowerCase();
    const selectedByName=this.textureVariants.find(entry=>[entry.id,entry.label,entry.path].some(value=>String(value||'').toLowerCase()===preferred));
    const declaredTexture=metadata.files?.player?.texture;
    const firstDeclared=Array.isArray(declaredTexture)?declaredTexture[0]:declaredTexture;
    const declaredPath=typeof firstDeclared==='string'?firstDeclared:firstDeclared?.uv;
    const declaredKey=String(declaredPath||'').replaceAll('\\','/').replace(/^\/+/, '').toLowerCase();
    const selectedByDeclaration=this.textureVariants.find(entry=>String(entry.path||'').replaceAll('\\','/').toLowerCase()===declaredKey);
    const selected=selectedByName||selectedByDeclaration||this.textureVariants[0];
    this.currentTextureId=selected.id;
    [this.material,this.translucentMaterial]=createModelMaterials(selected.texture,selected.hasTranslucency);
    const bedrockGeometry=source.rawGeometry?null:source?.bedrockModel||model['minecraft:geometry']?.[0];
    if(source.rawGeometry?!model?.bones:!bedrockGeometry?.bones)throw new Error(source.rawGeometry?tr('原始面模型中未找到骨骼数据'):tr('模型 JSON 中未找到 Bedrock 骨骼数据'));
    // Building the geometry is synchronous: let the progress bar paint first.
    if(progress){progress('build',0,1);await nextPaint();}
    this.root=source.rawGeometry?buildRawFaceModel(model,[this.material,this.translucentMaterial],selected.alphaCoverage):buildBedrockModel({bedrockModel:bedrockGeometry},[this.material,this.translucentMaterial]);
    installGpuSkinning(this.material,this.root.userData.boneTexture,this.lightUniforms);
    installGpuSkinning(this.translucentMaterial,this.root.userData.boneTexture,this.lightUniforms);
    this.bones=this.root.userData.bones; this.animations=animations;
    this.skeleton=new YsmSkeleton(this.root.userData.skeletonBones);
    this.animationContext=createYsmAnimationContext();
    this.audio?.dispose();this.audio=new YsmAudio(source.soundFiles);this.animationContext.audio=this.audio;
    this.bindAnimationContext(this.animationContext);
    bindHandItems(this.animationContext,this.handItems);bindPlayerStatus(this.animationContext,this.playerStatus);this.mainAnimationContext=this.animationContext;
    // YSM's folder schema places properties at the document root. Also accept
    // older metadata-wrapped exports so plugin options are not silently lost.
    this.customAnimationSlots=props.extra_animation&&typeof props.extra_animation==='object'?props.extra_animation:{};
    this.customAnimationGroups=Array.isArray(props.extra_animation_classify)?props.extra_animation_classify:[];
    this.customAnimationButtons=Array.isArray(props.extra_animation_buttons)?props.extra_animation_buttons:[];
    const slotNames=new Set();
    const collectSlotNames=value=>{if(typeof value==='string')slotNames.add(value);else if(Array.isArray(value))value.forEach(collectSlotNames);else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>{slotNames.add(key);collectSlotNames(item);});};
    collectSlotNames(this.customAnimationSlots);
    this.extraAnimationNames=new Set([...slotNames].filter(name=>Object.hasOwn(this.animations,name)));
    this.previewAnimationName=typeof props.preview_animation==='string'?props.preview_animation.trim():'';
    this.disablePreviewRotation=isYsmFlagEnabled(props.disable_preview_rotation??props.disablePreviewRotation);
    // Keep the interactive viewer straight-on. Model-card yaw/pitch and its
    // preview animation are applied only while rendering the generated cover.
    this.root.quaternion.identity();
    const widthScale=Number.isFinite(Number(props.width_scale))?Number(props.width_scale):0.7;
    const heightScale=Number.isFinite(Number(props.height_scale))?Number(props.height_scale):0.7;
    // IGeoRenderer applies height_scale to X/Z and width_scale to Y.
    this.modelScale=new THREE.Vector3(heightScale,widthScale,heightScale);
    this.rootPose=new THREE.Matrix4().makeScale(this.modelScale.x,this.modelScale.y,this.modelScale.z);
    this.controllerDefinitions=normalizeControllers(controllers);
    this.controllerRuntime=new YsmControllerRuntime(this.controllerDefinitions,this.animations);
    // The main view's runtime (withCardPose swaps controllerRuntime for a moment); read by the Molang 监视器.
    this.mainControllerRuntime=this.controllerRuntime;
    this.buildArm(armModel,armAnimationFiles,source.rawArmGeometry);
    this.scene.add(this.root);
    // Render the authored model pose first. Animation sampling is kept out of
    // the base render path because YSM's Molang helper layers are not
    // equivalent to Blockbench keyframes.
    this.applyFrame(); this.reset(); this.resize();
    this.renderView();
  }

  /** onProgress(step, done, total): step is "parse", "textures" or "build" (import progress bar). */
  async loadFiles(fileMap,{onProgress=null}={}) {
    this.stopCardPreview();
    if(this.root){ this.scene.remove(this.root); this.root.userData.disposeExtraGeometries?.();this.root.traverse(node=>node.geometry?.dispose()); this.root.userData.boneTexture?.dispose(); this.root=null; }
    this.material?.dispose();this.translucentMaterial?.dispose();this.disposeArm();
    for(const entry of this.textureVariants||[]){entry.texture.dispose();entry.texture.image?.close?.();}
    this.releaseCardLayers();
    this.textureVariants=[];this.material=null;this.translucentMaterial=null;
    this.fileMap=fileMap;this.loadProgress=onProgress;
    try{await this.load();}finally{this.loadProgress=null;}
  }

  releaseCardLayers(){
    for(const url of this.cardLayerObjectUrls||[])URL.revokeObjectURL(url);
    this.cardLayerObjectUrls=[];this.cardBackgroundUrl=null;this.cardForegroundUrl=null;this.cardBackgroundImage=null;this.cardForegroundImage=null;
  }

  // A main clip swapped for its tac: version (gun in hand) loops on that clip's length.
  // A looping clip wraps at its animation_length. Without one its length is
  // infinite (YSMFolderDeserializer), so its time keeps running like the
  // game's: Molang-driven clips (乐魂's fly) read the growing q.anim_time.
  loopTime(name,time){const length=animationLength(this.animations?.[name]);return Number.isFinite(length)?(length>0?time%length:0):time;}
  get duration() { return this.animations?.[this.base?this.animationName:this.mainClipName(this.animationName)]?.animation_length || 1; }
  mainClipName(name) { return this.animationContext===this.mainAnimationContext?mainAnimationFor(name,this.handItems,this.animations):name; }
  get autoRotate() { return this.controls.autoRotate; }
  set autoRotate(value) { this.controls.autoRotate=value; }
  get showGrid() { return this.grid.visible; }
  set showGrid(value) { this.grid.visible=value; }
  // Texture regions of the faces the 3D view currently shows (自动取色). The
  // card preview shares the bone mask, so re-evaluate the live pose first.
  visibleTextureCoverage(){
    if(!this.root)return null;
    if(this.animationContext===this.mainAnimationContext)this.applyFrame(false);
    return this.root.userData.visibleTextureCoverage();
  }
  setTexture(id) {
    const entry=this.textureVariants?.find(item=>item.id===id);if(!entry||!this.material)return false;
    this.currentTextureId=entry.id;this.material.map=entry.texture;this.material.needsUpdate=true;
    if(this.root?.userData.setAlphaCoverage)this.root.userData.alphaDrawStats=this.root.userData.setAlphaCoverage(entry.alphaCoverage);
    if(this.translucentMaterial){this.translucentMaterial.map=entry.texture;this.translucentMaterial.visible=entry.hasTranslucency;this.translucentMaterial.needsUpdate=true;}
    if(this.arm){const [opaque,translucent]=this.arm.materials;opaque.map=entry.texture;translucent.map=entry.texture;translucent.visible=entry.hasTranslucency;opaque.needsUpdate=translucent.needsUpdate=true;
      if(this.arm.root.userData.setAlphaCoverage)this.arm.root.userData.alphaDrawStats=this.arm.root.userData.setAlphaCoverage(entry.alphaCoverage);}
    this.renderView();return true;
  }
  /**
   * Main-view lighting. `level` is a Minecraft light level (0–15): normal
   * parts are darkened by the vanilla light map; with `glow` on, ysmGlow
   * parts keep the full-light value (15,15) like NativeModelRenderer.
   */
  setEnvironmentLight({level=15,glow=true}={}){
    const light=lightMapBrightness(level)/lightMapBrightness(15);
    this.lightUniforms.ysmLight.value=light;this.lightUniforms.ysmGlowLight.value=glow?1:light;
    if(this.root)this.renderView();
  }
  /**
   * Main-view light rig (光照调节): key-light direction in degrees (azimuth 0°
   * = the model's front, 90° = the right side seen from the default camera;
   * elevation above the ground plane), key and ambient intensity, key colour,
   * and whether the light marker is drawn. The card keeps DEFAULT_LIGHTING.
   */
  setLighting(changes={}){
    this.lighting={...this.lighting,...changes};this.applyLighting();
    if(this.root)this.renderView();
  }
  applyLighting(){
    const {azimuth,elevation,intensity,ambient,color,exposure,filmic,marker}=this.lighting;
    const direction=lightDirection(azimuth,elevation);
    this.keyLight.position.copy(direction).multiplyScalar(9);this.keyLight.intensity=intensity;this.keyLight.color.set(color);
    this.ambientLight.intensity=ambient;
    if(this.armKeyLight){this.armKeyLight.intensity=intensity;this.armKeyLight.color.set(color);this.armAmbient.intensity=ambient;}
    // Only the main renderer is tone mapped; the card renderers keep NoToneMapping.
    this.renderer.toneMapping=filmic?THREE.ACESFilmicToneMapping:THREE.LinearToneMapping;this.renderer.toneMappingExposure=exposure;
    const {bloom,bloomStrength,bloomRadius,bloomGlowOnly,bloomThreshold}=this.lighting;
    this.bloom={enabled:bloom,strength:bloomStrength,radius:bloomRadius,glowOnly:bloomGlowOnly,threshold:bloomThreshold};
    this.lightMarker.userData.update(direction,color);this.lightMarker.visible=marker;
  }
  /** Renders the main view: straight to the canvas, or through the bloom composers. */
  renderView(){
    // In first person the game draws no third-person model (only the
    // first-person arms, which the viewer does not have).
    const hidden=this.play&&this.playView==='first'&&this.root?.visible;
    if(hidden)this.root.visible=false;
    try{if(!hidden)this.root?.userData.prepareCulling?.(this.camera,'main');this.renderScene();}finally{if(hidden)this.root.visible=true;}
    if(this.firstPersonArmVisible)this.renderFirstPersonArm();
  }
  renderScene(){
    if(!this.bloom.enabled){this.renderer.render(this.scene,this.camera);return;}
    const pipeline=this.bloomPipeline||this.createBloom(),{strength,radius,glowOnly,threshold}=this.bloom,mask=this.lightUniforms.ysmBloomMask;
    pipeline.bloomPass.strength=strength;pipeline.bloomPass.radius=radius;pipeline.bloomPass.threshold=glowOnly?0:threshold;
    // Bloom source: the model only (glow parts only in glow-only mode), in linear HDR.
    const grid=this.grid.visible,marker=this.lightMarker.visible;
    this.grid.visible=false;this.lightMarker.visible=false;mask.value=glowOnly?1:0;
    try{pipeline.bloomComposer.render();}
    finally{mask.value=0;this.grid.visible=grid;this.lightMarker.visible=marker;}
    // The normal frame renders straight to the canvas (its own MSAA and tone
    // mapping, as without bloom); the bloom is then added on top in one pass.
    const renderer=this.renderer,autoClear=renderer.autoClear;
    renderer.setRenderTarget(null);renderer.render(this.scene,this.camera);
    renderer.autoClear=false;
    try{pipeline.composite.render(renderer);}finally{renderer.autoClear=autoClear;}
  }
  // Bloom is fill-rate bound (measured: a full-size 4×MSAA HDR frame cost more
  // than the whole blur), so only the bloom source is rendered off-screen, at
  // BLOOM_SCALE of the canvas and without MSAA; it is a blur anyway.
  createBloom(){
    const {full,half}=bloomSizes(this.renderer);
    const bloomComposer=new EffectComposer(this.renderer,new THREE.WebGLRenderTarget(half.x,half.y,{type:THREE.HalfFloatType}));bloomComposer.renderToScreen=false;
    const bloomPass=new UnrealBloomPass(half.clone(),1,0.5,0);
    bloomComposer.addPass(new RenderPass(this.scene,this.camera));bloomComposer.addPass(bloomPass);
    // The blur kernels are fixed in pixels: size the mip chain for the full
    // canvas so the glow keeps its on-screen size; only the source is half size.
    bloomPass.setSize(full.x,full.y);
    // Additive in both colour and alpha: the canvas is transparent, so glow
    // spilling over the background raises alpha too (stays premultiplied).
    const composite=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{bloomTexture:{value:bloomComposer.renderTarget2.texture}},vertexShader:BLOOM_MIX_VERTEX,fragmentShader:BLOOM_MIX_FRAGMENT,depthTest:false,depthWrite:false,transparent:true,
      blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor}));
    this.bloomPipeline={bloomComposer,bloomPass,composite};
    return this.bloomPipeline;
  }
  resizeBloom(){
    const {full,half}=bloomSizes(this.renderer),{bloomComposer,bloomPass}=this.bloomPipeline;
    bloomComposer.setSize(half.x,half.y);bloomPass.setSize(full.x,full.y);
  }
  setTheme(dark) {
    this.grid.material.color.set(dark?0x826b89:0xffffff);
    this.grid.material.opacity=dark?0.3:0.5;
    if(this.root)this.renderView();
  }
  resize() {
    const {width,height}=this.viewport.getBoundingClientRect();
    if(!width||!height)return;
    this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
    this.armCamera.aspect=width/height; this.armCamera.updateProjectionMatrix();
    this.renderer.setSize(width,height,false);
    if(this.bloomPipeline)this.resizeBloom();
  }
  reset() {
    // The source viewer frames the character around its torso rather than
    // the ground plane, which keeps the model visually centered in the tall
    // preview surface.
    this.controls.reset();this.controls.target.set(0,1.28,0);
    const distance=Math.max(6.8,4.5/Math.max(this.camera.aspect,0.6));
    this.camera.position.set(0,1.28,-distance);
    this.controls.update();
  }
  setView(view) {
    const distance=this.camera.position.distanceTo(this.controls.target);
    const center=this.controls.target;
    if(view==='side')this.camera.position.set(center.x+distance,center.y,center.z);
    else this.camera.position.set(center.x,center.y,center.z+(view==='back'?distance:-distance));
    this.controls.update();
  }
  /**
   * 操控模式 (play-control.js): the model stays over the origin, turned to the
   * control's body heading and lifted by its height, while the grid scrolls
   * under it by the horizontal distance travelled. The camera orbits at the
   * control's look yaw/pitch; the wheel changes its distance.
   */
  setPlayControl(control){
    this.play=control||null;
    this.controls.enabled=!this.play;
    if(this.play){this.playDistance=PLAY_DISTANCE;this.playPan=new THREE.Vector3();this.playView='back';this.applyPlayControl();}
    else{this.root?.position.set(0,0,0);this.root?.quaternion.identity();this.grid.position.set(0,-0.035,0);this.camera.fov=VIEW_FOV;this.camera.updateProjectionMatrix();this.reset();}
    if(this.root){this.applyFrame(false);this.renderView();}
  }
  /** Puts the follow camera back at its default distance (中键 / 居中视角). */
  resetPlayZoom(){if(this.play)this.playDistance=PLAY_DISTANCE;}
  /**
   * Drags the follow camera's viewpoint by a mouse movement in pixels, in the
   * camera's screen plane, so the point under the cursor follows it (like
   * OrbitControls' pan). The offset is kept in world space next to the model.
   */
  panPlay(dx,dy){
    if(!this.play)return;
    const scale=2*this.playDistance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))/(this.viewport.clientHeight||1);
    const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,1);
    this.playPan.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale).clampLength(0,PLAY_DISTANCE_MAX);
  }
  /** Puts the viewpoint back over the model (double right-click / 居中视角). */
  resetPlayPan(){this.playPan?.set(0,0,0);}
  /** Switches the 操控模式 camera (PLAY_VIEWS: F5 cycles first person, third person back and front). */
  setPlayView(view){
    if(!PLAY_VIEWS.includes(view))return;
    this.playView=view;
    if(this.play){this.applyPlayControl();this.applyFrame(false);this.renderView();}
  }
  applyPlayControl(){
    const {yaw,bodyYaw,pitch,position}=this.play,cell=16/64,wrap=value=>((value%cell)+cell)%cell;
    if(this.root){this.root.position.set(0,position.y,0);this.root.rotation.set(0,bodyYaw,0);}
    this.grid.position.set(-wrap(position.x),-0.035,-wrap(position.z));
    // Look direction for the view yaw/pitch (pitch > 0 looks down).
    const look=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    const fov=this.playView==='first'?FIRST_PERSON_FOV:VIEW_FOV;
    if(this.camera.fov!==fov){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    if(this.playView==='first'){
      const eye=new THREE.Vector3(0,position.y+EYE_HEIGHT,0);
      this.camera.position.copy(eye);this.camera.lookAt(eye.add(look));
      // GameRenderer.bobView moves the whole first-person view while walking.
      this.camera.updateMatrix();this.camera.matrix.multiply(viewBobMatrix(this.play).invert());
      this.camera.matrix.decompose(this.camera.position,this.camera.quaternion,this.camera.scale);return;
    }
    // Third person backs off from the target along the look direction; the
    // front view turns the camera round (yaw + 180°, pitch mirrored) like CameraType.THIRD_PERSON_FRONT.
    const target=new THREE.Vector3(0,position.y+0.9,0).add(this.playPan);
    if(this.playView==='front')look.set(-look.x,-look.y,-look.z);
    // Like the game's camera collision, the ground pulls a camera that would
    // dip below it closer to the target.
    const distance=look.y>0?Math.min(this.playDistance,(target.y-PLAY_GROUND_CLEARANCE)/look.y):this.playDistance;
    this.camera.position.copy(target).addScaledVector(look,-Math.max(0,distance));
    this.camera.lookAt(target);
  }
  /**
   * Plays a clip. Locomotion loops in the main slot. Wheel actions pass
   * once:true and play on the cap layer above main, like the game's cap
   * controller: main keeps playing (kept in this.base) and the action uses its
   * own loop mode (setAnimation without a loop type): loop:true clips keep
   * looping, hold_on_last_frame clips keep their final pose, others play once,
   * hand back to main and report onAnimationEnd. animationName/time always
   * describe the clip shown on the timeline.
   */
  setAnimation(name,{once=false}={}) {
    // Main states (idle/walk/run/jump) are entered even without a clip: the
    // game's main slot then plays nothing but ctrl.<state> still drives controllers.
    const animation=this.animations[name];if(!animation&&once)return;
    if(once){
      // Switching straight from one action to another counts as stop + play:
      // one frame with ctrl.playing_extra_animation = 0, so controllers that
      // leave a state on "!ctrl.playing_extra_animation" (e.g. 苏瑞铃's BGM
      // states in pre_parallel_0) exit it, stop its sounds and can enter the
      // new action's state on the next frame.
      if(this.base)this.extraAnimationGap=true;
      else this.base={name:this.animationName,time:this.time};
      this.controllerRuntime?.restartCap();
      this.animationName=name;this.time=0;this.playing=true;this.playMode=animationLoopMode(animation);
      this.applyFrame();return;
    }
    const base=this.base;
    if(base){
      // Stopping the action (clearModelSwitch) stops the cap controller's sounds.
      this.base=null;this.controllerRuntime?.restartCap();
      if(base.name===name){this.animationName=name;this.time=base.time;this.playMode='loop';this.playing=true;this.applyFrame();return;}
    }
    this.controllerRuntime?.restartMain(name);
    this.animationName=name;this.time=0;this.playing=true;this.playMode='loop';
    this.applyFrame();
  }
  // A finished PLAY_ONCE action hands back to main; its sounds keep playing.
  endAction(){
    const base=this.base;if(!base)return;
    this.base=null;this.animationName=base.name;this.time=base.time;this.playMode='loop';
  }
  // ysm.bone_rot reads the bone as it was left by the previous frame: the game
  // writes bone transforms only after every controller has run
  // (AnimationProcessor.tickAnimation → BoneTopLevelSnapshot.reset). Models
  // such as 玛丽萝斯 rely on this to get the frame delta of query.anim_time.
  // BoneRotation returns the bone's whole rotation, the model's rest rotation
  // included (the bone holds initial + animation), as -x°, -y°, z°; tail
  // chains like 双马尾粉猫猫's feed it back into the next segment.
  bindAnimationContext(context,skeleton=()=>this.skeleton) {
    context.previousBoneParams=null;context.pivotAbs=new Map();
    context.boneRotationResolver=name=>{
      const bones=skeleton(),id=bones?.index.get(name);if(id===undefined)return {x:0,y:0,z:0};
      const p=id*9,params=context.previousBoneParams||bones.params;
      return {x:-params[p]*180/Math.PI,y:-params[p+1]*180/Math.PI,z:params[p+2]*180/Math.PI};
    };
    // bone_pos / bone_scale read the same animated values as bone_rot. The
    // game fills bone_pivot_abs while drawing a frame and keeps the last value
    // while the bone is hidden; before the first drawn frame it is 0.
    context.boneParamResolver=(kind,name)=>{
      const bones=skeleton(),id=bones?.index.get(name);if(id===undefined)return {x:0,y:0,z:0};
      const params=context.previousBoneParams||bones.params,p=id*9;
      if(kind==='position')return {x:params[p+3],y:params[p+4],z:params[p+5]};
      if(kind==='scale')return {x:params[p+6],y:params[p+7],z:params[p+8]};
      const cached=context.pivotAbs.get(id);if(cached&&cached.params===context.previousBoneParams&&cached.frame===context.boneFrame)return cached.value;
      const value=context.previousBoneParams?bones.pivotAbs(id,params)||cached?.value||{x:0,y:0,z:0}:{x:0,y:0,z:0};
      context.pivotAbs.set(id,{params:context.previousBoneParams,frame:context.boneFrame,value});return value;
    };
  }
  // Settings forms (rip.ysm.gui.molang.MolangOption): the form's `value` is
  // evaluated to read the current state, `value=<n>` is executed to write it,
  // and a radio option runs its whole label script.
  getMolangValue(expression) {
    const source=String(expression||'').trim();
    if(!source||!this.animationContext)return 0;
    try{return evaluateMolang(source,this.animationContext);}catch{return 0;}
  }
  setMolangVariable(expression,value) {
    const source=String(expression||'').trim();
    return source?this.executeMolang(`${source}=${Number(value)||0}`):false;
  }
  /**
   * 保存配置 (第 68 节): runs several statements on the main view's player,
   * then recomputes the frame once. Returns how many ran without an error.
   */
  executeMolangScripts(scripts) {
    const context=this.mainAnimationContext;if(!context||!this.root)return 0;
    let ran=0;
    for(const script of scripts){const source=String(script||'').trim();if(!source)continue;try{executeMolangStatement(source,context);ran++;}catch(error){console.warn('Could not run saved config script:',error);}}
    if(this.animationContext===context){this.applyFrame();this.renderView();}
    return ran;
  }
  /** Every number stored under v.roaming (the game keeps these per model), as {path: value}. */
  roamingValues() {
    const context=this.mainAnimationContext;if(!context)return {};
    return Object.fromEntries(inspectMolangScopes(context).filter(entry=>entry.path.startsWith('v.roaming.')&&typeof entry.value==='number'&&Number.isFinite(entry.value)).map(entry=>[entry.path,entry.value]));
  }
  executeMolang(script) {
    const source=String(script||'').trim();
    if(!source||!this.animationContext)return false;
    try{executeMolangStatement(source,this.animationContext);}catch(error){console.warn('Could not run settings script:',error);return false;}
    this.applyFrame();this.renderView();return true;
  }
  /**
   * Puts an item (an entry of hand-items.js, or null) in a hand of the main
   * view's player; the card's preview entity always holds nothing. Set
   * `handItems` before loadFiles to start a model with items in hand.
   */
  setHandItem(hand,item){
    this.handItems={...this.handItems,[hand]:item||null};
    if(!this.mainAnimationContext)return;
    bindHandItems(this.mainAnimationContext,this.handItems);if(this.arm)bindHandItems(this.arm.context,this.handItems);
    if(this.animationContext===this.mainAnimationContext){this.applyFrame();this.renderView();}
  }
  /**
   * Sets the main view's player state (player-status.js: health, hunger,
   * armor, effects, weather, biome); the card's preview entity keeps the
   * defaults. Set `playerStatus` before loadFiles to start a model with it.
   */
  setPlayerStatus(status){
    this.playerStatus=status;
    if(!this.mainAnimationContext)return;
    bindPlayerStatus(this.mainAnimationContext,status);if(this.arm)bindPlayerStatus(this.arm.context,status);
    if(this.animationContext===this.mainAnimationContext){this.applyFrame(false);this.renderView();}
  }
  /**
   * The first-person arm (PlayerModelBundle.armModel + fp_arm clips, run by
   * FirstPersonArmAnimationController) in its own scene. HandItemRenderer
   * draws the right arm with part mask TYPE_RIGHT: bones under "RightArm"
   * and "Background" (YSMClientMapper partMask; children inherit it), and
   * only when the arm model has a "RightArm" bone (GeoModel.hasCustomRightHand).
   */
  buildArm(model,files=[],rawGeometry=false){
    this.disposeArm();
    const geometry=rawGeometry?model:model?.['minecraft:geometry']?.[0];if(!geometry?.bones)return;
    const texture=this.textureVariants.find(item=>item.id===this.currentTextureId)||this.textureVariants[0];
    const materials=createModelMaterials(texture.texture,texture.hasTranslucency),root=rawGeometry?buildRawFaceModel(geometry,materials,texture.alphaCoverage):buildBedrockModel({bedrockModel:geometry},materials);
    for(const material of materials)installGpuSkinning(material,root.userData.boneTexture,this.lightUniforms);
    const skeleton=new YsmSkeleton(root.userData.skeletonBones),parts=new Uint8Array(skeleton.count);
    for(const i of skeleton.boneOrder){const name=skeleton.bones[i].name,parent=skeleton.parent[i];parts[i]=name==='LeftArm'?1:name==='RightArm'?2:name==='Background'?3:parent>=0?parts[parent]:0;}
    const animations={};for(const file of files)Object.assign(animations,file?.animations||{});
    // The arm is its own animatable (PlayerGeoEntity) sharing the player's roaming variables.
    const context=createYsmAnimationContext();context.audio=null;
    this.bindAnimationContext(context,()=>this.arm?.skeleton);shareRoamingVariables(context,this.mainAnimationContext);
    bindHandItems(context,this.handItems);bindPlayerStatus(context,this.playerStatus);
    root.matrixAutoUpdate=false;this.armScene.add(root);
    this.arm={root,materials,skeleton,parts,context,visibility:new Uint8Array(skeleton.count),rightHand:skeleton.index.has('RightArm'),
      runtime:new YsmControllerRuntime(this.controllerDefinitions,animations,{arm:true})};
  }
  disposeArm(){
    const arm=this.arm;if(!arm)return;this.arm=null;
    this.armScene.remove(arm.root);arm.root.userData.disposeExtraGeometries?.();arm.root.traverse(node=>node.geometry?.dispose());arm.root.userData.boneTexture?.dispose();
    for(const material of arm.materials)material.dispose();
  }
  /** Whether the first-person arm is drawn: first person, an empty main hand (renderArmWithItem) and a custom right arm. */
  get firstPersonArmVisible(){
    if(!this.play||this.playView!=='first'||!this.arm?.rightHand)return false;
    // The hand shows the item ItemInHandRenderer still holds while it lowers.
    const shown=this.play.actions.shownMainHand;
    return !(shown===undefined?this.handItems.mainhand:shown);
  }
  updateFirstPersonArm(advance){
    const {skeleton,context,runtime,root,parts,visibility}=this.arm;
    skeleton.reset();
    context.time=this.elapsedTime;context.lifeTime=this.elapsedTime;context.query.anim_time=this.elapsedTime;context.query.life_time=this.elapsedTime;
    bindMovementQueries(context,this.play);bindItemActionQueries(context,this.play.actions);context.ysm.person_view=0;context.query.is_first_person=1;
    runtime.apply({skeleton,context,now:this.elapsedTime,main:null,cap:null,advance});
    if(advance)rememberBoneParams(context,skeleton);
    const matrices=skeleton.computeMatrices();
    for(let i=0;i<skeleton.count;i++)visibility[i]=skeleton.visible[i]&&(parts[i]===2||parts[i]===3)?1:0;
    root.userData.setAnimationBoneVisibility(visibility);root.userData.updateBoneTexture(matrices,skeleton.normalMatrices);
    root.matrix.copy(firstPersonArmMatrix(this.play));root.matrixWorldNeedsUpdate=true;
  }
  /** Draws the arm over the frame just rendered; its lights stay fixed in the world like the level's. */
  renderFirstPersonArm(){
    this.arm.root.userData.prepareCulling?.(this.armCamera,'arm');
    const view=this.camera.matrixWorldInverse,direction=this.keyLight.position.clone().normalize().transformDirection(view);
    this.armKeyLight.position.copy(direction);this.armAmbient.position.set(0,1,0).transformDirection(view);
    const renderer=this.renderer,autoClear=renderer.autoClear;
    renderer.setRenderTarget(null);renderer.autoClear=false;renderer.clearDepth();
    try{renderer.render(this.armScene,this.armCamera);}finally{renderer.autoClear=autoClear;}
  }
  // ---- Character card (YSM model picker preview) ----
  get cardAnimationName(){return this.previewAnimationName&&this.animations?.[this.previewAnimationName]?this.previewAnimationName:null;}
  createCardState(warmUp=this.card?.warmUp??1){
    // The GUI card uses the preview entity: its own Molang context and a
    // controller pipeline that skips armor controllers.
    // `time`/`elapsed` is the preview clip time shown on the slider; `clock`
    // is the entity's life time and only moves forward.
    const context=createYsmAnimationContext();this.bindAnimationContext(context);context.previewEntity=true;
    const state={context,runtime:new YsmControllerRuntime(this.controllerDefinitions,this.animations,{preview:true}),time:0,elapsed:0,clock:0};
    this.warmUpCardState(state,warmUp);
    return state;
  }
  // ysm.second_order springs start at 0 and controller states take a few
  // frames to settle, so a fresh card shows ribbons and outfit parts growing
  // in (长门). The game's preview entity lives on while the screen is open;
  // run `seconds` (设置 → 人物卡 → 预热时间; 0 = a freshly opened screen) at
  // the clip's first frame so the card starts settled.
  warmUpCardState(state,seconds=1,step=1/60){
    const steps=Math.max(0,Math.round((Number(seconds)||0)/step));
    this.withCardPose(state,0,()=>{
      for(let i=0;i<steps;i++){state.clock+=step;advanceYsmPhysics(state.context,step);this.elapsedTime=state.clock;this.applyFrame(true);}
    });
    state.runtime.restartMain(this.cardAnimationName);
  }
  // Applies the card animation state and ModelPreviewRenderer's pose, runs fn,
  // then restores the main viewer's state. The bone texture is left holding
  // the card pose; the main loop re-applies its own frame before rendering.
  withCardPose(state,guiHeight,fn){
    const saved={time:this.time,elapsedTime:this.elapsedTime,animationName:this.animationName,base:this.base,playMode:this.playMode,animationContext:this.animationContext,controllerRuntime:this.controllerRuntime,quaternion:this.root.quaternion.clone(),position:this.root.position.clone(),scale:this.root.scale.clone(),rootPose:this.rootPose.clone(),grid:this.grid.visible};
    // Match ModelPreviewRenderer.renderLivingEntityPreview and ModelButton:
    // the 52x90 button clips the preview to 52x70 and draws at GUI scale 30.
    // The entity yaw is 200° (180° with rotation disabled) and the outer
    // transform is pitched by -10° (0° when disabled).
    const pose=previewCardPose(this.disablePreviewRotation);
    this.animationName=this.cardAnimationName;this.base=null;this.playMode='loop';this.animationContext=state.context;this.controllerRuntime=state.runtime;
    this.time=state.time;this.elapsedTime=state.clock;this.grid.visible=false;
    // The GUI preview always renders at packed light (15,15).
    const light={normal:this.lightUniforms.ysmLight.value,glow:this.lightUniforms.ysmGlowLight.value};
    this.lightUniforms.ysmLight.value=1;this.lightUniforms.ysmGlowLight.value=1;
    // 光照调节 only changes the main view: the card renders with the default rig.
    const rig={position:this.keyLight.position.clone(),intensity:this.keyLight.intensity,color:this.keyLight.color.clone(),ambient:this.ambientLight.intensity,marker:this.lightMarker.visible};
    this.keyLight.position.copy(DEFAULT_LIGHT_POSITION);this.keyLight.intensity=DEFAULT_LIGHTING.intensity;this.keyLight.color.set(DEFAULT_LIGHTING.color);
    this.ambientLight.intensity=DEFAULT_LIGHTING.ambient;this.lightMarker.visible=false;
    this.rootPose.identity();
    this.root.scale.set(this.modelScale.x*30,this.modelScale.y*30,this.modelScale.z*30);
    const tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),THREE.MathUtils.degToRad(pose.pitch));
    const yaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(pose.yawOffset));
    this.root.quaternion.copy(tilt).multiply(yaw);
    // ModelButton renders at y + height/2 + 20, so the ground line sits 65 GUI
    // pixels below the clipped preview top (root.position is in GUI units).
    this.root.position.set(0,guiHeight/2-pose.baseline,0);
    try{return fn();}
    finally{
      this.time=saved.time;this.elapsedTime=saved.elapsedTime;this.animationName=saved.animationName;this.base=saved.base;this.playMode=saved.playMode;this.animationContext=saved.animationContext;this.controllerRuntime=saved.controllerRuntime;
      this.lightUniforms.ysmLight.value=light.normal;this.lightUniforms.ysmGlowLight.value=light.glow;
      this.keyLight.position.copy(rig.position);this.keyLight.intensity=rig.intensity;this.keyLight.color.copy(rig.color);this.ambientLight.intensity=rig.ambient;this.lightMarker.visible=rig.marker;
      this.root.quaternion.copy(saved.quaternion);this.root.position.copy(saved.position);this.root.scale.copy(saved.scale);this.rootPose.copy(saved.rootPose);this.grid.visible=saved.grid;
    }
  }
  // Fixed GUI-scale orthographic view: 52 GUI pixels span the card width.
  cardCamera(width,height){
    const guiHeight=height/(width/52),camera=new THREE.OrthographicCamera(-26,26,guiHeight/2,-guiHeight/2,0.01,5000);
    // Bedrock's model front faces -Z; view the unmirrored model from the front.
    camera.position.set(0,0,-1000);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
    return {camera,guiHeight};
  }
  /**
   * Plays the preview animation live in the sidebar card canvas. Without
   * preview_animation the game's preview entity plays nothing (main and cap
   * stop), so the card shows the authored pose plus the parallel layers.
   */
  startCardPreview(canvas,{duration=5,warmUp=1,onTime=null}={}){
    this.stopCardPreview();
    if(!this.root)return false;
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});
    renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x000000,0);
    this.card={canvas,renderer,duration:Math.max(0.1,Number(duration)||5),onTime,playing:true,dirty:true,warmUp,state:this.createCardState(warmUp),camera:null,guiHeight:0,
      gui:{hovered:false,focused:false,hoverAt:-Infinity}};
    // Clips on the card's GUI controllers (hover / focus) play their sound keyframes.
    this.card.state.context.guiAudio=this.audio;
    // Observers come from the canvas's own window: the card may live in a
    // 独立窗口 popup (第 62 节), whose layout this window's observers never see.
    const cardWindow=canvas.ownerDocument.defaultView||window;
    this.card.observer=new cardWindow.ResizeObserver(()=>this.resizeCard());this.card.observer.observe(canvas);
    // The card pauses while it is off screen (the model library page hides the
    // viewer, or the sidebar is scrolled away), like it does during a drag:
    // its time does not run on, so it resumes where it was.
    const card=this.card;
    card.visibility=new cardWindow.IntersectionObserver(entries=>{card.visible=entries.at(-1).isIntersecting;if(card.visible){card.dirty=true;this.ensureLoop();}});
    card.visibility.observe(canvas);
    this.resizeCard();this.ensureLoop();
    return true;
  }
  stopCardPreview(){
    if(!this.card)return;
    this.card.state.runtime.stopSounds();
    this.card.observer.disconnect();this.card.visibility.disconnect();this.card.renderer.dispose();this.card=null;
  }
  /**
   * Mouse and focus state of the sidebar card, like the in-game ModelButton:
   * hovering loops the model's `hover` clip (then `hover_fadeout` for its
   * length after leaving) and the focused (clicked) card loops `focus`.
   */
  setCardInteraction({hovered,focused}={}){
    const gui=this.card?.gui;if(!gui)return;
    if(hovered!==undefined)gui.hovered=Boolean(hovered);
    if(focused!==undefined)gui.focused=Boolean(focused);
    this.card.dirty=true;this.ensureLoop();
  }
  // ModelButton.renderWidget: the clip names for this frame, timed on the
  // preview entity's clock (so a paused card holds them).
  updateCardGui(){
    const card=this.card,gui=card.gui,clock=card.state.clock,animations=this.animations||{};
    if(gui.hovered)gui.hoverAt=clock;
    const fadeout=animations.hover_fadeout?animationLength(animations.hover_fadeout):0;
    const hover=gui.hovered?(animations.hover?'hover':'empty'):clock-gui.hoverAt<fadeout?'hover_fadeout':'empty';
    card.state.runtime.setGuiAnimations({hover,focus:gui.focused&&animations.focus?'focus':'empty'});
  }
  /**
   * Selecting a model in the game switches the player to it: the player's
   * controllers are rebuilt (GeoEntity.onModelLoaded), so their first states
   * run again and play their sounds (Doro's player.parallel_4 plays 提示).
   * Molang variables are kept, like the per-model variables the game keeps.
   */
  replayModelSelection(){
    if(!this.root||!this.controllerRuntime||this.animationContext!==this.mainAnimationContext)return;
    this.controllerRuntime.stopSounds();this.audio?.stopAll();this.controllerRuntime.reset();
    if(this.arm)this.arm.runtime.reset();
    this.applyFrame(true);this.renderView();
  }
  resizeCard(){
    const card=this.card;if(!card)return;
    const bounds=card.canvas.getBoundingClientRect(),ratio=(card.canvas.ownerDocument.defaultView||window).devicePixelRatio||1;
    const width=Math.max(1,Math.round(bounds.width*ratio)),height=Math.max(1,Math.round(bounds.height*ratio));
    card.renderer.setSize(width,height,false);
    Object.assign(card,this.cardCamera(width,height));card.dirty=true;this.ensureLoop();
  }
  setCardPlaying(playing){if(!this.card)return;this.card.playing=Boolean(playing);this.card.dirty=true;this.ensureLoop();}
  /**
   * Jumps the card's clip to a time. Physics and variables carry over (the
   * preview entity keeps its state), so the frame shows a settled model.
   */
  seekCard(time){
    const card=this.card;if(!card)return;
    const state=card.state,target=Math.min(card.duration,Math.max(0,Number(time)||0));
    if(target<state.elapsed)state.runtime.restartMain(this.cardAnimationName);
    state.elapsed=target;state.time=target;card.dirty=true;this.ensureLoop();
  }
  advanceCard(delta){
    const card=this.card,state=card.state;
    state.elapsed+=delta;state.clock+=delta;advanceYsmPhysics(state.context,delta);
    // Loop the (capped) preview duration like the in-game preview restarting
    // its clip; the entity's physics and variables are not reset.
    if(state.elapsed>card.duration){state.elapsed=0;state.runtime.restartMain(this.cardAnimationName);}
    state.time=state.elapsed;
  }
  renderCard(){
    const card=this.card;if(!card?.camera)return;
    this.updateCardGui();
    this.withCardPose(card.state,card.guiHeight,()=>{this.applyFrame(true);this.root.userData.prepareCulling?.(card.camera,'card');card.renderer.render(this.scene,card.camera);});
    card.dirty=false;card.onTime?.(card.state.time,card.duration);
  }
  /**
   * Renders the card frame at `time` seconds (with background, foreground and
   * title) as a PNG.
   */
  async renderCardImage({width=300,height=400,fullCardHeight=null,includeCardChrome=true,title='',time=0}={}){
    if(!this.root)return null;
    const cardHeight=includeCardChrome?Math.max(height,Number(fullCardHeight)||Math.round(height*9/7)):height;
    this.renderSuspended=true;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x000000,0);
    try{
      const {camera,guiHeight}=this.cardCamera(width,height),target=Math.max(0,Number(time)||0);
      // Save exactly what the card shows: its live state when it is on the
      // requested frame (paused on the slider). A fresh state would restart
      // physics and controller states and miss parts of the model.
      const live=this.card?.state,useLive=live&&Math.abs(live.time-target)<1e-6;
      const state=useLive?live:this.createCardState();
      if(!useLive&&target>0){state.elapsed=target;state.time=target;this.withCardPose(state,guiHeight,()=>this.applyFrame(true));}
      await renderer.compileAsync(this.scene,camera);
      this.withCardPose(state,guiHeight,()=>{this.applyFrame(false);this.root.userData.prepareCulling?.(camera,'card');renderer.render(this.scene,camera);});
      renderer.getContext().finish();
      const surface=document.createElement('canvas');surface.width=width;surface.height=cardHeight;
      this.composeCardFrame(surface.getContext('2d'),canvas,{width,height,cardHeight,includeCardChrome,title});
      return await new Promise((resolve,reject)=>surface.toBlob(blob=>blob?resolve(blob):reject(new Error(tr('无法生成封面 PNG'))),'image/png'));
    }finally{
      // Release the context now; batch renders (library covers) would otherwise
      // exhaust the browser's WebGL context limit.
      renderer.dispose();renderer.forceContextLoss();this.renderSuspended=false;
      if(this.card)this.card.dirty=true;
      this.applyFrame(false);this.ensureLoop();
    }
  }
  // Card background, the rendered preview, foreground and title.
  composeCardFrame(ctx,preview,{width,height,cardHeight,includeCardChrome=true,title=''}){
    ctx.clearRect(0,0,width,cardHeight);ctx.imageSmoothingEnabled=false;
    if(includeCardChrome&&this.cardBackgroundImage)ctx.drawImage(this.cardBackgroundImage,0,0,width,cardHeight);
    ctx.drawImage(preview,0,0,width,height);
    if(includeCardChrome){if(this.cardForegroundImage)ctx.drawImage(this.cardForegroundImage,0,0,width,cardHeight);drawCardTitle(ctx,title,width,height,cardHeight);}
  }
  /**
   * Renders `frameCount` card frames at `fps` for an animated export and
   * passes each composed frame to `onFrame(canvas, index)`. A fresh, warmed
   * preview entity plays from 0 s like the live card; the clip loops every
   * `duration` seconds while physics and variables carry on. Physics is
   * stepped at 60 Hz or finer whatever the output frame rate.
   */
  async renderCardAnimation({width=300,height=400,fullCardHeight=null,title='',fps=30,duration=5,frameCount=1,onFrame,onProgress=null,signal=null}={}){
    if(!this.root)return false;
    const cardHeight=Math.max(height,Number(fullCardHeight)||Math.round(height*9/7));
    this.renderSuspended=true;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x000000,0);
    try{
      const {camera,guiHeight}=this.cardCamera(width,height),state=this.createCardState();
      const step=1/fps,substeps=Math.max(1,Math.ceil(step*60-1e-6)),dt=step/substeps,perLoop=Math.max(1,Math.round(duration*fps));
      const surface=document.createElement('canvas');surface.width=width;surface.height=cardHeight;
      const ctx=surface.getContext('2d',{willReadFrequently:true});
      await renderer.compileAsync(this.scene,camera);
      for(let i=0;i<frameCount;i++){
        signal?.throwIfAborted();
        this.withCardPose(state,guiHeight,()=>{
          if(i>0)for(let s=0;s<substeps;s++){
            state.clock+=dt;advanceYsmPhysics(state.context,dt);
            const last=s===substeps-1;
            if(last&&i%perLoop===0){state.elapsed=0;state.runtime.restartMain(this.cardAnimationName);}
            else state.elapsed=last?(i%perLoop)/fps:state.elapsed+dt;
            state.time=state.elapsed;this.time=state.time;this.elapsedTime=state.clock;
            if(!last)this.applyFrame(true);
          }
          this.applyFrame(true);this.root.userData.prepareCulling?.(camera,'card');renderer.render(this.scene,camera);
        });
        this.composeCardFrame(ctx,canvas,{width,height,cardHeight,title});
        await onFrame(surface,i);
        onProgress?.(i+1,frameCount);
        // Let the page paint progress between frames.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      return true;
    }finally{
      renderer.dispose();renderer.forceContextLoss();this.renderSuspended=false;
      if(this.card)this.card.dirty=true;
      this.applyFrame(false);this.ensureLoop();
    }
  }
  seek(time) { this.time=Math.max(0,Math.min(time,this.duration));this.playing=false;this.applyFrame();this.onTime(this.time,this.duration); }
  /**
   * 设置 → 性能 → Benchmark: `callback(now, cpuMs, renderInfo)` runs after each
   * main-view frame (null turns it off). The render statistics are reset per
   * frame instead of per render call so bloom passes and the first-person arm count too.
   */
  setBenchmark(callback){this.onBenchmark=callback||null;this.renderer.info.autoReset=!callback;}
  setActive(active) {
    if(this.active===active)return; this.active=active;
    if(!active)this.audio?.stopAll();
    if(active){this.resize();this.ensureLoop();}
  }
  // One animation loop drives both the 3D view (when its tab is visible) and
  // the sidebar card, which stays live on every tab while it is on screen.
  get cardLive(){return Boolean(this.card)&&this.card.visible!==false;}
  ensureLoop(){
    if(this.frame||(!this.active&&!this.cardLive))return;
    this.lastTime=performance.now();this.scheduleFrame();
  }
  // 设置 → 性能 → 解除帧率上限: requestAnimationFrame runs at the display
  // refresh rate, so the uncapped loop schedules the next frame as a message
  // task instead (unthrottled, unlike setTimeout). It falls back to rAF while
  // the 3D view is not shown or the page is hidden, so it never spins idle.
  // `frameToken` makes a stale message (after a switch) a no-op.
  scheduleFrame(){
    const token=++this.frameToken;
    if(this.uncapped&&this.active&&!document.hidden){
      if(!this.frameChannel){this.frameChannel=new MessageChannel();this.frameChannel.port1.onmessage=event=>{if(event.data===this.frameToken)this.tick(performance.now());};}
      this.frame=-1;this.frameChannel.port2.postMessage(token);
    }else{this.frameWindow=this.loopWindow;this.frame=this.frameWindow.requestAnimationFrame(this.tick);}
  }
  cancelFrame(){if(this.frame>0)(this.frameWindow||window).cancelAnimationFrame(this.frame);this.frame=0;this.frameToken++;}
  /** The card's window when the card is popped out and only that window is visible, else this one. */
  get cardWindow(){const view=this.card?.canvas.ownerDocument.defaultView;return view&&view!==window&&!view.closed?view:null;}
  get loopWindow(){const view=this.cardWindow;return document.hidden&&view&&!view.document.hidden?view:window;}
  setUncapped(uncapped){
    uncapped=Boolean(uncapped);if(this.uncapped===uncapped)return;
    this.uncapped=uncapped;if(this.frame){this.cancelFrame();this.scheduleFrame();}
  }
  tick(now) {
    this.frame=0;
    if(!this.active&&!this.cardLive)return;
    const delta=Math.max(0,Math.min((now-this.lastTime)/1000,0.1));this.lastTime=now;
    const cardWindow=this.cardWindow,cardShown=cardWindow?!cardWindow.document.hidden:!document.hidden;
    if((!document.hidden||cardShown)&&!this.renderSuspended){
      const interacting=this.active&&(this.dragging||now<this.interactUntil);
      if(this.cardLive&&cardShown&&!interacting){if(this.card.playing){this.advanceCard(delta);this.card.dirty=true;}if(this.card.dirty&&(!this.uncapped||now-this.cardRenderedAt>=15)){this.renderCard();this.cardRenderedAt=now;}}
      if(this.active&&!document.hidden){
        const benchmark=this.onBenchmark,start=benchmark?performance.now():0;
        if(benchmark)this.renderer.info.reset();
        if(this.playing){
          const elapsed=delta*this.speed;this.elapsedTime+=elapsed;advanceYsmPhysics(this.animationContext,elapsed);if(this.firstPersonArmVisible)advanceYsmPhysics(this.arm.context,elapsed);
          if(this.base)this.base.time=this.loopTime(this.mainClipName(this.base.name),this.base.time+elapsed);
          if(!this.playMode||this.playMode==='loop')this.time=this.loopTime(this.base?this.animationName:this.mainClipName(this.animationName),this.time+elapsed);
          else{
            // A clip without animation_length never ends (it simply holds its last keyframes).
            const length=animationLength(this.animations?.[this.animationName]);
            this.time+=elapsed;
            if(this.time>=length){this.time=length;if(this.playMode==='once'){const name=this.animationName;if(this.base)this.endAction();else this.playMode='hold';this.onAnimationEnd?.(name);}}
          }
        }
        // Movement runs on real time, independent of the playback speed and pause.
        if(this.play){this.play.elytra=!!this.playerStatus?.armor?.elytra;this.play.update(delta);this.play.actions.update(delta,this.handItems,{swingTicks:swingDuration(this.playerStatus?.effects)});this.applyPlayControl();}
        this.applyFrame();this.onMainFrame?.();if(!this.play)this.controls.update(delta);this.renderView();
        this.onTime(this.time,this.duration);
        benchmark?.(now,performance.now()-start,this.renderer.info.render);
      }
    }
    this.scheduleFrame();
  }
  applyFrame(advanceTimeline=true) {
    if(!this.skeleton||!this.root)return;
    // Layers follow the game's controller order (see ysm-controller.js).
    this.skeleton.reset();
    const context=this.animationContext;
    context.time=this.time;context.lifeTime=this.elapsedTime;context.query.anim_time=this.time;context.query.life_time=this.elapsedTime;
    const base=this.base,mainName=base?base.name:this.animationName;
    const gap=context===this.mainAnimationContext&&this.extraAnimationGap;if(gap&&advanceTimeline)this.extraAnimationGap=false;
    context.ctrl.playing_extra_animation=!gap&&(base||this.extraAnimationNames?.has(this.animationName))?1:0;
    for(const name of ['idle','walk','run','jump','sneak','sneaking','fly','elytra_fly','swim','swim_stand'])context.ctrl[name]=mainName===name?1:0;
    // The main view's player: live movement in 操控模式, otherwise the pose of the main state.
    if(context===this.mainAnimationContext){
      bindMovementQueries(context,this.play||mainName);bindItemActionQueries(context,this.play?.actions||null);
      // CameraUtil.getCameraType: the camera type for the player (third person back outside 操控模式).
      const view=this.play?PLAY_VIEWS.indexOf(this.playView):1;
      context.ysm.person_view=view;context.query.is_first_person=view===0?1:0;
    }
    const main=base?(base.name?{name:base.name,time:base.time,loop:true}:null):this.animationName?{name:this.animationName,time:this.time,loop:!this.playMode||this.playMode==='loop'}:null;
    const cap=base?{name:this.animationName,time:this.time,mode:this.playMode}:null;
    this.controllerRuntime?.apply({skeleton:this.skeleton,context,now:this.elapsedTime,main,cap,advance:advanceTimeline});
    if(advanceTimeline)rememberBoneParams(context,this.skeleton);
    // LivingAnimatable.applyHeadTracking: after the animations the `Head` bone
    // turns with the view (x += headPitch, y += netHeadYaw). The game resets it
    // before the next frame's animations, so bone queries never see it.
    if(context===this.mainAnimationContext){
      const head=this.skeleton.index.get('Head'),pitch=Number(context.query.head_y_rotation)||0,yaw=Number(context.query.head_x_rotation)||0;
      if(head!==undefined&&(pitch||yaw)){this.skeleton.params[head*9]+=pitch*Math.PI/180;this.skeleton.params[head*9+1]+=yaw*Math.PI/180;}
    }
    if(context===this.mainAnimationContext&&this.firstPersonArmVisible)this.updateFirstPersonArm(advanceTimeline);
    const matrices=this.skeleton.computeMatrices(this.rootPose);
    this.root.userData.setAnimationBoneVisibility(this.skeleton.visible);
    this.root.userData.updateBoneTexture(matrices,this.skeleton.normalMatrices);
  }
  /** Renders the current view without the grid or light marker and resolves to a PNG blob. */
  screenshot(watermark={}) {
    const gridVisible=this.grid.visible,markerVisible=this.lightMarker.visible;let image;
    try{
      this.grid.visible=false;this.lightMarker.visible=false;this.renderView();
      if(watermark.enabled&&String(watermark.text||'').trim()){
        const output=document.createElement('canvas');output.width=this.canvas.width;output.height=this.canvas.height;
        const context=output.getContext('2d');context.drawImage(this.canvas,0,0);drawTiledWatermark(context,watermark.text,watermark.color,watermark.opacity,output.width,output.height);image=output.toDataURL('image/png');
      }else image=this.canvas.toDataURL('image/png');
    }
    finally{this.grid.visible=gridVisible;this.lightMarker.visible=markerVisible;this.renderView();}
    return fetch(image).then(response=>response.blob());
  }
  dispose() {
    this.setActive(false);this.stopCardPreview();this.audio?.dispose();this.audio=null;this.cancelFrame();this.resizeObserver.disconnect();this.canvas.removeEventListener('wheel',this.onWheel);this.controls.dispose();
    this.root?.userData.disposeExtraGeometries?.();this.root?.traverse(o=>o.geometry?.dispose());this.root?.userData.boneTexture?.dispose();this.material?.dispose();this.translucentMaterial?.dispose();this.disposeArm();
    for(const entry of this.textureVariants||[]){entry.texture.dispose();entry.texture.image?.close?.();}
    this.releaseCardLayers();
    this.grid.geometry.dispose();this.grid.material.dispose();this.lightMarker.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});
    if(this.bloomPipeline){const {bloomComposer,bloomPass,composite}=this.bloomPipeline;bloomComposer.dispose();bloomPass.dispose();composite.material.dispose();composite.dispose();this.bloomPipeline=null;}this.renderer.dispose();
  }
}

function isYsmFlagEnabled(value){
  return value===true||value===1||(typeof value==='string'&&/^(?:true|1)$/i.test(value.trim()));
}

// LightTexture.updateLightTexture for sky light `level` in the overworld at
// day (ambient 0, default gamma 0.5), as a grey brightness.
function lightMapBrightness(level){
  const f=Math.min(15,Math.max(0,Number(level)||0))/15,lerp=(a,b,t)=>a+(b-a)*t;
  let v=lerp(f/(4-3*f),0.75,0.04);
  v=lerp(v,1-(1-v)**4,0.5);v=lerp(v,0.75,0.04);
  return Math.min(1,Math.max(0,v));
}
// The opaque and translucent passes of a model over one texture.
function createModelMaterials(texture,hasTranslucency){
  // The original asset is unlit pixel artwork, so retain its authored colors.
  const opaque=new THREE.MeshLambertMaterial({map:texture,side:THREE.FrontSide,alphaTest:0.99,transparent:false,depthWrite:true});
  // YSM keeps depth writes enabled in its blended alpha pass. Disabling
  // them here lets translucent rear bone surfaces leak through front seams.
  const translucent=new THREE.MeshLambertMaterial({map:texture,side:THREE.FrontSide,alphaTest:0.1,transparent:true,depthWrite:true});
  translucent.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\n#ifdef USE_ALPHATEST\nif ( diffuseColor.a >= 0.99 ) discard;\n#endif');
  };
  translucent.visible=hasTranslucency;
  return [opaque,translucent];
}
// First-person arm placement in view space (blocks): the vanilla view bob
// (GameRenderer.bobView), the hand sway (ItemInHandRenderer.renderHandsWithItems),
// ItemInHandRenderer.renderPlayerArm for the right arm with the main hand's
// swing (attack animation) and equip progress, then YSM's HandItemRenderer
// offset and flip (YSM draws the arm in place of PlayerRenderer.renderRightHand).
function viewBobMatrix(play){
  const walk=-play.walkDistance*Math.PI,bob=play.bob,deg=THREE.MathUtils.degToRad,t=new THREE.Matrix4();
  return new THREE.Matrix4().makeTranslation(Math.sin(walk)*bob*0.5,-Math.abs(Math.cos(walk)*bob),0)
    .multiply(t.makeRotationZ(deg(Math.sin(walk)*bob*3))).multiply(t.makeRotationX(deg(Math.abs(Math.cos(walk-0.2)*bob)*5)));
}
function firstPersonArmMatrix(play){
  const deg=THREE.MathUtils.degToRad,t=new THREE.Matrix4(),m=viewBobMatrix(play);
  const xRot=play.pitch*180/Math.PI,yRot=-play.yaw*180/Math.PI;
  m.multiply(t.makeRotationX(deg((xRot-play.xBob)*0.1))).multiply(t.makeRotationY(deg((yRot-play.yBob)*0.1)));
  const actions=play.actions,swing=actions.swingingArm==='mainhand'?actions.attackTime():0,equip=actions.equipProgress();
  const root=Math.sqrt(swing),pi=Math.PI;
  m.multiply(t.makeTranslation(-0.3*Math.sin(root*pi)+0.64,0.4*Math.sin(root*pi*2)-0.6-0.6*equip,-0.4*Math.sin(swing*pi)-0.72)).multiply(t.makeRotationY(deg(45)));
  m.multiply(t.makeRotationY(deg(Math.sin(root*pi)*70))).multiply(t.makeRotationZ(deg(Math.sin(swing*swing*pi)*-20)));
  m.multiply(t.makeTranslation(-1,3.6,3.5)).multiply(t.makeRotationZ(deg(120))).multiply(t.makeRotationX(deg(200))).multiply(t.makeRotationY(deg(-135))).multiply(t.makeTranslation(5.6,0,0));
  return m.multiply(t.makeTranslation(-0.25,1.8,0)).multiply(t.makeScale(-1,-1,1));
}
function installGpuSkinning(material,boneTexture,lightUniforms){
  const previousCompile=material.onBeforeCompile;
  const previousCacheKey=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=shader=>{
    previousCompile?.(shader,material.renderer);
    shader.uniforms.ysmBoneTexture={value:boneTexture};
    shader.uniforms.ysmBoneTextureHeight={value:boneTexture.image.height};
    shader.uniforms.ysmLight=lightUniforms.ysmLight;shader.uniforms.ysmGlowLight=lightUniforms.ysmGlowLight;shader.uniforms.ysmBloomMask=lightUniforms.ysmBloomMask;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute float ysmBoneIndex;
attribute float ysmGlow;
attribute vec4 ysmUvRect;
uniform sampler2D ysmBoneTexture;
uniform float ysmBoneTextureHeight;
varying float vYsmBoneVisible;
varying float vYsmGlow;
flat varying vec4 vYsmUvRect;
vec4 ysmBoneTexel(float column){return texture2D(ysmBoneTexture,vec2((column+0.5)/8.0,(ysmBoneIndex+0.5)/ysmBoneTextureHeight));}`);
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
mat3 ysmBoneNormal=mat3(ysmBoneTexel(4.0).xyz,ysmBoneTexel(5.0).xyz,ysmBoneTexel(6.0).xyz);
objectNormal=normalize(ysmBoneNormal*objectNormal);
vYsmBoneVisible=ysmBoneTexel(7.0).r;
vYsmGlow=ysmGlow;
vYsmUvRect=ysmUvRect;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
mat4 ysmBoneMatrix=mat4(ysmBoneTexel(0.0),ysmBoneTexel(1.0),ysmBoneTexel(2.0),ysmBoneTexel(3.0));
transformed=(ysmBoneMatrix*vec4(transformed,1.0)).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nflat varying vec4 vYsmUvRect;\nvarying float vYsmBoneVisible;\nvarying float vYsmGlow;\nuniform float ysmLight;\nuniform float ysmGlowLight;\nuniform float ysmBloomMask;');
    // Sample only inside the face's own texture rect (see ysmUvRect in
    // bedrock.js), 1/100 texel in from its border; zero-width rects keep their line.
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 ysmUvInset=min(0.01/vec2(textureSize(map,0)),(vYsmUvRect.zw-vYsmUvRect.xy)*0.5);
diffuseColor*=texture2D(map,clamp(vMapUv,vYsmUvRect.xy+ysmUvInset,vYsmUvRect.zw-ysmUvInset));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight*=mix(ysmLight,ysmGlowLight,vYsmGlow)*mix(1.0,vYsmGlow,ysmBloomMask);\n#include <opaque_fragment>');
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(vYsmBoneVisible<0.5)discard;');
  };
  material.customProgramCacheKey=()=>`${previousCacheKey()}|ysm-gpu-skin-v3`;
}

// Mirror the two ModelPreviewRenderer angle branches used by YSM's model picker.
// With disable_preview_rotation enabled, the model faces straight forward and
// the source renderer adds its 5.5 GUI-unit vertical offset.
function previewCardPose(disableRotation){
  return disableRotation?{yawOffset:0,pitch:0,baseline:70.5}:{yawOffset:-20,pitch:-10,baseline:65};
}

function drawCardTitle(ctx,value,width,previewHeight,cardHeight){
  const colors={0:'#000000',1:'#0000aa',2:'#00aa00',3:'#00aaaa',4:'#aa0000',5:'#aa00aa',6:'#ffaa00',7:'#aaaaaa',8:'#555555',9:'#5555ff',a:'#55ff55',b:'#55ffff',c:'#ff5555',d:'#ff55ff',e:'#ffff55',f:'#ffffff'};
  const runs=[];let style={color:'#f4edf4',bold:false,italic:false},buffer='';
  const flush=()=>{if(buffer){runs.push({text:buffer,...style});buffer='';}};
  const text=String(value??'');
  for(let i=0;i<text.length;i++){
    if(text[i]!=='§'||i+1>=text.length){buffer+=text[i];continue;}
    const hex=/^§x(?:§[0-9a-f]){6}/i.exec(text.slice(i));
    if(hex){flush();style={...style,color:'#'+[...hex[0].matchAll(/§([0-9a-f])/gi)].map(match=>match[1]).join(''),bold:false,italic:false};i+=hex[0].length-1;continue;}
    const code=text[i+1].toLowerCase();if(!/[0-9a-fk-or]/.test(code)){buffer+=text[i];continue;}flush();i++;
    if(colors[code])style={color:colors[code],bold:false,italic:false};else if(code==='r')style={color:'#f4edf4',bold:false,italic:false};else if(code==='l')style={...style,bold:true};else if(code==='o')style={...style,italic:true};
  }
  flush();
  const scale=width/300,size=22*scale,lineHeight=28*scale,maxWidth=width-28*scale,lines=[[]];
  const setFont=run=>{ctx.font=`${run.italic?'italic ':''}${run.bold?'700':'600'} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;};
  for(const run of runs)for(const char of run.text){
    if(char==='\n'){lines.push([]);continue;}
    setFont(run);const current=lines.at(-1),lineWidth=current.reduce((sum,item)=>{setFont(item);return sum+ctx.measureText(item.text).width;},0);
    if(current.length&&lineWidth+ctx.measureText(char).width>maxWidth)lines.push([]);
    lines.at(-1).push({...run,text:char});
  }
  const visibleLines=lines.slice(0,Math.max(1,Math.floor((cardHeight-previewHeight-12*scale)/(24*scale)))),footerHeight=cardHeight-previewHeight,startY=previewHeight+(footerHeight-visibleLines.length*lineHeight)/2+size;
  ctx.save();ctx.textBaseline='alphabetic';ctx.shadowColor='#000b';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
  visibleLines.forEach((line,index)=>{
    const lineWidth=line.reduce((sum,run)=>{setFont(run);return sum+ctx.measureText(run.text).width;},0);let x=(width-lineWidth)/2,y=startY+index*lineHeight;
    for(const run of line){setFont(run);ctx.fillStyle=run.color;ctx.fillText(run.text,x,y);x+=ctx.measureText(run.text).width;}
  });
  ctx.restore();
}

const BLOOM_MIX_VERTEX='varying vec2 vUv;\nvoid main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
// The blurred bloom, tone mapped but left linear: the frame below is already
// sRGB, and adding sRGB-encoded glow would inflate its faint tails (0.05 linear
// reads as 0.25), turning a halo into haze. Linear addition stays close to the
// exact sRGB(tonemap(frame + bloom)). Alpha is its brightest channel so the
// glow also shows over the transparent background.
const BLOOM_MIX_FRAGMENT='uniform sampler2D bloomTexture;\nvarying vec2 vUv;\nvoid main(){gl_FragColor=vec4(texture2D(bloomTexture,vUv).rgb,1.0);\n#include <tonemapping_fragment>\ngl_FragColor.a=clamp(max(gl_FragColor.r,max(gl_FragColor.g,gl_FragColor.b)),0.0,1.0);\n}';
const BLOOM_SCALE=0.5;
function bloomSizes(renderer){
  const full=renderer.getDrawingBufferSize(new THREE.Vector2());
  return {full,half:full.clone().multiplyScalar(BLOOM_SCALE).floor().max(new THREE.Vector2(1,1))};
}
const DEFAULT_LIGHT_POSITION=new THREE.Vector3().copy(lightDirection(DEFAULT_LIGHTING.azimuth,DEFAULT_LIGHTING.elevation)).multiplyScalar(9);
// The light marker floats on a sphere around the model's chest, with a dashed
// line pointing at it. It is drawn on top of the model so it never gets lost.
const LIGHT_MARKER_CENTER=new THREE.Vector3(0,1.1,0),LIGHT_MARKER_RADIUS=2.4;
const LIGHT_MARKER_INK='#3d2f3d',LIGHTBULB_GLYPH=String.fromCodePoint(0xe0f0);// Material Symbols "lightbulb"
// A camera-facing lightbulb badge: a glow and a disc in the light's colour
// with the Material Symbols lightbulb on top.
function drawLightBulb(canvas,color){
  const ctx=canvas.getContext('2d'),size=canvas.width,mid=size/2;
  ctx.clearRect(0,0,size,size);
  const glow=ctx.createRadialGradient(mid,mid,size*0.18,mid,mid,mid);glow.addColorStop(0,`${color}aa`);glow.addColorStop(1,`${color}00`);
  ctx.fillStyle=glow;ctx.fillRect(0,0,size,size);
  ctx.beginPath();ctx.arc(mid,mid,size*0.26,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  ctx.lineWidth=size*0.03;ctx.strokeStyle=LIGHT_MARKER_INK;ctx.stroke();
  ctx.font=`${Math.round(size*0.34)}px "Material Symbols Outlined"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=LIGHT_MARKER_INK;
  ctx.fillText(LIGHTBULB_GLYPH,mid,mid+size*0.01);
}
function createLightMarker(){
  const group=new THREE.Group();group.name='light-marker';
  const overlay={depthTest:false,depthWrite:false,transparent:true,toneMapped:false};
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const bulb=new THREE.Sprite(new THREE.SpriteMaterial({...overlay,map:texture}));bulb.scale.set(0.6,0.6,1);
  const line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({...overlay,color:LIGHT_MARKER_INK,dashSize:0.08,gapSize:0.06,opacity:0.7}));
  const target=new THREE.Mesh(new THREE.SphereGeometry(0.03,12,8),new THREE.MeshBasicMaterial({...overlay,color:LIGHT_MARKER_INK,opacity:0.7}));
  target.position.copy(LIGHT_MARKER_CENTER);
  [line,target,bulb].forEach((object,i)=>object.renderOrder=10+i);
  group.add(line,target,bulb);
  let drawnColor=null;
  const paint=color=>{drawnColor=color;drawLightBulb(canvas,color);texture.needsUpdate=true;};
  group.userData.update=(direction,color)=>{
    const position=new THREE.Vector3().copy(direction).multiplyScalar(LIGHT_MARKER_RADIUS).add(LIGHT_MARKER_CENTER);
    bulb.position.copy(position);
    line.geometry.setFromPoints([position,LIGHT_MARKER_CENTER]);line.computeLineDistances();
    if(color!==drawnColor)paint(color);
  };
  // The icon font may still be loading; repaint once it is ready.
  document.fonts?.load('48px "Material Symbols Outlined"',LIGHTBULB_GLYPH).then(()=>{if(drawnColor)paint(drawnColor);}).catch(()=>{});
  return group;
}
function drawTiledWatermark(ctx,value,color,opacity,width,height){
  const text=String(value||'').trim();if(!text)return;
  const size=Math.max(16,Math.round(width/34)),diagonal=Math.ceil(Math.hypot(width,height));
  ctx.save();ctx.translate(width/2,height/2);ctx.rotate(-Math.PI/6);ctx.font=`600 ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(color||'')?color:'#ffffff';ctx.globalAlpha=Number.isFinite(Number(opacity))?Math.min(1,Math.max(0,Number(opacity))):.2;ctx.textAlign='center';ctx.textBaseline='middle';
  const textWidth=ctx.measureText(text).width,stepX=Math.max(textWidth+size*3,size*7),stepY=size*4.5;
  let row=0;for(let y=-diagonal;y<=diagonal;y+=stepY,row++){const offset=row%2?stepX/2:0;for(let x=-diagonal+offset;x<=diagonal;x+=stepX)ctx.fillText(text,x,y);}
  ctx.restore();
}

function extendCoverBounds(bounds,geometry,matrix){
  const p=geometry.attributes.position.array,point=new THREE.Vector3();
  for(const group of geometry.groups){if(!group.count)continue;const first=(group.start/6)*4,last=first+(group.count/6)*4;for(let v=first;v<last;v++){const i=v*3;point.set(p[i],p[i+1],p[i+2]).applyMatrix4(matrix);bounds.expandByPoint(point);}}
}

function textureSources(source){
  const provided=Array.isArray(source.textures)?source.textures:source.texture?[{file:source.texture}]:[];
  return provided.map((entry,index)=>{
    const file=entry.file||entry;
    const path=entry.path||file.webkitRelativePath?.split('/').slice(1).join('/')||file.name||`texture-${index+1}`;
    return {id:entry.id||path,path,label:entry.label||textureLabel(path),file};
  });
}

function textureLabel(path){
  const name=String(path).split(/[\\/]/).pop()||String(path);
  return name.replace(/\.[^.]+$/,'');
}
