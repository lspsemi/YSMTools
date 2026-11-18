import './library.css';
import { getLibraryBackend } from './backend.js';
import { readLibraryModel } from './thumbnail.js';
import { icon, escapeText, sorters, readSavedView, coverButtonHtml, revealCover } from './cover-card.js';
import { tr } from '../i18n.js';

// Quick model switcher of the 3D view: a column of library covers slides in
// from the left (L), ↑/↓ or the mouse wheel moves the selection and Enter (or
// a click) opens that model. The covers are the library's own cards, in the
// library's saved order. Like the library it reaches the host page only
// through the options of createModelSwitcher().

// Covers are read only around the selection; the rest load while scrolling.
const PRELOAD=6;
const packName=model=>model.fileName.replace(/\.(?:zip|ysm)$/i,'');

/**
 * @param {HTMLElement} host the 3D view (positioned)
 * @param {{toast:(message:string)=>void, currentId:()=>string|null, openModel:(byPath:Map<string,File>,name:string,model:object)=>Promise<void>}} options
 */
export function createModelSwitcher(host,{toast,currentId,openModel}){
  const panel=document.createElement('div');
  panel.className='model-switcher';panel.hidden=true;
  panel.innerHTML=`<div class="model-switcher-rail" aria-hidden="true">${tr('角色选择 · CHARACTER SELECTION')}</div>
    <div class="model-switcher-main">
      <span class="model-switcher-count" aria-live="polite"></span>
      <div class="model-switcher-list" role="listbox" tabindex="-1" aria-label="${tr('快速切换模型')}"><div class="model-switcher-track"></div></div>
      <p class="model-switcher-hint"><kbd>↑</kbd><kbd>↓</kbd> ${tr('滚轮 选择')}<br><kbd>Enter</kbd> ${tr('确定 ·')} <kbd>Esc</kbd> ${tr('关闭')}</p>
    </div>`;
  host.append(panel);
  const list=panel.querySelector('.model-switcher-list'),track=panel.querySelector('.model-switcher-track'),count=panel.querySelector('.model-switcher-count');

  let backend=null,models=[],index=0,state='closed',current=null,returnFocus=null,closeTimer=0,selectedItem=null;
  const covers=new Map();
  let wheelDelta=0,wheelReset=0;

  function render(){
    selectedItem=null;
    track.innerHTML=models.map((model,i)=>`<div class="model-switcher-item" role="option" id="model-switcher-${i}" aria-selected="false" data-index="${i}">
      <div class="library-cover-wrap">
        ${coverButtonHtml(model,`tabindex="-1" aria-label="${tr('切换到 {0}', escapeText(model.name))}"`,tr('{0} 切换', icon('swap_horiz')))}
        ${model.id===current?`<span class="library-badges"><span class="library-badge is-mounted">${icon('check')} ${tr('当前')}</span></span>`:''}
      </div>
      <span class="model-switcher-name" title="${escapeText(model.name)}">${escapeText(model.name)}</span>
    </div>`).join('');
  }
  function loadCovers(){
    for(let i=Math.max(0,index-PRELOAD);i<=Math.min(models.length-1,index+PRELOAD);i++){
      const model=models[i];
      if(!model.hasThumbnail||covers.has(model.id))continue;
      const url=backend.readThumbnail(model.id).then(blob=>URL.createObjectURL(blob)).catch(()=>null);
      covers.set(model.id,url);
      url.then(value=>{if(state==='open')revealCover(track.children[i]?.querySelector('img'),value);});
    }
  }
  // Every slot has a fixed height; only the selected cover is scaled. Moving
  // the track therefore never has to relayout the cards during a transition.
  function update(){
    const style=getComputedStyle(panel),size=name=>parseFloat(style.getPropertyValue(name));
    const card=size('--switcher-card'),gap=size('--switcher-gap'),label=size('--switcher-name');
    const slot=card*1.5+label;
    const centre=index*(slot+gap)+slot/2;
    const offset=Math.round(list.clientHeight/2-centre);
    selectedItem?.classList.remove('is-active');selectedItem?.setAttribute('aria-selected','false');
    const item=track.children[index];selectedItem=item;
    item.classList.add('is-active');item.setAttribute('aria-selected','true');
    list.setAttribute('aria-activedescendant',item.id);
    track.style.transform=`translateY(${offset}px)`;
    count.textContent=`${index+1} / ${models.length}`;
    loadCovers();
  }
  function select(next){
    next=Math.max(0,Math.min(models.length-1,next));
    if(next===index)return;
    index=next;update();
  }

  function onKey(event){
    if(event.ctrlKey||event.altKey||event.metaKey)return;
    const steps={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5};
    if(event.key in steps)select(index+steps[event.key]);
    else if(event.key==='Home')select(0);
    else if(event.key==='End')select(models.length-1);
    else if(event.key==='Enter'||event.key===' '){if(!event.repeat)confirm();}
    else if(event.key==='Escape'||event.code==='KeyL'){if(!event.repeat)close();}
    else return;
    event.preventDefault();event.stopImmediatePropagation();
  }
  // Like the action wheel: one notch (or one trackpad swipe) moves one card.
  function onWheel(event){
    event.preventDefault();event.stopPropagation();
    if(Math.abs(event.deltaY)<Math.abs(event.deltaX))return;
    clearTimeout(wheelReset);wheelReset=setTimeout(()=>{wheelDelta=0;},200);
    wheelDelta+=event.deltaMode===0?event.deltaY:event.deltaY*40;
    if(Math.abs(wheelDelta)<50)return;
    select(index+Math.sign(wheelDelta));wheelDelta=0;
  }
  function onPointerDown(event){if(!panel.contains(event.target))close();}
  track.addEventListener('click',event=>{
    const item=event.target.closest('[data-index]');if(!item)return;
    index=Number(item.dataset.index);update();confirm();
  });
  const onResize=()=>{if(state==='open')update();};

  async function open(){
    if(state!=='closed')return;
    state='loading';models=[];
    if(closeTimer)cleanup();
    try{
      backend??=await getLibraryBackend();
      if(!backend){toast(tr('快速切换使用模型库中的模型，需要桌面版或开发服务器'));return;}
      const saved=readSavedView();
      models=[...(await backend.state()).models].sort(sorters[saved.sort]||sorters.recent);
    }catch(error){console.error(error);toast(tr('读取模型库失败：{0}', error.message));return;}
    finally{if(state==='loading'&&!models.length)state='closed';}
    if(!models.length){toast(tr('模型库中还没有模型，请先在“模型库”中导入'));return;}
    current=currentId();
    index=Math.max(0,models.findIndex(model=>model.id===current));
    render();
    panel.classList.remove('is-closing');panel.hidden=false;state='open';
    returnFocus=document.activeElement;list.focus({preventScroll:true});
    update();
    addEventListener('keydown',onKey,true);
    host.addEventListener('wheel',onWheel,{capture:true,passive:false});
    addEventListener('pointerdown',onPointerDown,true);
    addEventListener('resize',onResize);
  }
  function close(){
    if(state!=='open')return;
    state='closed';
    removeEventListener('keydown',onKey,true);
    host.removeEventListener('wheel',onWheel,{capture:true});
    removeEventListener('pointerdown',onPointerDown,true);
    removeEventListener('resize',onResize);
    if(panel.contains(document.activeElement))(returnFocus?.isConnected?returnFocus:document.body).focus?.({preventScroll:true});
    panel.classList.add('is-closing');
    closeTimer=setTimeout(cleanup,150);
  }
  function cleanup(){
    clearTimeout(closeTimer);closeTimer=0;
    panel.hidden=true;track.innerHTML='';selectedItem=null;
    for(const url of covers.values())url.then(value=>value&&URL.revokeObjectURL(value));
    covers.clear();
  }
  async function confirm(){
    const model=models[index];
    close();
    if(!model||model.id===current)return;
    try{await openModel(await readLibraryModel(backend,model),packName(model),model);}
    catch(error){console.error(error);toast(tr('打开失败：{0}', error.message));}
  }

  return {open,close,get isOpen(){return state!=='closed';}};
}
