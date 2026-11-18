import { readModelArchive, prepareModelPackage } from '../model-package.js';
import { tr } from '../i18n.js';
import { readConfig } from '../app-config.js';

// Steam library covers are 2:3 portraits (600×900); render at 2/3 of that.
export const COVER_WIDTH=400,COVER_HEIGHT=600;

// Reads a library model back into a package path -> File map.
export async function readLibraryModel(backend,model){
  const data=await backend.readModel(model.id);
  if(!model.isDir)return readModelArchive(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{rawGeometry:readConfig('settings')?.renderMode==='raw'});
  const paths=JSON.parse(new TextDecoder().decode(data)),byPath=new Map();
  for(const path of paths)byPath.set(path,new File([await backend.readModelFile(model.id,path)],path.split('/').pop()));
  return byPath;
}

// A .zip / .ysm pack given as raw bytes (e.g. a file outside the library)
// as a package path -> File map.
export function readPackBytes(data){
  return readModelArchive(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{rawGeometry:readConfig('settings')?.renderMode==='raw'});
}

// One hidden ModelViewer renders every cover, so batch imports do not touch
// the viewer page. Covers are rendered one at a time.
let renderer=null,chain=Promise.resolve();
async function coverRenderer(){
  if(renderer)return renderer;
  const { ModelViewer }=await import('../viewer.js');
  const host=Object.assign(document.createElement('div'),{className:'library-cover-renderer'});
  host.setAttribute('aria-hidden','true');
  host.style.cssText='position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;';
  const canvas=document.createElement('canvas');host.append(canvas);document.body.append(host);
  renderer={host,viewer:new ModelViewer(canvas,host,()=>{})};
  return renderer;
}
// Frees the hidden renderer's WebGL context once a batch is done.
export function releaseCoverRenderer(){
  chain=chain.then(()=>{if(!renderer)return;renderer.viewer.dispose();renderer.viewer.renderer.forceContextLoss();renderer.host.remove();renderer=null;});
  return chain;
}

const stripFormatting=value=>String(value??'').replace(/§x(?:§[0-9a-f]){6}|§[0-9a-fk-or]/gi,'').trim();

// Mods with adapted animations, keyed like the viewer's details page.
const MOD_NAMES={carryon:tr('搬运'),tac:'TaCZ',swem:'SWEM',parcool:'ParCool',slashblade:tr('拔刀剑'),tlm:tr('东方女仆')};

// Plain-text details the library list view shows, from prepareModelPackage().
function packageInfo({metadata,files}){
  const meta=metadata.metadata||{},name=stripFormatting(meta.name);
  const license=meta.license&&typeof meta.license==='object'?meta.license.type:meta.license;
  const animations=metadata.files?.player?.animation||{};
  return {
    name:/^geometry\./i.test(name)?'':name,
    tips:stripFormatting(meta.tips),
    authors:(Array.isArray(meta.authors)?meta.authors:[]).map(author=>({name:stripFormatting(author?.name),role:stripFormatting(author?.role)})).filter(author=>author.name),
    license:stripFormatting(license),
    home:typeof meta.link?.home==='string'?meta.link.home:'',
    mods:Object.keys(MOD_NAMES).filter(key=>animations[key]).map(key=>MOD_NAMES[key]),
    textures:files.textures?.length||0,
    animations:files.animationFiles?.length||0,
    sounds:new Set(files.soundFiles?.values()).size,
  };
}

// Reads only the details of a pack (no rendering), for models imported
// before details were stored.
export async function readModelInfo(byPath){return packageInfo(await prepareModelPackage(byPath));}

// Length of the preview animation (0 when the pack has none).
const previewLength=viewer=>Number(viewer.animations?.[viewer.previewAnimationName]?.animation_length)||0;
// Without a preview animation the card still plays its parallel layers; the
// editor loops them like the viewer's card (DEFAULT_CARD_DURATION in main.js).
const IDLE_CARD_DURATION=5;
// Automatic covers take the middle of the clip: common preview templates rise,
// hold and sink, so the first and last frames often show no character.
// Clips over 30 s are treated as broken (the viewer caps them too) and use
// the first frame. A frame picked in the cover editor (info.coverTime) wins.
const MAX_AUTO_DURATION=30;
const autoCoverTime=length=>length>0&&length<=MAX_AUTO_DURATION?length/2:0;
const clampTime=(time,duration)=>Math.min(duration,Math.max(0,Number(time)||0));
const renderFrame=(viewer,time)=>viewer.renderCardImage({width:COVER_WIDTH,height:COVER_HEIGHT,fullCardHeight:COVER_HEIGHT,includeCardChrome:true,title:'',time});

// Loads a pack into the hidden renderer (silent).
async function loadPack(byPath){
  const prepared=await prepareModelPackage(byPath),{files}=prepared;
  const {viewer}=await coverRenderer();
  await viewer.loadFiles({...files,soundFiles:new Map()});
  return {prepared,viewer};
}
function queue(job){const task=chain.then(job);chain=task.catch(()=>{});return task;}

/**
 * Renders the character card of a model pack as a 2:3 cover PNG at `time`
 * seconds of the preview animation (default: the middle, see autoCoverTime).
 * Resolves to {blob, name, info}: name is the model's display name (plain
 * text, empty when the pack has none), info the details for the list view
 * (with coverTime when a time was given).
 */
export function renderCover(byPath,time=null){
  return queue(async()=>{
    const {prepared,viewer}=await loadPack(byPath);
    const length=previewLength(viewer),picked=time!==null;
    const at=picked?clampTime(time,length||IDLE_CARD_DURATION):autoCoverTime(length);
    const blob=await renderFrame(viewer,at);
    if(!blob)throw new Error(tr('模型没有可渲染的内容'));
    // Packs without a real name report the geometry identifier; keep the file name then.
    const info=packageInfo(prepared);
    if(picked)info.coverTime=at;
    return {blob,name:info.name,info};
  });
}

/**
 * Cover editor: plays the pack's card live on `canvas`, the same way the
 * viewer's sidebar card does (startCardPreview: warm-up, physics, looping
 * the whole preview clip, no length cap). It starts paused; seek() and
 * setPlaying() drive it and render() saves the frame on the canvas (the live
 * preview entity, so physics match what is shown). The hidden renderer is
 * the editor's until close(); the library runs no other cover work meanwhile.
 * Resolves to {duration, animated, info, background, foreground, time, seek,
 * setPlaying, render, close}; background/foreground are the card's GUI
 * layer URLs (or null) to stack around the canvas.
 */
export async function openCoverSession(byPath,canvas,{warmUp=1,onTime=null}={}){
  const {prepared,viewer}=await queue(()=>loadPack(byPath));
  const length=previewLength(viewer),duration=length>0?length:IDLE_CARD_DURATION;
  if(!viewer.startCardPreview(canvas,{duration,warmUp,onTime}))throw new Error(tr('模型没有可渲染的内容'));
  viewer.setCardPlaying(false);
  return {
    duration,
    animated:length>0,
    info:packageInfo(prepared),
    background:viewer.cardBackgroundUrl,
    foreground:viewer.cardForegroundUrl,
    get time(){return viewer.card?.state.time??0;},
    seek:time=>viewer.seekCard(clampTime(time,duration)),
    setPlaying:playing=>viewer.setCardPlaying(playing),
    render:()=>queue(()=>renderFrame(viewer,viewer.card.state.time)),
    close:()=>{viewer.stopCardPreview();return releaseCoverRenderer();},
  };
}
