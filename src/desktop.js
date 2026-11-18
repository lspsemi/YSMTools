// Integrations that only apply when the page runs inside the Tauri desktop shell.
import { tr } from './i18n.js';
export async function setupDesktop(){
  if(!('__TAURI_INTERNALS__' in window))return;
  const { openUrl }=await import('@tauri-apps/plugin-opener');
  // Open external links in the system browser instead of a new webview window.
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');
    if(!link||!/^https?:/i.test(link.href)||new URL(link.href).origin===location.origin)return;
    event.preventDefault();openUrl(link.href).catch(error=>console.error(error));
  });
  // Fullscreen (app / 3D view) is handled by fullscreen.js, which sets the OS window itself.
  setupWindowControls();
}

// The main window has no native frame (tauri.conf.json "decorations": false,
// 第 62 节): like the 独立窗口 and Molang 监视器 windows, the top bar carries
// M3 minimize / maximize / close buttons, its empty area drags the window and
// a double-click maximizes. Edge resizing is Tauri's own (undecorated resizing).
function setupWindowControls(){
  const header=document.querySelector('.site-header');if(!header)return;
  const control=async action=>{try{const {invoke}=await import('@tauri-apps/api/core');return await invoke('window_control',{action});}catch{return false;}};
  const button=(action,iconName,label,extra='')=>`<button class="icon-button${extra}" type="button" data-action="${action}" title="${label}" aria-label="${label}"><span class="material-symbol-icon" aria-hidden="true">${iconName}</span></button>`;
  const controls=document.createElement('div');
  controls.className='window-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label',tr('窗口'));
  controls.innerHTML=button('minimize','remove',tr('最小化'))+button('toggle_maximize','crop_square',tr('最大化'))+button('close','close',tr('关闭'),' window-close');
  header.append(controls);
  document.documentElement.classList.add('has-window-controls');
  const maximizeButton=controls.querySelector('[data-action=toggle_maximize]');
  const showMaximized=maximized=>{
    document.documentElement.classList.toggle('is-maximized',!!maximized);
    const label=maximized?tr('向下还原'):tr('最大化');
    maximizeButton.title=label;maximizeButton.setAttribute('aria-label',label);
    maximizeButton.firstElementChild.textContent=maximized?'filter_none':'crop_square';
  };
  controls.addEventListener('click',event=>{
    const action=event.target.closest('button')?.dataset.action;if(!action)return;
    control(action).then(value=>{if(action==='toggle_maximize')showMaximized(value);});
  });
  // Drag from the bar's empty space only: anything interactive keeps its click.
  header.addEventListener('mousedown',event=>{
    if(event.button!==0||event.target.closest('button,a,input,select,textarea,label,[role=menu],[role=menuitem],[role=menuitemradio],.language-menu'))return;
    // App fullscreen (第 64 节): the window stays put — no dragging, no double-click restore.
    if(document.documentElement.classList.contains('app-fullscreen'))return;
    event.preventDefault();
    if(event.detail===2)control('toggle_maximize').then(showMaximized);else control('start_dragging');
  });
  addEventListener('resize',()=>control('is_maximized').then(showMaximized));
  control('is_maximized').then(showMaximized);
}
