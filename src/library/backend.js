import { tr } from '../i18n.js';
// Storage backend of the model library. The desktop app calls the Rust
// commands in src-tauri/src/library.rs; in a browser on the dev server the
// same commands are served by tools/library-dev-api.js. Everything above this
// file only uses the object returned by getLibraryBackend().
const isDesktop='__TAURI_INTERNALS__' in window;
const newBatch=()=>`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;

// Dropped files have no paths in a webview either, so both backends copy them
// into a staging folder first. files: [[relative path, File]].
async function importDropped(upload,importStaged,files,onProgress){
  const batch=newBatch(),total=files.reduce((sum,[,file])=>sum+file.size,0);let done=0;
  for(const [path,file] of files){
    await upload(batch,path,file);
    done+=file.size;onProgress?.(done,total);
  }
  return importStaged(batch);
}

async function desktopBackend(){
  const [{ invoke },{ open },{ revealItemInDir }]=await Promise.all([import('@tauri-apps/api/core'),import('@tauri-apps/plugin-dialog'),import('@tauri-apps/plugin-opener')]);
  const call=(name,args,options)=>invoke(`library_${name}`,args,options).catch(error=>{throw new Error(String(error));});
  const bytes=async(name,args)=>new Uint8Array(await call(name,args));
  return {
    kind:'desktop',
    state:()=>call('state'),
    // Native pickers return paths, which the Rust side copies directly.
    async importFromPicker(directory){
      const picked=await open(directory?{directory:true,multiple:true,title:tr('选择模型文件夹（可包含多个模型）')}:{multiple:true,title:tr('选择模型包'),filters:[{name:tr('YSM 模型'),extensions:['zip','ysm']}]});
      const paths=[picked].flat().filter(Boolean);
      return paths.length?call('import',{paths}):null;
    },
    // Resolves to the picked folder paths ([] when cancelled).
    async pickGameDirs(){const picked=await open({directory:true,multiple:true,title:tr('选择游戏目录（可多选）')});return [picked].flat().filter(Boolean);},
    importDropped:(files,onProgress)=>importDropped(
      async(batch,path,file)=>call('upload',new Uint8Array(await file.arrayBuffer()),{headers:{batch,path:encodeURIComponent(path)}}),
      batch=>call('import_staged',{batch}),files,onProgress),
    addGameDir:path=>call('add_game_dir',{path}),
    removeGameDir:id=>call('remove_game_dir',{id}),
    // Batch commands: {models, errors} / {deleted, errors}.
    setMounted:(ids,dirs,mounted)=>call('set_mounted',{ids,dirs,mounted}),
    remove:ids=>call('delete',{ids}),
    rename:(id,name)=>call('rename',{id,name}),
    setInfo:(id,info)=>call('set_info',{id,info}),
    readModel:id=>bytes('read_model',{id}),
    readModelFile:(id,path)=>bytes('read_model_file',{id,path}),
    readThumbnail:async id=>new Blob([await bytes('read_thumbnail',{id})],{type:'image/png'}),
    saveThumbnail:async(id,blob)=>call('save_thumbnail',new Uint8Array(await blob.arrayBuffer()),{headers:{id}}),
    reveal:path=>revealItemInDir(path),
    // Windows Explorer thumbnails of .ysm files (docs section 70).
    explorer:{
      status:()=>call('explorer_status'),
      // Resolves to the picked folder path, or null when cancelled.
      pickFolder:async()=>await open({directory:true,title:tr('选择要显示缩略图的文件夹')})||null,
      scan:dir=>call('explorer_scan',{dir}),
      read:path=>bytes('explorer_read',{path}),
      save:async(path,blob)=>call('explorer_save',new Uint8Array(await blob.arrayBuffer()),{headers:{path:encodeURIComponent(path)}}),
      sync:()=>call('explorer_sync'),
    },
  };
}

function devBackend(){
  const request=async(name,body,headers={})=>{
    const response=await fetch(`/__library/${name}`,{method:'POST',body:body instanceof Blob||body instanceof Uint8Array?body:JSON.stringify(body??{}),headers});
    if(!response.ok)throw new Error(await response.text());
    return response;
  };
  const call=async(name,args)=>(await request(name,args)).json();
  const bytes=async(name,args)=>new Uint8Array(await (await request(name,args)).arrayBuffer());
  // Browsers do not expose file paths, so picked files are uploaded to a
  // staging folder on the dev server and imported from there.
  const pick=directory=>new Promise(resolve=>{
    const input=Object.assign(document.createElement('input'),{type:'file',multiple:true,accept:directory?'':'.zip,.ysm'});
    if(directory)input.webkitdirectory=true;
    input.onchange=()=>resolve([...input.files]);input.oncancel=()=>resolve([]);input.click();
  });
  return {
    kind:'dev',
    state:()=>call('state'),
    async importFromPicker(directory){
      const files=await pick(directory);if(!files.length)return null;
      const batch=newBatch();
      for(const file of files)await request('upload',file,{'x-batch':batch,'x-path':encodeURIComponent(file.webkitRelativePath||file.name)});
      return call('import',{batch});
    },
    importDropped:(files,onProgress)=>importDropped(
      (batch,path,file)=>request('upload',file,{'x-batch':batch,'x-path':encodeURIComponent(path)}),
      batch=>call('import_staged',{batch}),files,onProgress),
    // There is no folder picker that yields a path; the UI asks for one.
    pickGameDirs:async()=>null,
    addGameDir:path=>call('add_game_dir',{path}),
    removeGameDir:id=>call('remove_game_dir',{id}),
    setMounted:(ids,dirs,mounted)=>call('set_mounted',{ids,dirs,mounted}),
    remove:ids=>call('delete',{ids}),
    rename:(id,name)=>call('rename',{id,name}),
    setInfo:(id,info)=>call('set_info',{id,info}),
    readModel:id=>bytes('read_model',{id}),
    readModelFile:(id,path)=>bytes('read_model_file',{id,path}),
    readThumbnail:async id=>new Blob([await bytes('read_thumbnail',{id})],{type:'image/png'}),
    saveThumbnail:(id,blob)=>request('save_thumbnail',blob,{'x-id':id}),
    reveal:path=>call('reveal',{path}),
    explorer:{
      status:()=>call('explorer_status'),
      // No folder picker yields a path in a browser; the UI asks for one.
      pickFolder:async()=>undefined,
      scan:dir=>call('explorer_scan',{dir}),
      read:path=>bytes('explorer_read',{path}),
      save:(path,blob)=>request('explorer_save',blob,{'x-path':encodeURIComponent(path)}),
      sync:()=>call('explorer_sync'),
    },
  };
}

let backend=null;
// Resolves to null when neither the desktop shell nor the dev server API is
// available (the static web build).
export function getLibraryBackend(){
  backend??=(async()=>{
    if(isDesktop)return desktopBackend();
    const dev=devBackend();
    try{await dev.state();return dev;}catch{return null;}
  })();
  return backend;
}
