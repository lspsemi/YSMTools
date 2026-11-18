import './library.css';
import { getLibraryBackend } from './backend.js';
import { readLibraryModel, readModelInfo, readPackBytes, renderCover, releaseCoverRenderer, openCoverSession } from './thumbnail.js';
import { writeConfig } from '../app-config.js';
import { icon, escapeText, sorters, readSavedView, coverButtonHtml, revealCover } from './cover-card.js';
import { tr } from '../i18n.js';
import { hourglassHtml } from '../import-progress.js';

// The model library page: a Steam-style grid of 2:3 character covers (or a
// detail list), shown page by page, with batch import (pickers or drag and
// drop), multi-select (mount / unmount / delete) and mounting models into one
// or more game folders through links. Importing and game folders live in a
// settings side sheet so the page itself stays compact.
// It depends on the host page only through the options passed to
// mountLibrary(), so it can move into a separate app unchanged.

const formatSize=bytes=>bytes>=1<<20?`${(bytes/(1<<20)).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;
const FILTERS=[['all',tr('全部')],['mounted',tr('已挂载')],['unmounted',tr('未挂载')]];
const SORTS=[['recent',tr('最近导入')],['name',tr('名称')],['size',tr('文件大小')]];
const PAGE_SIZES=[24,48,96];
const LAYOUTS=[['grid','grid_view',tr('网格视图')],['list','view_list',tr('详细信息视图')]];
const PACK=/\.(?:zip|ysm)$/i;
const formatDate=time=>new Date(time).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});

// View settings (filter, sort, page size, page and scroll position) survive
// switching views and restarting the app. Storage may be unavailable.
function readViewState(){
  const saved=readSavedView();
  return {
    filter:FILTERS.some(([value])=>value===saved.filter)?saved.filter:'all',
    sort:sorters[saved.sort]?saved.sort:'recent',
    layout:LAYOUTS.some(([value])=>value===saved.layout)?saved.layout:'grid',
    pageSize:PAGE_SIZES.includes(saved.pageSize)?saved.pageSize:48,
    page:Number.isInteger(saved.page)&&saved.page>0?saved.page:1,
    scroll:Number.isFinite(saved.scroll)?saved.scroll:0,
    dirScope:typeof saved.dirScope==='string'?saved.dirScope:'all',
    mountDirs:Array.isArray(saved.mountDirs)?saved.mountDirs:null,
  };
}

// Short name of a game folder: the version folder for version isolation,
// otherwise the game folder (also when the custom folder itself was chosen).
function dirLabels(dirs){
  const parts=dir=>{
    const list=dir.path.split(/[\\/]+/).filter(Boolean),lower=list.map(part=>part.toLowerCase());
    let end=list.length;
    if(lower[end-1]==='custom'&&lower[end-2]==='yes_steve_model')end-=2;else if(lower[end-1]==='yes_steve_model')end-=1;
    if(lower[end-1]==='config')end-=1;
    return list.slice(0,Math.max(1,end));
  };
  const labels=new Map(dirs.map(dir=>[dir.id,parts(dir).at(-1)||dir.path]));
  // Two launchers' ".minecraft" folders: add the parent folder.
  for(const dir of dirs){
    if([...labels.values()].filter(label=>label===labels.get(dir.id)).length<2)continue;
    labels.set(dir.id,parts(dir).slice(-2).join('/'));
  }
  return labels;
}

/**
 * @param {HTMLElement} container
 * @param {{toast:(message:string)=>void, openModel:(byPath:Map<string,File>,name:string,model:object)=>Promise<void>, cardWarmUp?:()=>number}} host
 * cardWarmUp: the viewer's card warm-up setting (seconds), used by the cover editor.
 */
export async function mountLibrary(container,{toast,openModel,cardWarmUp=()=>1}){
  container.innerHTML=`
    <div class="library">
      <header class="library-bar">
        <div class="library-heading"><h1>${tr('模型库')}</h1><span class="library-count" id="library-count"></span></div>
        <label class="library-search">${icon('search')}<input id="library-search" type="search" placeholder="${tr('搜索模型（Ctrl+F）')}" aria-label="${tr('搜索模型')}"></label>
        <div class="md-segmented library-layout" role="radiogroup" aria-label="${tr('视图')}">${LAYOUTS.map(([value,symbol,label])=>`<label title="${label}"><input type="radio" name="library-layout" value="${value}" aria-label="${label}">${icon(symbol)}</label>`).join('')}</div>
        <button class="icon-button" id="library-settings" type="button" title="${tr('模型库设置：导入、游戏目录')}" aria-label="${tr('模型库设置')}" aria-haspopup="dialog">${icon('settings')}</button>
      </header>
      <div class="library-toolbar" id="library-toolbar">
        <div class="library-toolbar-main">
          <div class="library-chips" role="radiogroup" aria-label="${tr('筛选')}"></div>
          <button class="library-chip library-dir-scope" id="library-dir-scope" type="button" aria-haspopup="menu" hidden></button>
          <div class="library-progress" id="library-progress" hidden><span class="library-progress-text"></span><progress max="1" value="0"></progress>${hourglassHtml('is-compact library-progress-hourglass')}</div>
          <button class="md-button text library-sort" id="library-sort" type="button" aria-haspopup="menu"></button>
          <div class="library-pager-mini" id="library-pager-mini"></div>
        </div>
        <div class="library-toolbar-select" hidden>
          <button class="icon-button" type="button" data-select="clear" title="${tr('取消选择（Esc）')}" aria-label="${tr('取消选择')}">${icon('close')}</button>
          <strong class="library-select-count" aria-live="polite"></strong>
          <button class="md-button text" type="button" data-select="page" title="${tr('选择本页全部模型')}">${icon('select_all')} ${tr('选择本页')}</button>
          <button class="md-button text" type="button" data-select="all" title="${tr('选择全部符合筛选的模型（Ctrl+A）')}">${icon('done_all')} <span class="library-select-all-label">${tr('全选')}</span></button>
          <span class="library-toolbar-spacer"></span>
          <button class="md-button tonal" type="button" data-select="mount">${icon('add_link')} ${tr('挂载')}</button>
          <button class="md-button tonal" type="button" data-select="unmount">${icon('link_off')} ${tr('取消挂载')}</button>
          <button class="md-button tonal is-danger" type="button" data-select="delete" title="${tr('从模型库删除（Delete）')}">${icon('delete')} ${tr('删除')}</button>
        </div>
      </div>
      <div class="library-grid" id="library-grid" role="list"></div>
      <nav class="library-pager" id="library-pager" aria-label="${tr('分页')}"></nav>
      <div class="library-empty" id="library-empty" hidden>${icon('photo_library')}<strong>${tr('模型库还是空的')}</strong><span>${tr('把 .zip / .ysm 模型包、模型文件夹或包含多个模型的文件夹拖到这里，会自动生成人物封面')}</span>
        <div class="library-empty-actions"><button class="md-button tonal" type="button" data-sheet="import-folder">${icon('create_new_folder')} ${tr('导入文件夹')}</button><button class="md-button filled" type="button" data-sheet="import-files">${icon('add')} ${tr('导入模型包')}</button></div></div>
      <div class="library-unavailable" id="library-unavailable" hidden>${icon('desktop_windows')}<strong>${tr('模型库需要桌面版')}</strong><span>${tr('网页版无法读写本地文件。开发时可用')} <code>npm run dev</code> ${tr('在浏览器中使用。')}</span></div>
    </div>
    <dialog class="library-sheet" id="library-sheet" aria-labelledby="library-sheet-title">
      <div class="library-sheet-inner">
        <header class="library-sheet-header"><h2 id="library-sheet-title">${tr('模型库设置')}</h2><button class="icon-button" type="button" data-sheet="close" title="${tr('关闭（Esc）')}" aria-label="${tr('关闭')}">${icon('close')}</button></header>
        <div class="library-sheet-body">
          <section class="library-sheet-section" aria-labelledby="library-sheet-import">
            <h3 class="library-sheet-subheader" id="library-sheet-import">${tr('导入')}</h3>
            <button class="library-sheet-item" type="button" data-sheet="import-files"><span class="library-sheet-icon">${icon('upload_file')}</span><span class="library-sheet-text"><strong>${tr('导入模型包')}</strong><span>${tr('选择 .zip / .ysm 文件，可多选')}</span></span></button>
            <button class="library-sheet-item" type="button" data-sheet="import-folder"><span class="library-sheet-icon">${icon('create_new_folder')}</span><span class="library-sheet-text"><strong>${tr('导入文件夹')}</strong><span>${tr('导入文件夹中的模型包和模型文件夹（向下 3 层）')}</span></span></button>
            <p class="library-sheet-note">${icon('drag_pan')}<span>${tr('也可以把模型包、模型文件夹或包含多个模型的文件夹直接拖到模型库页面。')}</span></p>
          </section>
          <section class="library-sheet-section" aria-labelledby="library-games-title">
            <header class="library-sheet-section-header"><h3 class="library-sheet-subheader" id="library-games-title">${tr('游戏目录')}</h3><button class="md-button text" id="library-game-add" type="button">${icon('add')} ${tr('添加')}</button></header>
            <p class="library-sheet-note">${icon('link')}<span>${tr('挂载')} = ${tr('在游戏的 custom 文件夹中创建链接，不复制文件；可添加多个游戏或版本。')}</span></p>
            <ul class="library-game-list" id="library-game-list"></ul>
          </section>
          <section class="library-sheet-section" aria-labelledby="library-sheet-explorer">
            <h3 class="library-sheet-subheader" id="library-sheet-explorer">${tr('资源管理器缩略图')}</h3>
            <button class="library-sheet-item" type="button" data-sheet="explorer-folder"><span class="library-sheet-icon">${icon('imagesmode')}</span><span class="library-sheet-text"><strong>${tr('为文件夹生成缩略图')}</strong><span>${tr('为文件夹中的 .ysm 模型生成封面，在 Windows 资源管理器中显示为缩略图（向下 3 层）')}</span></span></button>
            <p class="library-sheet-note">${icon('info')}<span>${tr('模型库中的 .ysm 模型及其挂载链接会自动显示封面。')}</span></p>
            <p class="library-sheet-note" id="library-explorer-missing" hidden>${icon('warning')}<span>${tr('未检测到缩略图组件，请使用安装版。生成的封面会保留，安装后即可显示。')}</span></p>
          </section>
          <section class="library-sheet-section" aria-labelledby="library-sheet-storage">
            <h3 class="library-sheet-subheader" id="library-sheet-storage">${tr('存储')}</h3>
            <button class="library-sheet-item" type="button" data-sheet="open-root"><span class="library-sheet-icon">${icon('folder_open')}</span><span class="library-sheet-text"><strong>${tr('打开模型库文件夹')}</strong><span id="library-root-path"></span></span></button>
          </section>
        </div>
      </div>
    </dialog>
    <div class="library-drop" id="library-drop" aria-hidden="true" hidden><div>${icon('upload')}<strong>${tr('松开以导入到模型库')}</strong><span>${tr('.zip / .ysm 模型包、模型文件夹，或包含多个模型的文件夹')}</span></div></div>
    <dialog class="md-dialog library-frame-dialog" id="library-frame-dialog" aria-labelledby="library-frame-title"><form method="dialog">
      <h2 class="md-dialog-title" id="library-frame-title">${tr('调整封面')}<span class="library-frame-name"></span></h2>
      <div class="library-frame-card"><img class="library-frame-layer" data-layer="background" alt="" hidden><canvas role="img" aria-label="${tr('封面实时预览')}" hidden></canvas><img class="library-frame-layer" data-layer="foreground" alt="" hidden><span class="spinner" aria-hidden="true"></span></div>
      <div class="library-frame-controls"><button class="icon-button" type="button" data-frame="play" title="${tr('播放')}" aria-label="${tr('播放')}">${icon('play_arrow')}</button><input class="md-range" id="library-frame-range" type="range" min="0" max="1" step="0.01" value="0" aria-label="${tr('封面所在时间')}"><output for="library-frame-range"></output></div>
      <div class="md-dialog-actions"><button class="md-button text" value="cancel">${tr('取消')}</button><button class="md-button filled" value="save" disabled>${tr('保存封面')}</button></div>
    </form></dialog>
    <dialog class="md-dialog" id="library-dialog"><form method="dialog"><h2 class="md-dialog-title"></h2><div class="md-dialog-body"></div><div class="md-dialog-actions"></div></form></dialog>
    <div class="md-menu library-menu" id="library-menu" role="menu" hidden></div>`;

  const $=selector=>container.querySelector(selector);
  const backend=await getLibraryBackend();
  if(!backend){
    $('#library-unavailable').hidden=false;
    for(const selector of ['.library-search','.library-layout','#library-settings','#library-toolbar','#library-pager'])$(selector).hidden=true;
    return {refresh(){}};
  }

  const view=readViewState();
  // busy: a mount or delete is running; importing: an import or cover batch.
  let library={gameDirs:[],models:[]},labels=new Map(),query='',busy=false,importing=false;
  // Selection keeps model ids across pages and filters; `anchor` is where a
  // Shift+click range starts.
  const selected=new Set();let anchor=null;
  const coverUrls=new Map();
  const grid=$('#library-grid'),menu=$('#library-menu'),sheet=$('#library-sheet');

  let saveTimer=0;
  function persist(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>writeConfig('libraryView',view),150);
  }

  // ---- Scroll position ----
  // The page scrolls the window, which the viewer shares, so the position is
  // recorded only while the library is visible and put back when it returns.
  // While refresh() waits for the backend the window still has the viewer's
  // position, so scroll events are ignored until the grid is rendered again.
  let restoring=true;
  addEventListener('scroll',()=>{if(container.hidden||restoring)return;view.scroll=Math.round(scrollY);persist();},{passive:true});
  function restoreScroll(){scrollTo(0,view.scroll);restoring=false;}
  // After turning a page: bring the first row under the sticky toolbar.
  function scrollToGrid(){
    const toolbar=$('#library-toolbar'),top=grid.getBoundingClientRect().top+scrollY-toolbar.offsetHeight-(parseFloat(getComputedStyle(toolbar).top)||0)-8;
    if(scrollY>top)scrollTo(0,top);
  }

  // ---- Dialog and menu ----
  function dialog({title,body,actions}){
    const element=$('#library-dialog');
    element.querySelector('.md-dialog-title').textContent=title;
    element.querySelector('.md-dialog-body').innerHTML=body;
    element.querySelector('.md-dialog-actions').innerHTML=actions.map(([value,label,kind='text'])=>`<button class="md-button ${kind}" value="${value}">${label}</button>`).join('');
    element.returnValue='';element.showModal();
    // Settle from submit/cancel: some embedded Chromium builds never fire
    // the dialog's close event.
    return new Promise(resolve=>{
      const form=element.querySelector('form');
      const settle=value=>{form.onsubmit=null;element.oncancel=null;resolve(value);};
      form.onsubmit=event=>settle(event.submitter?.value||'');
      element.oncancel=()=>settle('cancel');
    });
  }
  // A dialog listing game folders as checkboxes; resolves to the checked ids,
  // or null when cancelled.
  async function pickDirs({title,intro,dirs,checked,status=()=>'',confirm}){
    const rows=dirs.map(dir=>`<label class="library-dir-option"><span class="md-checkbox"><input type="checkbox" value="${dir.id}"${checked.has(dir.id)?' checked':''}>${icon('check')}</span><span class="library-dir-option-text"><strong>${escapeText(labels.get(dir.id))}</strong><span title="${escapeText(dir.customDir||dir.path)}">${escapeText(dir.customDir||dir.path)}</span></span>${status(dir)}</label>`).join('');
    const answer=await dialog({title,body:`${intro?`<p>${intro}</p>`:''}<div class="library-dir-options">${rows}</div>`,actions:[['cancel',tr('取消')],['ok',confirm,'filled']]});
    if(answer!=='ok')return null;
    return [...$('#library-dialog').querySelectorAll('.library-dir-options input:checked')].map(input=>input.value);
  }

  function closeMenu(){menu.hidden=true;menu.innerHTML='';menu.onclick=null;}
  // items: [value, icon, label, checked?]; checked items show a check mark (radio menus).
  function openMenu(anchorElement,items,onPick){
    menu.innerHTML=items.map(([value,symbol,label,checked])=>`<button class="md-menu-item" type="button" role="${checked===undefined?'menuitem':'menuitemradio'}"${checked===undefined?'':` aria-checked="${checked}"`} data-menu="${escapeText(value)}">${icon(checked===undefined?symbol:checked?'check':'')}<span>${label}</span></button>`).join('');
    menu.hidden=false;
    const bounds=anchorElement.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    menu.style.left=`${Math.max(8,Math.min(innerWidth-width-8,bounds.right-width))}px`;
    menu.style.top=`${bounds.bottom+height+8>innerHeight?Math.max(8,bounds.top-height-4):bounds.bottom+4}px`;
    menu.onclick=event=>{const value=event.target.closest('[data-menu]')?.dataset.menu;if(value===undefined)return;closeMenu();onPick(value);};
    menu.dataset.owner=anchorElement.id||'';
    (menu.querySelector('[aria-checked=true]')||menu.querySelector('button'))?.focus();
  }
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!event.target.closest('[aria-haspopup=menu]'))closeMenu();});
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();closeMenu();return;}
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
    items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  });
  const toggleMenu=(button,items,onPick)=>{if(!menu.hidden&&menu.dataset.owner===button.id){closeMenu();return;}openMenu(button,items,onPick);};

  // ---- Covers ----
  // Only the covers of the current page are kept as object URLs; the rest
  // are released, so large libraries do not hold every image in memory.
  function coverUrl(model){
    if(!model.hasThumbnail)return null;
    if(!coverUrls.has(model.id))coverUrls.set(model.id,backend.readThumbnail(model.id).then(blob=>URL.createObjectURL(blob)).catch(()=>null));
    return coverUrls.get(model.id);
  }
  function dropCover(id){const url=coverUrls.get(id);coverUrls.delete(id);url?.then(value=>value&&URL.revokeObjectURL(value));}
  function showCover(model){
    coverUrl(model)?.then(url=>{
      revealCover(grid.querySelector(`[data-id="${model.id}"] img`),url);
    });
  }

  // ---- Derived lists ----
  const isMounted=model=>view.dirScope==='all'?model.mounts.length>0:model.mounts.some(mount=>mount.dir===view.dirScope);
  function matching(){
    const text=query.trim().toLowerCase();
    return library.models.filter(model=>!text||model.name.toLowerCase().includes(text)||model.fileName.toLowerCase().includes(text));
  }
  function visibleModels(){
    return matching().filter(model=>view.filter==='all'||(view.filter==='mounted')===isMounted(model)).sort(sorters[view.sort]);
  }
  const pageCount=total=>Math.max(1,Math.ceil(total/view.pageSize));

  // ---- Rendering ----
  function renderGames(){
    const list=$('#library-game-list');
    $('#library-root-path').textContent=library.root||'';
    if(!library.gameDirs.length){
      list.innerHTML=`<li class="library-game is-empty">${icon('sports_esports')}<span>${tr('尚未添加游戏目录。添加后可以把模型挂载到游戏中，挂载时可同时选择多个目录。')}</span></li>`;
      return;
    }
    list.innerHTML=library.gameDirs.map(dir=>{
      const count=library.models.filter(model=>model.mounts.some(mount=>mount.dir===dir.id)).length;
      return `<li class="library-game${dir.customDir?'':' is-invalid'}" data-dir="${dir.id}">
        <span class="library-game-icon">${icon(dir.customDir?'sports_esports':'error')}</span>
        <div class="library-game-text"><strong>${escapeText(labels.get(dir.id))}</strong><span title="${escapeText(dir.customDir||dir.path)}">${dir.customDir?escapeText(dir.customDir):tr('目录无效：{0}', escapeText(dir.path))}</span><span class="library-game-count">${tr('{0} 个已挂载', count)}</span></div>
        <button class="icon-button" type="button" data-game="filter" title="${tr('只看挂载在这里的模型')}" aria-label="${tr('只看挂载在 {0} 的模型', escapeText(labels.get(dir.id)))}">${icon('filter_list')}</button>
        <button class="icon-button" type="button" data-game="reveal" title="${tr('打开 custom 文件夹')}" aria-label="${tr('打开 {0} 的 custom 文件夹', escapeText(labels.get(dir.id)))}"${dir.customDir?'':' disabled'}>${icon('folder_open')}</button>
        <button class="icon-button" type="button" data-game="remove" title="${tr('移除这个游戏目录')}" aria-label="${tr('移除 {0}', escapeText(labels.get(dir.id)))}">${icon('close')}</button>
      </li>`;
    }).join('');
  }

  function renderChips(){
    const base=matching(),mounted=base.filter(isMounted).length;
    const counts={all:base.length,mounted,unmounted:base.length-mounted};
    container.querySelector('.library-chips').innerHTML=FILTERS.map(([value,label])=>`<button class="library-chip" type="button" role="radio" data-filter="${value}" aria-checked="${view.filter===value}">${icon('check')}${label}<span class="library-chip-count">${counts[value]}</span></button>`).join('');
    const scope=$('#library-dir-scope');
    scope.hidden=library.gameDirs.length<2;
    scope.setAttribute('aria-checked',String(view.dirScope!=='all'));
    scope.innerHTML=`${icon('sports_esports')}${view.dirScope==='all'?tr('全部游戏目录'):escapeText(labels.get(view.dirScope))}${icon('arrow_drop_down')}`;
    $('#library-sort').innerHTML=`${icon('sort')} ${SORTS.find(([value])=>value===view.sort)[1]}`;
  }

  function badgesHtml(model){
    const dirCount=library.gameDirs.length,mountNames=model.mounts.map(mount=>labels.get(mount.dir)).filter(Boolean);
    return [
      model.mounts.length?`<span class="library-badge is-mounted" title="${tr('已挂载到：{0}', escapeText(mountNames.join('、')))}">${icon('link')} ${dirCount>1?tr('已挂载 {0}/{1}', model.mounts.length, dirCount):tr('已挂载')}</span>`:'',
      model.conflicts.length?`<span class="library-badge is-conflict" title="${tr('{0} 中已有同名文件', escapeText(model.conflicts.map(id=>labels.get(id)).join('、')))}">${icon('warning')} ${tr('同名文件')}</span>`:'',
    ].join('');
  }
  // The cover with its selection check; grid tiles and list rows share it,
  // so every click and selection rule works the same in both views.
  function coverHtml(model,badges=''){
    const checked=selected.has(model.id);
    return `<div class="library-cover-wrap">
        ${coverButtonHtml(model,`data-action="open" aria-label="${tr('在查看器中打开 {0}', escapeText(model.name))}"`)}
        ${badges?`<span class="library-badges">${badges}</span>`:''}
        <button class="library-check" type="button" data-action="select" role="checkbox" aria-checked="${checked}" aria-label="${tr('选择 {0}', escapeText(model.name))}" title="${tr('选择（Shift 连选）')}">${icon('check')}</button>
      </div>`;
  }
  function itemActions(model){
    const dirCount=library.gameDirs.length;
    const mountTitle=dirCount>1?tr('选择挂载到哪些游戏目录'):model.mounts.length?tr('取消挂载（游戏不再加载）'):tr('挂载到游戏');
    return `<button class="icon-button library-mount${model.mounts.length?' is-on':''}" type="button" data-action="mount" aria-pressed="${model.mounts.length>0}" title="${mountTitle}" aria-label="${mountTitle}">${icon(model.mounts.length?(dirCount>1?'link':'link_off'):'add_link')}</button>
        <button class="icon-button" type="button" data-action="menu" aria-haspopup="menu" title="${tr('更多')}" aria-label="${tr('更多操作')}">${icon('more_vert')}</button>`;
  }
  const typeLabel=model=>model.isDir?tr('文件夹'):model.fileName.split('.').pop().toUpperCase();
  function tile(model){
    const checked=selected.has(model.id);
    return `<div class="library-tile${checked?' is-selected':''}" role="listitem" data-id="${model.id}">
      ${coverHtml(model,badgesHtml(model))}
      <div class="library-tile-footer">
        <div class="library-tile-text"><strong title="${escapeText(model.name)}">${escapeText(model.name)}</strong><span>${typeLabel(model)} · ${formatSize(model.size)}</span></div>
        ${itemActions(model)}
      </div>
    </div>`;
  }
  // Detail list row: cover on the left, the pack's details on the right.
  // Clicking the details behaves like clicking the cover.
  function row(model){
    const checked=selected.has(model.id),info=model.info;
    const fact=(label,value)=>value?`<div><dt>${label}</dt><dd>${value}</dd></div>`:'';
    const mounted=model.mounts.map(mount=>escapeText(labels.get(mount.dir))).filter(Boolean).join('、');
    let details;
    if(info){
      const authors=info.authors?.map(author=>`${escapeText(author.name)}${author.role?`<span class="library-row-role">${escapeText(author.role)}</span>`:''}`).join('、');
      const content=[info.textures&&tr('{0} 张材质', info.textures),info.animations&&tr('{0} 个动画文件', info.animations),info.sounds&&tr('{0} 个音效', info.sounds)].filter(Boolean).join(' · ');
      details=`${info.tips?`<p class="library-row-tips" title="${escapeText(info.tips)}">${escapeText(info.tips)}</p>`:''}
        <dl class="library-row-facts">${fact(tr('作者'),authors)}${fact(tr('协议'),escapeText(info.license))}${fact(tr('适配'),escapeText(info.mods?.join('、')))}${fact(tr('内容'),content)}${fact(tr('挂载'),mounted||(library.gameDirs.length?tr('未挂载'):''))}</dl>`;
    }else details=`<p class="library-row-pending">${infoFailed.has(model.id)?tr('{0} 无法读取详细信息', icon('error')):tr('{0} 正在读取详细信息…', icon('hourglass_empty'))}</p>`;
    return `<div class="library-row${checked?' is-selected':''}" role="listitem" data-id="${model.id}">
      ${coverHtml(model)}
      <div class="library-row-body" data-action="open">
        <div class="library-row-title"><strong title="${escapeText(model.name)}">${escapeText(model.name)}</strong>${badgesHtml(model)}</div>
        <span class="library-row-file" title="${escapeText(model.fileName)}">${tr('{0} · {1} · {2} · {3} 导入', escapeText(model.fileName), typeLabel(model), formatSize(model.size), formatDate(model.importedAt))}</span>
        ${details}
      </div>
      <div class="library-row-actions">${itemActions(model)}</div>
    </div>`;
  }
  const item=model=>view.layout==='list'?row(model):tile(model);

  function pagerButtons(current,total){
    const pages=new Set([1,total,current-1,current,current+1].filter(page=>page>=1&&page<=total));
    const sorted=[...pages].sort((a,b)=>a-b),items=[];
    sorted.forEach((page,index)=>{if(index&&page-sorted[index-1]>1)items.push('<span class="library-pager-gap">…</span>');items.push(`<button class="library-page${page===current?' is-current':''}" type="button" data-page="${page}"${page===current?' aria-current="page"':''} aria-label="${tr('第 {0} 页', page)}">${page}</button>`);});
    return items.join('');
  }
  function renderPager(total){
    const pages=pageCount(total),page=view.page,from=total?(page-1)*view.pageSize+1:0,to=Math.min(total,page*view.pageSize);
    const nav=(target,symbol,label,disabled)=>`<button class="icon-button" type="button" data-page="${target}" title="${label}" aria-label="${label}"${disabled?' disabled':''}>${icon(symbol)}</button>`;
    $('#library-pager').hidden=total===0;
    $('#library-pager').innerHTML=`
      <span class="library-pager-range">${tr('第 {0}–{1} 个，共 {2} 个', from, to, total)}</span>
      <button class="md-button text library-page-size" id="library-page-size" type="button" aria-haspopup="menu">${tr('每页 {0} 个', view.pageSize)}${icon('arrow_drop_down')}</button>
      <span class="library-toolbar-spacer"></span>
      ${nav(1,'first_page',tr('第一页'),page===1)}${nav(page-1,'chevron_left',tr('上一页'),page===1)}
      <span class="library-pages">${pagerButtons(page,pages)}</span>
      ${nav(page+1,'chevron_right',tr('下一页'),page===pages)}${nav(pages,'last_page',tr('最后一页'),page===pages)}`;
    $('#library-pager-mini').hidden=pages<2;
    $('#library-pager-mini').innerHTML=`${nav(page-1,'chevron_left',tr('上一页'),page===1)}<span>${page} / ${pages}</span>${nav(page+1,'chevron_right',tr('下一页'),page===pages)}`;
  }

  function renderSelection(){
    const count=selected.size,selecting=count>0,total=visibleModels().length;
    $('.library-toolbar-main').hidden=selecting;$('.library-toolbar-select').hidden=!selecting;
    $('#library-toolbar').classList.toggle('is-selecting',selecting);
    grid.classList.toggle('is-selecting',selecting);
    $('.library-select-count').textContent=tr('已选择 {0} 个', count);
    $('.library-select-all-label').textContent=tr('全选（{0}）', total);
    const models=library.models.filter(model=>selected.has(model.id));
    $('[data-select="unmount"]').disabled=busy||!models.some(model=>model.mounts.length);
    $('[data-select="mount"]').disabled=busy;$('[data-select="delete"]').disabled=busy;
    for(const element of grid.querySelectorAll('[data-id]')){
      const on=selected.has(element.dataset.id);
      element.classList.toggle('is-selected',on);element.querySelector('.library-check').setAttribute('aria-checked',String(on));
    }
  }

  function render(){
    labels=dirLabels(library.gameDirs);
    if(view.dirScope!=='all'&&!library.gameDirs.some(dir=>dir.id===view.dirScope))view.dirScope='all';
    const models=visibleModels(),pages=pageCount(models.length);
    view.page=Math.min(Math.max(1,view.page),pages);
    const pageModels=models.slice((view.page-1)*view.pageSize,view.page*view.pageSize);
    const mounted=library.models.filter(model=>model.mounts.length).length;
    $('#library-count').textContent=library.models.length?tr('{0} 个模型 · {1} 个已挂载', library.models.length, mounted):'';
    $('#library-empty').hidden=library.models.length>0;
    $('#library-toolbar').hidden=library.models.length===0&&$('#library-progress').hidden;
    for(const input of container.querySelectorAll('[name=library-layout]'))input.checked=input.value===view.layout;
    grid.classList.toggle('is-list',view.layout==='list');
    grid.innerHTML=pageModels.map(item).join('')||(library.models.length?`<p class="library-no-match">${tr('没有符合条件的模型')}</p>`:'');
    const onPage=new Set(pageModels.map(model=>model.id));
    for(const id of [...coverUrls.keys()])if(!onPage.has(id))dropCover(id);
    pageModels.forEach(showCover);
    fillInfo(pageModels);
    renderGames();renderChips();renderPager(models.length);renderSelection();
    persist();
  }
  // Re-renders one tile in place (cover generation, mount changes).
  function patchTile(model){
    const element=grid.querySelector(`[data-id="${model.id}"]`);if(!element)return;
    element.outerHTML=item(model);showCover(model);
  }

  async function refresh(){
    restoring=true;
    library=await backend.state();
    const ids=new Set(library.models.map(model=>model.id));
    for(const id of [...selected])if(!ids.has(id))selected.delete(id);
    render();restoreScroll();
  }
  function goToPage(page){
    const pages=pageCount(visibleModels().length),next=Math.min(Math.max(1,page),pages);
    if(next===view.page)return;
    view.page=next;render();scrollToGrid();
  }

  // `covers` shows the hourglass beside the bar (cover generation only).
  function setProgress(done,total,text,covers=false){
    const element=$('#library-progress');element.hidden=total===0;
    element.querySelector('.library-progress-hourglass').hidden=!covers;
    $('#library-toolbar').hidden=library.models.length===0&&total===0;
    element.querySelector('.library-progress-text').textContent=text;
    element.querySelector('progress').max=total||1;element.querySelector('progress').value=done;
  }

  // Renders and stores covers one model at a time; each tile updates as its
  // cover is ready.
  async function generateCovers(models){
    let done=0;const failed=[];
    for(const model of models){
      setProgress(done,models.length,tr('正在生成封面 {0} / {1}：{2}', done+1, models.length, model.name),true);
      try{
        // A frame picked in the cover editor is kept.
        const {blob,name,info}=await renderCover(await readLibraryModel(backend,model),model.info?.coverTime??null);
        await backend.saveThumbnail(model.id,blob);
        if(name&&name!==model.name)await backend.rename(model.id,name);
        await backend.setInfo(model.id,info);
        dropCover(model.id);
        const record=library.models.find(item=>item.id===model.id);
        if(record){record.hasThumbnail=true;record.info=info;if(name)record.name=name;patchTile(record);}
      }catch(error){console.error('Could not render cover:',model.fileName,error);failed.push(model.name);}
      done++;
    }
    setProgress(0,0,'');
    await releaseCoverRenderer();
    if(failed.length)toast(tr('{0} 个模型无法生成封面：{1}{2}', failed.length, failed.slice(0,3).join('、'), failed.length>3?tr(' 等'):''));
  }

  // ---- Explorer thumbnails (docs section 70) ----
  // Covers of .ysm files in a folder the user picks, for the thumbnail
  // provider DLL. Files that already have one (same content in the library
  // or an earlier run) are skipped; covers use the automatic frame.
  async function generateExplorerFolder(){
    if(importing){toast(tr('正在导入或生成封面，请稍候'));return;}
    let dir=await backend.explorer.pickFolder();
    if(dir===undefined){
      // The dev server has no native folder picker: ask for the path.
      const answer=await dialog({title:tr('为文件夹生成缩略图'),body:`<p>${tr('输入包含 .ysm 模型的文件夹路径。')}</p><label class="md-text-field"><span>${tr('路径')}</span><input id="library-explorer-input" spellcheck="false" autocomplete="off"></label>`,actions:[['cancel',tr('取消')],['ok',tr('生成'),'filled']]});
      dir=answer==='ok'?$('#library-explorer-input').value.trim():null;
    }
    if(!dir)return;
    importing=true;
    let made=0;const failed=[];
    try{
      setProgress(0,1,tr('正在扫描 {0}', dir));
      const files=await backend.explorer.scan(dir),todo=files.filter(file=>!file.hasCover);
      if(!files.length){toast(tr('这个文件夹（含 3 层子文件夹）中没有 .ysm 模型'));return;}
      if(!todo.length){toast(tr('这 {0} 个模型都已有缩略图', files.length));return;}
      for(const [index,file] of todo.entries()){
        setProgress(index,todo.length,tr('正在生成缩略图 {0} / {1}：{2}', index+1, todo.length, file.name));
        try{
          const {blob}=await renderCover(await readPackBytes(await backend.explorer.read(file.path)));
          await backend.explorer.save(file.path,blob);made++;
        }catch(error){console.error('Could not render explorer thumbnail:',file.path,error);failed.push(file.name.replace(/\.ysm$/i,''));}
      }
      const kept=files.length-todo.length;
      toast(tr('已为 {0} 个模型生成缩略图', made)+(kept?tr('，{0} 个已有', kept):'')+(failed.length?tr('；{0} 个失败：{1}{2}', failed.length, failed.slice(0,3).join('、'), failed.length>3?tr(' 等'):''):''));
    }catch(error){toast(tr('无法生成缩略图：{0}', error.message));}
    finally{
      setProgress(0,0,'');
      await releaseCoverRenderer();
      importing=false;
    }
  }

  // ---- Cover frame ----
  // Some preview animations start empty (the character walks or rises into
  // view), so the cover frame can be picked by hand on the live card, the
  // same preview the viewer's sidebar shows: paused on the first frame, the
  // slider scrubs the whole clip (any length) and play runs it. The time is
  // saved as info.coverTime and reused when the cover is generated again.
  async function editCoverFrame(model){
    if(importing){toast(tr('正在导入或生成封面，请稍候'));return;}
    importing=true;
    const element=$('#library-frame-dialog'),form=element.querySelector('form'),range=$('#library-frame-range');
    const card=element.querySelector('.library-frame-card'),canvas=card.querySelector('canvas'),spinner=card.querySelector('.spinner');
    const layers={background:card.querySelector('[data-layer=background]'),foreground:card.querySelector('[data-layer=foreground]')};
    const output=element.querySelector('.library-frame-controls output'),play=element.querySelector('[data-frame=play]'),save=element.querySelector('[value=save]');
    const format=value=>value.toFixed(2);
    let session=null,playing=false;
    element.querySelector('.library-frame-name').textContent=model.name;
    for(const layer of Object.values(layers)){layer.hidden=true;layer.removeAttribute('src');}
    canvas.hidden=true;spinner.hidden=false;save.disabled=true;range.disabled=true;play.disabled=true;
    range.value='0';range.style.setProperty('--fill','0%');output.textContent='';
    element.showModal();
    const syncTime=time=>{
      range.value=String(time);range.style.setProperty('--fill',`${time/session.duration*100}%`);
      output.textContent=tr('{0} / {1} 秒', format(time), format(session.duration));
    };
    const setPlaying=value=>{
      playing=value;session.setPlaying(value);
      play.innerHTML=icon(value?'pause':'play_arrow');
      const label=value?tr('暂停'):tr('播放');play.title=label;play.setAttribute('aria-label',label);
    };
    const finish=new Promise(resolve=>{
      form.onsubmit=event=>resolve(event.submitter?.value||'');
      element.oncancel=()=>resolve('cancel');
    });
    let answer='cancel';
    try{
      session=await openCoverSession(await readLibraryModel(backend,model),canvas,{warmUp:cardWarmUp(),onTime:time=>{if(playing)syncTime(time);}});
      for(const [name,layer] of Object.entries(layers)){const url=session[name];if(url){layer.src=url;layer.hidden=false;}}
      canvas.hidden=false;spinner.hidden=true;save.disabled=false;play.disabled=false;
      range.max=String(session.duration);range.disabled=false;
      // Dragging pauses the card on the frame, like the viewer's slider.
      range.oninput=()=>{if(playing)setPlaying(false);const time=Number(range.value);session.seek(time);syncTime(time);};
      play.onclick=()=>setPlaying(!playing);
      setPlaying(false);
      const start=Math.min(session.duration,model.info?.coverTime??0);
      if(start>0)session.seek(start);
      syncTime(start);
      answer=await finish;
    }catch(error){console.error(error);toast(tr('无法读取模型：{0}', error.message));}
    form.onsubmit=null;element.oncancel=null;
    try{
      if(answer==='save'&&session){
        save.disabled=true;
        if(playing)setPlaying(false);
        const time=session.time,blob=await session.render();
        const info={...session.info,coverTime:time};
        await backend.saveThumbnail(model.id,blob);
        await backend.setInfo(model.id,info);
        dropCover(model.id);
        const record=library.models.find(item=>item.id===model.id);
        if(record){record.hasThumbnail=true;record.info=info;patchTile(record);}
        toast(tr('封面已更新'));
      }
    }catch(error){console.error(error);toast(tr('保存封面失败：{0}', error.message));}
    finally{
      if(element.open)element.close();
      await session?.close();
      importing=false;
    }
  }

  // Details of models imported before they were stored (or whose cover
  // failed) are read in the background, one at a time, for the rows shown.
  const infoPending=new Set(),infoFailed=new Set();let infoQueue=Promise.resolve();
  function fillInfo(models){
    if(view.layout!=='list')return;
    for(const model of models){
      if(model.info||infoPending.has(model.id)||infoFailed.has(model.id))continue;
      infoPending.add(model.id);
      infoQueue=infoQueue.then(async()=>{
        const record=library.models.find(entry=>entry.id===model.id);
        // Skipped when the row left the page meanwhile; read again when it returns.
        if(!record||record.info||!grid.querySelector(`.library-row[data-id="${model.id}"]`)){infoPending.delete(model.id);return;}
        try{record.info=await readModelInfo(await readLibraryModel(backend,record));await backend.setInfo(record.id,record.info);}
        catch(error){console.error('Could not read model details:',record.fileName,error);infoFailed.add(record.id);}
        infoPending.delete(model.id);patchTile(record);
      });
    }
  }

  // pick: resolves to the backend's import result, or null when cancelled.
  async function runImport(pick){
    if(importing){toast(tr('正在导入，请稍候'));return;}
    importing=true;
    try{
      const result=await pick();
      if(!result)return;
      library=await backend.state();
      // Newly imported models are easiest to find on the first page of "最近导入".
      if(result.added.length&&view.sort==='recent'){view.page=1;view.scroll=0;}
      render();
      const skipped=result.skipped.length?tr('，跳过 {0} 个（{1}）', result.skipped.length, [...new Set(result.skipped.map(item=>item.reason))].join('、')):'';
      toast(result.added.length?tr('已导入 {0} 个模型{1}', result.added.length, skipped):tr('没有导入新模型{0}', skipped||tr('：没有找到 .zip / .ysm 模型包或模型文件夹')));
      if(result.added.length)await generateCovers(result.added);
    }catch(error){console.error(error);toast(tr('导入失败：{0}', error.message));}
    finally{setProgress(0,0,'');importing=false;}
  }

  // ---- Drag and drop ----
  // Mirrors collect_packs on the backend: packs and model folders up to three
  // levels below each dropped item, so only model files are copied.
  const entryFile=entry=>new Promise((resolve,reject)=>entry.file(resolve,reject));
  async function entryChildren(entry){
    const reader=entry.createReader(),children=[];
    for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)return children;children.push(...batch);}
  }
  async function isModelFolder(children){
    const named=name=>children.find(child=>child.name.toLowerCase()===name);
    if(named('ysm.json')?.isFile||named('main.json')?.isFile)return true;
    const models=named('models');
    return Boolean(models?.isDirectory&&(await entryChildren(models)).some(child=>child.isFile&&child.name.toLowerCase()==='main.json'));
  }
  async function allFiles(entry,path,out){
    if(entry.isFile){out.push([path,await entryFile(entry)]);return;}
    for(const child of await entryChildren(entry))await allFiles(child,`${path}/${child.name}`,out);
  }
  async function collectDropped(entry,depth,path,out){
    if(entry.isFile){if(PACK.test(entry.name))out.push([path,await entryFile(entry)]);return;}
    if(!entry.isDirectory)return;
    const children=await entryChildren(entry);
    if(await isModelFolder(children)){for(const child of children)await allFiles(child,`${path}/${child.name}`,out);return;}
    if(depth>0)for(const child of children)await collectDropped(child,depth-1,`${path}/${child.name}`,out);
  }
  // entries: FileSystemEntry list taken synchronously in the drop event
  // (items stop working after it); files: the plain file list fallback.
  function importDropped(entries,files){
    return runImport(async()=>{
      setProgress(0,1,tr('正在读取拖入的文件…'));
      const picked=[];
      if(entries.length)for(const entry of entries)await collectDropped(entry,3,entry.name,picked);
      else for(const file of files)if(PACK.test(file.name))picked.push([file.name,file]);
      if(!picked.length){toast(tr('没有找到 .zip / .ysm 模型包或模型文件夹'));return null;}
      return backend.importDropped(picked,(done,total)=>setProgress(done,total,tr('正在复制到模型库 {0}%', Math.round(done/Math.max(1,total)*100))));
    });
  }
  // Window-level, like the viewer's drop target; only while the library is
  // shown (the viewer ignores drags then).
  let dragDepth=0;
  const dropTarget=$('#library-drop');
  const draggingFiles=event=>!container.hidden&&[...(event.dataTransfer?.types||[])].includes('Files');
  addEventListener('dragenter',event=>{if(!draggingFiles(event))return;event.preventDefault();dragDepth++;dropTarget.hidden=false;});
  addEventListener('dragover',event=>{if(!draggingFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect=importing?'none':'copy';});
  addEventListener('dragleave',event=>{if(!draggingFiles(event))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropTarget.hidden=true;});
  addEventListener('drop',event=>{
    if(!draggingFiles(event))return;event.preventDefault();dragDepth=0;dropTarget.hidden=true;
    const entries=[...(event.dataTransfer.items||[])].map(entry=>entry.webkitGetAsEntry?.()).filter(Boolean);
    if(sheet.open)closeSheet();
    importDropped(entries,[...(event.dataTransfer.files||[])]);
  });

  // ---- Settings sheet ----
  function openSheet(){renderGames();sheet.showModal();sheet.querySelector('[data-sheet=close]').focus();}
  function closeSheet(){sheet.close();$('#library-settings').focus();}

  // ---- Game folders ----
  async function addGameDirs(){
    let paths=await backend.pickGameDirs();
    if(paths===null){
      // The dev server has no native folder picker: ask for the path.
      const answer=await dialog({title:tr('添加游戏目录'),body:`<p>${tr('输入游戏目录（包含 mods、config 的文件夹，开启版本隔离时为 versions/&lt;版本名&gt;），也可以直接输入 config/yes_steve_model/custom 文件夹。')}</p><label class="md-text-field"><span>${tr('路径')}</span><input id="library-game-input" spellcheck="false" autocomplete="off"></label>`,actions:[['cancel',tr('取消')],['ok',tr('添加'),'filled']]});
      paths=answer==='ok'?[$('#library-game-input').value.trim()].filter(Boolean):[];
    }
    let added=0;
    for(const path of paths){
      try{library=await backend.addGameDir(path);added++;}
      catch(error){toast(`${path}：${error.message}`);}
    }
    if(added){render();toast(added>1?tr('已添加 {0} 个游戏目录', added):tr('已添加游戏目录'));}
    return added;
  }
  async function removeGameDir(dir){
    const count=library.models.filter(model=>model.mounts.some(mount=>mount.dir===dir.id)).length,label=labels.get(dir.id);
    const answer=await dialog({title:tr('移除游戏目录“{0}”？', label),body:`<p>${count?tr('将同时取消挂载在这里的 {0} 个模型（只删除模型库创建的链接）。', count):''}${tr('游戏文件和模型库中的模型不受影响。')}</p>`,actions:[['cancel',tr('取消')],['remove',tr('移除'),'filled']]});
    if(answer!=='remove')return;
    try{library=await backend.removeGameDir(dir.id);render();toast(tr('已移除游戏目录 {0}', label));}
    catch(error){toast(error.message);}
  }

  // ---- Mounting ----
  function mergeModels(models){
    for(const updated of models){const index=library.models.findIndex(item=>item.id===updated.id);if(index>=0)library.models[index]=updated;}
  }
  // One toast for a batch: the successes, then the first failure.
  function reportErrors(errors,done){
    if(!errors.length){toast(done);return;}
    const name=id=>library.models.find(model=>model.id===id)?.name??id;
    const first=errors[0];
    toast(tr('{0}{1} 项失败：{2}{3}：{4}', done?`${done}；`:'', errors.length, name(first.id), first.dir?` → ${labels.get(first.dir)??''}`:'', first.message));
  }
  async function applyMount(ids,dirs,mounted){
    if(!ids.length||(!dirs.length&&mounted))return;
    busy=true;renderSelection();
    try{
      const {models,errors}=await backend.setMounted(ids,dirs,mounted);
      mergeModels(models);render();
      // A model counts as done when at least one of its folders went through.
      const attempts=dirs.length||1,ok=new Set(ids.filter(id=>errors.filter(error=>error.id===id).length<attempts));
      const where=dirs.length&&library.gameDirs.length>1?`（${dirs.map(id=>labels.get(id)).join('、')}）`:'';
      const kinds=new Set(models.filter(model=>ok.has(model.id)).flatMap(model=>model.mounts.map(mount=>mount.kind)));
      const note=mounted&&kinds.has('hardlink')?tr('，部分为硬链接'):mounted&&kinds.has('junction')?tr('，部分为目录联接'):'';
      const single=ids.length===1?library.models.find(model=>model.id===ids[0])?.name:null;
      const subject=single??tr('{0} 个模型', ok.size);
      reportErrors(errors,ok.size?(mounted?tr('已挂载 {0}{1}{2}，重新加载游戏模型后生效', subject, where, note):tr('已取消挂载 {0}{1}', subject, where)):'');
    }catch(error){toast(error.message);}
    finally{busy=false;renderSelection();}
  }
  async function ensureGameDir(){return library.gameDirs.length>0||await addGameDirs()>0;}
  const validDirs=()=>library.gameDirs.filter(dir=>dir.customDir);

  async function mountOne(model){
    if(!model.mounts.length&&!await ensureGameDir())return;
    const dirs=validDirs();
    if(!model.mounts.length&&!dirs.length){toast(tr('游戏目录无效，请移除后重新添加'));return;}
    if(library.gameDirs.length<2){
      await applyMount([model.id],model.mounts.length?[]:dirs.map(dir=>dir.id),!model.mounts.length);
      return;
    }
    const current=new Set(model.mounts.map(mount=>mount.dir));
    const picked=await pickDirs({
      title:tr('挂载“{0}”', model.name),intro:tr('勾选要挂载到的游戏目录，取消勾选会移除那里的链接。'),dirs,checked:current,confirm:tr('确定'),
      status:dir=>current.has(dir.id)?`<span class="library-dir-status is-on">${tr('已挂载')}</span>`:model.conflicts.includes(dir.id)?`<span class="library-dir-status is-conflict">${tr('同名文件')}</span>`:'',
    });
    if(!picked)return;
    const add=picked.filter(id=>!current.has(id)),remove=[...current].filter(id=>!picked.includes(id));
    if(add.length)await applyMount([model.id],add,true);
    if(remove.length)await applyMount([model.id],remove,false);
  }

  async function mountSelected(){
    if(!await ensureGameDir())return;
    const ids=[...selected],dirs=validDirs();
    if(!dirs.length){toast(tr('游戏目录无效，请移除后重新添加'));return;}
    if(library.gameDirs.length<2){await applyMount(ids,dirs.map(dir=>dir.id),true);return;}
    const remembered=new Set((view.mountDirs||dirs.map(dir=>dir.id)).filter(id=>dirs.some(dir=>dir.id===id)));
    const picked=await pickDirs({title:tr('挂载 {0} 个模型', ids.length),intro:tr('挂载到以下勾选的游戏目录：'),dirs,checked:remembered.size?remembered:new Set(dirs.map(dir=>dir.id)),confirm:tr('挂载'),
      status:dir=>{const count=library.models.filter(model=>selected.has(model.id)&&model.mounts.some(mount=>mount.dir===dir.id)).length;return count?`<span class="library-dir-status is-on">${tr('{0} 个已挂载', count)}</span>`:'';}});
    if(!picked?.length)return;
    view.mountDirs=picked;persist();
    await applyMount(ids,picked,true);
  }

  async function unmountSelected(){
    const models=library.models.filter(model=>selected.has(model.id)&&model.mounts.length);
    const dirs=library.gameDirs.filter(dir=>models.some(model=>model.mounts.some(mount=>mount.dir===dir.id)));
    if(dirs.length<2){await applyMount(models.map(model=>model.id),[],false);return;}
    const picked=await pickDirs({title:tr('取消挂载 {0} 个模型', models.length),intro:tr('从以下勾选的游戏目录中移除链接：'),dirs,checked:new Set(dirs.map(dir=>dir.id)),confirm:tr('取消挂载'),
      status:dir=>`<span class="library-dir-status">${tr('{0} 个', models.filter(model=>model.mounts.some(mount=>mount.dir===dir.id)).length)}</span>`});
    if(!picked?.length)return;
    await applyMount(models.map(model=>model.id),picked,false);
  }

  // ---- Deleting ----
  async function removeModels(models){
    if(!models.length||busy)return;
    const mounted=models.filter(model=>model.mounts.length).length;
    const names=models.slice(0,5).map(model=>`<li>${escapeText(model.name)}</li>`).join('')+(models.length>5?`<li>${tr('…等 {0} 个', models.length)}</li>`:'');
    const title=models.length===1?tr('删除“{0}”？', models[0].name):tr('删除 {0} 个模型？', models.length);
    const answer=await dialog({title,body:`<p>${models.length===1?tr('将从模型库中删除这个模型及其封面'):tr('将从模型库中删除这些模型及其封面')}${mounted?tr('，并移除游戏目录中的链接（{0} 个已挂载）', mounted):''}${tr('。原始文件不受影响。')}</p>${models.length>1?`<ul class="library-dialog-list">${names}</ul>`:''}`,actions:[['cancel',tr('取消')],['delete',tr('删除'),'filled']]});
    if(answer!=='delete')return;
    busy=true;renderSelection();
    try{
      const {deleted,errors}=await backend.remove(models.map(model=>model.id));
      const names=new Map(library.models.map(model=>[model.id,model.name]));
      for(const id of deleted){dropCover(id);selected.delete(id);}
      reportErrors(errors,deleted.length?(deleted.length===1?tr('已删除 {0}', names.get(deleted[0])):tr('已删除 {0} 个模型', deleted.length)):'');
      library.models=library.models.filter(model=>!deleted.includes(model.id));
      render();
    }catch(error){toast(tr('删除失败：{0}', error.message));}
    finally{busy=false;renderSelection();}
  }

  async function openInViewer(model){
    if(busy)return;
    try{await openModel(await readLibraryModel(backend,model),model.fileName.replace(/\.(?:zip|ysm)$/i,''),model);}
    catch(error){console.error(error);toast(tr('打开失败：{0}', error.message));}
  }

  // ---- Selection ----
  function toggleSelect(model,range){
    const list=visibleModels();
    if(range&&anchor&&anchor!==model.id){
      const from=list.findIndex(item=>item.id===anchor),to=list.findIndex(item=>item.id===model.id);
      if(from>=0&&to>=0){const on=!selected.has(model.id)||selected.has(anchor);for(const item of list.slice(Math.min(from,to),Math.max(from,to)+1))on?selected.add(item.id):selected.delete(item.id);}
    }else if(selected.has(model.id))selected.delete(model.id);
    else selected.add(model.id);
    anchor=model.id;renderSelection();
  }
  function clearSelection(){selected.clear();anchor=null;renderSelection();}

  // ---- Events ----
  grid.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]'),id=event.target.closest('[data-id]')?.dataset.id;
    const model=library.models.find(item=>item.id===id);if(!button||!model)return;
    const action=button.dataset.action;
    // Selecting text in a list row is not a click on it.
    if(button.classList.contains('library-row-body')&&getSelection()?.toString())return;
    // While selecting (or with Ctrl/Shift), a click on a cover toggles it.
    if(action==='select'||(action==='open'&&(selected.size||event.ctrlKey||event.metaKey||event.shiftKey))){event.preventDefault();toggleSelect(model,event.shiftKey);}
    else if(action==='open')openInViewer(model);
    else if(action==='mount')mountOne(model);
    else if(action==='menu'){
      if(!menu.hidden&&menu.dataset.owner===`menu-${model.id}`){closeMenu();return;}
      button.id=`menu-${model.id}`;
      openMenu(button,[['open','view_in_ar',tr('在查看器中打开')],['select',selected.has(model.id)?'check_box':'check_box_outline_blank',selected.has(model.id)?tr('取消选择'):tr('选择')],['mount',model.mounts.length&&library.gameDirs.length<2?'link_off':'add_link',library.gameDirs.length>1?tr('挂载到…'):model.mounts.length?tr('取消挂载'):tr('挂载到游戏')],['frame','crop_portrait',tr('调整封面…')],['cover','refresh',tr('重新生成封面')],['delete','delete',tr('从模型库删除')]],action=>{
        if(action==='open')openInViewer(model);
        else if(action==='select')toggleSelect(model,false);
        else if(action==='mount')mountOne(model);
        else if(action==='cover'){if(!importing){importing=true;generateCovers([model]).finally(()=>{importing=false;});}}
        else if(action==='frame')editCoverFrame(model);
        else if(action==='delete')removeModels([model]);
      });
    }
  });
  // Shift+click would otherwise select the page's text.
  grid.addEventListener('mousedown',event=>{if(event.shiftKey&&event.target.closest('[data-action]'))event.preventDefault();});

  $('#library-toolbar').addEventListener('click',event=>{
    const action=event.target.closest('[data-select]')?.dataset.select;
    if(action==='clear')clearSelection();
    else if(action==='page'){const list=visibleModels();for(const model of list.slice((view.page-1)*view.pageSize,view.page*view.pageSize))selected.add(model.id);renderSelection();}
    else if(action==='all'){for(const model of visibleModels())selected.add(model.id);renderSelection();}
    else if(action==='mount')mountSelected();
    else if(action==='unmount')unmountSelected();
    else if(action==='delete')removeModels(library.models.filter(model=>selected.has(model.id)));
  });
  container.querySelector('.library-chips').addEventListener('click',event=>{
    const chip=event.target.closest('[data-filter]');if(!chip||chip.dataset.filter===view.filter)return;
    view.filter=chip.dataset.filter;view.page=1;render();
  });
  $('#library-dir-scope').onclick=event=>toggleMenu(event.currentTarget,[['all','',tr('全部游戏目录'),view.dirScope==='all'],...library.gameDirs.map(dir=>[dir.id,'',escapeText(labels.get(dir.id)),view.dirScope===dir.id])],value=>{view.dirScope=value;view.page=1;render();});
  $('#library-sort').onclick=event=>toggleMenu(event.currentTarget,SORTS.map(([value,label])=>[value,'',label,view.sort===value]),value=>{view.sort=value;view.page=1;render();});
  const onPagerClick=event=>{
    const target=event.target.closest('[data-page]');if(target&&!target.disabled){goToPage(Number(target.dataset.page));return;}
    const size=event.target.closest('#library-page-size');
    if(size)toggleMenu(size,PAGE_SIZES.map(value=>[String(value),'',tr('每页 {0} 个', value),view.pageSize===value]),value=>{
      // Keep the first model of the current page in view.
      const first=(view.page-1)*view.pageSize;view.pageSize=Number(value);view.page=Math.floor(first/view.pageSize)+1;render();scrollToGrid();
    });
  };
  $('#library-pager').addEventListener('click',onPagerClick);
  $('#library-pager-mini').addEventListener('click',onPagerClick);

  $('#library-game-list').addEventListener('click',event=>{
    const action=event.target.closest('[data-game]')?.dataset.game,dir=library.gameDirs.find(item=>item.id===event.target.closest('[data-dir]')?.dataset.dir);
    if(!action||!dir)return;
    if(action==='remove')removeGameDir(dir);
    else if(action==='reveal')backend.reveal(dir.customDir).catch(error=>toast(error.message));
    else if(action==='filter'){closeSheet();view.dirScope=dir.id;view.filter='mounted';view.page=1;render();scrollToGrid();}
  });
  $('#library-game-add').onclick=addGameDirs;
  $('#library-settings').onclick=openSheet;
  // Buttons in the sheet and on the empty page.
  container.addEventListener('click',event=>{
    const action=event.target.closest('[data-sheet]')?.dataset.sheet;if(!action)return;
    if(action==='close'){closeSheet();return;}
    if(action==='open-root'){backend.reveal(library.root).catch(error=>toast(error.message));return;}
    // Close first so the import progress in the toolbar is visible.
    if(sheet.open)closeSheet();
    if(action==='explorer-folder'){generateExplorerFolder();return;}
    runImport(()=>backend.importFromPicker(action==='import-folder'));
  });
  // A click on the backdrop (the dialog box itself, outside its content) closes it.
  sheet.addEventListener('click',event=>{if(event.target===sheet)closeSheet();});
  container.querySelector('.library-layout').addEventListener('change',event=>{view.layout=event.target.value;render();});
  $('#library-search').addEventListener('input',event=>{query=event.target.value;view.page=1;render();});
  $('#library-search').addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.value){event.stopPropagation();event.target.value='';query='';render();}});

  // Keyboard: Ctrl+F search, Ctrl+A select all, Delete deletes the selection,
  // Esc clears it, Alt+←/→ turns pages. Only while the library is shown and
  // no dialog is open.
  document.addEventListener('keydown',event=>{
    if(container.hidden||$('#library-dialog').open||$('#library-frame-dialog').open||sheet.open)return;
    const typing=event.target.closest?.('input,textarea,select,[contenteditable]');
    const ctrl=event.ctrlKey||event.metaKey;
    if(ctrl&&event.key.toLowerCase()==='f'){event.preventDefault();$('#library-search').focus();$('#library-search').select();return;}
    if(typing)return;
    if(ctrl&&event.key.toLowerCase()==='a'){event.preventDefault();for(const model of visibleModels())selected.add(model.id);renderSelection();}
    else if(event.key==='Escape'&&selected.size&&menu.hidden){event.preventDefault();clearSelection();}
    else if(event.key==='Delete'&&selected.size&&!busy){event.preventDefault();removeModels(library.models.filter(model=>selected.has(model.id)));}
    else if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();goToPage(view.page+(event.key==='ArrowRight'?1:-1));}
  });

  await refresh();
  // Covers missing from an earlier session (closed mid-batch) are rendered now.
  const missing=library.models.filter(model=>!model.hasThumbnail);
  if(missing.length){importing=true;generateCovers(missing).finally(()=>{importing=false;});}
  // Explorer thumbnails: warn when the provider is not installed, and hand
  // covers made before it existed to its cache (quietly, in the background).
  backend.explorer.status().then(status=>{$('#library-explorer-missing').hidden=status.registered;}).catch(()=>{});
  backend.explorer.sync().catch(error=>console.warn('Explorer thumbnail sync:',error));
  return {refresh};
}
