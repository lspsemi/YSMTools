import { tr } from './i18n.js';
const isDesktop='__TAURI_INTERNALS__' in window;
const tauri=()=>Promise.all([import('@tauri-apps/plugin-dialog'),import('@tauri-apps/api/core')]);
const writeFile=async(invoke,path,blob)=>invoke('save_file',new Uint8Array(await blob.arrayBuffer()),{headers:{path:encodeURIComponent(path)}});
const download=(blob,filename)=>{
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

// Saves a blob. Desktop shows a system save dialog filtered to `filter`; the
// web build uses a browser download. Resolves to false when the user cancels.
export async function saveFile(blob,filename,filter={name:tr('PNG 图片'),extensions:['png']}){
  if(!isDesktop){download(blob,filename);return true;}
  const [{ save },{ invoke }]=await tauri();
  const path=await save({defaultPath:filename,filters:[filter]});
  if(!path)return false;
  await writeFile(invoke,path,blob);
  return true;
}
export const savePng=(blob,filename)=>saveFile(blob,filename);

// Saves several files [{blob, filename}] into one folder the user picks
// (desktop), or as separate downloads (web). Resolves to false when cancelled.
export async function saveFilesToFolder(files,title=tr('选择保存文件夹')){
  if(!isDesktop){for(const file of files){download(file.blob,file.filename);await new Promise(resolve=>setTimeout(resolve,250));}return true;}
  const [{ open },{ invoke }]=await tauri();
  const folder=await open({directory:true,title});
  if(!folder||Array.isArray(folder))return false;
  const separator=folder.includes('\\')?'\\':'/';
  for(const file of files)await writeFile(invoke,`${folder.replace(/[\\/]+$/,'')}${separator}${file.filename}`,file.blob);
  return true;
}
