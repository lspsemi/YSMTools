// 独立窗口 (第 62 节): moves a live part of the page (the toolbar, the cover
// sidebar) into its own OS window and back, like the Document Picture-in-
// Picture API does. The window is a same-origin `window.open` popup of
// popout.html: in the browser a normal popup, on the desktop a Tauri window
// created by the main window's new-window handler (src-tauri/src/launch.rs),
// which keeps the opener relationship, so this page can script it directly.
//
// Because the element is moved, not copied, every event listener, canvas and
// piece of state keeps working with no other code changes. Two things a
// moved element would otherwise lose are patched here, so this module must be
// imported before anything else in main.js:
//   - listeners added with `document.addEventListener` (outside-click menu
//     closing, the slider fill, shortcuts) are also added to each popup's
//     document, since events there never reach this document;
//   - `document.querySelector` / `querySelectorAll` / `getElementById` also
//     search the popups, so lookups of moved elements keep finding them.
import { tr } from './i18n.js';
const isDesktop=typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
const escapeHtml=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const popupDocuments=new Set();
const documentListeners=[];

const nativeAdd=document.addEventListener.bind(document);
const nativeRemove=document.removeEventListener.bind(document);
const capture=options=>typeof options==='boolean'?options:!!options?.capture;
document.addEventListener=(type,listener,options)=>{
  nativeAdd(type,listener,options);
  documentListeners.push({type,listener,options});
  for(const doc of popupDocuments)doc.addEventListener(type,listener,options);
};
document.removeEventListener=(type,listener,options)=>{
  nativeRemove(type,listener,options);
  const index=documentListeners.findIndex(item=>item.type===type&&item.listener===listener&&capture(item.options)===capture(options));
  if(index>=0)documentListeners.splice(index,1);
  for(const doc of popupDocuments)doc.removeEventListener(type,listener,options);
};
const nativeQuery=document.querySelector.bind(document);
const nativeQueryAll=document.querySelectorAll.bind(document);
const nativeById=document.getElementById.bind(document);
document.querySelector=selector=>{
  const found=nativeQuery(selector);if(found||!popupDocuments.size)return found;
  for(const doc of popupDocuments){const element=doc.querySelector(selector);if(element)return element;}
  return null;
};
document.querySelectorAll=selector=>{
  const found=nativeQueryAll(selector);if(!popupDocuments.size)return found;
  return [...found,...[...popupDocuments].flatMap(doc=>[...doc.querySelectorAll(selector)])];
};
document.getElementById=id=>{
  const found=nativeById(id);if(found||!popupDocuments.size)return found;
  for(const doc of popupDocuments){const element=doc.getElementById(id);if(element)return element;}
  return null;
};

// Desktop: window.close() only closes the webview; the Tauri window stays up
// blank, frameless and impossible to close (第 63.4 节). Close the window itself
// from inside the popup (window_control acts on the calling window);
// win.close() is the browser path and the fallback.
function closePopupWindow(win){
  const fallback=()=>{try{win.close();}catch{}};
  let internals=null;try{internals=win.closed?null:win.__TAURI_INTERNALS__;}catch{}
  if(!internals){fallback();return;}
  try{internals.invoke('window_control',{action:'close'}).catch(fallback);}catch{fallback();}
}

const open=new Map();
addEventListener('pagehide',()=>{for(const popout of [...open.values()])popout.close();});

/** True while `name` is shown in its own window. */
export const isPoppedOut=name=>open.has(name);

/**
 * Opens `element` in its own window. `bounds` {x, y, width, height} (screen
 * position may be null) is where it opens; `fit(doc)` (optional) returns the
 * size the window should have and is re-run whenever the element changes
 * (the toolbar grows for its drop-down menus). `onBounds(bounds)` reports
 * moves/resizes; `onClosed(byUser)` runs once the element is back in place.
 * Resolves to a handle {close()} or null when the browser blocked the popup.
 */
export async function popOut(name,{element,title,icon='select_window',className,bounds,fit,resizable=true,pinned=false,onBounds,onPinned,onClosed}){
  if(open.has(name))return open.get(name);
  // The desktop window has no native frame: the page draws a title bar (below).
  // Always ask for a position, so the offset between the requested (outer
  // window) position and the reported one (screenX/Y: the content area on the
  // desktop, below the title bar) can be measured and saved bounds don't drift.
  const left=Math.round(Number.isFinite(bounds.x)?bounds.x:screenX+Math.max(0,(outerWidth-bounds.width)/2));
  const top=Math.round(Number.isFinite(bounds.y)?bounds.y:screenY+120);
  const features=['popup',`width=${Math.round(bounds.width)}`,`height=${Math.round(bounds.height)}`,`left=${left}`,`top=${top}`];
  // A fresh name each time: after a page reload the previous popup (same
  // browsing-context group) may still be closing, and reusing its name would
  // navigate that dying window instead of opening a new one (第 63.4 节).
  const win=window.open('./popout.html',`ysm-popout-${name}-${Date.now().toString(36)}`,features.join(','));
  if(!win)return null;
  // Wait until popout.html (not the initial about:blank) has loaded.
  const ready=await new Promise(resolve=>{
    const started=performance.now();
    const check=()=>{
      let ok=false;try{ok=win.document.readyState==='complete'&&win.location.pathname.endsWith('popout.html');}catch{}
      if(ok)resolve(true);else if(win.closed||performance.now()-started>8000)resolve(false);else setTimeout(check,30);
    };
    check();
  });
  if(!ready){closePopupWindow(win);return null;}

  const offset={x:win.screenX-left,y:win.screenY-top};
  const doc=win.document,html=doc.documentElement;
  html.classList.add('popout-page',className);
  doc.title=title;
  // Desktop: undecorated window (src-tauri/src/popout.rs) with its own M3 title
  // bar — drag, double-click / maximize button, minimize, close — and a resize
  // grip. Browser popups keep the browser's frame.
  const tauri=isDesktop?win.__TAURI_INTERNALS__:null;
  let titlebar=null;
  if(tauri){
    html.classList.add('popout-framed');
    const control=action=>tauri.invoke('window_control',{action}).catch(()=>false);
    titlebar=doc.createElement('header');titlebar.className='window-titlebar';
    titlebar.innerHTML=`<span class="material-symbol-icon" aria-hidden="true">${icon}</span><h1>${escapeHtml(title)}</h1><button class="icon-button window-pin" type="button" data-action="pin" aria-pressed="false"><span class="material-symbol-icon" aria-hidden="true">push_pin</span></button><button class="icon-button" type="button" data-action="minimize" title="${tr('最小化')}" aria-label="${tr('最小化')}"><span class="material-symbol-icon" aria-hidden="true">remove</span></button><button class="icon-button" type="button" data-action="toggle_maximize" title="${tr('最大化')}" aria-label="${tr('最大化')}"><span class="material-symbol-icon" aria-hidden="true">crop_square</span></button><button class="icon-button window-close" type="button" data-action="close" title="${tr('关闭')}" aria-label="${tr('关闭')}"><span class="material-symbol-icon" aria-hidden="true">close</span></button>`;
    doc.body.prepend(titlebar);
    const maximizeButton=titlebar.querySelector('[data-action=toggle_maximize]');
    const showMaximized=maximized=>{
      html.classList.toggle('is-maximized',!!maximized);
      const label=maximized?tr('向下还原'):tr('最大化');
      maximizeButton.title=label;maximizeButton.setAttribute('aria-label',label);
      maximizeButton.firstElementChild.textContent=maximized?'filter_none':'crop_square';
    };
    // 置顶 (图钉): always-on-top of this window, remembered by the caller (onPinned).
    const pinButton=titlebar.querySelector('[data-action=pin]');
    const showPinned=value=>{
      const label=value?tr('取消置顶'):tr('置顶');
      pinButton.setAttribute('aria-pressed',String(!!value));pinButton.title=label;pinButton.setAttribute('aria-label',label);
    };
    const setPinned=value=>tauri.invoke('window_pin',{pinned:!!value}).catch(()=>false).then(result=>{showPinned(result);return result;});
    showPinned(false);
    if(pinned)setPinned(true);
    titlebar.addEventListener('mousedown',event=>{
      if(event.button!==0||event.target.closest('button'))return;
      event.preventDefault();
      if(event.detail===2)control('toggle_maximize').then(showMaximized);else control('start_dragging');
    });
    titlebar.addEventListener('click',event=>{
      const action=event.target.closest('button')?.dataset.action;if(!action)return;
      if(action==='close')handle.closeByUser();
      else if(action==='pin')setPinned(pinButton.getAttribute('aria-pressed')!=='true').then(value=>onPinned?.(!!value));
      else if(action==='toggle_maximize')control(action).then(showMaximized);
      else control(action);
    });
    win.addEventListener('resize',()=>{control('is_maximized').then(showMaximized);if(fit)queueFit();});
    if(resizable){
      const grip=doc.createElement('span');grip.className='window-resize-grip';grip.setAttribute('aria-hidden','true');
      grip.addEventListener('mousedown',event=>{if(event.button!==0)return;event.preventDefault();tauri.invoke('plugin:window|start_resize_dragging',{value:'SouthEast'}).catch(()=>{});});
      doc.body.append(grip);
    }
  }
  // Same styles and theme as this page; kept in sync (theme switch, 自动取色, dev-server CSS updates).
  const syncAttributes=()=>{for(const name of ['lang','data-theme','data-dynamic-color']){const value=document.documentElement.getAttribute(name);if(value===null)html.removeAttribute(name);else html.setAttribute(name,value);}};
  let styleCopies=[];
  const syncStyles=()=>{
    for(const node of styleCopies)node.remove();
    styleCopies=[...document.head.querySelectorAll('style,link[rel=stylesheet]')].map(node=>doc.importNode(node,true));
    doc.head.append(...styleCopies);
  };
  syncAttributes();syncStyles();
  let stylePending=false;
  const headObserver=new MutationObserver(()=>{if(stylePending)return;stylePending=true;queueMicrotask(()=>{stylePending=false;syncStyles();});});
  headObserver.observe(document.head,{childList:true,subtree:true,characterData:true});
  const attributeObserver=new MutationObserver(syncAttributes);
  attributeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme','data-dynamic-color']});

  const placeholder=document.createComment(`popout:${name}`);
  element.before(placeholder);
  doc.body.append(element);
  for(const {type,listener,options} of documentListeners)doc.addEventListener(type,listener,options);
  popupDocuments.add(doc);

  // ---- window size: fit to content ----
  let fitObserver=null,resizeObserver=null,fitQueued=false;
  const applyFit=()=>{
    fitQueued=false;if(win.closed)return;
    // A menu that takes focus scrolls the page (body) before the window has grown.
    resetScroll();
    const size=fit(doc);if(!size)return;
    const width=Math.ceil(size.width),height=Math.ceil(size.height);
    if(Math.abs(win.innerWidth-width)<=1&&Math.abs(win.innerHeight-height)<=1)return;
    if(isDesktop&&win.__TAURI_INTERNALS__)win.__TAURI_INTERNALS__.invoke('popout_fit',{width,height}).catch(()=>{});
    else{try{win.resizeTo(width+(win.outerWidth-win.innerWidth),height+(win.outerHeight-win.innerHeight));}catch{}}
    win.setTimeout(resetScroll,50);
  };
  const resetScroll=()=>{win.scrollTo(0,0);doc.documentElement.scrollTop=0;doc.body.scrollTop=0;doc.body.scrollLeft=0;};
  const queueFit=()=>{if(!fitQueued){fitQueued=true;win.requestAnimationFrame(applyFit);}};
  if(fit){
    fitObserver=new win.MutationObserver(queueFit);
    fitObserver.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-expanded','class','style']});
    // Observers of the popup's own window: this window's ResizeObserver never sees its layout.
    resizeObserver=new win.ResizeObserver(queueFit);resizeObserver.observe(element);
    queueFit();
  }

  // ---- remembered bounds ----
  let lastBounds='';
  const readBounds=()=>{
    if(win.closed||!win.innerWidth)return;
    const value={x:win.screenX-offset.x,y:win.screenY-offset.y,width:win.innerWidth,height:win.innerHeight},text=JSON.stringify(value);
    if(text!==lastBounds){lastBounds=text;onBounds?.(value);}
  };
  const boundsTimer=setInterval(readBounds,1000);

  let closed=false,closingByCode=false;
  const restore=()=>{
    if(closed)return;closed=true;
    readBounds();clearInterval(boundsTimer);clearInterval(closedTimer);
    headObserver.disconnect();attributeObserver.disconnect();fitObserver?.disconnect();resizeObserver?.disconnect();
    for(const {type,listener,options} of documentListeners){try{doc.removeEventListener(type,listener,options);}catch{}}
    popupDocuments.delete(doc);open.delete(name);
    if(placeholder.isConnected)placeholder.replaceWith(element);else document.body.append(element);
    titlebar?.remove();
    onClosed?.(!closingByCode);
  };
  // The popup's page also unloads when this page reloads, sometimes before this
  // page's own pagehide: decide a moment later, so a reload is not taken for
  // the user closing the window (the timer never fires on an unloading page).
  // A popup page that unloaded while its window stays open is closed too.
  win.addEventListener('pagehide',()=>setTimeout(()=>{if(closed)return;restore();if(!win.closed)closePopupWindow(win);},150));
  // Backup for windows that disappear without pagehide.
  const closedTimer=setInterval(()=>{if(win.closed)restore();},500);

  const closeWindow=()=>closePopupWindow(win);
  const handle={
    window:win,
    refit:queueFit,
    close(){closingByCode=true;restore();closeWindow();},
    // The title bar's close button: like closing the window itself.
    closeByUser(){restore();closeWindow();},
  };
  open.set(name,handle);
  return handle;
}
