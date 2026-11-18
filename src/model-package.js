import { parseLenientJson } from './json.js';
import { tr } from './i18n.js';

// Reading YSM model packs into the inputs ModelViewer.loadFiles expects.
// Shared by the viewer page and the model library (thumbnails).

const FIRST_PERSON_ANIMATION=/^fp[._]arm$/i;

export function modelArchiveKind(bytes){
  const header=new Uint8Array(bytes,0,Math.min(bytes.byteLength,8));
  if(header[0]===0x50&&header[1]===0x4b)return 'zip';
  const isEncrypted=(header[0]===0x59&&header[1]===0x53&&header[2]===0x47&&header[3]===0x50)||(header[0]===0xef&&header[1]===0xbb&&header[2]===0xbf&&header[3]===0x59&&header[4]===0x53&&header[5]===0x47&&header[6]===0x50);
  return isEncrypted?'ysm':null;
}

// Unpacks a .zip or encrypted .ysm (ArrayBuffer, transferred to a worker)
// into a Map of package-relative path -> File.
export async function readModelArchive(bytes,{rawGeometry=false}={}){
  const kind=modelArchiveKind(bytes);
  if(!kind)throw new Error(tr('不支持的模型文件格式'));
  const isZip=kind==='zip';
  const worker=isZip?new Worker(new URL('./zip-worker.js',import.meta.url),{type:'module'}):new Worker(`${import.meta.env.BASE_URL}ysm-parser/worker.js`);
  const entries=await new Promise((resolve,reject)=>{
    worker.onmessage=event=>{worker.terminate();if(event.data?.error)reject(new Error(event.data.error));else resolve(event.data?.entries||[]);};
    worker.onerror=event=>{worker.terminate();reject(new Error(event.message||tr('模型文件解析失败')));};
    worker.postMessage(isZip?bytes:{bytes,rawGeometry},[bytes]);
  });
  let byPath=new Map(entries.flatMap(([path,data])=>{
    const normalized=path.replaceAll('\\','/').replace(/^\.\//,'');if(normalized.startsWith('/')||/^[a-z]:/i.test(normalized)||normalized.split('/').includes('..')||normalized.startsWith('__MACOSX/'))return[];
    return[[normalized,new File([data],normalized.split('/').pop()||'package-file')]];
  }));
  if(!byPath.has('models/main.json')&&!byPath.has('models/main.ysmgeo')){
    const candidates=[...byPath.keys()].filter(path=>/(?:^|\/)models\/main\.(?:json|ysmgeo)$/i.test(path));
    if(candidates.length===1){const suffix=candidates[0].match(/models\/main\.(?:json|ysmgeo)$/i)[0],prefix=candidates[0].slice(0,-suffix.length);byPath=new Map([...byPath].flatMap(([path,file])=>path.startsWith(prefix)?[[path.slice(prefix.length),file]]:[]));}
  }
  return byPath;
}

// Collects the files of an unpacked pack. Throws when the pack has no model
// or textures. Returns the loadFiles() options plus the parsed metadata.
export async function prepareModelPackage(byPath){
  const modelPath=byPath.has('models/main.ysmgeo')?'models/main.ysmgeo':byPath.has('models/main.json')?'models/main.json':byPath.has('main.ysmgeo')?'main.ysmgeo':byPath.has('main.json')?'main.json':null;
  const modelFile=modelPath&&byPath.get(modelPath),rawGeometry=modelPath?.endsWith('.ysmgeo'),legacyLayout=modelPath==='main.json'||modelPath==='main.ysmgeo';
  let textureEntries=[...byPath.entries()].filter(([path])=>/^textures\/.*\.(png|jpg|jpeg|webp)$/i.test(path)).map(([path,file])=>({id:path,path,label:path.split('/').pop().replace(/\.[^.]+$/,''),file}));
  if(legacyLayout&&!textureEntries.length)textureEntries=[...byPath.entries()].filter(([path])=>/\.(png|jpg|jpeg|webp)$/i.test(path)).map(([path,file])=>({id:path,path,label:path.split('/').pop().replace(/\.[^.]+$/,''),file}));
  if(!modelFile||!textureEntries.length)throw new Error(tr('模型包中需要 models/main.json 和 textures 贴图，或根目录 main.json 与贴图'));
  const metadataFile=byPath.get('ysm.json'),metadata=metadataFile?parseLenientJson(await metadataFile.text()):{},getPackageFile=path=>byPath.get(String(path||'').replaceAll('\\','/').replace(/^\.\//,''));
  // The game's material list is files.player.texture only (projectile,
  // vehicle and GUI images are not player materials); default_texture falls
  // back to its first entry.
  const declaredTextures=[metadata.files?.player?.texture].flat().map(entry=>typeof entry==='string'?entry:entry?.uv).filter(Boolean).map(path=>String(path).replaceAll('\\','/').replace(/^\.?\//,'').toLowerCase());
  const playerTextures=declaredTextures.map(path=>textureEntries.find(entry=>entry.path.toLowerCase()===path)).filter(Boolean);
  if(playerTextures.length)textureEntries=[...new Set(playerTextures)];
  const importedBedrockModel=legacyLayout&&!rawGeometry?parseLenientJson(await modelFile.text())['minecraft:geometry']?.[0]:null;
  if(legacyLayout&&!rawGeometry&&!importedBedrockModel?.bones)throw new Error(tr('根目录 main.json 中没有 minecraft:geometry 骨骼数据'));
  if(legacyLayout&&!metadata.metadata){
    const geometry=importedBedrockModel,info=geometry?.description?.ysm_extra_info||{};
    metadata.metadata={name:info.name||geometry?.description?.identifier||tr('旧版 YSM 模型'),tips:info.tips||'',authors:(info.authors||[]).map(name=>typeof name==='string'?{name}:name),license:{type:info.license||''}};
    metadata.properties={preview_animation:'idle'};
  }
  const viewerMetadataFile=metadataFile||new File([JSON.stringify(metadata)],'ysm.json',{type:'application/json'});
  // fp_arm clips only drive the first-person arm (ModelAssemblyFactory), never the body.
  let animationFiles=Object.entries(metadata.files?.player?.animation||{}).filter(([id])=>!FIRST_PERSON_ANIMATION.test(id)).map(([id,path])=>({id,path,file:getPackageFile(path)})).filter(entry=>entry.file);
  if(metadata.properties?.preview_animation){
    const previewFile=animationFiles.find(entry=>entry.id==='main')?.file;
    if(previewFile)animationFiles=animationFiles.filter(entry=>entry.file!==previewFile).concat([{id:'preview-main',path:'preview animation source',file:previewFile}]);
  }
  if(!animationFiles.length)animationFiles=[...byPath.entries()].filter(([path])=>legacyLayout?/^[^/]+\.animation\.json$/i.test(path):/^animations\/.*\.json$/i.test(path)).filter(([path])=>!FIRST_PERSON_ANIMATION.test(path.split('/').pop().replace(/\.animation\.json$/i,''))).map(([path,file])=>({id:path.split('/').pop().replace(/\.animation\.json$/i,''),path,file}));
  // The first-person arm: its own geometry (files.player.model.arm) and the fp_arm clips.
  const armModelFile=legacyLayout?null:byPath.get('models/arm.ysmgeo')||getPackageFile(metadata.files?.player?.model?.arm)||byPath.get('models/arm.json')||null;
  const armAnimationFiles=Object.entries(metadata.files?.player?.animation||{}).filter(([id])=>FIRST_PERSON_ANIMATION.test(id)).map(([id,path])=>({id,path,file:getPackageFile(path)})).filter(entry=>entry.file);
  let controllerFiles=(metadata.files?.player?.animation_controllers||[]).map(path=>({path,file:getPackageFile(path)})).filter(entry=>entry.file);
  if(!controllerFiles.length)controllerFiles=[...byPath.entries()].filter(([path])=>/^controller\/.*\.json$/i.test(path)).map(([path,file])=>({path,file}));
  const avatarFiles=new Map([...byPath].filter(([path])=>path.toLowerCase().startsWith('avatar/')).map(([path,file])=>[path.toLowerCase(),file]));
  const soundFiles=new Map();
  for(const [path,file] of byPath){const match=/^sounds\/(.+)\.(?:ogg|wav|mp3)$/i.exec(path);if(match){soundFiles.set(match[1],file);if(!soundFiles.has(match[1].toLowerCase()))soundFiles.set(match[1].toLowerCase(),file);}}
  return {metadata,avatarFiles,textureEntries,files:{soundFiles,model:modelFile,rawGeometry,armModel:armModelFile,rawArmGeometry:armModelFile?.name.endsWith('.ysmgeo'),armAnimationFiles,textures:textureEntries,texture:textureEntries[0]?.file,animationFiles,controllerFiles,metadata:viewerMetadataFile,bedrockModel:importedBedrockModel,cardBackground:getPackageFile(metadata.properties?.gui_background),cardBackgroundFallback:getPackageFile('background/gui_background.png'),cardForeground:getPackageFile(metadata.properties?.gui_foreground),cardForegroundFallback:getPackageFile('background/gui_foreground.png')}};
}
