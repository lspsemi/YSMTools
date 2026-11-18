// Molang 监视器 window page (第 61 节): molang-inspector.html. Shows what the
// viewer page (molang-inspector.js, the host) streams to it; owns no Molang
// context. Desktop: undecorated transparent Tauri window with its own title
// bar (drag), resize grip and close button; the opacity slider fades the whole
// window. Browser: a popup window, where the slider fades the content only.
// 第 66 节: 控制器 section, curves (图表) of watches, variable locks (锁定).
import './style.css';
import { tr } from './i18n.js';
import { readConfig } from './app-config.js';
import { compileMolang } from './molang.js';
import { isDesktop, openLink, parseMolangPath } from './molang-inspector-link.js';

const MIN_OPACITY=20;
// Curves show the last GRAPH_SECONDS of the viewer's animation clock.
const GRAPH_SECONDS=10;
const SCOPES=['v','ctrl','ysm','q'];
const icon=name=>`<span class="material-symbol-icon" aria-hidden="true">${name}</span>`;
const escapeHtml=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

const html=document.documentElement;
html.classList.add('molang-inspector-page',isDesktop?'is-desktop':'is-browser');
html.dataset.theme=readConfig('theme',null)||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.title=tr('Molang 监视器');

const root=document.createElement('main');
root.className='molang-inspector';
root.innerHTML=`<header class="molang-inspector-header">${icon('function')}<h1>${tr('Molang 监视器')}</h1><button class="icon-button molang-inspector-settings-button" type="button" aria-pressed="false" aria-controls="molang-inspector-settings" title="${tr('监视器设置')}" aria-label="${tr('监视器设置')}">${icon('settings')}</button>${isDesktop?`<button class="icon-button window-pin molang-inspector-pin" type="button" aria-pressed="false">${icon('push_pin')}</button><button class="icon-button molang-inspector-minimize" type="button" title="${tr('最小化')}" aria-label="${tr('最小化')}">${icon('remove')}</button><button class="icon-button molang-inspector-maximize" type="button" title="${tr('最大化')}" aria-label="${tr('最大化')}">${icon('crop_square')}</button>`:''}<button class="icon-button molang-inspector-close window-close" type="button" title="${tr('关闭')}" aria-label="${tr('关闭')}">${icon('close')}</button></header>
<form class="molang-inspector-input" autocomplete="off"><input class="molang-inspector-expr" type="text" spellcheck="false" placeholder="${tr('Molang 表达式，例如 v.speed * 2')}" aria-label="${tr('Molang 表达式')}"><button class="icon-button" type="submit" title="${tr('添加到监视列表')}" aria-label="${tr('添加到监视列表')}">${icon('add')}</button><button class="icon-button molang-inspector-run" type="button" title="${tr('执行（可赋值，例如 v.mode = 2）')}" aria-label="${tr('执行')}">${icon('play_arrow')}</button><button class="icon-button molang-inspector-lock" type="button" title="${tr('锁定变量（例如 q.is_in_water = 1；不写值则锁定当前值）')}" aria-label="${tr('锁定变量')}">${icon('lock')}</button></form>
<p class="molang-inspector-message" role="status" hidden></p>
<div class="molang-inspector-settings" id="molang-inspector-settings" role="region" aria-label="${tr('监视器设置')}" hidden>
  <div class="molang-inspector-settings-head"><button class="icon-button molang-inspector-settings-back" type="button" title="${tr('返回')}" aria-label="${tr('返回')}">${icon('arrow_back')}</button><h2>${tr('监视器设置')}</h2></div>
  <label class="settings-item"><span class="settings-item-text"><strong>${tr('强制切换主状态')}</strong><span>${tr('把 ctrl.fly、ctrl.walk 等主状态变量锁定为非 0 时，3D 视图的主状态也切换到这个状态（播放同名动画、状态按钮暂时不可用）。同时锁定多个时按游戏的优先级取一个。游戏里改变量不会切换主状态，只用于测试。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" class="molang-inspector-override" aria-label="${tr('强制切换主状态')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
</div>
<div class="molang-inspector-body">
  <section class="molang-inspector-locks" hidden><h2>${tr('锁定')}</h2><ul class="molang-inspector-list molang-inspector-lock-list"></ul></section>
  <section><h2>${tr('监视')}</h2><ul class="molang-inspector-list molang-inspector-watch-list"></ul><p class="molang-inspector-empty molang-inspector-watch-empty">${tr('在上方输入表达式并按回车添加。点击下方变量可填入输入框。')}</p></section>
  <section><h2>${tr('控制器')}</h2><div class="molang-inspector-controllers"></div><p class="molang-inspector-empty molang-inspector-controller-empty">${tr('正在连接…')}</p></section>
  <section><div class="molang-inspector-vars-head"><h2>${tr('变量')}</h2><label class="molang-inspector-filter">${icon('search')}<input type="search" spellcheck="false" placeholder="${tr('筛选')}" aria-label="${tr('筛选变量')}"></label></div><div class="molang-inspector-var-groups"></div><p class="molang-inspector-empty molang-inspector-var-empty">${tr('正在连接…')}</p></section>
</div>
<div class="molang-inspector-footer" role="group" aria-label="${tr('不透明度')}">${icon('opacity')}<label for="molang-inspector-opacity">${tr('不透明度')}</label><input id="molang-inspector-opacity" class="md-range" type="range" min="${MIN_OPACITY}" max="100" step="1" value="92"><output for="molang-inspector-opacity">92%</output><span class="molang-inspector-grip" aria-hidden="true"></span></div>`;
document.body.append(root);

const $=selector=>root.querySelector(selector);
const header=$('.molang-inspector-header'),form=$('.molang-inspector-input'),exprInput=$('.molang-inspector-expr'),message=$('.molang-inspector-message');
const watchList=$('.molang-inspector-watch-list'),watchEmpty=$('.molang-inspector-watch-empty');
const filterInput=$('.molang-inspector-filter input'),groups=$('.molang-inspector-var-groups'),varEmpty=$('.molang-inspector-var-empty');
// Not a <footer>: style.css hides every footer element (footer{display:none!important}).
const opacityInput=$('#molang-inspector-opacity'),opacityOutput=$('.molang-inspector-footer output');

const lockSection=$('.molang-inspector-locks'),lockList=$('.molang-inspector-lock-list');
const controllerBox=$('.molang-inspector-controllers'),controllerEmpty=$('.molang-inspector-controller-empty');

const state={pinned:false,opacity:92,watches:[],graphs:[],filter:'',overrideMainState:false};

// ---- settings view (第 67 节) ----
const settingsView=$('.molang-inspector-settings'),settingsButton=$('.molang-inspector-settings-button'),bodyView=$('.molang-inspector-body'),overrideInput=$('.molang-inspector-override');
function showSettings(show){
  settingsView.hidden=!show;bodyView.hidden=show;form.hidden=show;
  settingsButton.setAttribute('aria-pressed',String(show));
  if(show)overrideInput.focus();else settingsButton.focus();
}
settingsButton.addEventListener('click',()=>showSettings(settingsView.hidden));
$('.molang-inspector-settings-back').addEventListener('click',()=>showSettings(false));
settingsView.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();showSettings(false);}});
overrideInput.addEventListener('change',()=>{state.overrideMainState=overrideInput.checked;sendSettings({overrideMainState:state.overrideMainState});});
// Desktop only: sets always-on-top (置顶) and the pin button; null in a browser popup.
let applyPinned=null;
let link=null,lastSnapshot=null,varKeys=null,varCells=new Map(),watchCells=[],messageTimer=0,goneTimer=0,executeId=0;
let lockKeys=null,lockedPaths=new Set(),controllerKeys=null,controllerCells=[];
// Curve samples per watched expression: flat [time, value, …] (value null = not a number).
const series=new Map();
const pendingRuns=new Map();
const tauriWindow=isDesktop?(await import('@tauri-apps/api/window')).getCurrentWindow():null;

const showMessage=(text,error=false)=>{
  clearTimeout(messageTimer);message.textContent=text;message.classList.toggle('is-error',error);message.hidden=!text;
  if(text)messageTimer=setTimeout(()=>{message.hidden=true;},error?4000:2000);
};
const sendSettings=patch=>link?.send({type:'settings',patch});
function closeSelf(){if(tauriWindow)tauriWindow.close().catch(()=>{});else window.close();}

// ---- opacity: CSS opacity of the page; the desktop window itself is transparent ----
function applyOpacity(){
  opacityInput.value=String(state.opacity);
  opacityInput.style.setProperty('--fill',`${(state.opacity-MIN_OPACITY)/(100-MIN_OPACITY)*100}%`);
  opacityOutput.textContent=`${state.opacity}%`;
  root.style.opacity=String(state.opacity/100);
}
opacityInput.addEventListener('input',()=>{state.opacity=Number(opacityInput.value);applyOpacity();});
opacityInput.addEventListener('change',()=>sendSettings({opacity:state.opacity}));

// ---- desktop title bar drag, resize grip, remembered bounds ----
if(tauriWindow){
  // Minimize / maximize go through the window_control command (src-tauri/src/popout.rs),
  // shared with the 独立窗口 title bars; it returns whether the window is maximized.
  const {invoke}=await import('@tauri-apps/api/core');
  const control=action=>invoke('window_control',{action}).catch(()=>false);
  const maximizeButton=$('.molang-inspector-maximize');
  const showMaximized=maximized=>{
    html.classList.toggle('is-maximized',!!maximized);
    const label=maximized?tr('向下还原'):tr('最大化');
    maximizeButton.title=label;maximizeButton.setAttribute('aria-label',label);
    maximizeButton.querySelector('.material-symbol-icon').textContent=maximized?'filter_none':'crop_square';
  };
  header.addEventListener('mousedown',event=>{
    if(event.button!==0||event.target.closest('button'))return;
    event.preventDefault();
    if(event.detail===2)control('toggle_maximize').then(showMaximized);
    else tauriWindow.startDragging().catch(()=>{});
  });
  // 置顶 (图钉): always-on-top, remembered in appSettings.molangInspector.pinned (sent with init).
  const pinButton=$('.molang-inspector-pin');
  const showPinned=value=>{
    const label=value?tr('取消置顶'):tr('置顶');
    pinButton.setAttribute('aria-pressed',String(!!value));pinButton.title=label;pinButton.setAttribute('aria-label',label);
  };
  applyPinned=value=>invoke('window_pin',{pinned:!!value}).catch(()=>false).then(result=>{showPinned(result);return !!result;});
  showPinned(false);
  if(state.pinned)applyPinned(true);
  pinButton.addEventListener('click',()=>applyPinned(pinButton.getAttribute('aria-pressed')!=='true').then(value=>{state.pinned=value;sendSettings({pinned:value});}));
  $('.molang-inspector-minimize').addEventListener('click',()=>control('minimize'));
  maximizeButton.addEventListener('click',()=>control('toggle_maximize').then(showMaximized));
  addEventListener('resize',()=>control('is_maximized').then(showMaximized));
  $('.molang-inspector-grip').addEventListener('mousedown',event=>{
    if(event.button!==0)return;
    event.preventDefault();tauriWindow.startResizeDragging('SouthEast').catch(()=>{});
  });
  let boundsTimer=0;
  const reportBounds=()=>{clearTimeout(boundsTimer);boundsTimer=setTimeout(async()=>{
    try{
      const [position,size,scale]=await Promise.all([tauriWindow.outerPosition(),tauriWindow.innerSize(),tauriWindow.scaleFactor()]);
      if(!size.width||!size.height)return; // minimized
      link?.send({type:'bounds',x:Math.round(position.x/scale),y:Math.round(position.y/scale),width:Math.round(size.width/scale),height:Math.round(size.height/scale)});
    }catch{}
  },400);};
  tauriWindow.onMoved(reportBounds);tauriWindow.onResized(reportBounds);
}else{
  // A popup has no move event: compare its screen rectangle now and then.
  let lastBounds='';
  const reportBounds=()=>{
    const bounds={x:screenX,y:screenY,width:innerWidth,height:innerHeight},text=JSON.stringify(bounds);
    if(text===lastBounds||!innerWidth)return;
    lastBounds=text;link?.send({type:'bounds',...bounds});
  };
  setInterval(reportBounds,1000);addEventListener('pagehide',reportBounds);
}

// ---- watches ----
function renderWatches(){
  watchList.innerHTML=state.watches.map((expr,index)=>{
    const graphed=state.graphs.includes(expr),label=graphed?tr('隐藏曲线'):tr('显示曲线');
    return `<li class="molang-inspector-watch" data-index="${index}"><div class="molang-inspector-row"><code class="molang-inspector-key" title="${escapeHtml(expr)}">${escapeHtml(expr)}</code><output class="molang-inspector-value">…</output><button class="icon-button molang-inspector-graph" type="button" aria-pressed="${graphed}" title="${label}" aria-label="${label}">${icon('show_chart')}</button><button class="icon-button molang-inspector-remove" type="button" title="${tr('移除')}" aria-label="${tr('移除')}">${icon('close')}</button></div>${graphed?`<div class="molang-inspector-chart"><canvas aria-label="${tr('{0} 最近 {1} 秒的曲线',expr,GRAPH_SECONDS)}" role="img"></canvas><span class="molang-inspector-chart-max"></span><span class="molang-inspector-chart-min"></span></div>`:''}</li>`;
  }).join('');
  watchCells=[...watchList.querySelectorAll('.molang-inspector-value')].map(element=>({element,text:null}));
  watchEmpty.hidden=state.watches.length>0;
  drawCharts();
}
watchList.addEventListener('click',event=>{
  const item=event.target.closest('.molang-inspector-watch');if(!item||event.target.closest('.molang-inspector-chart'))return;
  const index=Number(item.dataset.index),expr=state.watches[index];
  if(event.target.closest('.molang-inspector-remove')){
    state.watches.splice(index,1);state.graphs=state.graphs.filter(g=>g!==expr);series.delete(expr);
    renderWatches();sendSettings({watches:state.watches,graphs:state.graphs});return;
  }
  if(event.target.closest('.molang-inspector-graph')){
    if(state.graphs.includes(expr)){state.graphs=state.graphs.filter(g=>g!==expr);series.delete(expr);}else state.graphs.push(expr);
    renderWatches();sendSettings({graphs:state.graphs});return;
  }
  exprInput.value=expr;exprInput.focus();
});

// ---- curves (第 66 节): per-frame samples from the host, last GRAPH_SECONDS ----
function addSamples(received){
  for(const [expr,list] of Object.entries(received||{})){
    if(!state.graphs.includes(expr))continue;
    let data=series.get(expr);if(!data)series.set(expr,data=[]);
    for(let i=0;i<list.length;i+=2){
      // The clock went back (new model, restart): start over.
      if(data.length&&list[i]<data[data.length-2])data.length=0;
      data.push(list[i],list[i+1]);
    }
    const end=data[data.length-2];let drop=0;
    while(drop<data.length&&data[drop]<end-GRAPH_SECONDS)drop+=2;
    if(drop)data.splice(0,drop);
  }
}
let chartFrame=0;
function drawCharts(){if(!chartFrame)chartFrame=requestAnimationFrame(()=>{chartFrame=0;for(const item of watchList.querySelectorAll('.molang-inspector-watch'))drawChart(item);});}
function drawChart(item){
  const chart=item.querySelector('.molang-inspector-chart');if(!chart)return;
  const canvas=chart.querySelector('canvas'),expr=state.watches[Number(item.dataset.index)],data=series.get(expr)||[];
  const ratio=devicePixelRatio||1,width=Math.max(1,Math.round(canvas.clientWidth*ratio)),height=Math.max(1,Math.round(canvas.clientHeight*ratio));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const g=canvas.getContext('2d');g.clearRect(0,0,width,height);
  let min=Infinity,max=-Infinity;
  for(let i=1;i<data.length;i+=2){const v=data[i];if(v===null)continue;if(v<min)min=v;if(v>max)max=v;}
  const maxLabel=chart.querySelector('.molang-inspector-chart-max'),minLabel=chart.querySelector('.molang-inspector-chart-min');
  if(min>max){maxLabel.textContent='';minLabel.textContent=data.length?tr('不是数字'):tr('等待数据…');return;}
  maxLabel.textContent=formatNumber(max);minLabel.textContent=formatNumber(min);
  const style=getComputedStyle(chart),pad=4*ratio;
  // Flat values sit in the middle.
  const span=max-min||Math.max(1,Math.abs(max)),low=max===min?min-span/2:min;
  const end=data[data.length-2],start=end-GRAPH_SECONDS;
  const x=t=>(t-start)/GRAPH_SECONDS*width,y=v=>height-pad-(v-low)/span*(height-pad*2);
  if(low<0&&low+span>0){
    g.strokeStyle=style.getPropertyValue('--chart-zero').trim()||'#888';g.lineWidth=ratio;g.setLineDash([3*ratio,3*ratio]);
    g.beginPath();g.moveTo(0,Math.round(y(0))+.5);g.lineTo(width,Math.round(y(0))+.5);g.stroke();g.setLineDash([]);
  }
  g.strokeStyle=style.getPropertyValue('--chart-line').trim()||'#36c';g.lineWidth=1.5*ratio;g.lineJoin='round';
  g.beginPath();let drawing=false;
  for(let i=0;i<data.length;i+=2){
    const v=data[i+1];if(v===null){drawing=false;continue;}
    if(drawing)g.lineTo(x(data[i]),y(v));else{g.moveTo(x(data[i]),y(v));drawing=true;}
  }
  g.stroke();
}
const formatNumber=value=>Number.isInteger(value)?String(value):String(Number(value.toFixed(3)));
new ResizeObserver(drawCharts).observe(watchList);
const syntaxError=expr=>{try{compileMolang(expr);return null;}catch(error){return error;}};
form.addEventListener('submit',event=>{
  event.preventDefault();
  const expr=exprInput.value.trim();if(!expr)return;
  const error=syntaxError(expr);
  if(error){showMessage(tr('语法错误：{0}',error.message),true);return;}
  if(!state.watches.includes(expr)){state.watches.push(expr);renderWatches();sendSettings({watches:state.watches});}
  exprInput.select();
});
$('.molang-inspector-run').addEventListener('click',()=>{
  const expr=exprInput.value.trim();if(!expr)return;
  const error=syntaxError(expr);
  if(error){showMessage(tr('语法错误：{0}',error.message),true);return;}
  const id=++executeId;pendingRuns.set(id,true);
  link?.send({type:'execute',id,script:expr});
});

// ---- locks (第 66 节): "path" locks the current value, "path = expr" that value ----
function requestLock(path,expr=''){
  const id=++executeId;pendingRuns.set(id,'lock');
  link?.send({type:'lock',id,path,expr});
}
$('.molang-inspector-lock').addEventListener('click',()=>{
  const text=exprInput.value.trim();if(!text)return;
  const match=/^(.*?[^=!<>])=(?!=)(.*)$/s.exec(text),path=(match?match[1]:text).trim(),expr=match?match[2].trim():'';
  if(!parseMolangPath(path)){showMessage(tr('只能锁定变量，例如 v.speed 或 q.is_in_water'),true);return;}
  if(expr){const error=syntaxError(expr);if(error){showMessage(tr('语法错误：{0}',error.message),true);return;}}
  requestLock(path,expr);
});
lockList.addEventListener('click',event=>{
  const row=event.target.closest('.molang-inspector-row');if(!row)return;
  if(event.target.closest('.molang-inspector-remove'))link?.send({type:'unlock',path:row.dataset.path});
});
lockList.addEventListener('change',event=>{
  const input=event.target.closest('.molang-inspector-lock-value');if(!input)return;
  const expr=input.value.trim(),row=input.closest('.molang-inspector-row');if(!expr)return;
  const error=syntaxError(expr);if(error){showMessage(tr('语法错误：{0}',error.message),true);return;}
  requestLock(row.dataset.path,expr);
});
lockList.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.closest('.molang-inspector-lock-value'))event.target.blur();});
let mainOverride=null;
function renderLocks(locks){
  lockedPaths=new Set(locks.map(lock=>lock[0]));
  const keys=locks.map(lock=>lock[0]).join('\n');
  lockSection.hidden=!locks.length;
  if(keys!==lockKeys){
    lockKeys=keys;
    lockList.innerHTML=locks.map(([path])=>`<li class="molang-inspector-row" data-path="${escapeHtml(path)}">${icon('lock')}<code class="molang-inspector-key" title="${escapeHtml(path)}">${escapeHtml(path)}</code><input class="molang-inspector-lock-value" type="text" spellcheck="false" aria-label="${tr('{0} 的锁定值',path)}"><button class="icon-button molang-inspector-remove" type="button" title="${tr('解除锁定')}" aria-label="${tr('解除锁定')}">${icon('lock_open')}</button></li>`).join('');
    varKeys=null;
  }
  locks.forEach(([path,text],i)=>{
    const row=lockList.children[i],input=row?.querySelector('input');if(input&&document.activeElement!==input&&input.value!==text)input.value=text;
    // 强制切换主状态: the lock that sets the main state.
    const drives=!!mainOverride&&path===`ctrl.${mainOverride}`;
    if(row&&row.classList.contains('is-driving')!==drives){row.classList.toggle('is-driving',drives);row.title=drives?tr('主状态已切换为 {0}',mainOverride):'';}
  });
}

// ---- controllers (第 66 节): state, time in state, transition conditions ----
const openControllers=new Set();
controllerBox.addEventListener('toggle',event=>{const d=event.target;if(d.dataset?.name){if(d.open)openControllers.add(d.dataset.name);else openControllers.delete(d.dataset.name);}},true);
controllerBox.addEventListener('click',event=>{
  const row=event.target.closest('.molang-inspector-transition');if(!row)return;
  exprInput.value=row.dataset.condition;exprInput.focus();
});
function renderControllers(list){
  const keys=list.map(c=>`${c.name}|${c.state}|${c.clips.map(clip=>clip.name).join(',')}|${c.transitions.map(t=>t.target).join(',')}`).join('\n');
  if(keys!==controllerKeys){
    controllerKeys=keys;
    controllerBox.innerHTML=list.map(c=>`<details class="molang-inspector-group molang-inspector-controller" data-name="${escapeHtml(c.name)}"${openControllers.has(c.name)?' open':''}><summary title="${escapeHtml(c.name)}"><code class="molang-inspector-key">${escapeHtml(c.name)}</code><span class="molang-inspector-state">${escapeHtml(c.state??'—')}</span><output class="molang-inspector-state-time"></output></summary><div class="molang-inspector-controller-body">${c.clips.length?`<p class="molang-inspector-clips">${c.clips.map(clip=>`<span class="molang-inspector-clip${clip.missing?' is-missing':''}" title="${clip.missing?tr('找不到这个动画'):''}">${escapeHtml(clip.name)}</span>`).join('')}</p>`:''}<p class="molang-inspector-finished"></p>${c.transitions.length?`<ul class="molang-inspector-list">${c.transitions.map(t=>`<li class="molang-inspector-row molang-inspector-transition" data-condition="${escapeHtml(t.condition||'1')}" title="${escapeHtml(t.condition||'')}">${icon('arrow_forward')}<span class="molang-inspector-target">${escapeHtml(t.target)}</span><code class="molang-inspector-key">${escapeHtml(t.condition||tr('（无条件）'))}</code><output class="molang-inspector-value"></output></li>`).join('')}</ul>`:`<p class="molang-inspector-empty">${tr('没有转移')}</p>`}</div></details>`).join('');
    controllerCells=[...controllerBox.querySelectorAll('.molang-inspector-controller')].map(element=>({time:element.querySelector('.molang-inspector-state-time'),clips:[...element.querySelectorAll('.molang-inspector-clip')],finished:element.querySelector('.molang-inspector-finished'),values:[...element.querySelectorAll('.molang-inspector-transition')].map(row=>({row,element:row.querySelector('output'),text:null}))}));
  }
  list.forEach((c,i)=>{
    const cell=controllerCells[i];if(!cell)return;
    const time=`${c.time.toFixed(2)} s`;if(cell.time.textContent!==time)cell.time.textContent=time;
    c.clips.forEach((clip,j)=>cell.clips[j]?.classList.toggle('is-inactive',!clip.active));
    const finished=c.finished?`all_animations_finished = ${c.finished[0]} · any_animation_finished = ${c.finished[1]}`:'';
    if(cell.finished.textContent!==finished)cell.finished.textContent=finished;
    c.transitions.forEach((t,j)=>{
      const value=cell.values[j];if(!value)return;
      // null: not checked (an earlier transition fired, or the state just changed).
      const text=t.value===null?'—':formatNumber(t.value);
      value.row.classList.toggle('is-true',t.value!==null&&t.value!==0);
      value.row.classList.toggle('is-unchecked',t.value===null);
      writeValue(value,text);
    });
  });
}

// ---- variables ----
filterInput.addEventListener('input',()=>{state.filter=filterInput.value;varKeys=null;renderSnapshot();});
filterInput.addEventListener('change',()=>sendSettings({filter:state.filter}));
groups.addEventListener('click',event=>{
  const row=event.target.closest('.molang-inspector-row');if(!row)return;
  if(event.target.closest('.molang-inspector-var-lock')){
    const path=row.dataset.path;
    if(lockedPaths.has(path))link?.send({type:'unlock',path});else requestLock(path);
    return;
  }
  exprInput.value=row.dataset.path;exprInput.focus();
});
const closedScopes=new Set();
groups.addEventListener('toggle',event=>{const d=event.target;if(d.dataset?.scope){if(d.open)closedScopes.delete(d.dataset.scope);else closedScopes.add(d.dataset.scope);}},true);
function renderVariables(entries){
  const byScope=new Map(SCOPES.map(scope=>[scope,[]]));
  for(const entry of entries)byScope.get(entry[0].slice(0,entry[0].indexOf('.')))?.push(entry);
  groups.innerHTML=SCOPES.filter(scope=>byScope.get(scope).length).map(scope=>`<details class="molang-inspector-group"${closedScopes.has(scope)?'':' open'} data-scope="${scope}"><summary><code>${scope}.</code><span class="molang-inspector-count">${byScope.get(scope).length}</span></summary><ul class="molang-inspector-list">${byScope.get(scope).map(([path])=>`<li class="molang-inspector-row${lockedPaths.has(path)?' is-locked':''}" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}"><code class="molang-inspector-key">${escapeHtml(path)}</code><output class="molang-inspector-value"></output><button class="icon-button molang-inspector-var-lock" type="button" title="${lockedPaths.has(path)?tr('解除锁定'):tr('锁定当前值')}" aria-label="${lockedPaths.has(path)?tr('解除锁定'):tr('锁定当前值')}" aria-pressed="${lockedPaths.has(path)}">${icon(lockedPaths.has(path)?'lock':'lock_open')}</button></li>`).join('')}</ul></details>`).join('');
  varCells=new Map([...groups.querySelectorAll('.molang-inspector-row')].map(row=>[row.dataset.path,{element:row.querySelector('output'),text:null}]));
}
function writeValue(cell,text){
  if(cell.text===text)return;
  const changed=cell.text!==null;cell.text=text;cell.element.textContent=text;
  if(changed){cell.element.classList.remove('is-changed');void cell.element.offsetWidth;cell.element.classList.add('is-changed');}
}
function renderSnapshot(){
  const snap=lastSnapshot;if(!snap)return;
  // Values belong to the watch list the host had; skip rows edited since.
  state.watches.forEach((expr,i)=>{const cell=watchCells[i];const at=snap.watchKeys.indexOf(expr);if(cell&&at>=0)writeValue(cell,snap.watches[at]);});
  mainOverride=snap.mainOverride||null;
  renderLocks(snap.locks||[]);
  if(!snap.loaded){
    if(varKeys!=='none'){varKeys='none';groups.innerHTML='';varCells=new Map();}
    varEmpty.textContent=tr('未加载模型');varEmpty.hidden=false;
    controllerKeys=null;controllerBox.innerHTML='';controllerCells=[];controllerEmpty.textContent=tr('未加载模型');controllerEmpty.hidden=false;
    return;
  }
  renderControllers(snap.controllers||[]);
  controllerEmpty.textContent=tr('这个模型没有动画控制器');controllerEmpty.hidden=(snap.controllers||[]).length>0;
  const filter=state.filter.trim().toLowerCase();
  let entries=snap.vars;
  if(filter)entries=entries.filter(entry=>entry[0].toLowerCase().includes(filter));
  entries=[...entries].sort((a,b)=>a[0].localeCompare(b[0]));
  const keys=entries.map(entry=>entry[0]).join('\n');
  if(keys!==varKeys){varKeys=keys;renderVariables(entries);}
  varEmpty.textContent=filter?tr('没有匹配的变量'):tr('暂无变量');varEmpty.hidden=entries.length>0;
  for(const [path,text] of entries){const cell=varCells.get(path);if(cell)writeValue(cell,text);}
}

function applyTheme(message){
  html.dataset.theme=message.theme==='dark'?'dark':'light';
  let style=document.querySelector('#dynamic-color');
  if(!style){style=document.createElement('style');style.id='dynamic-color';document.head.append(style);}
  if(style.textContent!==message.css)style.textContent=message.css||'';
}

link=await openLink('window',received=>{
  switch(received.type){
    case 'init':
      clearTimeout(goneTimer);
      Object.assign(state,{graphs:[],overrideMainState:false},received.settings);filterInput.value=state.filter;series.clear();overrideInput.checked=state.overrideMainState;
      applyPinned?.(state.pinned);
      applyOpacity();renderWatches();applyTheme(received);varKeys=null;renderSnapshot();break;
    case 'snapshot':lastSnapshot=received;if(received.series){addSamples(received.series);drawCharts();}renderSnapshot();break;
    case 'locked':
      if(!pendingRuns.delete(received.id))break;
      if(received.error)showMessage(received.error,true);else showMessage(tr('已锁定'));
      break;
    case 'theme':applyTheme(received);break;
    case 'executed':
      if(!pendingRuns.delete(received.id))break;
      showMessage(received.ok?tr('已执行'):received.loaded?tr('执行失败'):tr('请先加载模型'),!received.ok);break;
    case 'ping':link.send({type:'hello'});break;
    case 'close':closeSelf();break;
    // The viewer page is reloading: close unless it comes back.
    case 'host-gone':clearTimeout(goneTimer);goneTimer=setTimeout(closeSelf,4000);break;
  }
});
$('.molang-inspector-close').addEventListener('click',()=>{link.send({type:'closed'});closeSelf();});
// Closed some other way (browser popup's own close button, Alt+F4). When the
// host closed it, the host is no longer open and ignores this.
addEventListener('pagehide',event=>{if(!event.persisted)link.send({type:'closed'});});
applyOpacity();
link.send({type:'hello'});
