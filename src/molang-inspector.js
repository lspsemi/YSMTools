// Molang 监视器 (第 61 节), viewer side. The inspector is a separate OS window
// (molang-inspector.html + molang-inspector-window.js): on the desktop a Tauri
// window created by src-tauri/src/molang_inspector.rs, in the browser a popup.
// This page owns the Molang context, so it evaluates everything and streams
// the results to the window 10 times a second (only when they changed); the
// window sends back watch-list/opacity/filter/bounds changes, which are kept in
// appSettings.molangInspector (Config/settings.json, 第 51 节), and statements
// to run. 第 66 节 adds the controller list, per-frame curves of watches and
// variable locks.
import { tr } from './i18n.js';
import { inspectMolang, inspectMolangScopes, lockMolangVariable, unlockMolangVariable } from './ysm-animation.js';
import { isDesktop, openLink, parseMolangPath } from './molang-inspector-link.js';

export const DEFAULT_MOLANG_INSPECTOR={enabled:false,pinned:false,opacity:92,x:null,y:null,width:380,height:520,watches:[],graphs:[],locks:[],filter:'',overrideMainState:false};
// Main states in AnimationRegister priority order (play-control.js selectMainState).
// With overrideMainState (第 67 节) the first one whose ctrl.<state> is locked non-zero becomes the main state.
export const MAIN_STATE_PRIORITY=['swim','fly','elytra_fly','swim_stand','jump','sneak','sneaking','run','walk','idle'];
const REFRESH_MS=100,POPUP_NAME='ysm-molang-inspector',MAX_SAMPLES=600,MAX_LOCKS=64;

export function normalizeMolangInspector(value){
  const s={...DEFAULT_MOLANG_INSPECTOR,...(value&&typeof value==='object'?value:{})};
  s.enabled=s.enabled===true;
  s.pinned=s.pinned===true;
  s.opacity=Math.min(100,Math.max(20,Math.round(Number(s.opacity)||DEFAULT_MOLANG_INSPECTOR.opacity)));
  s.width=Math.max(280,Math.round(Number(s.width)||DEFAULT_MOLANG_INSPECTOR.width));
  s.height=Math.max(240,Math.round(Number(s.height)||DEFAULT_MOLANG_INSPECTOR.height));
  s.x=Number.isFinite(s.x)?Math.round(s.x):null;s.y=Number.isFinite(s.y)?Math.round(s.y):null;
  s.watches=Array.isArray(s.watches)?s.watches.filter(w=>typeof w==='string'&&w.trim()).slice(0,64):[];
  s.graphs=Array.isArray(s.graphs)?[...new Set(s.graphs.filter(g=>typeof g==='string'&&s.watches.includes(g)))]:[];
  const locks=new Map();
  for(const lock of Array.isArray(s.locks)?s.locks:[]){
    const parsed=parseMolangPath(lock?.path),value=lock?.value;
    if(parsed&&(typeof value==='string'||Number.isFinite(value))&&locks.size<MAX_LOCKS)locks.set(parsed.path,{path:parsed.path,value});
  }
  s.locks=[...locks.values()];
  s.filter=typeof s.filter==='string'?s.filter:'';
  s.overrideMainState=s.overrideMainState===true;
  return s;
}

/** Display text of a Molang value: numbers up to 4 decimals, strings quoted, {x,y,z} as a vector. */
export function formatMolangValue(value){
  if(typeof value==='number'){
    if(!Number.isFinite(value))return value!==value?'0':String(value);
    return Number.isInteger(value)?String(value):String(Number(value.toFixed(4)));
  }
  if(typeof value==='boolean')return value?'1':'0';
  if(typeof value==='string')return `'${value}'`;
  if(value===null||value===undefined)return '0';
  if(typeof value==='object'){
    if('x'in value&&'y'in value&&'z'in value)return `(${formatMolangValue(Number(value.x)||0)}, ${formatMolangValue(Number(value.y)||0)}, ${formatMolangValue(Number(value.z)||0)})`;
    try{return JSON.stringify(value);}catch{return '{…}';}
  }
  return String(value);
}

/**
 * `getContext()` → the main view's Molang context or null; `execute(script)`
 * runs a statement on it; `settings` is appSettings.molangInspector; `save()`
 * persists it; `onClosed()` runs when the window was closed from its own close
 * button; `onBlocked()` when the browser blocked the popup.
 */
/** The main state the locks force (第 67 节), or null. */
export function lockedMainState(locks){
  for(const state of MAIN_STATE_PRIORITY){
    const lock=locks.find(item=>item.path===`ctrl.${state}`);
    if(lock&&(typeof lock.value==='number'?lock.value!==0:lock.value!==''))return state;
  }
  return null;
}

/**
 * `onMainStateOverride(state|null, force)` (第 67 节): the main state the
 * locks force while 强制切换主状态 is on and the window is connected; `force`
 * when a new model's context needs it applied again.
 */
export function createMolangInspectorHost({getContext,getRuntime,getClock,execute,settings,save,onClosed,onBlocked,onMainStateOverride}){
  let link=null,linkPromise=null,open=false,connected=false,timer=0,last='',popup=null;
  // Curves: per-frame samples [time, value, …] of the graphed watches, sent with the next snapshot.
  let samples=new Map(),lastSampleTime=new Map();
  // Locks are applied to the main context while the window is open (lockedContext).
  let lockedContext=null,mainOverride=null;
  function updateMainOverride(force=false){
    const state=open&&connected&&settings.overrideMainState?lockedMainState(settings.locks):null;
    if(state===mainOverride&&!force)return;
    mainOverride=state;onMainStateOverride?.(state,force);
  }
  const ensureLink=()=>linkPromise??=openLink('host',receive).then(value=>link=value);
  const send=message=>link?.send(message);

  const themeState=()=>({theme:document.documentElement.dataset.theme||'light',css:document.querySelector('#dynamic-color')?.textContent||''});
  const sendInit=()=>{last='';samples=new Map();lastSampleTime=new Map();send({type:'init',settings:{pinned:settings.pinned,opacity:settings.opacity,watches:settings.watches,graphs:settings.graphs,filter:settings.filter,overrideMainState:settings.overrideMainState},...themeState()});sendSnapshot();};

  // ---- locks (第 66 节): applied to the main context while the window is connected ----
  function syncLocks(){
    const context=open&&connected?getContext():null;
    if(context===lockedContext)return;
    // A new model brings a new context; the old one is gone with its locks.
    lockedContext=context;
    if(context)for(const lock of settings.locks)lockMolangVariable(context,parseMolangPath(lock.path),lock.value);
    if(context)updateMainOverride(true);
  }
  function releaseLocks(){
    if(lockedContext)for(const lock of settings.locks)unlockMolangVariable(lockedContext,parseMolangPath(lock.path));
    lockedContext=null;updateMainOverride();
  }
  /** An empty `expr` locks the current value. Returns an error text or ''. */
  function addLock(path,expr){
    const parsed=parseMolangPath(path);if(!parsed)return tr('只能锁定变量，例如 v.speed 或 q.is_in_water');
    const context=getContext();if(!context)return tr('请先加载模型');
    if(settings.locks.length>=MAX_LOCKS&&!settings.locks.some(lock=>lock.path===parsed.path))return tr('最多锁定 64 个变量');
    let value;
    try{value=inspectMolang(String(expr||'').trim()||parsed.path,context);}catch(error){return tr('语法错误：{0}',error.message);}
    if(typeof value==='boolean')value=value?1:0;
    if(typeof value==='number'&&!Number.isFinite(value))value=0;
    if(typeof value!=='number'&&typeof value!=='string')return tr('只能锁定数字或字符串');
    syncLocks();
    if(!lockMolangVariable(context,parsed,value))return tr('无法锁定这个变量');
    settings.locks=[...settings.locks.filter(lock=>lock.path!==parsed.path),{path:parsed.path,value}];
    save();updateMainOverride();return '';
  }
  function removeLock(path){
    const parsed=parseMolangPath(path);if(!parsed)return;
    if(lockedContext)unlockMolangVariable(lockedContext,parsed);
    settings.locks=settings.locks.filter(lock=>lock.path!==parsed.path);save();updateMainOverride();
  }

  // ---- curves: sampled after every rendered frame of the main view ----
  function sampleFrame(){
    if(!open||!connected)return;
    syncLocks();
    if(!settings.graphs.length)return;
    const context=getContext();if(!context)return;
    const time=Number(getClock?.())||0;
    for(const expr of settings.graphs){
      // Paused: the clock stands still and so does the curve.
      if(lastSampleTime.get(expr)===time)continue;
      lastSampleTime.set(expr,time);
      let value;try{value=inspectMolang(expr,context);}catch{continue;}
      if(typeof value==='boolean')value=value?1:0;
      if(typeof value!=='number')value=null;else if(!Number.isFinite(value))value=0;
      let list=samples.get(expr);if(!list)samples.set(expr,list=[]);
      if(list.length>=MAX_SAMPLES*2)list.splice(0,2);
      list.push(Math.round(time*1e4)/1e4,value);
    }
  }
  // The window follows the app's light/dark theme and 自动取色 palette.
  const themeObserver=new MutationObserver(()=>{if(open&&connected)send({type:'theme',...themeState()});});
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  themeObserver.observe(document.head,{childList:true,subtree:true,characterData:true});

  function snapshot(){
    const context=getContext();
    const watches=settings.watches.map(expr=>{
      if(!context)return '—';
      try{return formatMolangValue(inspectMolang(expr,context));}catch{return tr('语法错误');}
    });
    const vars=context?inspectMolangScopes(context).map(entry=>[entry.path,formatMolangValue(entry.value)]):[];
    const runtime=context&&getRuntime?.(),clock=Number(getClock?.())||0;
    const controllers=runtime?runtime.inspect(clock).map(item=>({...item,time:Math.round(item.time*100)/100})):[];
    const locks=settings.locks.map(lock=>[lock.path,formatMolangValue(lock.value)]);
    return {type:'snapshot',loaded:!!context,watchKeys:settings.watches,watches,vars,controllers,locks,mainOverride};
  }
  function sendSnapshot(){
    if(!open||!connected)return;
    syncLocks();
    const message=snapshot(),text=JSON.stringify(message);
    const series=samples.size?Object.fromEntries(samples):null;samples=new Map();
    if(text===last&&!series)return;
    last=text;send(series?{...message,series}:message);
  }
  const startTimer=()=>{clearInterval(timer);timer=setInterval(sendSnapshot,REFRESH_MS);};

  function receive(message){
    if(!open){
      // A window left over from before (page reload with the switch now off).
      if(message.type==='hello')send({type:'close'});
      return;
    }
    switch(message.type){
      case 'hello':connected=true;sendInit();startTimer();break;
      case 'settings':{
        const patch=message.patch||{};
        if('opacity'in patch)settings.opacity=patch.opacity;
        if('pinned'in patch)settings.pinned=patch.pinned===true;
        if(Array.isArray(patch.watches))settings.watches=patch.watches.filter(w=>typeof w==='string');
        if(Array.isArray(patch.graphs))settings.graphs=patch.graphs.filter(g=>typeof g==='string');
        if(typeof patch.filter==='string')settings.filter=patch.filter;
        if('overrideMainState'in patch)settings.overrideMainState=patch.overrideMainState===true;
        Object.assign(settings,normalizeMolangInspector(settings));save();updateMainOverride();sendSnapshot();break;
      }
      case 'bounds':{
        const {x,y,width,height}=message;
        Object.assign(settings,normalizeMolangInspector({...settings,x,y,width,height}));save();break;
      }
      case 'execute':{
        const loaded=!!getContext(),ok=loaded&&execute(String(message.script||''));
        send({type:'executed',id:message.id,ok,loaded});sendSnapshot();break;
      }
      case 'lock':{
        const error=addLock(message.path,message.expr);
        send({type:'locked',id:message.id,error});last='';sendSnapshot();break;
      }
      case 'unlock':removeLock(message.path);last='';sendSnapshot();break;
      case 'closed':
        open=false;connected=false;releaseLocks();clearInterval(timer);popup=null;
        settings.enabled=false;save();onClosed?.();break;
    }
  }

  async function openWindow(){
    if(isDesktop){
      const {invoke}=await import('@tauri-apps/api/core');
      await invoke('molang_inspector_open',{title:tr('Molang 监视器'),x:settings.x,y:settings.y,width:settings.width,height:settings.height});
      return;
    }
    if(popup&&!popup.closed){popup.focus();return;}
    // A popup that survived a reload of this page answers the ping instead.
    send({type:'ping'});
    await new Promise(resolve=>setTimeout(resolve,250));
    if(connected||!open)return;
    const features=[`popup`,`width=${settings.width}`,`height=${settings.height}`];
    if(settings.x!==null&&settings.y!==null)features.push(`left=${settings.x}`,`top=${settings.y}`);
    popup=window.open('./molang-inspector.html',POPUP_NAME,features.join(','));
    if(!popup){open=false;settings.enabled=false;save();onBlocked?.();}
  }
  // The window waits a moment for this page to come back after a reload, then closes.
  addEventListener('pagehide',()=>{if(open)send({type:'host-gone'});});

  return {
    sampleFrame,
    async setOpen(value){
      if(value===open)return;
      open=value;
      if(open){
        // window.open must run while the switch's click still counts as a user gesture.
        if(!isDesktop)popup=popup&&!popup.closed?popup:null;
        await ensureLink();
        try{await openWindow();}catch(error){console.error('Molang inspector:',error);open=false;settings.enabled=false;save();onClosed?.();return;}
        // An already open window (this page was reloaded) answers with 'hello'.
        if(open&&!connected)send({type:'ping'});
        return;
      }
      connected=false;releaseLocks();clearInterval(timer);
      send({type:'close'});
      if(isDesktop){try{const {invoke}=await import('@tauri-apps/api/core');await invoke('molang_inspector_close');}catch{}}
      else{popup?.close();popup=null;}
    },
  };
}
