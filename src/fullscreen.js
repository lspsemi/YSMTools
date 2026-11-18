// Two fullscreen modes (第 64 节):
//   - app: the whole page (header button / F11);
//   - viewer: the 预览 3D view (#viewer-shell, toolbar button).
//
// Desktop (Tauri): the Fullscreen API is not used, so the browser never acts on
// Esc by itself. The OS window is made fullscreen with setFullscreen and the
// page is laid out with classes: `html.app-fullscreen` (window fixed: no
// dragging, no window buttons, Esc does nothing; only the button leaves it)
// and `html.viewer-fullscreen` + `#viewer-shell.is-fullscreen` (the view
// covers the window). The 3D view leaves its fullscreen on Esc (handled in
// main.js through `onViewerEscape`), back to the app state underneath.
//
// Browser: the Fullscreen API, plus navigator.keyboard.lock(['Escape']) where
// supported (Chromium), so a short Esc reaches the page instead of leaving
// fullscreen (holding Esc still leaves it: the browser enforces that).
const isDesktop=typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
const state={app:false,viewer:false};
const listeners=new Set();
const shell=()=>document.querySelector('#viewer-shell');

export const fullscreenState=()=>({...state});
export const isAnyFullscreen=()=>state.app||state.viewer;
export function onFullscreenChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}
const emit=()=>{for(const listener of listeners){try{listener({...state});}catch(error){console.error(error);}}};

let currentWindow=null;
async function osWindow(){
  if(!currentWindow){const {getCurrentWindow}=await import('@tauri-apps/api/window');currentWindow=getCurrentWindow();}
  return currentWindow;
}
// The OS window is fullscreen while either mode is on. Not resizable meanwhile:
// the frameless window's edge resizing would otherwise still grab the borders.
// A maximized window keeps its maximized size when made fullscreen (the
// taskbar strip stays black) and comes back from it at the wrong position:
// leave the maximized state first and maximize again afterwards.
let restoreMaximized=false,osFullscreen=false;
async function syncDesktopWindow(){
  const full=state.app||state.viewer,win=await osWindow();
  if(full===osFullscreen)return;
  osFullscreen=full;
  if(full){
    restoreMaximized=await win.isMaximized().catch(()=>false);
    if(restoreMaximized)await win.unmaximize();
    await win.setFullscreen(true);
    await win.setResizable(false).catch(()=>{});
  }else{
    await win.setResizable(true).catch(()=>{});
    await win.setFullscreen(false);
    if(restoreMaximized){restoreMaximized=false;await win.maximize();}
  }
}
function syncClasses(){
  const html=document.documentElement;
  html.classList.toggle('app-fullscreen',state.app);
  html.classList.toggle('viewer-fullscreen',state.viewer);
  shell()?.classList.toggle('is-fullscreen',isDesktop&&state.viewer);
}

// ---- browser: Fullscreen API ----
function lockEscape(){if(document.fullscreenElement)navigator.keyboard?.lock?.(['Escape']).catch(()=>{});}
if(!isDesktop){
  document.addEventListener('fullscreenchange',()=>{
    const element=document.fullscreenElement;
    state.viewer=!!element&&element===shell();
    state.app=!!element&&!state.viewer;
    if(element)lockEscape();else navigator.keyboard?.unlock?.();
    syncClasses();emit();
  });
}

/** Whole-app fullscreen on/off (`value` omitted = toggle). Throws when unsupported. */
export async function setAppFullscreen(value=!state.app){
  value=!!value;
  if(isDesktop){
    if(state.app===value)return;
    state.app=value;syncClasses();emit();
    await syncDesktopWindow();return;
  }
  if(value===state.app)return;
  if(value)await document.documentElement.requestFullscreen();
  else if(document.fullscreenElement)await document.exitFullscreen();
}

/** 3D view fullscreen on/off (`value` omitted = toggle). Throws when unsupported. */
export async function setViewerFullscreen(value=!state.viewer){
  value=!!value;
  if(isDesktop){
    if(state.viewer===value)return;
    state.viewer=value;syncClasses();emit();
    await syncDesktopWindow();return;
  }
  if(value===state.viewer)return;
  // In app fullscreen the view goes fullscreen on top; leaving it returns to the app.
  if(value)await shell().requestFullscreen();
  else if(document.fullscreenElement)await document.exitFullscreen();
}
