import { tr } from './i18n.js';
// Import progress for the viewer: an M3 linear progress indicator with the
// current step, shown in the 3D view's loading overlay. One import is split
// into weighted steps; a step reports real counts where it has them (JSON
// files parsed, textures decoded) and otherwise creeps toward its end over an
// estimated time (unzip / decrypt run in a worker without progress events).

// [key, label, weight] per source. Weights follow measured times: decrypting
// a .ysm dominates, folder imports start at parsing.
const PLANS={
  ysm:[['read',tr('读取文件'),5],['unpack',tr('解密 YSM 模型'),55],['parse',tr('解析模型与动画'),25],['textures',tr('加载贴图'),5],['build',tr('构建模型'),10]],
  zip:[['read',tr('读取文件'),5],['unpack',tr('解压 ZIP'),15],['parse',tr('解析模型与动画'),50],['textures',tr('加载贴图'),10],['build',tr('构建模型'),20]],
  folder:[['parse',tr('解析模型与动画'),65],['textures',tr('加载贴图'),15],['build',tr('构建模型'),20]],
};

// Hourglass under the progress bar, drawn like the Material Symbols
// "hourglass" glyph (24 px, one colour) inside a round tonal container. It
// turns half a turn, pauses while the sand runs into the lower bulb, then
// turns the other half (see style.css). The sand rects slide in and out of
// the bulb-interior clips. Also used next to the library's cover-generation
// progress (`hourglassHtml('is-compact')`), so every copy gets its own clip ids.
let hourglassCount=0;
export function hourglassHtml(extraClass=''){
  const id=`import-hourglass-${++hourglassCount}`;
  return `<div class="import-hourglass ${extraClass}" aria-hidden="true"><svg viewBox="0 0 24 24"><defs><clipPath id="${id}-top"><path d="M8 4h8v3q0 1.65-1.175 2.825Q13.65 11 12 11q-1.65 0-2.825-1.175Q8 8.65 8 7Z"/></clipPath><clipPath id="${id}-bottom"><path d="M8 20h8v-3q0-1.65-1.175-2.825Q13.65 13 12 13q-1.65 0-2.825 1.175Q8 15.35 8 17Z"/></clipPath></defs><g class="import-hourglass-body"><g clip-path="url(#${id}-top)"><rect class="import-hourglass-sand import-hourglass-sand-top" x="7" y="4" width="10" height="7"/></g><g clip-path="url(#${id}-bottom)"><rect class="import-hourglass-sand import-hourglass-sand-bottom" x="7" y="13" width="10" height="7"/></g><path class="import-hourglass-glass" fill-rule="evenodd" d="M4 22v-2h2v-3q0-1.525.713-2.863Q7.425 12.8 8.7 12q-1.275-.8-1.987-2.138Q6 8.525 6 7V4H4V2h16v2h-2v3q0 1.525-.712 2.862Q16.575 11.2 15.3 12q1.275.8 1.988 2.137Q18 15.475 18 17v3h2v2ZM8 4h8v3q0 1.65-1.175 2.825Q13.65 11 12 11q-1.65 0-2.825-1.175Q8 8.65 8 7ZM8 20h8v-3q0-1.65-1.175-2.825Q13.65 13 12 13q-1.65 0-2.825 1.175Q8 15.35 8 17Z"/></g></svg></div>`;
}

/**
 * @param {HTMLElement} element the overlay to render into
 * @returns progress controller: start(kind, name), step(key, done?, total?),
 *   creep(key, estimateMs), finish()
 */
export function createImportProgress(element){
  let plan=null,name='',current=-1,fraction=0,shown=0,creepTimer=0;
  const stop=()=>{clearInterval(creepTimer);creepTimer=0;};
  // The host may replace the overlay's content meanwhile (unloading the old
  // model resets it), so the markup is rebuilt when missing.
  function ensureMarkup(){
    element.hidden=false;
    if(element.querySelector('.import-progress'))return;
    element.innerHTML=`<strong class="import-progress-title"></strong><div class="import-progress" role="progressbar" aria-label="${tr('导入进度')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="import-progress-indicator"></div></div><div class="import-progress-meta"><span class="import-progress-step"></span><span class="import-progress-percent"></span></div>${hourglassHtml()}`;
    element.querySelector('.import-progress-title').textContent=name?tr('正在导入 {0}', name):tr('正在导入模型');
  }
  function render(){
    if(!plan)return;
    ensureMarkup();
    const before=plan.slice(0,current).reduce((sum,[, ,weight])=>sum+weight,0),total=plan.reduce((sum,[, ,weight])=>sum+weight,0);
    // Never move backwards (a later step can start before an estimate caught up).
    shown=Math.max(shown,Math.min(1,(before+plan[current][2]*fraction)/total));
    const percent=Math.round(shown*100);
    element.querySelector('.import-progress').setAttribute('aria-valuenow',String(percent));
    element.querySelector('.import-progress-indicator').style.transform=`scaleX(${shown})`;
    element.querySelector('.import-progress-step').textContent=tr('第 {0} / {1} 步 · {2}', current+1, plan.length, plan[current][1]);
    element.querySelector('.import-progress-percent').textContent=`${percent}%`;
  }
  return {
    start(kind,modelName){
      stop();plan=PLANS[kind]||PLANS.folder;name=modelName;current=0;fraction=0;shown=0;
      element.replaceChildren();render();
    },
    get active(){return Boolean(plan);},
    // Re-renders after the host replaced the overlay's content.
    refresh:render,
    // Moves to `key` (steps the plan does not have are ignored) and sets its
    // completed share from done/total.
    step(key,done=0,total=1){
      if(!plan)return;
      const index=plan.findIndex(([item])=>item===key);if(index<0||index<current)return;
      if(index!==current){stop();current=index;fraction=0;}
      fraction=total>0?Math.min(1,done/total):0;render();
    },
    // For a step without progress events: 1 - e^(-t/estimate), so it slows
    // down instead of stopping at an exact guess.
    creep(key,estimateMs){
      this.step(key,0,1);if(!plan||plan[current][0]!==key)return;
      const started=performance.now();stop();
      creepTimer=setInterval(()=>{fraction=0.95*(1-Math.exp(-(performance.now()-started)/Math.max(300,estimateMs)));render();},120);
    },
    finish(){stop();plan=null;},
  };
}

// Lets the browser paint the progress before a long synchronous step. Falls
// back to a timeout when frames are not running (hidden window).
export function nextPaint(){
  return new Promise(resolve=>{const timer=setTimeout(resolve,50);requestAnimationFrame(()=>setTimeout(()=>{clearTimeout(timer);resolve();},0));});
}
