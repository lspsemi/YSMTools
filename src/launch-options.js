// Launch options (设置 → 性能 → 解除帧率上限): the desktop app keeps them in
// launch.json next to the executable and applies them when it creates the
// window (src-tauri/src/launch.rs), so a change needs a restart. In a plain
// browser nothing can be applied (browser flags cannot be changed from a page),
// so `supported` is false and saved and active options are always the same.
const isDesktop='__TAURI_INTERNALS__' in window;
const DEV_KEY='ysm-dev-launch-options';
const DEFAULTS={uncappedFrameRate:false};

async function desktop(){
  const {invoke}=await import('@tauri-apps/api/core');
  const call=(name,args)=>invoke(name,args).catch(error=>{throw new Error(String(error));});
  return {
    supported:true,
    state:()=>call('launch_options_state'),
    set:options=>call('launch_options_set',{options}),
    restart:()=>call('restart_app')
  };
}
function browser(){
  const read=()=>{try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(DEV_KEY)||'{}')};}catch{return {...DEFAULTS};}};
  return {
    supported:false,
    state:async()=>({saved:read(),active:read()}),
    async set(options){try{localStorage.setItem(DEV_KEY,JSON.stringify(options));}catch{}return {saved:read(),active:read()};},
    restart:async()=>location.reload()
  };
}
let backend=null;
export function launchOptions(){return backend??=isDesktop?desktop():Promise.resolve(browser());}
