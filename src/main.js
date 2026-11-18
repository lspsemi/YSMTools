import './style.css';
// Must stay the first module import: it patches document listeners/lookups for 独立窗口 (第 62 节).
import { popOut, isPoppedOut } from './popout.js';
import { setupDesktop } from './desktop.js';
import { fullscreenState, isAnyFullscreen, onFullscreenChange, setAppFullscreen, setViewerFullscreen } from './fullscreen.js';
import { setupOpenFiles } from './open-file.js';
import { launchOptions } from './launch-options.js';
import { setupScrollbars } from './scrollbars.js';
import { savePng, saveFile, saveFilesToFolder } from './save-file.js';
import { modelArchiveKind, readModelArchive, prepareModelPackage } from './model-package.js';
import { createImportProgress, nextPaint } from './import-progress.js';
import { renderWheelOverview, imagesToPdf, speakerIcon } from './wheel-export.js';
import { updateDynamicColor } from './dynamic-color.js';
import { logoSvg, setupLogoFavicon } from './app-logo.js';
import { setupAboutEasterEgg } from './about-easter-egg.js';
import gplLogoUrl from '../assets/gplv3-logo.svg?url';
import { CARD_EXPORT_FORMATS, createCardEncoder, mp4Bitrate } from './card-export.js';
import { HANDS, collectActionTriggers, collectHoldTriggers, handItemMenu, itemActionClips } from './hand-items.js';
import { DEFAULT_LIGHTING, LIGHTING_LIMITS, normalizeLighting } from './lighting.js';
import { PLAY_VIEWS, PlayControl } from './play-control.js';
import { ARMOR_SLOTS, BIOMES, BIOME_GROUPS, DEFAULT_STATUS, EFFECTS, STATUS_LIMITS, WEATHERS, isDefaultStatus, normalizeStatus, statusUsedBy } from './player-status.js';
import { tr } from './i18n.js';
import { readConfig, writeConfig } from './app-config.js';
import { setupLanguageMenu } from './language-menu.js';
import { createModelStatus, movementIndicator } from './model-status.js';
import { DEFAULT_MOLANG_INSPECTOR, MAIN_STATE_PRIORITY, createMolangInspectorHost, normalizeMolangInspector } from './molang-inspector.js';

// Material Symbols names for the icons used across the page (Angular Material's icon set).
const ICON_NAMES={'arrow-up-right':'open_in_new',box:'deployed_code',boxes:'widgets',info:'info',x:'close',scan:'view_in_ar',pause:'pause',play:'play_arrow',footprints:'directions_walk',download:'download',check:'check',archive:'folder_zip',upload:'drive_folder_upload',users:'group',sparkles:'auto_awesome','shield-check':'verified_user','person-standing':'accessibility_new','move-up':'arrow_upward','mouse-pointer-2':'mouse',moon:'dark_mode',sun:'light_mode','message-square':'chat',link:'link','file-box':'extension','chevron-right':'chevron_right','chevron-left':'chevron_left','chevron-down':'arrow_drop_down','book-open':'description','arrow-left':'arrow_back',heart:'favorite'};
const materialIcon = name => `<span class="material-symbol-icon" aria-hidden="true">${name}</span>`;
const icon = name => materialIcon(ICON_NAMES[name]||name);
// .md-range sliders paint their active track from --fill.
// Writes a DOM property or CSS variable only when it changes: rewriting the
// same text or value still makes the browser restyle and relayout.
function writeUi(element,key,value){
  if(key.startsWith('--')){if(element.style.getPropertyValue(key)!==value)element.style.setProperty(key,value);}
  else if(element[key]!==value)element[key]=value;
}
const syncRangeFill=input=>{const span=Number(input.max)-Number(input.min)||1;writeUi(input,'--fill',`${(Number(input.value)-Number(input.min))/span*100}%`);};
document.addEventListener('input',event=>{if(event.target.matches?.('.md-range'))syncRangeFill(event.target);});
const external = 'target="_blank" rel="noopener noreferrer"';
const source = 'https://alltheysm.st/models';
// 关于 page (第 72 节).
const APP_VERSION = __APP_VERSION__;
const SOURCE_REPOS = [['Codeberg','https://codeberg.org/MioNext/YesSteveModelTestTools']];
const minecraftColors={0:'#000000',1:'#0000aa',2:'#00aa00',3:'#00aaaa',4:'#aa0000',5:'#aa00aa',6:'#ffaa00',7:'#aaaaaa',8:'#555555',9:'#5555ff',a:'#55ff55',b:'#55ffff',c:'#ff5555',d:'#ff55ff',e:'#ffff55',f:'#ffffff'};
function minecraftTextRuns(value){
  const format={color:null,bold:false,italic:false,underline:false,strike:false},runs=[];let buffer='';
  const flush=()=>{if(buffer){runs.push({text:buffer,...format});buffer='';}};
  const reset=()=>{format.color=null;format.bold=false;format.italic=false;format.underline=false;format.strike=false;};
  const source=String(value??'');
  for(let i=0;i<source.length;i++){
    if(source[i]!=='§'||i+1>=source.length){buffer+=source[i];continue;}
    const hex=/^§x(?:§[0-9a-f]){6}/i.exec(source.slice(i));
    if(hex){flush();format.color='#'+[...hex[0].matchAll(/§([0-9a-f])/gi)].map(item=>item[1]).join('');format.bold=false;format.italic=false;format.underline=false;format.strike=false;i+=hex[0].length-1;continue;}
    const code=source[i+1].toLowerCase();if(!/[0-9a-fk-or]/.test(code)){buffer+=source[i];continue;}flush();i++;
    if(minecraftColors[code]){reset();format.color=minecraftColors[code];}
    else if(code==='r')reset();
    else if(code==='l')format.bold=true;else if(code==='o')format.italic=true;else if(code==='n')format.underline=true;else if(code==='m')format.strike=true;
  }
  flush();return runs;
}
const escapeText=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
// Minecraft draws text with a 1px shadow in the same hue at 25% brightness,
// which keeps light codes such as §e and §b readable on light backgrounds.
const minecraftShadow=color=>{const hex=/^#([0-9a-f]{6})$/i.exec(color);if(!hex)return '';const value=Number.parseInt(hex[1],16);return `1px 1px 0 rgb(${(value>>16&255)>>2},${(value>>8&255)>>2},${(value&255)>>2})`;};
const minecraftRunStyle=run=>[run.color?`color:${run.color};--mc-shadow:${minecraftShadow(run.color)}`:'',run.bold?'font-weight:700':'',run.italic?'font-style:italic':'',run.underline||run.strike?`text-decoration:${[run.underline?'underline':'',run.strike?'line-through':''].filter(Boolean).join(' ')}`:''].filter(Boolean).join(';');
const minecraftTextHtml=value=>minecraftTextRuns(value).map(run=>{const style=minecraftRunStyle(run);return `<span${style?` style="${style}"`:''}>${escapeText(run.text)}</span>`;}).join('');
const minecraftTextSvg=value=>minecraftTextRuns(value).map(run=>{const style=minecraftRunStyle(run);return `<tspan${style?` style="${style.replaceAll('color:','fill:')}"`:''}>${escapeText(run.text)}</tspan>`;}).join('');

document.querySelector('#app').innerHTML = `
  <nav class="nav-rail" aria-label="${tr('功能')}"><button class="nav-rail-item" type="button" data-nav="viewer" aria-current="page"><span class="nav-rail-indicator">${materialIcon('view_in_ar')}</span><span>${tr('查看器')}</span></button><button class="nav-rail-item" type="button" data-nav="library"><span class="nav-rail-indicator">${materialIcon('photo_library')}</span><span>${tr('模型库')}</span></button></nav>
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="./" aria-label="${tr('YSM模型工具 首页')}"><span class="brand-symbol">${logoSvg()}</span><span>${tr('YSM模型工具')}</span></a>
    <nav class="top-nav" aria-label="${tr('主导航')}"><a class="current" href="#details">${icon('boxes')}<span>${tr('模型')}</span></a></nav>
    <div class="header-actions"><span class="local-badge"><span></span>${tr('本地预览')}</span><button class="icon-button render-mode-button" id="render-mode-button" type="button" aria-pressed="false" aria-label="${tr('切换 YSM 渲染模式')}" title="${tr('当前：工程还原渲染；点击切换为原始面渲染')}">${materialIcon('deployed_code')}</button><button class="icon-button" id="import-button" aria-label="${tr('导入模型文件夹')}" title="${tr('导入模型文件夹')}">${icon('upload')}</button><input id="model-folder" type="file" webkitdirectory directory multiple hidden><button class="icon-button" id="zip-import-button" aria-label="${tr('导入 ZIP 或 YSM 模型')}" title="${tr('导入 ZIP 或 YSM 模型')}">${icon('archive')}</button><input id="model-zip" type="file" accept=".zip,.ysm,application/zip" hidden><button class="icon-button" id="theme-button" aria-label="${tr('切换到深色模式')}" title="${tr('切换主题')}">${icon('moon')}</button><button class="icon-button" id="app-fullscreen-button" aria-label="${tr('全屏')}" title="${tr('全屏（F11）')}">${materialIcon('fullscreen')}</button><a class="original-button" href="${source}" ${external}>${tr('访问原站')} ${icon('arrow-up-right')}</a></div>
  </div></header>
  <main class="page-shell">
    <div class="breadcrumb"><a href="https://alltheysm.st/models" ${external}>${icon('arrow-left')} ${tr('模型库')}</a><span>/</span><span>${tr('模型详情')}</span><span>/</span><strong id="breadcrumb-model-name"></strong></div>
    <div class="model-layout">
      <aside class="model-sidebar">
        <div class="cover-card"><img class="cover-layer cover-background" alt="" aria-hidden="true" hidden><div class="cover-wrap"><canvas class="cover" role="img" aria-label="${tr('游戏内封面预览')}" hidden></canvas><span class="cover-badge">${icon('box')} YSM MODEL</span><button class="cover-preview" id="cover-preview">${icon('scan')} ${tr('查看 3D 预览')} ${icon('arrow-up-right')}</button></div><img class="cover-layer cover-foreground" alt="" aria-hidden="true" hidden><h2 class="cover-caption"><span id="cover-title"></span></h2></div>
        <div class="cover-actions"><div class="card-playback-setting"><button class="md-button tonal" id="card-playback-toggle" type="button" aria-pressed="false" disabled>${icon('pause')} ${tr('暂停')}</button><label for="card-frame-time"><span>${tr('当前帧')}</span><output id="card-frame-time-value" for="card-frame-time">${tr('0.00 秒')}</output><input id="card-frame-time" class="md-range" type="range" min="0" max="5" step="0.01" value="0" aria-label="${tr('封面当前帧')}"></label></div><button class="md-button filled save-card-button" id="save-card-button" type="button" disabled>${icon('download')} ${tr('保存封面')}</button><button class="md-button tonal" id="export-card-button" type="button" disabled>${materialIcon('animation')} ${tr('导出动图')}</button></div>
        <div class="sidebar-meta"><span>${tr('适用模组')}</span><strong>Yes Steve Model</strong></div>
        <p class="sidebar-note">${icon('info')} ${tr('模型及作者信息来自导入的模型包')}</p>
      </aside>
      <section class="model-content">
        <div class="title-row"><div><div class="eyebrow">MODEL OVERVIEW <span> / </span> ${tr('模型详情')}</div><h1 id="model-title"><span class="model-name"></span><span class="default-tag" hidden>${tr('默认模型')}</span></h1><p class="subtitle" id="model-tips"></p></div><span class="model-mark">${icon('box')}</span></div>
        <div class="tabs" role="tablist" aria-label="${tr('模型内容')}"><button role="tab" id="tab-details" aria-controls="details-panel" aria-selected="true" data-tab="details">${icon('info')} ${tr('详情')}</button><button role="tab" id="tab-preview" aria-controls="preview-panel" aria-selected="false" data-tab="preview" tabindex="-1">${icon('scan')} ${tr('预览')} <span class="tab-pill">3D</span></button><button role="tab" id="tab-settings" aria-controls="settings-panel" aria-selected="false" data-tab="settings" tabindex="-1">${materialIcon('settings')} ${tr('设置')}</button><button role="tab" disabled title="${tr('本阶段仅实现详情和预览')}">${icon('message-square')} ${tr('评论')}</button><button role="tab" disabled title="${tr('本阶段仅实现详情和预览')}">${icon('archive')} ${tr('发行版')}</button><span class="tab-indicator" aria-hidden="true"></span></div>
        <div id="details-panel" class="details-panel" role="tabpanel" aria-labelledby="tab-details">
          <section class="detail-section model-description-section" id="model-description"><div class="section-title"><h2>${icon('book-open')} ${tr('模型说明')}</h2></div><p class="model-description-text" id="model-description-text"></p></section>
          <section class="detail-section"><div class="section-title"><h2>${icon('users')} ${tr('作者')}</h2><span id="author-count">${tr('来自模型包信息')}</span></div><div class="author-grid" id="author-grid"></div></section>
          <section class="detail-section" id="mod-support-section"><div class="section-title"><h2>${icon('boxes')} ${tr('模组动作')}</h2><span id="mod-count">${tr('未提供适配信息')}</span></div><div class="mod-grid" id="mod-grid"></div></section>
          <section class="detail-section" id="model-links-section"><div class="section-title"><h2>${icon('link')} ${tr('相关链接')}</h2></div><div class="link-grid" id="model-links"></div></section>
          <section class="license-card" id="model-license"><div class="license-symbol">${icon('shield-check')}</div><div class="license-body"><div class="license-title"><h2 id="license-name">${tr('许可信息')}</h2><span>${tr('模型授权')}</span></div><p id="license-description"></p></div></section>
        </div>
        <div id="settings-panel" class="settings-panel" role="tabpanel" aria-labelledby="tab-settings" hidden>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('palette')} ${tr('外观')}</h2><span>${tr('界面配色与动效')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('自动取色')}</strong><span>${tr('根据所加载模型贴图的颜色动态调整整个界面的配色，增强沉浸感。取色在后台进行，不影响模型加载和浏览。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-dynamic-color" aria-label="${tr('自动取色')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-status" id="dynamic-color-status" role="status">${materialIcon('colorize')}<span class="settings-status-text"></span></div>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('轮盘按钮动效')}</strong><span>${tr('点击动作轮盘的扇区时，扇区快速按下并回位。系统开启“减少动画”时不播放。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-wheel-bounce" aria-label="${tr('轮盘按钮动效')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('配置界面动效')}</strong><span>${tr('点击动作轮盘扇区的齿轮时，配置界面从右侧滑入，先快后慢。系统开启“减少动画”时不播放。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-wheel-settings-motion" aria-label="${tr('配置界面动效')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('轮盘声音图标')}</strong><span>${tr('在会播放声音的轮盘扇区上显示一个扬声器图标。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-wheel-sound-icon" aria-label="${tr('轮盘声音图标')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('light_mode')} ${tr('预览光照')}</h2><span>${tr('模拟游戏的光照等级，只影响“预览 3D”视图；灯光方向、曝光等在工具栏“光照调节”中')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('发光图层')}</strong><span>${tr('名称以 ysmGlow 开头的部件按游戏规则始终以最高亮度显示，不受环境亮度影响。环境亮度为 15 时与其他部件看起来相同，调低环境亮度即可看到发光效果。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-glow" aria-label="${tr('发光图层')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-item settings-range"><span class="settings-item-text"><strong id="setting-light-level-label">${tr('环境亮度')}</strong><span>${tr('模拟游戏中的光照等级（0 ~ 15）：15 为白天露天，0 为无光的洞穴。按原版光照贴图曲线压暗普通部件。')}</span></span><div><output id="setting-light-level-value" for="setting-light-level">${tr('15 级')}</output><input id="setting-light-level" class="md-range" type="range" min="0" max="15" step="1" value="15" aria-labelledby="setting-light-level-label"></div></div><div class="settings-item settings-range"><span class="settings-item-text"><strong id="setting-background-dim-label">${tr('背景压暗')}</strong><span>${tr('把 3D 视图的背景逐渐压暗，100% 为纯黑。深色场景下可衬托发光部件和泛光；截图背景始终透明，不受影响。')}</span></span><div><output id="setting-background-dim-value" for="setting-background-dim">0%</output><input id="setting-background-dim" class="md-range" type="range" min="0" max="100" step="1" value="0" aria-labelledby="setting-background-dim-label"></div></div><label class="settings-item"><span class="settings-item-text"><strong>${tr('显示网格')}</strong><span>${tr('在 3D 视图中显示地面网格。关闭后视野更干净；截图和封面始终不含网格。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-grid" aria-label="${tr('显示网格')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('build')} ${tr('工具栏')}</h2><span>${tr('选择“预览 3D”工具栏中显示的按钮，关闭不常用的按钮可让界面更简洁')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('自动隐藏工具栏')}</strong><span>${tr('工具栏平时收在 3D 视图右边框外，不再挡住画面；鼠标靠近视图右边缘时从右侧滑出，打开其中的菜单或面板时保持显示。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-auto-hide-toolbar" aria-label="${tr('自动隐藏工具栏')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('导出轮盘图片')}</strong><span>${tr('在工具栏显示“导出轮盘图片”按钮，把模型的动作轮盘和设置面板导出为一张总览图或多页文件（导出格式见下方“轮盘导出”）。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-wheel-export" aria-label="${tr('导出轮盘图片')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('手持物品')}</strong><span>${tr('在工具栏显示“手持物品”按钮，为主手和副手选择物品，以触发模型的手持动画（剑、盾、弓、TaCZ 枪械等）。关闭后两手恢复为空手。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-hand-items" aria-label="${tr('手持物品')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('截图按钮')}</strong><span>${tr('在 3D 视图右下角显示截图按钮和模型加载状态。关闭后全屏时仍可按 F2 截图。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-screenshot" aria-label="${tr('截图按钮')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('光照调节')}</strong><span>${tr('在工具栏显示“光照调节”按钮，调整主光方向、强度、颜色、环境光、曝光、电影色调与泛光，并可显示光源位置标记。关闭按钮不会重置已调好的光照。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-lighting" aria-label="${tr('光照调节')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('角色状态')}</strong><span>${tr('在工具栏显示“角色状态”按钮，设置生命值、饥饿值、盔甲、药水效果、天气和群系，触发模型脚本中对应的效果（如低血量姿势、雨天雨伞、穿戴盔甲时隐藏衣物）。关闭后恢复为默认状态。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-status" aria-label="${tr('角色状态')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('模型状态面板')}</strong><span>${tr('在 3D 视图顶部显示模型当前的动作；播放声音时显示扬声器，操控模式下另外显示跑、跳、飞行、鞘翅滑翔和游泳的指示器。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-model-status" aria-label="${tr('模型状态面板')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('select_window')} ${tr('窗口')}</h2><span>${tr('把界面的一部分放到单独的窗口中')}</span></div>
            <div class="settings-list">
              <button class="settings-item settings-nav" id="settings-popout-open" type="button" aria-haspopup="true" data-subpage="settings-popout-page"><span class="settings-item-text"><strong>${tr('独立窗口')}</strong><span id="settings-popout-summary"></span></span>${materialIcon('chevron_right')}</button>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('arrow_selector_tool')} ${tr('操控')}</h2><span>${tr('操控模式：在“预览 3D”中用鼠标和键盘像游戏里一样控制模型（WASD 移动、空格跳跃、双击 W 疾跑、双击空格飞行、Z 轮盘）')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('操控按钮')}</strong><span>${tr('在工具栏显示“操控模式”按钮。点击后画面捕获鼠标和键盘，按 Esc 释放鼠标，再按一次按钮退出。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-play-control" aria-label="${tr('操控按钮')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-item settings-range"><span class="settings-item-text"><strong id="setting-mouse-sensitivity-label">${tr('光标灵敏度')}</strong><span>${tr('操控模式下鼠标移动时视角转动的快慢，100% 为默认值。')}</span></span><div><output id="setting-mouse-sensitivity-value" for="setting-mouse-sensitivity">100%</output><input id="setting-mouse-sensitivity" class="md-range" type="range" min="10" max="300" step="10" value="100" aria-labelledby="setting-mouse-sensitivity-label"></div></div>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('speed')} ${tr('性能')}</h2><span>${tr('排查卡顿或比较不同模型、光照设置的渲染开销')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>Benchmark</strong><span>${tr('在“预览 3D”视图左上角叠加实时帧率与帧率波动折线图（虚线为 60 / 30 FPS），并显示平均、1% 低帧、最低 / 最高帧率、CPU 帧耗时、绘制调用次数、三角面数、内存、渲染分辨率与显卡。只显示在画面上，不会出现在截图中。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-benchmark" aria-label="Benchmark"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('解除帧率上限')}</strong><span>${tr('默认情况下 3D 视图的帧率不超过显示器刷新率（垂直同步）。开启后立即改为尽可能快地连续渲染，可配合 Benchmark 测出真实渲染能力（屏幕上能看到的帧数仍受刷新率限制）；显卡和处理器会满负荷运行，耗电与风扇噪音明显增加。桌面版重启后还会关闭垂直同步以进一步提高帧率，此时画面可能出现撕裂。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-uncapped-fps" aria-label="${tr('解除帧率上限')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-status" id="uncapped-fps-status" role="status" hidden>${materialIcon('restart_alt')}<span class="settings-status-text"></span><button class="md-button text" id="uncapped-fps-restart" type="button">${tr('立即重启')}</button></div>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('function')} ${tr('模型调试')}</h2><span>${tr('不进游戏也能检查模型的 Molang 逻辑')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('Molang 监视器')}</strong><span>${tr('打开一个独立的系统窗口（可拖出主窗口、调整大小），实时显示“预览 3D”中模型的 Molang 变量（v. / ctrl. / ysm. / q.）和自定义表达式的值，也可以执行赋值语句（例如 v.mode = 2）。窗口底部的滑条可调节整个窗口的透明度。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-molang-inspector" aria-label="${tr('Molang 监视器')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('branding_watermark')} ${tr('截图水印')}</h2><span>${tr('截图时在画面上平铺文字水印，封面与轮盘导出不受影响')}</span></div>
            <div class="settings-list" id="watermark-settings">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('添加水印')}</strong><span>${tr('开启后截图会铺满斜向重复的水印文字；文字为空时不添加。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-watermark" aria-label="${tr('添加水印')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item settings-field" data-watermark-option><span class="settings-item-text"><strong>${tr('水印文字')}</strong><span>${tr('最多 40 个字符。')}</span></span><span class="md-outlined-field"><input id="watermark-text" type="text" maxlength="40" placeholder=" " autocomplete="off"><span>${tr('水印文字')}</span></span></label>
              <label class="settings-item" data-watermark-option><span class="settings-item-text"><strong>${tr('文字颜色')}</strong><span>${tr('浅色背景下建议改用深色。')}</span></span><span class="md-color"><input id="watermark-color" type="color" value="#ffffff" aria-label="${tr('水印文字颜色')}"></span></label>
              <div class="settings-item settings-range" data-watermark-option><span class="settings-item-text"><strong id="watermark-opacity-label">${tr('不透明度')}</strong><span>${tr('数值越小水印越淡。')}</span></span><div><output id="watermark-opacity-value" for="watermark-opacity">20%</output><input id="watermark-opacity" class="md-range" type="range" min="0" max="100" value="20" aria-labelledby="watermark-opacity-label"></div></div>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('badge')} ${tr('封面')}</h2><span>${tr('左侧实时封面与“保存封面”使用以下设置')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('显示左侧封面')}</strong><span>${tr('关闭后隐藏左侧整栏（封面、播放控制、保存封面、导出动图），封面完全不渲染，节省性能。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-show-cover" aria-label="${tr('显示左侧封面')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('选中与悬停边框')}</strong><span>${tr('在左侧封面外侧画一圈边框：选中封面时显示主题主色边框，鼠标经过时显示另一种颜色的边框。关闭后只在用键盘切换焦点时显示焦点框。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-cover-outline" aria-label="${tr('选中与悬停边框')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-item settings-range"><span class="settings-item-text"><strong id="setting-card-warmup-label">${tr('预热时间')}</strong><span>${tr('封面开始播放前，先在第一帧运行物理与动画控制器的时间。设为 0 与游戏刚打开模型界面时一致（飘带等物理部件会从无到有地出现）；部件出现较慢的模型可以调大。修改后封面从头播放（暂停时停留在当前帧）。')}</span></span><div><output id="setting-card-warmup-value" for="setting-card-warmup">${tr('1.0 秒')}</output><input id="setting-card-warmup" class="md-range" type="range" min="0" max="5" step="0.5" value="1" aria-labelledby="setting-card-warmup-label"></div></div>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('account_tree')} ${tr('轮盘导出')}</h2><span>${tr('工具栏“导出轮盘图片”按钮使用以下设置')}</span></div>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('分页导出')}</strong><span>${tr('轮盘很多时按 A4 竖版分成多页，卡片不会被切开；跨页的连线用编号和“→ 第 N 页”“来自第 N 页”标出。关闭时导出为一张长图。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-wheel-paged" aria-label="${tr('分页导出')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <div class="settings-item radio-setting settings-choice" id="setting-wheel-format" role="radiogroup" aria-labelledby="setting-wheel-format-label"><span class="settings-item-text"><strong id="setting-wheel-format-label">${tr('分页格式')}</strong><span>${tr('多页 PDF 保存为一个文件；多张 PNG 保存到所选文件夹，文件名按页码编号。')}</span></span><div><label><input type="radio" name="setting-wheel-format" value="pdf"><span>${tr('多页 PDF')}</span></label><label><input type="radio" name="setting-wheel-format" value="png"><span>${tr('多张 PNG')}</span></label></div></div>
            </div>
          </section>
          <section class="detail-section"><div class="section-title"><h2>${materialIcon('info')} ${tr('关于')}</h2><span>${tr('版本、开源地址与许可证')}</span></div>
            <div class="settings-list">
              <button class="settings-item settings-nav" id="settings-about-open" type="button" aria-haspopup="true" data-subpage="settings-about-page"><span class="settings-item-text"><strong>${tr('关于 YSM模型工具')}</strong><span>${tr('版本 {0}', APP_VERSION)}</span></span>${materialIcon('chevron_right')}</button>
            </div>
          </section>
          <section class="settings-subpage" id="settings-about-page" aria-labelledby="settings-about-title" hidden>
            <header class="settings-subpage-header"><button class="icon-button" id="settings-about-back" type="button" title="${tr('返回')}" aria-label="${tr('返回')}">${materialIcon('arrow_back')}</button><h2 id="settings-about-title">${tr('关于')}</h2></header>
            <div class="about-card">
              <button class="about-logo" id="about-logo" type="button" aria-label="${tr('YSM模型工具')}">${logoSvg()}</button>
              <h3 class="about-name">${tr('YSM模型工具')}</h3>
              <p class="about-version">${tr('版本 {0}', APP_VERSION)}</p>
              <p class="about-description">${tr('YSM模型工具，一个让你更好查看和调试模型的助手')}</p>
            </div>
            <div class="settings-list about-links">
              ${SOURCE_REPOS.map(([name,url])=>`<a class="settings-item settings-nav" href="${url}" ${external}><span class="settings-item-text"><strong>${tr('开源地址 · {0}', name)}</strong><span>${url.replace('https://','')}</span></span>${materialIcon('open_in_new')}</a>`).join('')}
            </div>
            <div class="about-license">
              <a href="https://www.gnu.org/licenses/gpl-3.0.html" ${external} title="GNU GPL v3"><img src="${gplLogoUrl}" alt="GPLv3" height="72"></a>
              <p>${tr('自豪的使用 GPL v3开源')}</p>
            </div>
          </section>
          <section class="settings-subpage" id="settings-popout-page" aria-labelledby="settings-popout-title" hidden>
            <header class="settings-subpage-header"><button class="icon-button" id="settings-popout-back" type="button" title="${tr('返回')}" aria-label="${tr('返回')}">${materialIcon('arrow_back')}</button><h2 id="settings-popout-title">${tr('独立窗口')}</h2></header>
            <p class="settings-subpage-intro">${tr('开启后对应的界面会移到一个单独的系统窗口中，可以拖到主窗口外面；关闭该窗口或关闭开关即放回原处。')}</p>
            <div class="settings-list">
              <label class="settings-item"><span class="settings-item-text"><strong>${tr('工具栏独立窗口')}</strong><span>${tr('把“预览 3D”右侧的工具栏放进一个横向的小窗口。手持物品、材质等菜单在小窗口下方展开，窗口会随之变高。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-popout-toolbar" aria-label="${tr('工具栏独立窗口')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
              <label class="settings-item" id="setting-popout-cover-row"><span class="settings-item-text"><strong>${tr('封面独立窗口')}</strong><span>${tr('把左侧的封面、播放控制、保存封面与导出动图放进单独的窗口，主界面的 3D 视图随之加宽。需要先在“封面”中打开“显示左侧封面”。')}</span></span><span class="md-switch"><input type="checkbox" role="switch" id="setting-popout-cover" aria-label="${tr('封面独立窗口')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>
            </div>
          </section>
        </div>
        <div id="preview-panel" role="tabpanel" aria-labelledby="tab-preview" hidden>
          <div class="viewer-shell" id="viewer-shell"><div id="viewport"><canvas id="scene" aria-label="${tr('三维模型预览，拖动旋转，滚轮缩放')}"></canvas><div class="loading-state" id="loading-state"><span class="spinner"></span><strong>${tr('正在准备模型')}</strong><span>${tr('加载几何、贴图与动画…')}</span></div><div class="viewer-tools"><button class="icon-button" id="pose-walk" title="${tr('走')}" aria-label="${tr('走')}">${materialIcon('directions_walk')}</button><button class="icon-button" id="pose-run" title="${tr('跑')}" aria-label="${tr('跑')}">${materialIcon('directions_run')}</button><button class="icon-button" id="pose-jump" title="${tr('跳')}" aria-label="${tr('跳')}">${materialIcon('arrow_upward')}</button><button class="icon-button" id="play-control-button" title="${tr('操控模式')}" aria-label="${tr('操控模式')}" aria-pressed="false">${materialIcon('arrow_selector_tool')}</button><div class="hand-item-picker" id="hand-item-picker"><button class="icon-button" id="hand-item-button" title="${tr('手持物品')}" aria-label="${tr('手持物品')}" aria-haspopup="menu" aria-expanded="false">${materialIcon('back_hand')}</button><div class="hand-item-menu" id="hand-item-menu" role="menu" aria-label="${tr('手持物品')}" hidden><div class="md-segmented hand-item-hands" role="radiogroup" aria-label="${tr('选择手')}"><label><input type="radio" name="hand-item-hand" value="mainhand" checked>${materialIcon('check')}<span>${tr('主手')}</span></label><label><input type="radio" name="hand-item-hand" value="offhand">${materialIcon('check')}<span>${tr('副手')}</span></label></div><div class="hand-item-options" id="hand-item-options"></div></div></div><div class="light-picker" id="status-picker"><button class="icon-button" id="status-button" title="${tr('角色状态')}" aria-label="${tr('角色状态')}" aria-haspopup="dialog" aria-expanded="false">${materialIcon('monitor_heart')}</button></div><button class="icon-button" id="action-wheel-button" title="${tr('动作轮盘')}" aria-label="${tr('动作轮盘')}" aria-haspopup="menu" aria-expanded="false">${materialIcon('donut_large')}</button><button class="wheel-close-button" id="action-wheel-close" type="button" aria-label="${tr('关闭动作轮盘')}" title="${tr('关闭轮盘')}" hidden>${materialIcon('close')}</button><button class="icon-button" id="wheel-export-button" title="${tr('导出轮盘图片')}" aria-label="${tr('导出轮盘图片')}">${materialIcon('account_tree')}</button><div class="light-picker" id="light-picker"><button class="icon-button" id="light-button" title="${tr('光照调节')}" aria-label="${tr('光照调节')}" aria-haspopup="dialog" aria-expanded="false">${materialIcon('wb_sunny')}</button></div><button class="icon-button" id="center-view-button" title="${tr('居中视角')}" aria-label="${tr('居中视角')}">${materialIcon('filter_center_focus')}</button><button class="icon-button" id="reset-pose-button" title="${tr('重置姿势')}" aria-label="${tr('重置姿势')}">${materialIcon('restart_alt')}</button><button class="icon-button" id="fullscreen-button" title="${tr('全屏')}" aria-label="${tr('全屏')}">${materialIcon('fullscreen')}</button><button class="icon-button" id="unload-model" type="button" title="${tr('卸载模型')}" aria-label="${tr('卸载模型')}" disabled>${materialIcon('eject')}</button><div class="texture-picker" id="texture-picker" hidden><button class="texture-picker-trigger" id="texture-picker-trigger" type="button" aria-label="${tr('选择材质')}" title="${tr('选择材质')}" aria-haspopup="listbox" aria-expanded="false">${materialIcon('texture')}<span id="texture-current">texture</span>${icon('chevron-down')}</button><div class="texture-picker-options" id="texture-picker-options" role="listbox" aria-label="${tr('模型材质')}" hidden></div></div></div><div class="viewer-tools-edge" aria-hidden="true"></div><div class="capture-panel" id="capture-panel" role="group" aria-label="${tr('截图')}"><div class="capture-fields"><span class="capture-status" id="render-status" role="status">${tr('准备加载')}</span></div><button class="md-fab" id="take-screenshot-button" type="button" title="${tr('截图（全屏时可按 F2）')}" aria-label="${tr('截图')}">${materialIcon('photo_camera')}</button></div><div class="light-panel" id="light-panel" role="dialog" aria-label="${tr('光照调节')}" hidden><header><strong>${tr('光照调节')}</strong><button class="icon-button light-marker-toggle" id="light-marker" type="button" aria-pressed="false" title="${tr('显示光源标记')}" aria-label="${tr('显示光源标记')}">${materialIcon('lightbulb')}</button><button class="md-button text" id="light-reset" type="button">${tr('恢复默认')}</button></header><div class="light-subheader">${tr('主光')}</div><label class="light-row" for="light-azimuth"><span>${tr('水平方向')}</span><output id="light-azimuth-value" for="light-azimuth"></output><input id="light-azimuth" class="md-range" type="range" data-light="azimuth"></label><label class="light-row" for="light-elevation"><span>${tr('高度角')}</span><output id="light-elevation-value" for="light-elevation"></output><input id="light-elevation" class="md-range" type="range" data-light="elevation"></label><label class="light-row" for="light-intensity"><span>${tr('强度')}</span><output id="light-intensity-value" for="light-intensity"></output><input id="light-intensity" class="md-range" type="range" data-light="intensity"></label><label class="light-row light-color-row"><span>${tr('颜色')}</span><span class="md-color"><input id="light-color" type="color" aria-label="${tr('主光颜色')}"></span></label><div class="light-subheader">${tr('环境光')}</div><label class="light-row" for="light-ambient"><span>${tr('强度')}</span><output id="light-ambient-value" for="light-ambient"></output><input id="light-ambient" class="md-range" type="range" data-light="ambient"></label><div class="light-subheader">${tr('画面')}</div><label class="light-row light-switch-row"><span>${tr('电影色调')}</span><span class="md-switch"><input type="checkbox" role="switch" id="light-filmic" aria-label="${tr('电影色调')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label><label class="light-row" for="light-exposure"><span>${tr('曝光')}</span><output id="light-exposure-value" for="light-exposure"></output><input id="light-exposure" class="md-range" type="range" data-light="exposure"></label><div class="light-subheader">${tr('泛光')}</div><label class="light-row light-switch-row"><span>${tr('开启泛光')}</span><span class="md-switch"><input type="checkbox" role="switch" id="light-bloom" aria-label="${tr('开启泛光')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label><label class="light-row" data-bloom-option for="light-bloomStrength"><span>${tr('强度')}</span><output id="light-bloomStrength-value" for="light-bloomStrength"></output><input id="light-bloomStrength" class="md-range" type="range" data-light="bloomStrength"></label><label class="light-row" data-bloom-option for="light-bloomRadius"><span>${tr('范围')}</span><output id="light-bloomRadius-value" for="light-bloomRadius"></output><input id="light-bloomRadius" class="md-range" type="range" data-light="bloomRadius"></label><label class="light-row light-switch-row" data-bloom-option><span>${tr('仅发光部件')}</span><span class="md-switch"><input type="checkbox" role="switch" id="light-bloom-glow" aria-label="${tr('仅发光部件')}"><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label><label class="light-row" data-bloom-option data-bloom-highlight for="light-bloomThreshold" title="${tr('数值越大，越亮的地方才会发光')}"><span>${tr('阈值')}</span><output id="light-bloomThreshold-value" for="light-bloomThreshold"></output><input id="light-bloomThreshold" class="md-range" type="range" data-light="bloomThreshold"></label><p class="light-note">${tr('只影响“预览 3D”视图（截图含色调、曝光与泛光，不含标记），封面保持游戏光照。光照等级与发光图层见 设置 → 预览光照。')}</p></div><div class="light-panel status-panel" id="status-panel" role="dialog" aria-label="${tr('角色状态')}" hidden></div><div class="action-wheel" id="action-wheel" role="menu" aria-label="${tr('选择模型动作')}" hidden></div><div class="play-item-panel" id="play-item-panel" role="dialog" aria-label="${tr('选择物品')}" hidden></div><div class="play-hint" id="play-hint" role="status" hidden></div><div class="play-view" id="play-view" role="status" aria-live="polite" hidden></div><div class="viewer-notice" id="viewer-notice" role="status" aria-live="assertive" hidden></div><div class="view-presets"><button class="selected" data-view="front">${tr('正面')}</button><button data-view="side">${tr('侧面')}</button><button data-view="back">${tr('背面')}</button></div><div class="axis-widget" aria-hidden="true"><span>Y</span><span>Z</span><span>X</span></div><div class="viewport-hint">${icon('mouse-pointer-2')} ${tr('拖动旋转')} <span>·</span> ${tr('滚轮缩放')} <span>·</span> ${tr('右键平移')}</div></div>
          <div class="animation-panel"><div class="animation-top"><div class="animation-title">${icon('sparkles')} ${tr('动画')} <span id="animation-name">${tr('待机')}</span></div><div class="animation-choices"><button data-animation="idle" class="selected">${icon('person-standing')} ${tr('待机')}</button><button data-animation="walk">${icon('footprints')} ${tr('行走')}</button><button data-animation="run">${icon('footprints')} ${tr('奔跑')}</button><button data-animation="jump">${icon('move-up')} ${tr('跳跃')}</button></div></div><div class="timeline-row"><button id="play-button" class="play-button" aria-label="${tr('暂停动画')}">${icon('pause')}</button><span id="time-current">0.00</span><input id="timeline" type="range" min="0" max="3" step="0.001" value="0" aria-label="${tr('动画播放进度')}"><span id="time-duration">3.00 s</span><select id="speed" aria-label="${tr('动画播放速度')}"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div></div></div>
          <div class="preview-note">${icon('info')} ${tr('动画为基础关键帧预览，游戏内的交互效果以实际表现为准。')}</div>
        </div>
      </section>
    </div>
    <footer><span class="footer-brand">${tr('YSM模型工具')}</span><span>${tr('让每一个模型，都有自己的舞台。')}</span><a href="${source}" ${external}>${tr('参考 All the YSM')} ${icon('arrow-up-right')}</a></footer>
  </main>
  <div class="library-view" id="library-view" hidden></div>
  <div class="drop-overlay" id="drop-overlay" aria-hidden="true" hidden><div>${tr('松开以加载模型 ZIP、YSM 或文件夹')}</div></div>
  <dialog class="md-dialog" id="card-export-dialog" aria-labelledby="card-export-title"><form method="dialog">
    <h2 id="card-export-title">${tr('导出动态封面')}</h2>
    <p class="md-dialog-supporting" id="card-export-summary"></p>
    <fieldset class="export-field" id="card-export-format-field"><legend>${tr('格式')}</legend><div class="md-segmented" id="card-export-format"></div><p class="export-hint" id="card-export-format-hint"></p></fieldset><fieldset class="export-field" id="card-export-scale-field"><legend>${tr('分辨率')}</legend><div class="md-segmented" id="card-export-scale"></div><p class="export-hint" id="card-export-scale-hint"></p></fieldset><fieldset class="export-field" id="card-export-fps-field"><legend>${tr('帧率')}</legend><div class="md-segmented" id="card-export-fps"></div><p class="export-hint" id="card-export-fps-hint"></p></fieldset><fieldset class="export-field" id="card-export-loops-field"><legend id="card-export-loops-label">${tr('播放次数')}</legend><div class="export-range"><input id="card-export-loops" class="md-range" type="range" min="1" max="100" step="1" value="1" aria-labelledby="card-export-loops-label"><output id="card-export-loops-value" for="card-export-loops">${tr('1 次')}</output></div><p class="export-hint" id="card-export-loops-hint"></p></fieldset>
    <div class="export-progress" id="card-export-progress" hidden><div class="md-linear-progress" role="progressbar" aria-labelledby="card-export-progress-text" aria-valuemin="0" aria-valuemax="100"><span></span></div><span id="card-export-progress-text"></span></div>
    <div class="md-dialog-actions"><button class="md-button text" id="card-export-cancel" type="button">${tr('取消')}</button><button class="md-button filled" id="card-export-start" type="submit">${icon('download')} ${tr('导出')}</button></div>
  </form></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;

let viewer, viewerPromise, toastTimer, toastExitTimer, dragDepth=0, activeModelName='';
const MAX_CARD_DURATION=30;
const DEFAULT_CARD_DURATION=5;
let cardDurationValue=DEFAULT_CARD_DURATION,cardPlaybackPaused=false,cardFrameTime=0,cardFrameTimer;
function cardDuration(){return cardDurationValue;}
function syncCardPlaybackUi(){const button=document.querySelector('#card-playback-toggle'),save=document.querySelector('#save-card-button');if(button){button.innerHTML=`${icon(cardPlaybackPaused?'play':'pause')} ${cardPlaybackPaused?tr('开始'):tr('暂停')}`;button.setAttribute('aria-pressed',String(cardPlaybackPaused));}if(save)save.innerHTML=tr('{0} 保存封面', icon('download'));}
let cardFrameInput,cardFrameOutput;
function updateCardFrameSlider(){
  cardFrameInput??=document.querySelector('#card-frame-time');cardFrameOutput??=document.querySelector('#card-frame-time-value');
  const duration=cardDuration();writeUi(cardFrameInput,'max',String(duration));cardFrameTime=Math.min(duration,Math.max(0,cardFrameTime));
  writeUi(cardFrameInput,'value',String(cardFrameTime));syncRangeFill(cardFrameInput);writeUi(cardFrameOutput,'value',tr('{0} 秒', cardFrameTime.toFixed(2)));
}
// Keep the readout on the same requestAnimationFrame cadence as the card.
const updateCardFrameSliderLive=updateCardFrameSlider;

function resetCardDuration(duration=DEFAULT_CARD_DURATION){cardDurationValue=Math.min(MAX_CARD_DURATION,Math.max(0.1,Number(duration)||DEFAULT_CARD_DURATION));updateCardFrameSlider();}
let avatarObjectUrls=[];
const safeExternalUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};
function renderMinecraftText(target,value){
  for(const run of minecraftTextRuns(value)){const span=document.createElement('span');span.className='minecraft-title-text';span.textContent=run.text;if(run.color){span.style.color=run.color;span.style.setProperty('--mc-shadow',minecraftShadow(run.color));}if(run.bold)span.style.fontWeight='700';if(run.italic)span.style.fontStyle='italic';if(run.underline||run.strike)span.style.textDecoration=[run.underline?'underline':'',run.strike?'line-through':''].filter(Boolean).join(' ');target.append(span);}
}
// A blank metadata.name shows the pack's file name without its archive
// extension, like ModelButton.
function renderModelMetadata(ysmJson,avatarFiles,isImported=false,packName=''){
  const metadata=ysmJson?.metadata||{},authors=Array.isArray(metadata.authors)?metadata.authors:[],files=avatarFiles instanceof Map?avatarFiles:new Map();
  for(const url of avatarObjectUrls)URL.revokeObjectURL(url);avatarObjectUrls=[];
  const title=document.querySelector('#model-title'),tag=title.querySelector('.default-tag'),name=(String(metadata.name||'').trim()?metadata.name:'')||packName||tr('未命名模型'),nameText=document.createElement('span');activeModelName=name;nameText.className='model-name';
  renderMinecraftText(nameText,name);title.replaceChildren(nameText,tag);
  const cardTitle=document.querySelector('#cover-title');cardTitle.replaceChildren();renderMinecraftText(cardTitle,name);
  const plainName=String(name).replace(/§x(?:§[0-9a-f]){6}/gi,'').replace(/§[0-9a-fk-or]/gi,'').trim();tag.hidden=plainName.toLowerCase()!=='default';
  const breadcrumbName=document.querySelector('#breadcrumb-model-name');breadcrumbName.replaceChildren();renderMinecraftText(breadcrumbName,name);
  document.title=tr('{0} · YSM模型工具', plainName||tr('YSM 模型'));
  const tips=document.querySelector('#model-tips'),description=document.querySelector('#model-description-text'),descriptionSection=document.querySelector('#model-description');
  const info=metadata.extra_info??ysmJson?.extra_info??metadata.tips;
  const descriptionText=typeof info==='string'?info:Array.isArray(info)?info.map(item=>typeof item==='string'?item:item?.text||item?.description||'').filter(Boolean).join('\n'):info&&typeof info==='object'?String(info.text||info.description||info.content||''):'';
  tips.replaceChildren();renderMinecraftText(tips,metadata.tips||descriptionText||tr('未提供模型说明'));
  description.replaceChildren();if(descriptionText)renderMinecraftText(description,descriptionText);
  descriptionSection.hidden=!descriptionText;
  const authorGrid=document.querySelector('#author-grid');authorGrid.replaceChildren();
  for(const author of authors){
    const card=document.createElement('article');card.className='author-card';
    const image=document.createElement('img');image.alt=author.name?tr('{0}的头像', wheelText(author.name)):tr('作者头像');
    const avatarPath=String(author.avatar||'').replace(/^\.?\//,'').replace(/\\/g,'/');
    const avatarFile=files.get(avatarPath.toLowerCase());
    if(avatarFile){const url=URL.createObjectURL(avatarFile);avatarObjectUrls.push(url);image.src=url;}
    else image.hidden=true;
    image.onerror=()=>{image.hidden=true;};
    const copy=document.createElement('div');copy.className='author-copy';
    const name=document.createElement('strong');renderMinecraftText(name,author.name||tr('未命名作者'));copy.append(name);
    if(author.comment){const comment=document.createElement('p');comment.className='author-comment';renderMinecraftText(comment,author.comment);copy.append(comment);}
    const role=document.createElement('span');role.className='role-tag';renderMinecraftText(role,author.role||tr('作者'));
    const contacts=document.createElement('div');contacts.className='author-contacts';
    for(const [platform,value] of Object.entries(author.contact||{})){const href=safeExternalUrl(value);if(!href)continue;const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=platform;link.title=`${wheelText(author.name||tr('作者'))} · ${platform}`;contacts.append(link);}
    card.append(image,copy,role);if(contacts.childElementCount)card.append(contacts);authorGrid.append(card);
  }
  if(!authors.length){const empty=document.createElement('p');empty.className='author-empty';empty.textContent=tr('这个模型包没有提供作者信息。');authorGrid.append(empty);}
  document.querySelector('#author-count').textContent=authors.length?tr('{0} 位作者', authors.length):tr('模型未提供作者信息');
  const animationFiles=ysmJson?.files?.player?.animation||{},modCatalog={
    carryon:{title:tr('搬运'),subtitle:'Carry On'},
    tac:{title:tr('永恒枪械工坊'),subtitle:'Timeless and Classics Zero'},
    swem:{title:'SWEM',subtitle:'Star Worm Equestrian Mod'},
    parcool:{title:'ParCool',subtitle:'Parkour mod'},
    slashblade:{title:'SlashBlade',subtitle:'Slash Blade'},
    tlm:{title:tr('东方女仆'),subtitle:'Touhou Little Maid'},
  };
  const modGrid=document.querySelector('#mod-grid');modGrid.replaceChildren();let supportedMods=0;
  for(const [key,definition] of Object.entries(modCatalog)){
    if(!animationFiles[key])continue;supportedMods++;
    const card=document.createElement('div');card.className='mod-card';
    if(definition.image){const image=document.createElement('img');image.src=definition.image;image.alt=tr('{0}模组图标', definition.title);card.append(image);}
    else{const image=document.createElement('span');image.className='link-icon';image.innerHTML=icon('file-box');card.append(image);}
    const copy=document.createElement('div'),name=document.createElement('strong'),subtitle=document.createElement('span'),status=document.createElement('span');
    name.textContent=definition.title;subtitle.textContent=definition.subtitle;copy.append(name,subtitle);status.className='supported';status.innerHTML=icon('check')+' '+tr('已适配');card.append(copy,status);modGrid.append(card);
  }
  document.querySelector('#mod-count').textContent=supportedMods?tr('已适配 {0} 个模组', supportedMods):tr('模型未提供适配动画');document.querySelector('#mod-support-section').hidden=!supportedMods;
  const linkGrid=document.querySelector('#model-links');linkGrid.replaceChildren();
  const links=metadata.link||{};
  for(const [key,value] of [['home',links.home],['donate',links.donate]]){
    const href=safeExternalUrl(value);if(!href)continue;
    const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';
    const iconWrap=document.createElement('span');iconWrap.className=`link-icon${key==='donate'?' pink':''}`;iconWrap.innerHTML=icon(key==='donate'?'heart':'box');
    const copy=document.createElement('div'),name=document.createElement('strong'),desc=document.createElement('span');
    name.textContent=key==='donate'?tr('支持作者'):tr('主页');desc.textContent=new URL(href).host;copy.append(name,desc);link.append(iconWrap,copy);link.insertAdjacentHTML('beforeend',icon('arrow-up-right'));linkGrid.append(link);
  }
  document.querySelector('#model-links-section').hidden=!linkGrid.childElementCount;
  // License text comes only from the pack (metadata.license.type / desc), shown with
  // its Minecraft formatting like YSM's "协议：%s" tooltip.
  const license=metadata.license&&typeof metadata.license==='object'?metadata.license:{type:metadata.license};
  const licenseType=String(license.type??'').trim(),licenseDesc=String(license.desc??'').trim();
  const licenseName=document.querySelector('#license-name');licenseName.replaceChildren();renderMinecraftText(licenseName,licenseType);
  const licenseDescription=document.querySelector('#license-description');licenseDescription.replaceChildren();
  if(licenseDesc)renderMinecraftText(licenseDescription,licenseDesc);
  licenseDescription.hidden=!licenseDesc;
  document.querySelector('#model-license').hidden=!licenseType;
  
}
let modelBusy=false,currentYsmArchive=null,currentLibraryModel=null;
function setModelBusy(busy){
  modelBusy=busy;
  for(const id of ['render-mode-button','import-button','zip-import-button'])document.getElementById(id).disabled=busy;
  document.querySelector('#unload-model').disabled=busy||!viewer?.root;
}
function showEmptyModel(){
  document.querySelector('.cover-card').classList.add('is-empty');
  renderModelMetadata({metadata:{name:tr('未加载模型'),tips:tr('请导入模型文件夹、ZIP 压缩包或 YSM 模型')}},new Map(),true);
  document.title=tr('YSM模型工具');
  document.querySelector('#author-count').textContent=tr('等待导入模型');
  document.querySelector('#save-card-button').disabled=true;document.querySelector('#export-card-button').disabled=true;
  document.querySelector('#card-playback-toggle').disabled=true;cardPlaybackPaused=false;cardFrameTime=0;clearTimeout(cardFrameTimer);resetCardDuration();syncCardPlaybackUi();
  document.querySelector('#author-grid').innerHTML=`<p class="author-empty">${tr('请通过右上角按钮导入模型文件夹、ZIP 压缩包或 YSM 模型。')}</p>`;
  document.querySelector('.cover').hidden=true;
  for(const layer of document.querySelectorAll('.cover-layer')){layer.hidden=true;layer.removeAttribute('src');}
  closeActionWheel();document.querySelector('#action-wheel').replaceChildren();
  closeTexturePicker();refreshTexturePicker(null);
  textureCurrent.textContent='texture';textureTrigger.title=tr('选择材质');textureTrigger.removeAttribute('aria-activedescendant');
  document.querySelector('#scene').hidden=true;
  document.querySelector('#scene').setAttribute('aria-label',tr('三维模型预览'));
  const loading=document.querySelector('#loading-state');loading.hidden=false;
  loading.innerHTML=`<strong>${tr('未加载模型')}</strong><span>${tr('请导入模型文件夹、ZIP 压缩包或 YSM 模型')}</span>`;
  document.querySelector('#render-status').textContent=tr('未加载模型');
  document.querySelector('#animation-name').textContent=tr('未加载');updateTime(0,0);
  document.querySelector('#speed').value='1';
  document.querySelectorAll('[data-animation],#pose-walk,#pose-run,#pose-jump').forEach(button=>button.classList.remove('selected','active'));syncMainStateButtons();
  document.querySelector('#play-button').innerHTML=icon('play');
  document.querySelector('#play-button').setAttribute('aria-label',tr('播放动画'));
  setModelBusy(modelBusy);
}
async function releaseViewer({keepColors=false}={}){
  exitPlayControl();
  const previous=viewer;viewer=null;viewerPromise=null;updateModelStatus();
  showEmptyModel();
  previous?.dispose();
  // Switching models keeps the old palette until the new texture is sampled.
  if(!keepColors)syncDynamicColor();
}
document.querySelector('#unload-model').onclick=async()=>{
  if(modelBusy||!viewer)return;
  setModelBusy(true);
  try{await releaseViewer();toast(tr('模型已卸载'));}finally{setModelBusy(false);}
};
document.querySelector('#save-card-button').onclick=async event=>{
  const button=event.currentTarget,instance=viewer;if(!instance?.root||button.disabled)return;
  button.disabled=true;button.textContent=tr('正在生成封面…');
  try{
    // Save the frame the progress slider is on (pause and scrub to choose it).
    const previewBounds=document.querySelector('.cover-wrap').getBoundingClientRect(),cardBounds=document.querySelector('.cover-card').getBoundingClientRect(),pixelRatio=window.devicePixelRatio||1;
    const width=Math.max(1,Math.round(previewBounds.width*pixelRatio)),height=Math.max(1,Math.round(previewBounds.height*pixelRatio)),fullCardHeight=Math.max(height,Math.round(cardBounds.height*pixelRatio));
    const blob=await instance.renderCardImage({width,height,fullCardHeight,includeCardChrome:true,title:activeModelName,time:cardFrameTime});
    if(!blob)throw new Error(tr('模型尚未加载'));
    const safeName=wheelText(activeModelName).replace(/[\\/:*?"<>|]/g,'_').trim()||'ysm-card';
    button.textContent=tr('正在保存…');
    if(await savePng(blob,`${safeName}.png`))toast(tr('封面已保存（PNG）'));
  }catch(error){console.error('Could not export model card:',error);toast(tr('保存失败：{0}', error.message));}
  finally{button.disabled=!viewer?.root;syncCardPlaybackUi();}
};
// ---- Animated card export (viewer only; library covers stay static PNG) ----
// Records the card from 0 s for one clip loop (MP4 can repeat it) at a
// multiple of the sidebar card's 300 px width, 7:12 like the in-game card.
const CARD_EXPORT_BASE_WIDTH=300,CARD_EXPORT_SCALES=[1,2,3,4],CARD_EXPORT_MAX_LOOPS=100;
const cardExportLoops=value=>Math.min(CARD_EXPORT_MAX_LOOPS,Math.max(1,Math.round(Number(value))||1));
const CARD_EXPORT_HINTS={gif:tr('兼容性最好，可直接发到聊天软件；最多 256 色，透明背景的半透明边缘会变成硬边。'),apng:tr('无损画质并保留透明背景；文件较大，部分软件只显示第一帧。'),mp4:tr('文件最小，适合上传视频平台；不支持透明，透明部分用封面底色填充。')};
const cardExportDialog=document.querySelector('#card-export-dialog');let cardExportAbort=null;
function cardExportOptions(){
  const saved=appSettings.cardExport||{},format=CARD_EXPORT_FORMATS[saved.format]?saved.format:'gif',rates=CARD_EXPORT_FORMATS[format].fps;
  const fps=rates.includes(saved.fps?.[format])?saved.fps[format]:rates[0];
  return {format,scale:CARD_EXPORT_SCALES.includes(saved.scale)?saved.scale:2,fps,loops:format==='mp4'?cardExportLoops(saved.loops):1};
}
// Even sizes keep H.264 happy; the preview area is the top 7/9 (4:3 of width).
function cardExportSize(scale){
  const width=CARD_EXPORT_BASE_WIDTH*scale,cardHeight=Math.round(width*12/7/2)*2;
  return {width,height:Math.round(width*4/3),cardHeight};
}
function renderSegmented(container,name,options,value){
  container.replaceChildren(...options.map(option=>{
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='radio';input.name=name;input.value=String(option.value);input.checked=option.value===value;
    label.append(input);label.insertAdjacentHTML('beforeend',`${icon('check')}<span>${option.label}</span>`);return label;
  }));
}
function syncCardExportDialog(){
  const options=cardExportOptions(),duration=cardDuration(),size=cardExportSize(options.scale);
  renderSegmented(document.querySelector('#card-export-format'),'card-export-format',Object.entries(CARD_EXPORT_FORMATS).map(([value,format])=>({value,label:format.label})),options.format);
  renderSegmented(document.querySelector('#card-export-scale'),'card-export-scale',CARD_EXPORT_SCALES.map(value=>({value,label:`${value}×`})),options.scale);
  renderSegmented(document.querySelector('#card-export-fps'),'card-export-fps',CARD_EXPORT_FORMATS[options.format].fps.map(value=>({value,label:`${value} fps`})),options.fps);
  const loops=document.querySelector('#card-export-loops');loops.value=String(options.loops);syncRangeFill(loops);
  document.querySelector('#card-export-format-hint').textContent=CARD_EXPORT_HINTS[options.format];
  document.querySelector('#card-export-scale-hint').textContent=tr('{0} × {1} 像素', size.width, size.cardHeight);
  document.querySelector('#card-export-fps-hint').textContent=options.format==='gif'?tr('GIF 帧间隔以 1/100 秒计，因此只提供 25 / 50 fps。'):'';
  document.querySelector('#card-export-loops-field').hidden=options.format!=='mp4';
  syncCardExportLoops(options.loops);
  document.querySelector('#card-export-summary').textContent=tr('从第 0 秒开始录制封面动画{0}。录制期间侧栏封面会暂停。', options.format==='mp4'?'':tr('一遍（{0} 秒），播放时无限循环', duration.toFixed(2)));
}
// Live label while dragging the MP4 play-count slider: length and a size
// estimate from the encoder's target bitrate.
function syncCardExportLoops(loops){
  const options=cardExportOptions(),{width,cardHeight}=cardExportSize(options.scale),seconds=cardDuration()*loops;
  const megabytes=mp4Bitrate(width,cardHeight,options.fps)*seconds/8/1048576,length=seconds>=60?tr('{0} 分 {1} 秒', Math.floor(seconds/60), Math.round(seconds%60)):tr('{0} 秒', seconds.toFixed(2));
  document.querySelector('#card-export-loops-value').value=tr('{0} 次', loops);
  document.querySelector('#card-export-loops-hint').textContent=tr('共 {0}，约 {1} MB。视频不会自动循环，可以多录几遍。', length, megabytes<10?megabytes.toFixed(1):Math.round(megabytes));
}
document.querySelector('#card-export-loops').addEventListener('input',event=>syncCardExportLoops(cardExportLoops(event.target.value)));
cardExportDialog.addEventListener('change',event=>{
  const input=event.target;if(input.type!=='radio'&&input.id!=='card-export-loops')return;
  const options=cardExportOptions(),next={format:options.format,scale:options.scale,fps:{...(appSettings.cardExport?.fps||{})},loops:cardExportLoops(appSettings.cardExport?.loops)};
  if(input.name==='card-export-format')next.format=input.value;
  else if(input.name==='card-export-scale')next.scale=Number(input.value);
  else if(input.name==='card-export-fps')next.fps[options.format]=Number(input.value);
  else if(input.id==='card-export-loops')next.loops=cardExportLoops(input.value);
  appSettings.cardExport=next;saveAppSettings();syncCardExportDialog();
});
function setCardExportBusy(busy){
  cardExportDialog.querySelectorAll('fieldset').forEach(field=>{field.disabled=busy;});
  document.querySelector('#card-export-start').disabled=busy;
  document.querySelector('#card-export-progress').hidden=!busy;
  if(busy)setCardExportProgress(0,tr('正在准备…'));
}
function setCardExportProgress(fraction,text){
  const bar=cardExportDialog.querySelector('.md-linear-progress');
  bar.style.setProperty('--progress',`${Math.round(fraction*1000)/10}%`);bar.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
  document.querySelector('#card-export-progress-text').textContent=text;
}
document.querySelector('#export-card-button').addEventListener('click',()=>{
  if(!viewer?.root)return;
  syncCardExportDialog();setCardExportBusy(false);cardExportDialog.showModal();
});
document.querySelector('#card-export-cancel').addEventListener('click',()=>{if(cardExportAbort)cardExportAbort.abort();else cardExportDialog.close();});
// Esc while recording cancels the recording instead of closing the dialog.
cardExportDialog.addEventListener('cancel',event=>{if(cardExportAbort){event.preventDefault();cardExportAbort.abort();}});
cardExportDialog.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  const instance=viewer;if(!instance?.root||cardExportAbort)return;
  const options=cardExportOptions(),format=CARD_EXPORT_FORMATS[options.format],{width,height,cardHeight}=cardExportSize(options.scale);
  const duration=cardDuration(),frameCount=Math.max(1,Math.round(duration*options.fps))*options.loops;
  const abort=new AbortController();cardExportAbort=abort;setCardExportBusy(true);
  let encoder=null;
  try{
    encoder=await createCardEncoder(options.format,{width,height:cardHeight,fps:options.fps,frameCount,matte:'#1b171d'});
    await instance.renderCardAnimation({width,height,fullCardHeight:cardHeight,title:activeModelName,fps:options.fps,duration,frameCount,signal:abort.signal,
      onFrame:canvas=>encoder.addFrame(canvas),
      onProgress:(done,total)=>setCardExportProgress(done/total*0.95,tr('正在录制 {0} / {1} 帧', done, total))});
    setCardExportProgress(0.97,tr('正在写出文件…'));
    const blob=await encoder.finish();encoder=null;
    abort.signal.throwIfAborted();
    cardExportAbort=null;cardExportDialog.close();
    const safeName=wheelText(activeModelName).replace(/[\\/:*?"<>|]/g,'_').trim()||'ysm-card';
    if(await saveFile(blob,`${safeName}.${format.extension}`,format.filter))toast(tr('动态封面已保存（{0}，{1} MB）', format.label, (blob.size/1048576).toFixed(1)));
  }catch(error){
    // The dialog stays open on failure so a smaller size or another format can be tried.
    if(abort.signal.aborted)toast(tr('已取消导出'));
    else{console.error('Could not export animated card:',error);toast(tr('导出失败：{0}', error.message));}
  }finally{encoder?.close();cardExportAbort=null;setCardExportBusy(false);}
});
function startCardPreview(instance){
  const cover=document.querySelector('.cover');
  // Hidden sidebar: no card renderer at all (setting "显示左侧封面").
  if(appSettings.showCover!==true){instance.stopCardPreview();cover.hidden=true;return;}
  const started=instance.startCardPreview(cover,{duration:cardDuration(),warmUp:cardWarmUpSeconds(),onTime:time=>{if(!cardPlaybackPaused){cardFrameTime=time;updateCardFrameSliderLive();}}});
  cover.hidden=!started;
  if(started){instance.setCardPlaying(!cardPlaybackPaused);if(cardFrameTime)instance.seekCard(cardFrameTime);syncCardInteraction();}
}
// The sidebar card behaves like the in-game model button: hovering plays the
// model's `hover` clip, and clicking (or Enter/Space) selects it, which gives
// it focus (`focus` clip) and switches the player to the model again, so the
// sounds the model plays when it is picked are heard (replayModelSelection).
const coverCard=document.querySelector('.cover-card');
coverCard.tabIndex=0;coverCard.title=tr('点击选中封面（与游戏中选择模型相同）');
function syncCardInteraction(){viewer?.setCardInteraction({hovered:coverCard.matches(':hover'),focused:coverCard.contains(document.activeElement)});}
let coverFocusedBeforePress=false;
coverCard.addEventListener('pointerenter',()=>viewer?.setCardInteraction({hovered:true}));
coverCard.addEventListener('pointerleave',()=>viewer?.setCardInteraction({hovered:false}));
coverCard.addEventListener('focusin',()=>viewer?.setCardInteraction({focused:true}));
coverCard.addEventListener('focusout',event=>{if(!coverCard.contains(event.relatedTarget))viewer?.setCardInteraction({focused:false});});
coverCard.addEventListener('pointerdown',()=>{coverFocusedBeforePress=coverCard.contains(document.activeElement);});
// Picking the model that is already selected changes nothing in the game.
coverCard.addEventListener('click',event=>{if(event.target.closest('button'))return;if(!coverFocusedBeforePress)viewer?.replayModelSelection();coverFocusedBeforePress=true;});
coverCard.addEventListener('keydown',event=>{if(event.target!==coverCard||(event.key!=='Enter'&&event.key!==' '))return;event.preventDefault();viewer?.replayModelSelection();});
const texturePicker=document.querySelector('#texture-picker'),textureTrigger=document.querySelector('#texture-picker-trigger'),textureCurrent=document.querySelector('#texture-current'),textureOptions=document.querySelector('#texture-picker-options');
function refreshTexturePicker(instance){
  const entries=instance?.textureVariants||[];textureOptions.replaceChildren();
  for(const entry of entries){const option=document.createElement('button');option.type='button';option.className='texture-picker-option';option.id=`texture-option-${entries.indexOf(entry)}`;option.dataset.textureId=entry.id;option.setAttribute('role','option');option.setAttribute('aria-selected',String(entry.id===instance.currentTextureId));option.textContent=entry.label;option.onclick=()=>{viewer?.setTexture(entry.id);syncDynamicColor();textureCurrent.textContent=entry.label;textureTrigger.title=tr('材质：{0}', entry.label);textureTrigger.setAttribute('aria-activedescendant',option.id);closeTexturePicker();refreshTexturePicker(viewer);};textureOptions.append(option);}
  texturePicker.hidden=entries.length<2;
  const selected=entries.find(entry=>entry.id===instance?.currentTextureId)||entries[0];if(selected){textureCurrent.textContent=selected.label;textureTrigger.title=tr('材质：{0}', selected.label);textureTrigger.setAttribute('aria-activedescendant',`texture-option-${entries.indexOf(selected)}`);}
}
let textureCloseTimer;
function closeTexturePicker(){textureTrigger.setAttribute('aria-expanded','false');if(textureOptions.hidden)return;textureOptions.classList.add('is-closing');clearTimeout(textureCloseTimer);textureCloseTimer=setTimeout(()=>{textureOptions.hidden=true;textureOptions.classList.remove('is-closing');},150);}
textureTrigger.onclick=()=>{const open=textureOptions.hidden;clearTimeout(textureCloseTimer);textureOptions.classList.remove('is-closing');textureOptions.hidden=!open;textureTrigger.setAttribute('aria-expanded',String(open));if(open)textureOptions.querySelector('[aria-selected="true"]')?.focus();};
document.addEventListener('pointerdown',event=>{if(!texturePicker.contains(event.target))closeTexturePicker();});
texturePicker.addEventListener('keydown',event=>{if(event.key==='Escape'){closeTexturePicker();textureTrigger.focus();return;}if(event.key==='ArrowDown'&&textureOptions.hidden){event.preventDefault();textureTrigger.click();}});
// Items held by the main view's player (hand-items.js); kept across model loads.
const handItems={mainhand:null,offhand:null},HAND_NAMES={mainhand:tr('主手'),offhand:tr('副手')};
const handItemPicker=document.querySelector('#hand-item-picker'),handItemButton=document.querySelector('#hand-item-button'),handItemMenuElement=document.querySelector('#hand-item-menu'),handItemOptions=document.querySelector('#hand-item-options');
let handItemHand='mainhand',handItemCloseTimer;
function syncHandItemButton(){
  const held=HANDS.filter(hand=>handItems[hand]);
  handItemButton.classList.toggle('active',held.length>0);
  const title=held.length?tr('手持物品：{0}', held.map(hand=>`${HAND_NAMES[hand]} ${handItems[hand].label}`).join(' · ')):tr('手持物品');
  handItemButton.title=title;handItemButton.setAttribute('aria-label',title);
}
function renderHandItemMenu(){
  const hand=handItemHand,other=hand==='mainhand'?'offhand':'mainhand';
  const menu=handItemMenu(viewer?.animations||{},hand,undefined,handItems[other]);
  const current=handItems[hand]?.key??'';
  const option=entry=>`<button type="button" class="hand-item-option" role="menuitemradio" aria-checked="${entry.key===current}" data-hand-item="${wheelEscape(entry.key)}"><span class="hand-item-text"><span>${wheelEscape(entry.label)}</span>${entry.clip?`<small>${wheelEscape(entry.clip)}</small>`:''}</span></button>`;
  const group=(title,entries)=>entries.length?`<div class="hand-item-subheader" role="presentation">${title}</div>${entries.map(option).join('')}`:'';
  handItemOptions.innerHTML=option(menu.empty)+(menu.matching.length?'':`<p class="hand-item-note">${viewer?.root?tr('该模型没有此手的手持动画，选择物品仍会影响 ysm.has_{0} 等查询', hand):tr('导入模型后可查看会触发手持动画的物品')}</p>`)+group(tr('触发该模型的手持动画'),menu.matching)+group(tr('其他物品'),menu.others);
  const entries=new Map([menu.empty,...menu.matching,...menu.others].map(entry=>[entry.key,entry]));
  handItemOptions.querySelectorAll('[data-hand-item]').forEach(button=>button.onclick=()=>{
    const entry=entries.get(button.dataset.handItem);setHeldItem(hand,entry?.item||null);
    handItemOptions.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
    toast(`${HAND_NAMES[hand]}：${entry?.label||tr('空手')}${entry?.clip?tr(' · 播放 {0}', entry.clip):''}`);
  });
}
// Puts an item in a hand of the main view's player and refreshes every picker.
function setHeldItem(hand,item){
  handItems[hand]=item||null;viewer?.setHandItem(hand,handItems[hand]);syncHandItemButton();syncMainStateButtons();
  if(!handItemMenuElement.hidden)renderHandItemMenu();
  if(playItemPanelOpen)renderPlayItemPanel();
}
function closeHandItemMenu(){handItemButton.setAttribute('aria-expanded','false');if(handItemMenuElement.hidden)return;handItemMenuElement.classList.add('is-closing');clearTimeout(handItemCloseTimer);handItemCloseTimer=setTimeout(()=>{handItemMenuElement.hidden=true;handItemMenuElement.classList.remove('is-closing');},150);}
handItemButton.onclick=()=>{
  const open=handItemMenuElement.hidden;clearTimeout(handItemCloseTimer);handItemMenuElement.classList.remove('is-closing');
  if(open)renderHandItemMenu();
  handItemMenuElement.hidden=!open;handItemButton.setAttribute('aria-expanded',String(open));
  // Keep the list inside the 3D view, which clips anything below it.
  if(open){const viewport=document.querySelector('#viewport').getBoundingClientRect(),top=handItemOptions.getBoundingClientRect().top;handItemOptions.style.maxHeight=`${Math.max(144,Math.min(360,viewport.bottom-top-16))}px`;}
  if(open)handItemOptions.querySelector('[aria-checked="true"]')?.focus();
};
handItemMenuElement.querySelectorAll('input[name="hand-item-hand"]').forEach(input=>input.onchange=()=>{handItemHand=input.value;renderHandItemMenu();});
document.addEventListener('pointerdown',event=>{if(!handItemPicker.contains(event.target))closeHandItemMenu();});
handItemPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){closeHandItemMenu();handItemButton.focus();}});
// 光照调节 panel: a non-modal popover; the view stays draggable while it is open.
const lightPicker=document.querySelector('#light-picker'),lightButton=document.querySelector('#light-button'),lightPanel=document.querySelector('#light-panel');
const LIGHT_FORMAT={azimuth:value=>`${value}°`,elevation:value=>`${value}°`,intensity:value=>value.toFixed(1),ambient:value=>value.toFixed(1),exposure:value=>`${value.toFixed(2)}×`,bloomStrength:value=>value.toFixed(2),bloomRadius:value=>value.toFixed(2),bloomThreshold:value=>value.toFixed(2)};
let lightCloseTimer;
function lighting(){return normalizeLighting(appSettings.lighting);}
function syncLightPanel(){
  const current=lighting();
  for(const [key,limits] of Object.entries(LIGHTING_LIMITS)){
    const input=document.querySelector(`#light-${key}`);Object.assign(input,{min:limits.min,max:limits.max,step:limits.step});input.value=String(current[key]);syncRangeFill(input);
    document.querySelector(`#light-${key}-value`).value=LIGHT_FORMAT[key](current[key]);
  }
  document.querySelector('#light-color').value=current.color;document.querySelector('#light-marker').setAttribute('aria-pressed',String(current.marker));document.querySelector('#light-filmic').checked=current.filmic;
  document.querySelector('#light-bloom').checked=current.bloom;document.querySelector('#light-bloom-glow').checked=current.bloomGlowOnly;
  // 阈值 only matters when every highlight blooms.
  lightPanel.querySelectorAll('[data-bloom-option]').forEach(row=>row.hidden=!current.bloom||(row.hasAttribute('data-bloom-highlight')&&current.bloomGlowOnly));
}
function updateLighting(changes,save=true){appSettings.lighting={...lighting(),...changes};if(save)saveAppSettings();viewer?.setLighting(lighting());syncLightPanel();}
function closeLightPanel(){lightButton.setAttribute('aria-expanded','false');if(lightPanel.hidden)return;lightPanel.classList.add('is-closing');clearTimeout(lightCloseTimer);lightCloseTimer=setTimeout(()=>{lightPanel.hidden=true;lightPanel.classList.remove('is-closing');},150);}
lightButton.onclick=()=>{
  const open=lightPanel.hidden;clearTimeout(lightCloseTimer);lightPanel.classList.remove('is-closing');
  if(open)closeStatusPanel();
  if(open)syncLightPanel();
  lightPanel.hidden=!open;lightButton.setAttribute('aria-expanded',String(open));
};
lightPanel.querySelectorAll('[data-light]').forEach(input=>{
  input.addEventListener('input',()=>updateLighting({[input.dataset.light]:Number(input.value)},false));
  input.addEventListener('change',saveAppSettings);
});
document.querySelector('#light-color').addEventListener('input',event=>updateLighting({color:event.target.value},false));
document.querySelector('#light-color').addEventListener('change',saveAppSettings);
document.querySelector('#light-marker').addEventListener('click',()=>updateLighting({marker:!lighting().marker}));
document.querySelector('#light-filmic').addEventListener('change',event=>updateLighting({filmic:event.target.checked}));
document.querySelector('#light-bloom').addEventListener('change',event=>updateLighting({bloom:event.target.checked}));
document.querySelector('#light-bloom-glow').addEventListener('change',event=>updateLighting({bloomGlowOnly:event.target.checked}));
document.querySelector('#light-reset').onclick=()=>updateLighting({...DEFAULT_LIGHTING,marker:lighting().marker});
// Dragging the 3D view keeps the panel open, so the marker can be seen from any side.
document.addEventListener('pointerdown',event=>{if(!lightPicker.contains(event.target)&&!lightPanel.contains(event.target)&&event.target!==document.querySelector('#scene'))closeLightPanel();});
lightPanel.addEventListener('keydown',event=>{if(event.key==='Escape'){closeLightPanel();lightButton.focus();}});
// 角色状态 panel (player-status.js): health, hunger, armor, effects, weather
// and biome of the main view's player. Kept across models, like held items.
const statusPicker=document.querySelector('#status-picker'),statusButton=document.querySelector('#status-button'),statusPanel=document.querySelector('#status-panel');
let playerStatus=normalizeStatus(DEFAULT_STATUS),statusCloseTimer;
const EFFECT_LEVELS=[tr('关'),'I','II','III','IV','V'];
function setPlayerStatus(status){
  playerStatus=normalizeStatus(status);viewer?.setPlayerStatus(playerStatus);
  const changed=!isDefaultStatus(playerStatus);statusButton.classList.toggle('active',changed);
  const title=changed?tr('角色状态（已修改）'):tr('角色状态');statusButton.title=title;statusButton.setAttribute('aria-label',title);
}
function statusRange(key,label,value,{min,max},used=false){return `<label class="light-row${used?' is-used':''}" for="status-${key}"><span>${label}</span><output id="status-${key}-value" for="status-${key}">${value}</output><input id="status-${key}" class="md-range" type="range" min="${min}" max="${max}" step="1" value="${value}" data-status="${key}"></label>`;}
// Effects the model doesn't test stay folded under 显示全部 until opened.
let statusShowAllEffects=false;
const STATUS_USED=`<small class="status-used">${tr('模型使用')}</small>`;
function renderStatusPanel(){
  const status=playerStatus,used=statusUsedBy(modelScripts()),usedEffects=used.effects,mark=flag=>flag?' is-used':'';
  // Effects the model's scripts test come first and are marked; the rest
  // (unless switched on) fold away.
  const effectRank=effect=>usedEffects.includes(effect.id)?usedEffects.indexOf(effect.id):EFFECTS.length+EFFECTS.indexOf(effect);
  const effects=[...EFFECTS].sort((a,b)=>effectRank(a)-effectRank(b)),shown=effects.filter(({id})=>usedEffects.includes(id)||status.effects[id]),folded=effects.filter(effect=>!shown.includes(effect));
  const effectRow=({id,label})=>{const level=status.effects[id]||0;return `<div class="status-effect" data-effect="${id}"><span>${label}${usedEffects.includes(id)?`<small>${tr('模型使用')}</small>`:''}</span><button class="icon-button" type="button" data-effect-step="-1" aria-label="${tr('降低{0}等级', label)}" ${level?'':'disabled'}>${materialIcon('remove')}</button><output aria-label="${tr('{0}等级', label)}">${EFFECT_LEVELS[level]}</output><button class="icon-button" type="button" data-effect-step="1" aria-label="${tr('提高{0}等级', label)}" ${level>=STATUS_LIMITS.effectLevel.max?'disabled':''}>${materialIcon('add')}</button></div>`;};
  const usedBiome=biome=>used.biomes.includes(biome.id),biomeGroups=[...BIOME_GROUPS].sort(([a],[b])=>Number(BIOMES.some(biome=>biome.group===b&&usedBiome(biome)))-Number(BIOMES.some(biome=>biome.group===a&&usedBiome(biome))));
  const sections=[
    {title:tr('生命'),used:used.health||used.food,html:`${statusRange('health',tr('生命值'),status.health,{min:0,max:status.maxHealth},used.health)}
    ${statusRange('maxHealth',tr('最大生命值'),status.maxHealth,STATUS_LIMITS.maxHealth,used.health)}
    ${statusRange('food',tr('饥饿值'),status.food,STATUS_LIMITS.food,used.food)}`},
    {title:tr('盔甲'),used:used.armor.length>0||used.armorValue,html:`<div class="md-segmented status-armor" role="group" aria-label="${tr('穿戴的盔甲')}">${ARMOR_SLOTS.map(([slot,label])=>`<label class="${mark(used.armor.includes(slot))}"><input type="checkbox" data-armor="${slot}" ${status.armor[slot]?'checked':''}><span>${label}</span></label>`).join('')}</div>
    ${statusRange('armorValue',tr('护甲值'),status.armorValue,STATUS_LIMITS.armorValue,used.armorValue)}`},
    {title:tr('药水效果'),used:usedEffects.length>0,html:`${shown.length?`<div class="status-effects">${shown.map(effectRow).join('')}</div>`:''}<details class="status-more"${statusShowAllEffects?' open':''}><summary>${materialIcon('expand_more')}<span>${tr('显示全部')}</span><small>${folded.length}</small></summary><div class="status-effects">${folded.map(effectRow).join('')}</div></details>`},
    {title:tr('天气'),used:used.weather||used.openAir,html:`<div class="md-segmented status-weather" role="radiogroup" aria-label="${tr('天气')}">${WEATHERS.map(([id,label])=>`<label><input type="radio" name="status-weather" value="${id}" ${status.weather===id?'checked':''}>${materialIcon('check')}<span>${label}</span></label>`).join('')}</div>
    <label class="light-row light-switch-row${mark(used.openAir)}"><span>${tr('露天')}</span><span class="md-switch"><input type="checkbox" role="switch" id="status-open-air" aria-label="${tr('露天')}" ${status.openAir?'checked':''}><span class="md-switch-track"><span class="md-switch-handle"></span></span></span></label>`},
    {title:tr('群系'),used:used.biome,html:`<div class="status-biomes" role="radiogroup" aria-label="${tr('群系')}">${biomeGroups.map(([group,title])=>`<div class="status-biome-group"><span>${title}</span><div>${BIOMES.filter(biome=>biome.group===group).sort((a,b)=>Number(usedBiome(b))-Number(usedBiome(a))).map(biome=>`<label class="status-chip${mark(usedBiome(biome))}"${usedBiome(biome)?` title="${tr('模型检测的群系')}"`:''}><input type="radio" name="status-biome" value="${biome.id}" ${status.biome===biome.id?'checked':''}><span>${biome.label}</span></label>`).join('')}</div></div>`).join('')}</div>`},
  ];
  // Sections the model reads move to the top (in their usual order).
  const ordered=[...sections.filter(section=>section.used),...sections.filter(section=>!section.used)],usedTitles=ordered.filter(section=>section.used).map(section=>section.title);
  const summary=!viewer?.root?'':usedTitles.length?tr('模型脚本读取：{0}。带圆点的选项会改变模型的显示。', usedTitles.join('、')):tr('当前模型的脚本没有读取这些状态，调整后外观不会变化。');
  statusPanel.innerHTML=`<header><strong>${tr('角色状态')}</strong><button class="md-button text" id="status-reset" type="button">${tr('恢复默认')}</button></header>
    ${summary?`<p class="status-summary">${summary}</p>`:''}
    ${ordered.map(section=>`<div class="light-subheader">${section.title}${section.used?STATUS_USED:''}</div>
    ${section.html}`).join('')}
    <p class="light-note">${tr('只改变“预览 3D”中模型脚本读到的状态（q.health、ysm.food_level、ysm.has_helmet、ysm.effect_level、ysm.weather、q.biome_has_any_tag 等），封面保持默认状态。')}</p>`;
  statusPanel.querySelectorAll('.md-range').forEach(syncRangeFill);
  statusPanel.querySelector('.status-more').addEventListener('toggle',event=>{statusShowAllEffects=event.target.open;});
}
function closeStatusPanel(){statusButton.setAttribute('aria-expanded','false');if(statusPanel.hidden)return;statusPanel.classList.add('is-closing');clearTimeout(statusCloseTimer);statusCloseTimer=setTimeout(()=>{statusPanel.hidden=true;statusPanel.classList.remove('is-closing');},150);}
statusButton.onclick=()=>{
  const open=statusPanel.hidden;clearTimeout(statusCloseTimer);statusPanel.classList.remove('is-closing');
  if(open){closeLightPanel();renderStatusPanel();}
  statusPanel.hidden=!open;statusButton.setAttribute('aria-expanded',String(open));
};
statusPanel.addEventListener('input',event=>{
  const key=event.target.dataset.status;if(!key)return;
  const value=Number(event.target.value);syncRangeFill(event.target);statusPanel.querySelector(`#status-${key}-value`).value=String(value);
  const next={...playerStatus,[key]:value};
  // The health slider ends at the maximum health.
  if(key==='maxHealth'){const health=statusPanel.querySelector('#status-health');health.max=String(value);next.health=Math.min(playerStatus.health,value);health.value=String(next.health);syncRangeFill(health);statusPanel.querySelector('#status-health-value').value=String(next.health);}
  setPlayerStatus(next);
});
statusPanel.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.armor)setPlayerStatus({...playerStatus,armor:{...playerStatus.armor,[target.dataset.armor]:target.checked}});
  else if(target.name==='status-weather')setPlayerStatus({...playerStatus,weather:Number(target.value)});
  else if(target.id==='status-open-air')setPlayerStatus({...playerStatus,openAir:target.checked});
  else if(target.name==='status-biome')setPlayerStatus({...playerStatus,biome:target.value});
});
statusPanel.addEventListener('click',event=>{
  if(event.target.closest('#status-reset')){setPlayerStatus(DEFAULT_STATUS);renderStatusPanel();return;}
  const step=event.target.closest('[data-effect-step]');if(!step)return;
  const row=step.closest('[data-effect]'),id=row.dataset.effect,level=Math.min(STATUS_LIMITS.effectLevel.max,Math.max(0,(playerStatus.effects[id]||0)+Number(step.dataset.effectStep)));
  setPlayerStatus({...playerStatus,effects:{...playerStatus.effects,[id]:level}});
  row.querySelector('output').value=EFFECT_LEVELS[level];
  const [down,up]=row.querySelectorAll('button');down.disabled=!level;up.disabled=level>=STATUS_LIMITS.effectLevel.max;
  if(step.disabled)(level?down:up).focus();
});
document.addEventListener('pointerdown',event=>{if(!statusPicker.contains(event.target)&&!statusPanel.contains(event.target)&&event.target!==document.querySelector('#scene'))closeStatusPanel();});
statusPanel.addEventListener('keydown',event=>{if(event.key==='Escape'){closeStatusPanel();statusButton.focus();}});
statusPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){closeStatusPanel();statusButton.focus();}});
lightPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){closeLightPanel();lightButton.focus();}});
function ensureViewer() {
  if(!viewerPromise) viewerPromise=import('./viewer.js').then(({ ModelViewer })=>new ModelViewer(document.querySelector('#scene'),document.querySelector('#viewport'),updateTimeLive));
  return viewerPromise;
}
function toast(message) {
  const el=document.querySelector('#toast');clearTimeout(toastTimer);clearTimeout(toastExitTimer);
  el.textContent=message;el.hidden=false;el.classList.remove('is-visible');
  requestAnimationFrame(()=>el.classList.add('is-visible'));
  toastTimer=setTimeout(()=>{el.classList.remove('is-visible');toastExitTimer=setTimeout(()=>{el.hidden=true;},260);},3200);
}
function setTheme(dark) { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; const b=document.querySelector('#theme-button'); b.innerHTML=icon(dark?'sun':'moon'); b.setAttribute('aria-label',dark?tr('切换到浅色模式'):tr('切换到深色模式')); writeConfig('theme',dark?'dark':'light'); viewer?.setTheme(dark);  }
setTheme(readConfig('theme') === 'dark');
document.querySelector('#theme-button').onclick=()=>setTheme(document.documentElement.dataset.theme!=='dark');
document.querySelector('meta[name=description]')?.setAttribute('content',tr('YSM模型工具：模型预览、模型库与游戏挂载'));
setupAboutEasterEgg(document.querySelector('#about-logo'),{toast,tr});
setupLanguageMenu({before:document.querySelector('#theme-button'),iconHtml:materialIcon('translate'),hasModel:()=>Boolean(viewer?.root),toast});
// Whole-app fullscreen (header button / F11, fullscreen.js): on the desktop the
// window is fixed while it lasts; only this button (or F11) leaves it, not Esc.
async function toggleAppFullscreen(){try{await setAppFullscreen();}catch{toast(tr('当前环境不支持全屏'));}}
document.querySelector('#app-fullscreen-button').onclick=toggleAppFullscreen;
if('__TAURI_INTERNALS__' in window)document.addEventListener('keydown',event=>{if(event.key==='F11'&&!event.repeat){event.preventDefault();toggleAppFullscreen();}});
document.querySelector('#card-playback-toggle').addEventListener('click',()=>{
  if(!viewer?.root)return;
  cardPlaybackPaused=!cardPlaybackPaused;syncCardPlaybackUi();viewer.setCardPlaying(!cardPlaybackPaused);
});
document.querySelector('#card-frame-time').addEventListener('input',event=>{
  cardFrameTime=Number(event.currentTarget.value);cardPlaybackPaused=true;updateCardFrameSlider();syncCardPlaybackUi();
  viewer?.setCardPlaying(false);viewer?.seekCard(cardFrameTime);
});
document.querySelector('#import-button').onclick=()=>document.querySelector('#model-folder').click();
// The import progress bar lives in the 3D view's loading overlay.
const importProgress=createImportProgress(document.querySelector('#loading-state'));
// Ends the progress bar; on failure the overlay goes back to the loaded model
// (or the empty state).
function endImportProgress(){
  if(!importProgress.active)return;
  importProgress.finish();
  const loading=document.querySelector('#loading-state');
  if(viewer?.root)loading.hidden=true;
  else{loading.hidden=false;loading.innerHTML=`<strong>${tr('未加载模型')}</strong><span>${tr('请导入模型文件夹、ZIP 压缩包或 YSM 模型')}</span>`;}
}
async function loadImportedModel(byPath,sourceName,packName='',sourceArchive=null){
  if(modelBusy)return;
  currentLibraryModel=null;
  libraryModelId=null;
  // Folders and library models start here; archives already started reading.
  if(!importProgress.active){importProgress.start('folder',packName);await selectTab('preview');}
  cardPlaybackPaused=false;cardFrameTime=0;clearTimeout(cardFrameTimer);
  resetCardDuration();
  let prepared;
  try{prepared=await prepareModelPackage(byPath);}catch(error){endImportProgress();throw error;}
  const {metadata,avatarFiles,textureEntries,files}=prepared;
  setModelBusy(true);
  try{
    await releaseViewer({keepColors:true});await selectTab('preview');
    const loading=document.querySelector('#loading-state');importProgress.refresh();
    viewer=await ensureViewer();viewer.handItems={...handItems};viewer.playerStatus=playerStatus;viewer.setLighting(lighting());viewer.setTheme(document.documentElement.dataset.theme==='dark');viewer.showGrid=appSettings.showGrid!==false;applyEnvironmentLight();applyBenchmark();viewer.setUncapped(appSettings.uncappedFrameRate===true);viewer.onMainFrame=()=>molangInspector?.sampleFrame();
    viewer.onAnimationEnd=()=>{const current=viewer.animationName,label=[['idle',tr('待机')],['walk',tr('走')],['run',tr('跑')],['jump',tr('跳')]].find(([key])=>findAnimation(key)===current)?.[1];if(label)showAnimation(current,label);else{const idle=findAnimation('idle');if(idle)activateAnimation(idle,tr('待机'));}syncActionWheelPlaying();};
    await viewer.loadFiles(files,{onProgress:(step,done,total)=>importProgress.step(step,done,total)});
    for(const [selector,url] of [['.cover-background',viewer.cardBackgroundUrl],['.cover-foreground',viewer.cardForegroundUrl]]){const layer=document.querySelector(selector);if(url){layer.src=url;layer.hidden=false;}else{layer.hidden=true;layer.removeAttribute('src');}}
    document.querySelector('.cover-card').classList.remove('is-empty');
    document.querySelector('#save-card-button').disabled=!viewer.root;document.querySelector('#export-card-button').disabled=!viewer.root;
    const previewDuration=Number(viewer.animations?.[viewer.previewAnimationName]?.animation_length)||DEFAULT_CARD_DURATION;
    resetCardDuration(previewDuration);
    document.querySelector('#card-playback-toggle').disabled=!viewer.root;syncCardPlaybackUi();
    refreshTexturePicker(viewer);renderHandItemMenu();syncMainStateButtons();if(!statusPanel.hidden)renderStatusPanel();renderModelMetadata(metadata,avatarFiles,true,packName);
    document.querySelector('#scene').hidden=false;
    viewer.setActive(!document.querySelector('#preview-panel').hidden);
    document.querySelector('#render-status').textContent=tr('已加载 · {0} 骨骼', viewer.skeleton?.index?.size||0);
    syncPlay();startCardPreview(viewer);syncDynamicColor();
    importProgress.step('build',1,1);importProgress.finish();loading.hidden=true;
    currentYsmArchive=sourceArchive;
    const restored=restoreModelConfig();
    if(restored)toast(tr('{0}导入成功 · 已恢复保存的配置（{1} 项）', sourceName, restored));
    else toast(previewDuration>MAX_CARD_DURATION?tr('{0}导入成功 · 封面动画时长异常，预览默认限制为 {1} 秒', sourceName, MAX_CARD_DURATION):tr('{0}导入成功', sourceName));
  }catch(error){await releaseViewer();throw error;}
  finally{endImportProgress();setModelBusy(false);}
}
document.querySelector('#model-folder').onchange=async event=>{
  try{const files=[...event.target.files],byPath=new Map(files.map(file=>[file.webkitRelativePath.split('/').slice(1).join('/').replaceAll('\\','/'),file]));await loadImportedModel(byPath,tr('模型文件夹'),files[0]?.webkitRelativePath.split('/')[0]||'');}
  catch(error){console.error(error);toast(tr('加载出错：{0}', error.message||tr('模型文件夹无效')));}finally{event.target.value='';}
};
document.querySelector('#zip-import-button').onclick=()=>document.querySelector('#model-zip').click();
// Reads a file in chunks so the progress bar can follow large archives.
async function readFileWithProgress(file,onProgress){
  if(!file.stream)return file.arrayBuffer();
  const reader=file.stream().getReader(),chunks=[];let loaded=0;
  for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.length;onProgress(loaded,file.size);}
  const bytes=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes.buffer;
}
// Unzipping and decrypting report no progress: estimated from the file size
// (measured: 22 MB of .ysm decrypts in about 12 s; unzipping is far faster).
// The creep reaches ~75% of the step at 1.5x the estimate.
const UNPACK_MS_PER_MB={ysm:350,zip:40};
async function importModelArchive(archive){
  if(modelBusy)return;
  const name=archive.name.replace(/\.(?:zip|ysm)$/i,'');
  importProgress.start(/\.ysm$/i.test(archive.name)?'ysm':'zip',name);setModelBusy(true);
  let byPath,kind;
  try{
    await selectTab('preview');
    const bytes=await readFileWithProgress(archive,(loaded,total)=>importProgress.step('read',loaded,total));
    kind=modelArchiveKind(bytes);
    // The extension guessed the plan; the header decides.
    if(kind&&kind!==(/\.ysm$/i.test(archive.name)?'ysm':'zip')){importProgress.start(kind,name);importProgress.step('read',1,1);}
    importProgress.creep('unpack',Math.max(500,archive.size/(1<<20)*(UNPACK_MS_PER_MB[kind]||100)));
    byPath=await readModelArchive(bytes,{rawGeometry:kind==='ysm'&&appSettings.renderMode==='raw'});
    importProgress.step('unpack',1,1);await nextPaint();
  }catch(error){endImportProgress();throw error;}
  finally{setModelBusy(false);}
  await loadImportedModel(byPath,kind==='zip'?tr('模型压缩包'):tr('加密 YSM 模型'),name,kind==='ysm'?archive:null);
}
document.querySelector('#model-zip').onchange=async event=>{
  const archive=event.target.files?.[0];if(!archive)return;
  try{await importModelArchive(archive);}catch(error){console.error(error);toast(tr('加载出错：{0}', error.message||tr('模型文件格式无效')));}finally{event.target.value='';}
};
function readDroppedEntry(entry,prefix=''){
  if(entry.isFile)return new Promise((resolve,reject)=>entry.file(file=>resolve([[`${prefix}${entry.name}`,file]]),reject));
  if(!entry.isDirectory)return Promise.resolve([]);
  const reader=entry.createReader();
  return (async()=>{const files=[];while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)files.push(...await readDroppedEntry(child,`${prefix}${entry.name}/`));}return files;})();
}
function droppedEntry(item){return item.getAsEntry?.()||item.webkitGetAsEntry?.()||null;}
// The model library handles drops itself while it is shown.
function hasDraggedFiles(event){return document.querySelector('#library-view').hidden&&[...(event.dataTransfer?.types||[])].includes('Files');}
window.addEventListener('dragenter',event=>{if(!hasDraggedFiles(event))return;event.preventDefault();dragDepth++;document.querySelector('#drop-overlay').hidden=false;});
window.addEventListener('dragover',event=>{if(!hasDraggedFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';});
window.addEventListener('dragleave',event=>{if(!hasDraggedFiles(event))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)document.querySelector('#drop-overlay').hidden=true;});
window.addEventListener('drop',async event=>{
  if(!hasDraggedFiles(event))return;event.preventDefault();dragDepth=0;document.querySelector('#drop-overlay').hidden=true;
  try{
    const entries=[...(event.dataTransfer.items||[])].map(droppedEntry).filter(Boolean);
    if(entries.length){
      if(entries.length!==1)throw new Error(tr('请一次拖入一个模型文件夹、ZIP 压缩包或 YSM 模型'));
      const entry=entries[0];
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));if(/\.(?:zip|ysm)$/i.test(file.name)){await importModelArchive(file);return;}throw new Error(tr('请拖入 ZIP、YSM 或模型文件夹'));}
      if(!entry.isDirectory)throw new Error(tr('不支持此拖入项目'));
      const byPath=new Map(await readDroppedEntry(entry));await loadImportedModel(byPath,tr('模型文件夹'),entry.name);return;
    }
    const files=[...(event.dataTransfer.files||[])];if(files.length===1&&/\.(?:zip|ysm)$/i.test(files[0].name)){await importModelArchive(files[0]);return;}
    throw new Error(tr('浏览器无法读取该拖入项目，请直接拖入文件夹、ZIP 或 YSM'));
  }catch(error){console.error(error);toast(tr('加载出错：{0}', error.message||tr('模型文件或文件夹无效')));}
});

const TAB_NAMES=['details','preview','settings'];
async function selectTab(name,focus=false) {
  for(const button of document.querySelectorAll('[data-tab]')) { const selected=button.dataset.tab===name; button.setAttribute('aria-selected',selected); button.tabIndex=selected?0:-1; if(selected&&focus)button.focus(); }
  syncTabIndicator();
  const activePanel=document.querySelector(`#${name}-panel`);
  for(const tab of TAB_NAMES)document.querySelector(`#${tab}-panel`).hidden=tab!==name;
  activePanel.classList.remove('tab-panel-enter');void activePanel.offsetWidth;activePanel.classList.add('tab-panel-enter');
  history.replaceState(null,'',`#${name}`);
  if(name!=='preview')exitPlayControl();
  if(viewer?.root&&!modelBusy)viewer.setActive(name==='preview');
}
function syncTabIndicator(){const selected=document.querySelector('.tabs [data-tab][aria-selected="true"]'),indicator=document.querySelector('.tab-indicator');if(!selected||!indicator)return;const inset=16;indicator.style.width=`${Math.max(24,selected.offsetWidth-inset*2)}px`;indicator.style.transform=`translateX(${selected.offsetLeft+inset}px)`;}
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=event=>{
    const rect=button.getBoundingClientRect(),diameter=Math.max(rect.width,rect.height)*1.5,ripple=document.createElement('span');
    const x=event.detail===0?rect.width/2:event.clientX-rect.left,y=event.detail===0?rect.height/2:event.clientY-rect.top;
    ripple.className='tab-ripple';ripple.style.width=ripple.style.height=`${diameter}px`;ripple.style.left=`${x-diameter/2}px`;ripple.style.top=`${y-diameter/2}px`;
    button.append(ripple);ripple.addEventListener('animationend',()=>ripple.remove(),{once:true});selectTab(button.dataset.tab);
  };
  button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=TAB_NAMES.indexOf(button.dataset.tab),next=e.key==='Home'?0:e.key==='End'?TAB_NAMES.length-1:(index+(e.key==='ArrowRight'?1:-1)+TAB_NAMES.length)%TAB_NAMES.length;selectTab(TAB_NAMES[next],true);}};
});
window.addEventListener('resize',syncTabIndicator);requestAnimationFrame(syncTabIndicator);
document.querySelector('.top-nav .current').onclick=e=>{e.preventDefault();selectTab('details');};
document.querySelector('#cover-preview').onclick=()=>selectTab('preview');


// A clip without animation_length runs on past the slider's range; the slider shows its place in it.
// The timeline row (.animation-panel) is hidden by style.css; it still
// follows every rendered frame of the main clip.
let timelineInput,timeCurrent,timeDuration;
function updateTime(time,duration) {
  timelineInput??=document.querySelector('#timeline');timeCurrent??=document.querySelector('#time-current');timeDuration??=document.querySelector('#time-duration');
  writeUi(timelineInput,'max',String(duration));writeUi(timelineInput,'value',String(time>duration&&duration>0?time%duration:time));
  writeUi(timeCurrent,'textContent',time.toFixed(2));writeUi(timeDuration,'textContent',`${duration.toFixed(2)} s`);
}
const updateTimeLive=(time,duration)=>{updateTime(time,duration);updateModelStatus();};
// 模型状态 panel (src/model-status.js, 第 60 节): fed once per rendered frame.
let modelStatus=null,modelStatusLabels=null;
// Wheel labels (with § colour codes) by clip name, rebuilt per model.
function wheelActionLabel(name){
  if(modelStatusLabels?.animations!==viewer.animations){
    const labels=new Map(),add=(id,label)=>{if(viewer.animations?.[id]&&!labels.has(id))labels.set(id,wheelText(label)?String(label):id);};
    for(const [id,label] of Object.entries(viewer.customAnimationSlots||{}))add(id,label);
    for(const group of viewer.customAnimationGroups||[])for(const [id,label] of Object.entries(group?.extra_animation||{}))add(id,label);
    modelStatusLabels={animations:viewer.animations,labels};
  }
  if(name===viewer.previewAnimationName&&!modelStatusLabels.labels.has(name))return tr('封面动画');
  return modelStatusLabels.labels.get(name)??name;
}
function updateModelStatus(){
  if(!modelStatus)return;
  if(appSettings.showModelStatus===false||!viewer?.root){modelStatus.update({visible:false});return;}
  const action=!!viewer.base,mainState=action?viewer.base.name:viewer.animationName;
  const label=action?wheelActionLabel(viewer.animationName):Object.hasOwn(MAIN_STATE_LABELS,mainState)?MAIN_STATE_LABELS[mainState]:String(mainState||tr('无动作'));
  modelStatus.update({visible:true,action,labelHtml:minecraftTextHtml(label),labelText:wheelText(label),sound:!!viewer.audio?.playing,play:!!viewer.play,movement:viewer.play?movementIndicator(mainState):null});
}
function needViewer() { if(modelBusy||!viewer?.root){toast(modelBusy?tr('模型正在处理，请稍候'):tr('请先导入模型'));return false;}return true; }
// AnimationRegister: the main slot plays each state's clip by its fixed name
// (idle/walk/run/jump) and never substitutes another clip. A missing clip plays
// nothing while ctrl.<state> still drives the controllers.
const MAIN_STATES=['idle','walk','run','jump'];
const findAnimation=kind=>MAIN_STATES.includes(kind)?kind:undefined;
// A movement state shows something only when the model has its clip (or the
// tac: clip that a held gun swaps in) or a controller/animation reads ctrl.<state>.
function mainStateAvailable(kind,scripts){
  const animations=viewer?.animations||{};
  return kind==='idle'||!!animations[kind]||!!(viewer?.handItems?.mainhand?.gun&&animations[`tac:${kind}`])||new RegExp(`\\bctrl\\.${kind}\\b`).test(scripts);
}
// Every script of the loaded model as one string (controller definitions keep their states in Maps).
function modelScripts(){return viewer?.root?JSON.stringify([viewer.controllerDefinitions,viewer.animations||{}],(key,value)=>value instanceof Map?[...value]:value):'';}
function syncMainStateButtons(){
  const scripts=modelScripts();
  for(const kind of ['walk','run','jump']){
    const hidden=!!viewer?.root&&!mainStateAvailable(kind,scripts);
    document.querySelector(`#pose-${kind}`).hidden=hidden;document.querySelector(`[data-animation="${kind}"]`).hidden=hidden;
  }
}
function activateAnimation(name,label,{once=false}={}){if(!name){toast(tr('当前模型没有{0}动画', label));return false;}viewer.setAnimation(name,{once});showAnimation(name,label);return true;}
// Updates the toolbar for the clip now on the timeline.
function showAnimation(name,label){document.querySelector('#animation-name').textContent=label;document.querySelectorAll('[data-animation]').forEach(button=>button.classList.toggle('selected',button.dataset.animation===name));document.querySelectorAll('#pose-walk,#pose-run,#pose-jump').forEach(button=>button.classList.toggle('active',button.id===`pose-${label===tr('走')?'walk':label===tr('跑')?'run':label===tr('跳')?'jump':''}`));syncPlay();}
let actionWheelPage=0,actionWheelPath=[],actionWheelSettings=null;
const WHEEL_PREVIEW_ANIMATION='__ysm_preview_card_animation__',WHEEL_RETURN='#return';
const wheelText=value=>minecraftTextRuns(value).map(run=>run.text).join('').trim();
const wheelEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function getWheelEntries(path=actionWheelPath){
  if(path.length){const group=viewer.customAnimationGroups.find(item=>String(item.id)===path.at(-1));return Object.entries(group?.extra_animation||{}).map(([id,label])=>({id,label:wheelText(label)?String(label):id}));}
  const entries=Object.entries(viewer?.customAnimationSlots||{}).map(([id,label])=>({id,label:wheelText(label)?String(label):id}));
  if(viewer?.previewAnimationName&&viewer.animations?.[viewer.previewAnimationName])entries.push({id:WHEEL_PREVIEW_ANIMATION,label:tr('封面动画')});
  return entries;
}
function getWheelGroup(id){const key=String(id).replace(/^#/,'');return viewer?.customAnimationGroups?.find(group=>String(group.id)===key);}
function getWheelForm(id){const key=String(id);return viewer?.customAnimationButtons?.find(button=>String(button.id)===key);}
// ModernAnimationRouletteScreen: a key starting with "#" opens that classify
// sub-wheel, a value starting with "#" adds a gear for that settings group, and
// any other click plays the clip named by the key. Labels and colour codes are
// never used to find clips, groups or forms.
function wheelEntryGroup(entry){return entry.id.startsWith('#')?getWheelGroup(entry.id):undefined;}
function wheelEntryForm(entry){const label=String(entry.label??'');return label.startsWith('#')?getWheelForm(label.slice(1)):undefined;}
// displayLabel: the value, a "#<form id>" value shows that group's name, and a
// blank value shows the key (getWheelEntries fills that in).
function wheelEntryStyledLabel(entry){
  const form=wheelEntryForm(entry);
  return form&&form.name!=null?String(form.name):String(entry.label??'');
}
// The clip a wheel entry plays, if any (mirrors the activate handler in renderActionWheel).
function wheelEntryAnimation(entry){
  if(entry.id===WHEEL_PREVIEW_ANIMATION)return viewer.previewAnimationName;
  return !entry.id.startsWith('#')&&viewer.animations?.[entry.id]?entry.id:'';
}
const hasKeys=value=>!!value&&typeof value==='object'&&Object.keys(value).length>0;
function classifyWheelEntry(entry){
  if(entry.id===WHEEL_RETURN)return 'return';
  if(entry.id.startsWith('#'))return 'folder';
  if(entry.id===WHEEL_PREVIEW_ANIMATION)return 'preview';
  const animation=viewer.animations?.[wheelEntryAnimation(entry)];
  if(animation)return animationHasSound(animation)&&!hasKeys(animation.bones)?'audio':'action';
  return wheelEntryForm(entry)?'settings':'missing';
}
// Sound keyframes, or a timeline script calling ysm.play_sound.
function animationHasSound(animation){return hasKeys(animation?.sound_effects)||/play_sound/.test(JSON.stringify(animation?.timeline||''));}
// Variables that lead a controller into a state that plays a sound. Wheel
// clips often only set one (苏瑞铃: 萝莉镇魂曲 sets v.loli=1, pre_parallel_0
// then enters the 萝莉镇魂曲 state whose 萝莉镇魂曲bgm clip has the sound).
let soundTriggerCache=null;
function soundTriggerVariables(){
  const controllers=viewer?.controllerRuntime?.controllers;
  if(soundTriggerCache?.controllers===controllers)return soundTriggerCache.names;
  const names=new Set();
  for(const controller of controllers?.values?.()||[])for(const state of controller.states.values())for(const transition of state.transitions){
    const target=controller.states.get(transition.target);
    if(!target||!(target.sound_effects.length||target.animations.some(clip=>animationHasSound(viewer.animations?.[clip.name]))))continue;
    for(const match of transition.condition.matchAll(/\b(?:v|variable)\.([a-z_]\w*)/gi))names.add(match[1].toLowerCase());
  }
  soundTriggerCache={controllers,names};return names;
}
// A wheel clip plays a sound itself or sets a variable that starts one.
function wheelAnimationHasSound(animation){
  if(!animation)return false;if(animationHasSound(animation))return true;
  const names=soundTriggerVariables();if(!names.size)return false;
  for(const match of JSON.stringify(animation.timeline||'').matchAll(/\b(?:v|variable)\.([a-z_]\w*)\s*=(?!=)/gi))if(names.has(match[1].toLowerCase()))return true;
  return false;
}
const formFieldDetail=field=>{
  if(field.type==='range')return `${field.min??0} ~ ${field.max??1}${field.step!=null?tr('（步长 {0}）', field.step):''}`;
  if(field.type==='radio')return Object.keys(field.labels||{}).join(' / ');
  return wheelText(field.description)?String(field.description):'';
};
// The whole wheel as a tree for the overview image: each category's pages
// keyed by group id (root is ''), and the settings panels sectors open.
function collectWheelTree(){
  const wheels=new Map(),forms=new Map(),queue=[[]];
  while(queue.length){
    const path=queue.shift(),key=path.at(-1)??'',entries=getWheelEntries(path),pageCount=Math.max(1,Math.ceil(entries.length/8));
    const labels=[tr('根目录'),...path.map(id=>{const group=getWheelGroup(id);return group?.name||id;})];
    const pages=Array.from({length:pageCount},(_,page)=>({page:page+1,pageCount,entries:entries.slice(page*8,page*8+8).map(entry=>{
      const styled=wheelEntryStyledLabel(entry),group=wheelEntryGroup(entry),form=wheelEntryForm(entry),kind=classifyWheelEntry(entry);
      if(form&&!forms.has(String(form.id)))forms.set(String(form.id),{id:String(form.id),name:form.name||form.id,fields:(Array.isArray(form.config_forms)?form.config_forms:[]).map((field,index)=>({type:field.type,title:wheelText(field.title)?String(field.title):tr('设置 {0}', index+1),detail:formFieldDetail(field)}))});
      if(group&&!wheels.has(String(group.id))&&!queue.some(item=>item.at(-1)===String(group.id))&&String(group.id)!==key)queue.push([...path,String(group.id)]);
      return {label:wheelText(styled)?styled:entry.id,kind,sound:wheelAnimationHasSound(viewer.animations?.[wheelEntryAnimation(entry)]),settings:form?String(form.id):null,target:group?String(group.id):null};
    })}));
    wheels.set(key,{path:labels,pages});
  }
  return {wheels,forms};
}
// App settings (Settings tab), kept per browser profile.
let playControl=null;
modelStatus=createModelStatus(document.querySelector('#viewport'));
const appSettings={wheelPaged:false,wheelBounce:false,wheelSettingsMotion:true,wheelSoundIcon:false,wheelPageFormat:'pdf',dynamicColor:true,showWheelExport:false,showHandItems:false,showScreenshot:false,showLighting:false,showStatus:false,showModelStatus:true,showPlayControl:false,autoHideToolbar:false,mouseSensitivity:100,lighting:{...DEFAULT_LIGHTING},watermark:{enabled:false,text:'',color:'#ffffff',opacity:20},cardWarmUp:1,showCover:false,coverOutline:true,glowLayer:true,lightLevel:15,backgroundDim:0,showGrid:true,benchmark:false,uncappedFrameRate:false,molangInspector:{...DEFAULT_MOLANG_INSPECTOR},modelConfigs:{},popout:{toolbar:{enabled:false},cover:{enabled:false}},renderMode:'legacy',cardExport:{format:'gif',scale:2,fps:{},loops:1}};
// Remembered in Config/settings.json (app-config.js, 第 51 节).
{const saved=readConfig('settings');if(saved&&typeof saved==='object')Object.assign(appSettings,saved);}
if(!appSettings.modelConfigs||typeof appSettings.modelConfigs!=='object'||Array.isArray(appSettings.modelConfigs))appSettings.modelConfigs={};
appSettings.molangInspector=normalizeMolangInspector(appSettings.molangInspector);
appSettings.popout=normalizePopoutSettings(appSettings.popout);
function saveAppSettings(){writeConfig('settings',appSettings);}
function syncRenderModeButton(){
  const button=document.querySelector('#render-mode-button'),raw=appSettings.renderMode==='raw';
  button.setAttribute('aria-pressed',String(raw));
  button.title=raw?tr('当前：原始面渲染；点击切换为工程还原渲染'):tr('当前：工程还原渲染；点击切换为原始面渲染');
  button.setAttribute('aria-label',button.title);
}
syncRenderModeButton();
document.querySelector('#render-mode-button').onclick=async()=>{
  if(modelBusy)return;
  const previous=appSettings.renderMode==='raw'?'raw':'legacy',archive=currentYsmArchive,libraryModel=currentLibraryModel;
  appSettings.renderMode=previous==='raw'?'legacy':'raw';saveAppSettings();syncRenderModeButton();
  if(!archive&&!libraryModel){toast(appSettings.renderMode==='raw'?tr('已切换为原始面渲染；导入 YSM 模型后生效'):tr('已切换为工程还原渲染；导入 YSM 模型后生效'));return;}
  try{
    if(archive)await importModelArchive(archive);
    else if(/\.ysm$/i.test(libraryModel.fileName)){
      const [{getLibraryBackend},{readLibraryModel}]=await Promise.all([import('./library/backend.js'),import('./library/thumbnail.js')]);
      const backend=await getLibraryBackend();
      await openLibraryModel(await readLibraryModel(backend,libraryModel),libraryModel.fileName.replace(/\.ysm$/i,''),libraryModel);
    }
  }catch(error){
    appSettings.renderMode=previous;saveAppSettings();syncRenderModeButton();
    console.error(error);toast(tr('切换渲染模式失败：{0}',error.message||tr('模型加载失败')));
  }
};
function syncSettingsUi(){
  document.querySelector('#setting-dynamic-color').checked=appSettings.dynamicColor;
  document.querySelector('#setting-wheel-bounce').checked=appSettings.wheelBounce===true;
  document.querySelector('#setting-wheel-settings-motion').checked=appSettings.wheelSettingsMotion!==false;
  document.querySelector('#setting-wheel-sound-icon').checked=appSettings.wheelSoundIcon===true;
  document.querySelector('#setting-wheel-paged').checked=appSettings.wheelPaged;
  const format=document.querySelector('#setting-wheel-format');format.setAttribute('aria-disabled',String(!appSettings.wheelPaged));
  format.querySelectorAll('input').forEach(input=>{input.checked=input.value===appSettings.wheelPageFormat;input.disabled=!appSettings.wheelPaged;});
  const warmUp=document.querySelector('#setting-card-warmup');warmUp.value=String(cardWarmUpSeconds());syncCardWarmUpLabel();
  document.querySelector('#setting-glow').checked=appSettings.glowLayer!==false;
  applyBackgroundDim();
  document.querySelector('#setting-show-grid').checked=appSettings.showGrid!==false;
  document.querySelector('#setting-show-cover').checked=appSettings.showCover===true;applyShowCover();
  document.querySelector('#setting-cover-outline').checked=appSettings.coverOutline!==false;applyCoverOutline();
  document.querySelector('#setting-light-level').value=String(lightLevel());syncLightLevelLabel();
  document.querySelector('#setting-show-wheel-export').checked=appSettings.showWheelExport;
  document.querySelector('#setting-show-hand-items').checked=appSettings.showHandItems;
  document.querySelector('#setting-show-screenshot').checked=appSettings.showScreenshot;
  document.querySelector('#setting-auto-hide-toolbar').checked=appSettings.autoHideToolbar===true;
  document.querySelector('#setting-show-lighting').checked=appSettings.showLighting;
  document.querySelector('#setting-show-status').checked=appSettings.showStatus;
  document.querySelector('#setting-show-model-status').checked=appSettings.showModelStatus!==false;
  document.querySelector('#setting-show-play-control').checked=appSettings.showPlayControl;
  document.querySelector('#setting-benchmark').checked=appSettings.benchmark===true;applyBenchmark();
  document.querySelector('#setting-uncapped-fps').checked=appSettings.uncappedFrameRate===true;
  document.querySelector('#setting-molang-inspector').checked=appSettings.molangInspector.enabled;applyMolangInspector();
  syncPopoutSettingsUi();
  document.querySelector('#setting-mouse-sensitivity').value=String(mouseSensitivity());syncMouseSensitivityLabel();
  applyToolbarSettings();
  const watermark=watermarkSettings();
  document.querySelector('#setting-watermark').checked=watermark.enabled;
  document.querySelector('#watermark-text').value=watermark.text;document.querySelector('#watermark-color').value=watermark.color;
  document.querySelector('#watermark-opacity').value=String(watermark.opacity);document.querySelector('#watermark-opacity-value').textContent=`${watermark.opacity}%`;
  document.querySelectorAll('[data-watermark-option]').forEach(row=>{row.setAttribute('aria-disabled',String(!watermark.enabled));row.querySelectorAll('input').forEach(input=>input.disabled=!watermark.enabled);});
}
function watermarkSettings(){
  const saved=appSettings.watermark||{},opacity=Math.round(Number(saved.opacity));
  return {enabled:saved.enabled===true,text:String(saved.text??'').slice(0,40),color:/^#[0-9a-f]{6}$/i.test(saved.color)?saved.color:'#ffffff',opacity:Number.isFinite(opacity)?Math.min(100,Math.max(0,opacity)):20};
}
function updateWatermark(changes,save=true){appSettings.watermark={...watermarkSettings(),...changes};if(save)saveAppSettings();syncSettingsUi();}
// Optional toolbar buttons. Hiding the held-item button also empties both hands,
// so the 3D view never keeps a pose the toolbar no longer shows.
function applyToolbarSettings(){
  document.querySelector('#viewport').classList.toggle('toolbar-auto-hide',appSettings.autoHideToolbar===true);
  document.querySelector('#wheel-export-button').hidden=!appSettings.showWheelExport;
  document.querySelector('#capture-panel').hidden=!appSettings.showScreenshot;
  lightPicker.hidden=!appSettings.showLighting;
  document.querySelector('#play-control-button').hidden=!appSettings.showPlayControl;
  if(!appSettings.showPlayControl)exitPlayControl();
  statusPicker.hidden=!appSettings.showStatus;
  if(!appSettings.showStatus){closeStatusPanel();if(!isDefaultStatus(playerStatus))setPlayerStatus(DEFAULT_STATUS);}
  if(!appSettings.showLighting){closeLightPanel();if(lighting().marker)updateLighting({marker:false});}
  handItemPicker.hidden=!appSettings.showHandItems;
  if(appSettings.showHandItems)return;
  closeHandItemMenu();
  for(const hand of HANDS)if(handItems[hand]){handItems[hand]=null;viewer?.setHandItem(hand,null);}syncMainStateButtons();
  syncHandItemButton();
}
// 光标灵敏度 in percent of play-control.js's default mouse sensitivity.
function mouseSensitivity(){const value=Math.round(Number(appSettings.mouseSensitivity));return Number.isFinite(value)?Math.min(300,Math.max(10,value)):100;}
function syncMouseSensitivityLabel(){const input=document.querySelector('#setting-mouse-sensitivity');syncRangeFill(input);document.querySelector('#setting-mouse-sensitivity-value').value=`${input.value}%`;}
function lightLevel(){const value=Math.round(Number(appSettings.lightLevel));return Number.isFinite(value)?Math.min(15,Math.max(0,value)):15;}
function backgroundDim(){const value=Math.round(Number(appSettings.backgroundDim));return Number.isFinite(value)?Math.min(100,Math.max(0,value)):0;}
// 背景压暗: a black layer over the 3D view's themed gradient (style.css --viewport-dim).
function applyBackgroundDim(){const value=backgroundDim(),input=document.querySelector('#setting-background-dim');input.value=String(value);syncRangeFill(input);document.querySelector('#setting-background-dim-value').value=`${value}%`;document.querySelector('#viewport').style.setProperty('--viewport-dim',String(value/100));}
function syncLightLevelLabel(){const input=document.querySelector('#setting-light-level');syncRangeFill(input);document.querySelector('#setting-light-level-value').value=tr('{0} 级', input.value);}
function applyEnvironmentLight(){viewer?.setEnvironmentLight({level:lightLevel(),glow:appSettings.glowLayer!==false});}
// Seconds the card's preview entity runs at its first frame before it is shown.
function cardWarmUpSeconds(){const value=Number(appSettings.cardWarmUp);return Number.isFinite(value)?Math.min(5,Math.max(0,value)):1;}
function syncCardWarmUpLabel(){const input=document.querySelector('#setting-card-warmup');syncRangeFill(input);document.querySelector('#setting-card-warmup-value').value=tr('{0} 秒', Number(input.value).toFixed(1));}
// 自动取色: the selected texture of the loaded model drives the page colors,
// weighted by the texture areas the currently shown faces use.
const DYNAMIC_COLOR_STATUS={pending:tr('正在从模型贴图中取色…'),model:tr('当前页面正在使用模型的配色'),default:tr('模型贴图中没有合适的颜色，正在使用默认配色'),empty:tr('导入模型后，页面会使用模型的配色'),off:tr('正在使用默认配色')};
function setDynamicColorStatus(state){document.querySelector('#dynamic-color-status .settings-status-text').textContent=DYNAMIC_COLOR_STATUS[state];document.querySelector('#dynamic-color-status').dataset.state=state;}
async function syncDynamicColor(){
  const instance=viewer?.root?viewer:null,texture=instance?.textureVariants?.find(entry=>entry.id===instance.currentTextureId)?.file||null;
  const blob=appSettings.dynamicColor?texture:null,coverage=blob?instance.visibleTextureCoverage():null;
  setDynamicColorStatus(blob?'pending':appSettings.dynamicColor?'empty':'off');
  const result=await updateDynamicColor(blob,coverage);
  if(result==='model'||result==='default')setDynamicColorStatus(result);
}
document.querySelector('#setting-dynamic-color').addEventListener('change',event=>{appSettings.dynamicColor=event.target.checked;saveAppSettings();syncDynamicColor();});
document.querySelector('#setting-wheel-paged').addEventListener('change',event=>{appSettings.wheelPaged=event.target.checked;saveAppSettings();syncSettingsUi();});
document.querySelector('#setting-show-wheel-export').addEventListener('change',event=>{appSettings.showWheelExport=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-show-lighting').addEventListener('change',event=>{appSettings.showLighting=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-show-status').addEventListener('change',event=>{appSettings.showStatus=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-show-model-status').addEventListener('change',event=>{appSettings.showModelStatus=event.target.checked;saveAppSettings();updateModelStatus();});
document.querySelector('#setting-show-play-control').addEventListener('change',event=>{appSettings.showPlayControl=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-mouse-sensitivity').addEventListener('input',event=>{appSettings.mouseSensitivity=Number(event.target.value);syncMouseSensitivityLabel();if(playControl)playControl.sensitivity=mouseSensitivity()/100;});
document.querySelector('#setting-mouse-sensitivity').addEventListener('change',saveAppSettings);
document.querySelector('#setting-auto-hide-toolbar').addEventListener('change',event=>{appSettings.autoHideToolbar=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-show-screenshot').addEventListener('change',event=>{appSettings.showScreenshot=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-watermark').addEventListener('change',event=>updateWatermark({enabled:event.target.checked}));
document.querySelector('#watermark-text').addEventListener('change',event=>updateWatermark({text:event.target.value}));
document.querySelector('#watermark-color').addEventListener('input',event=>updateWatermark({color:event.target.value},false));
document.querySelector('#watermark-color').addEventListener('change',saveAppSettings);
document.querySelector('#watermark-opacity').addEventListener('input',event=>updateWatermark({opacity:Number(event.target.value)},false));
document.querySelector('#watermark-opacity').addEventListener('change',saveAppSettings);
document.querySelector('#setting-benchmark').addEventListener('change',event=>{appSettings.benchmark=event.target.checked;saveAppSettings();applyBenchmark();});
// 设置 → 性能 → 解除帧率上限 (default off): the viewer renders as fast as it can
// instead of once per display refresh, at once. The desktop app additionally
// starts WebView2 without GPU vsync (a launch option, src/launch-options.js),
// which only applies after a restart.
const uncappedStatus=document.querySelector('#uncapped-fps-status');
function syncUncappedStatus({saved,active},supported){
  const pending=supported&&saved.uncappedFrameRate!==active.uncappedFrameRate;
  uncappedStatus.hidden=!pending;
  uncappedStatus.querySelector('.settings-status-text').textContent=saved.uncappedFrameRate?tr('已解除帧率上限。重启软件后还会关闭垂直同步，帧率可进一步提高。'):tr('已恢复帧率上限。重启软件后恢复垂直同步。');
}
async function saveUncappedLaunchOption(){
  const backend=await launchOptions();let state=await backend.state();
  if(state.saved.uncappedFrameRate!==(appSettings.uncappedFrameRate===true))state=await backend.set({...state.saved,uncappedFrameRate:appSettings.uncappedFrameRate===true});
  syncUncappedStatus(state,backend.supported);
}
saveUncappedLaunchOption().catch(error=>console.error(error));
document.querySelector('#setting-uncapped-fps').addEventListener('change',event=>{
  appSettings.uncappedFrameRate=event.target.checked;saveAppSettings();viewer?.setUncapped(appSettings.uncappedFrameRate);
  saveUncappedLaunchOption().catch(error=>toast(tr('保存启动设置失败：{0}', error.message)));
});
document.querySelector('#uncapped-fps-restart').addEventListener('click',async()=>{try{await (await launchOptions()).restart();}catch(error){toast(tr('重启失败：{0}', error.message));}});
// 设置 → 模型调试 → Molang 监视器 (第 61 节, default off): a separate OS window
// (browser: popup) fed with the main view's Molang values; works with no model loaded.
let molangInspector=null;
// 强制切换主状态 (第 67 节): while the Molang 监视器 locks ctrl.<state> non-zero
// (and its setting is on), that state is the main state. mainStateBefore is
// what to go back to outside 操控模式 (in it, the movement's own state).
let mainStateOverride=null,mainStateBefore=null;
function applyMainStateOverride(state,force=false){
  const previous=mainStateOverride;
  if(state===previous&&!force)return;
  mainStateOverride=state;
  if(!viewer?.root)return;
  if(state){
    if(!previous)mainStateBefore=viewer.base?viewer.base.name:viewer.animationName;
    viewer.setAnimation(state);showMainState(state);return;
  }
  if(!previous)return;
  const back=playControl?playControl.state:MAIN_STATE_PRIORITY.includes(mainStateBefore)?mainStateBefore:'idle';
  mainStateBefore=null;viewer.setAnimation(back);showMainState(back);
}
/** Enters a main state, unless the Molang 监视器 forces another one. */
function setMainState(name){const state=mainStateOverride||name;viewer.setAnimation(state);showMainState(state);}
/** True (with a notice) while the main state is forced, so the state buttons do nothing. */
function mainStateForced(){
  if(!mainStateOverride)return false;
  toast(tr('主状态由 Molang 监视器的锁定决定（{0}），解除锁定或关闭“强制切换主状态”后再切换',MAIN_STATE_LABELS[mainStateOverride]||mainStateOverride));
  return true;
}
function applyMolangInspector(){
  const settings=appSettings.molangInspector;
  const switchOff=()=>{document.querySelector('#setting-molang-inspector').checked=false;};
  if(settings.enabled&&!molangInspector)molangInspector=createMolangInspectorHost({
    settings,save:saveAppSettings,
    getContext:()=>viewer?.root?viewer.mainAnimationContext:null,
    getRuntime:()=>viewer?.root?viewer.mainControllerRuntime:null,
    getClock:()=>viewer?.root?viewer.elapsedTime:0,
    execute:script=>!!viewer?.root&&viewer.executeMolang(script),
    onClosed:switchOff,
    onBlocked:()=>{switchOff();toast(tr('浏览器阻止了弹出窗口，请再次打开开关'));},
    onMainStateOverride:applyMainStateOverride,
  });
  molangInspector?.setOpen(settings.enabled);
}
document.querySelector('#setting-molang-inspector').addEventListener('change',event=>{appSettings.molangInspector.enabled=event.target.checked;saveAppSettings();applyMolangInspector();});
// 设置 → 窗口 → 独立窗口 (第 62 节): the toolbar and the cover sidebar can each
// live in their own OS window (popout.js moves the live elements there).
function normalizePopoutSettings(value){
  const item=entry=>{
    const v=entry&&typeof entry==='object'?entry:{};
    const num=n=>Number.isFinite(n)?Math.round(n):null;
    return {enabled:v.enabled===true,pinned:v.pinned===true,x:num(v.x),y:num(v.y),width:num(v.width),height:num(v.height)};
  };
  return {toolbar:item(value?.toolbar),cover:item(value?.cover)};
}
const POPOUTS={
  toolbar:{
    element:()=>document.querySelector('.viewer-tools'),
    title:()=>tr('工具栏'),
    icon:'build',
    className:'popout-toolbar',
    // Its size always follows the content (fit), so no resize grip.
    resizable:false,
    available:()=>true,
    defaultSize:{width:600,height:64},
    // The window wraps the bar plus any open drop-down menu or listbox; its
    // size follows the content, so a remembered size is not used.
    fitsContent:true,
    fit:doc=>{
      let right=0,bottom=0;
      for(const element of doc.querySelectorAll('.viewer-tools, .viewer-tools [role=menu]:not([hidden]), .viewer-tools [role=listbox]:not([hidden])')){
        const rect=element.getBoundingClientRect();if(!rect.width)continue;
        right=Math.max(right,rect.right);bottom=Math.max(bottom,rect.bottom);
      }
      const menuOpen=bottom>doc.querySelector('.viewer-tools').getBoundingClientRect().bottom+1;
      // At least as wide as the title bar's icon, title and four buttons (desktop).
      return right&&bottom?{width:Math.max(right,280),height:bottom+(menuOpen?8:0)}:null;
    },
  },
  cover:{
    element:()=>document.querySelector('.model-sidebar'),
    title:()=>tr('封面'),
    icon:'badge',
    className:'popout-cover',
    available:()=>appSettings.showCover===true,
    defaultSize:{width:340,height:740},
  },
};
const popoutHandles=new Map(),popoutBusy=new Set();
let pageClosing=false;
addEventListener('pagehide',()=>{pageClosing=true;});
async function setPopout(name,open){
  const config=POPOUTS[name],state=appSettings.popout[name];
  if(popoutBusy.has(name)||open===isPoppedOut(name))return;
  if(!open){popoutHandles.get(name)?.close();return;}
  popoutBusy.add(name);
  try{
    const size=config.fitsContent?config.defaultSize:{width:state.width||config.defaultSize.width,height:state.height||config.defaultSize.height};
    const handle=await popOut(name,{
      element:config.element(),title:config.title(),icon:config.icon,className:config.className,fit:config.fit,resizable:config.resizable!==false,
      bounds:{x:state.x,y:state.y,...size},
      pinned:state.pinned,
      onBounds:bounds=>{Object.assign(state,bounds);saveAppSettings();},
      onPinned:value=>{state.pinned=value;saveAppSettings();},
      onClosed:byUser=>{
        popoutHandles.delete(name);
        // Closing the window itself turns the switch off (not when this page unloads).
        if(byUser&&!pageClosing){state.enabled=false;saveAppSettings();syncPopoutSettingsUi();}
        afterPopoutMove(name);
      },
    });
    if(!handle){
      state.enabled=false;saveAppSettings();syncPopoutSettingsUi();
      toast(tr('浏览器阻止了弹出窗口，请再次打开开关'));return;
    }
    popoutHandles.set(name,handle);
    afterPopoutMove(name);
  }finally{popoutBusy.delete(name);}
  // The switch may have changed while the window was opening.
  const wanted=state.enabled&&config.available();
  if(wanted!==isPoppedOut(name))setPopout(name,wanted);
}
// Things that depend on where the element now is.
function afterPopoutMove(name){
  if(name==='cover'){
    document.querySelector('.model-layout').classList.toggle('cover-hidden',appSettings.showCover!==true||isPoppedOut('cover'));
    // The card's WebGL renderer is rebuilt on the moved canvas (new size, visibility observer).
    if(viewer?.root&&appSettings.showCover===true)startCardPreview(viewer);
  }else if(name==='toolbar'){
    document.querySelector('#viewport').classList.toggle('toolbar-popped',isPoppedOut('toolbar'));
    if(!document.querySelector('#action-wheel').hidden)positionWheelClose();
  }
}
function applyPopouts(){
  for(const name of Object.keys(POPOUTS))setPopout(name,appSettings.popout[name].enabled&&POPOUTS[name].available());
}
function syncPopoutSettingsUi(){
  const toolbar=appSettings.popout.toolbar.enabled,cover=appSettings.popout.cover.enabled,coverAvailable=POPOUTS.cover.available();
  document.querySelector('#setting-popout-toolbar').checked=toolbar;
  const coverSwitch=document.querySelector('#setting-popout-cover');
  coverSwitch.checked=cover;coverSwitch.disabled=!coverAvailable;
  document.querySelector('#setting-popout-cover-row').setAttribute('aria-disabled',String(!coverAvailable));
  const on=[toolbar&&tr('工具栏'),cover&&coverAvailable&&tr('封面')].filter(Boolean);
  document.querySelector('#settings-popout-summary').textContent=on.length===2?tr('已开启：工具栏、封面'):on.length?tr('已开启：{0}',on[0]):tr('工具栏与封面都在主窗口中');
}
for(const name of Object.keys(POPOUTS))document.querySelector(`#setting-popout-${name}`).addEventListener('change',event=>{
  appSettings.popout[name].enabled=event.target.checked;saveAppSettings();syncPopoutSettingsUi();
  setPopout(name,event.target.checked&&POPOUTS[name].available());
});
// Settings sub-pages (二级菜单): the main list is hidden while one is shown.
// Each opener row names its page in data-subpage; the page's back button is its header's first button.
const settingsPanel=document.querySelector('#settings-panel');
let openSubpageRow=null;
function showSettingsSubpage(row){
  const page=row&&document.getElementById(row.dataset.subpage);
  for(const section of settingsPanel.querySelectorAll(':scope>.detail-section'))section.hidden=Boolean(page);
  for(const subpage of settingsPanel.querySelectorAll(':scope>.settings-subpage'))subpage.hidden=subpage!==page;
  if(page){openSubpageRow=row;settingsPanel.scrollIntoView({block:'start'});page.querySelector('.settings-subpage-header button').focus();}
  else if(openSubpageRow){openSubpageRow.scrollIntoView({block:'center'});openSubpageRow.focus();openSubpageRow=null;}
}
for(const row of settingsPanel.querySelectorAll('[data-subpage]'))row.addEventListener('click',()=>showSettingsSubpage(row));
for(const page of settingsPanel.querySelectorAll(':scope>.settings-subpage')){
  page.querySelector('.settings-subpage-header button').addEventListener('click',()=>showSettingsSubpage(null));
  page.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();showSettingsSubpage(null);}});
}
let benchmarkHud=null;
// 设置 → 性能 → Benchmark (default off). The overlay module loads only when it is first turned on.
async function applyBenchmark(){
  const enabled=appSettings.benchmark===true;
  if(enabled&&!benchmarkHud){const {createBenchmarkHud}=await import('./benchmark.js');benchmarkHud??=createBenchmarkHud(document.querySelector('#viewport'));}
  if(!benchmarkHud)return;
  const on=appSettings.benchmark===true&&viewer;
  benchmarkHud.setRenderer(on?viewer.renderer:null);viewer?.setBenchmark(on?benchmarkHud.sample:null);
}
document.querySelector('#setting-show-hand-items').addEventListener('change',event=>{appSettings.showHandItems=event.target.checked;saveAppSettings();applyToolbarSettings();});
document.querySelector('#setting-glow').addEventListener('change',event=>{appSettings.glowLayer=event.target.checked;saveAppSettings();applyEnvironmentLight();});
// The light level previews live while dragging and is saved on release.
document.querySelector('#setting-light-level').addEventListener('input',event=>{appSettings.lightLevel=Number(event.target.value);syncLightLevelLabel();applyEnvironmentLight();});
document.querySelector('#setting-light-level').addEventListener('change',saveAppSettings);
document.querySelector('#setting-background-dim').addEventListener('input',event=>{appSettings.backgroundDim=Number(event.target.value);applyBackgroundDim();});
document.querySelector('#setting-background-dim').addEventListener('change',saveAppSettings);
document.querySelector('#setting-wheel-bounce').addEventListener('change',event=>{appSettings.wheelBounce=event.target.checked;saveAppSettings();});
document.querySelector('#setting-wheel-settings-motion').addEventListener('change',event=>{appSettings.wheelSettingsMotion=event.target.checked;saveAppSettings();});
document.querySelector('#setting-wheel-sound-icon').addEventListener('change',event=>{appSettings.wheelSoundIcon=event.target.checked;saveAppSettings();if(!document.querySelector('#action-wheel')?.hidden)renderActionWheel({keepFrame:true});});
function applyShowCover(){
  const show=appSettings.showCover===true;
  // A popped-out cover leaves the main layout too (独立窗口, 第 62 节).
  document.querySelector('.model-layout').classList.toggle('cover-hidden',!show||isPoppedOut('cover'));
  syncPopoutSettingsUi();applyPopouts();
  if(!viewer?.root)return;
  if(show){if(!viewer.card)startCardPreview(viewer);}
  else startCardPreview(viewer);
}
document.querySelector('#setting-show-cover').addEventListener('change',event=>{appSettings.showCover=event.target.checked;saveAppSettings();applyShowCover();});
function applyCoverOutline(){coverCard.classList.toggle('has-state-outline',appSettings.coverOutline!==false);}
document.querySelector('#setting-cover-outline').addEventListener('change',event=>{appSettings.coverOutline=event.target.checked;saveAppSettings();applyCoverOutline();});
document.querySelector('#setting-show-grid').addEventListener('change',event=>{appSettings.showGrid=event.target.checked;saveAppSettings();if(viewer)viewer.showGrid=appSettings.showGrid;});
document.querySelector('#setting-card-warmup').addEventListener('input',syncCardWarmUpLabel);
// Applied on release: the card is rebuilt (and warmed up again) from the
// start, or on the paused frame so a chosen frame can still be saved.
document.querySelector('#setting-card-warmup').addEventListener('change',event=>{appSettings.cardWarmUp=Number(event.target.value);saveAppSettings();if(!viewer?.root)return;if(!cardPlaybackPaused){cardFrameTime=0;updateCardFrameSlider();}startCardPreview(viewer);});
document.querySelectorAll('#setting-wheel-format input').forEach(input=>input.addEventListener('change',()=>{if(input.checked){appSettings.wheelPageFormat=input.value;saveAppSettings();}}));
syncSettingsUi();syncDynamicColor();
async function exportActionWheel(){
  if(!needViewer())return;
  const button=document.querySelector('#wheel-export-button');if(button)button.disabled=true;
  try{
    const {wheels,forms}=collectWheelTree(),pages=[...wheels.values()].flatMap(wheel=>wheel.pages);
    if(!pages.some(page=>page.entries.length))throw new Error(tr('当前模型没有轮盘动作'));
    const css=getComputedStyle(document.documentElement),token=name=>css.getPropertyValue(`--md-sys-color-${name}`).trim();
    const theme={background:token('surface'),card:token('surface-container-low'),surfaceContainer:token('surface-container'),sector:token('surface-container-highest'),empty:token('surface-container'),missing:token('surface-container-low'),folder:token('primary-container'),onFolder:token('on-primary-container'),audio:token('tertiary-container'),onAudio:token('on-tertiary-container'),primary:token('primary'),tertiary:token('tertiary'),sectorStroke:token('surface'),outline:token('outline-variant'),onSurface:token('on-surface'),muted:token('on-surface-variant')};
    const entries=pages.flatMap(page=>page.entries),actions=entries.filter(entry=>entry.kind==='action'||entry.kind==='audio').length,folders=wheels.size-1;
    const paged=appSettings.wheelPaged,pdf=paged&&appSettings.wheelPageFormat==='pdf';
    toast(paged?tr('正在生成分页轮盘图…'):tr('正在生成轮盘图片…'));
    const images=await renderWheelOverview({title:activeModelName||tr('动作轮盘'),subtitle:tr('动作轮盘 · {0} 个动作{1}{2} · 共 {3} 页轮盘', actions, folders?tr(' · {0} 个子分类', folders):'', forms.size?tr(' · {0} 个设置面板', forms.size):'', pages.length),wheels,forms,theme,family:css.getPropertyValue('--md-ref-typeface').trim()||'sans-serif',textRuns:minecraftTextRuns,paged,mime:pdf?'image/jpeg':'image/png'});
    const name=tr('{0}_动作轮盘', wheelText(activeModelName).replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,100)||'ysm');
    if(pdf){if(await saveFile(await imagesToPdf(images,tr('{0} 动作轮盘', wheelText(activeModelName))),`${name}.pdf`,{name:tr('PDF 文档'),extensions:['pdf']}))toast(tr('轮盘 PDF 已保存（{0} 页）', images.length));}
    else if(images.length>1){if(await saveFilesToFolder(images.map((image,i)=>({blob:image.blob,filename:`${name}_${String(i+1).padStart(2,'0')}.png`})),tr('选择保存轮盘图片的文件夹')))toast(tr('已保存 {0} 张轮盘图片', images.length));}
    else if(await savePng(images[0].blob,`${name}.png`))toast(tr('轮盘图片已保存'));
  }catch(error){console.error(error);toast(tr('导出失败：{0}', error.message));}
  finally{if(button)button.disabled=false;}
}
// 保存配置 (第 68 节): the values of every settings form (radio = the selected
// option, checkbox / range = the value) plus every v.roaming number (what the
// game keeps per model), stored per model name in appSettings.modelConfigs and
// restored after the model loads: v.roaming first, then radio scripts (they may
// set several variables), then checkboxes and sliders.
const MAX_MODEL_CONFIGS=200;
const modelConfigKey=()=>String(activeModelName||'').trim();
function savedModelConfig(){const key=modelConfigKey();return key&&appSettings.modelConfigs?.[key]||null;}
function collectModelConfig(){
  const fields=[];
  for(const form of viewer?.customAnimationButtons||[]){
    for(const field of Array.isArray(form?.config_forms)?form.config_forms:[]){
      const path=String(field?.value||'').trim();if(!path)continue;
      // title / option: plain text so an exported file is readable; restoring ignores them.
      const base={form:String(form.id),...(wheelText(field.title)?{title:wheelText(field.title)}:{})};
      if(field.type==='radio'){const labels=Object.keys(field.labels||{});if(labels.length){const value=radioSettingIndex(path,labels.length);fields.push({...base,type:'radio',path,value,option:wheelText(labels[value])||labels[value]});}}
      else if(field.type==='checkbox')fields.push({...base,type:'checkbox',path,value:viewer.getMolangValue(path)>0?1:0});
      else if(field.type==='range'){const value=Number(viewer.getMolangValue(path));fields.push({...base,type:'range',path,value:Number.isFinite(value)?value:0});}
    }
  }
  return {savedAt:new Date().toISOString(),roaming:viewer.roamingValues(),fields};
}
/** Saves the current configuration of the loaded model; returns how many values were saved. */
function saveModelConfig(){
  const key=modelConfigKey();if(!key||!viewer?.root)return 0;
  const config=collectModelConfig(),count=config.fields.length+Object.keys(config.roaming).length;if(!count)return 0;
  const configs={...appSettings.modelConfigs};delete configs[key];configs[key]=config;
  // Oldest first (insertion order); keep the newest MAX_MODEL_CONFIGS.
  const keys=Object.keys(configs);for(const old of keys.slice(0,Math.max(0,keys.length-MAX_MODEL_CONFIGS)))delete configs[old];
  appSettings.modelConfigs=configs;saveAppSettings();return count;
}
function clearModelConfig(){const key=modelConfigKey();if(!key||!appSettings.modelConfigs?.[key])return;const configs={...appSettings.modelConfigs};delete configs[key];appSettings.modelConfigs=configs;saveAppSettings();}
/** Applies the saved configuration of the model just loaded; returns how many values were applied. */
function restoreModelConfig(){return applyModelConfig(savedModelConfig());}
/** Applies a configuration (saved, or imported from a file) to the loaded model; returns how many values were applied. */
function applyModelConfig(config){
  if(!config||!viewer?.root)return 0;
  const roaming=Object.entries(config.roaming||{}).filter(([path,value])=>/^v\.roaming(\.[A-Za-z_]\w*)+$/.test(path)&&Number.isFinite(value)).map(([path,value])=>`${path}=${value}`);
  // Match saved values to the model's current forms (a newer version may have dropped some).
  const current=new Map();
  for(const form of viewer.customAnimationButtons||[])for(const field of Array.isArray(form?.config_forms)?form.config_forms:[])current.set(`${form.id}\n${field.type}\n${String(field.value||'').trim()}`,field);
  const radios=[],values=[];
  for(const saved of Array.isArray(config.fields)?config.fields:[]){
    const field=current.get(`${saved.form}\n${saved.type}\n${saved.path}`);if(!field)continue;
    if(saved.type==='radio'){const option=Object.values(field.labels||{})[Number(saved.value)];if(typeof option==='string')radios.push(option);}
    else if(Number.isFinite(saved.value))values.push(`${saved.path}=${saved.value}`);
  }
  return viewer.executeMolangScripts([...roaming,...radios,...values]);
}
// 导出 / 导入配置文件 (第 69 节): the current configuration as a small JSON file to share.
const MODEL_CONFIG_FORMAT='ysm-model-config';
async function exportModelConfig(){
  const key=modelConfigKey();if(!key||!viewer?.root)return;
  const config=collectModelConfig(),count=config.fields.length+Object.keys(config.roaming).length;
  if(!count){toast(tr('这个模型没有可保存的配置'));return;}
  const {savedAt,...values}=config;
  const file={format:MODEL_CONFIG_FORMAT,version:1,model:wheelText(key)||key,exportedAt:savedAt,...values};
  const name=tr('{0}_配置',(wheelText(key)||'ysm').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,100));
  try{if(await saveFile(new Blob([JSON.stringify(file,null,2)],{type:'application/json'}),`${name}.json`,{name:tr('YSM 模型配置'),extensions:['json']}))toast(tr('配置已导出（{0} 项）',count));}
  catch(error){console.error(error);toast(tr('导出失败：{0}',error.message));}
}
/** Reads a config file, applies the values that fit the loaded model and saves the result as its configuration. */
async function importModelConfig(file,wheel){
  let data;
  try{data=JSON.parse(await file.text());}catch{toast(tr('无法读取配置文件：不是有效的 JSON'));return;}
  if(data?.format!==MODEL_CONFIG_FORMAT||!Array.isArray(data.fields)){toast(tr('这不是 YSM 模型工具导出的配置文件'));return;}
  if(!viewer?.root){toast(tr('请先加载模型'));return;}
  const config={roaming:data.roaming&&typeof data.roaming==='object'&&!Array.isArray(data.roaming)?data.roaming:{},fields:data.fields.filter(field=>field&&typeof field==='object'&&typeof field.path==='string')};
  const applied=applyModelConfig(config);
  if(!applied){toast(tr('配置文件里没有适用于当前模型的设置'));return;}
  saveModelConfig();syncWheelSettings(wheel);syncWheelConfigStatus(wheel);
  const from=typeof data.model==='string'?data.model:'',current=wheelText(modelConfigKey());
  toast(from&&from!==current?tr('已导入来自“{0}”的配置，应用了 {1} 项，并已保存',from,applied):tr('已导入配置，应用了 {0} 项，并已保存',applied));
}
function pickModelConfigFile(wheel){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.onchange=()=>{const file=input.files?.[0];if(file)importModelConfig(file,wheel);};
  input.click();
}
function syncWheelConfigStatus(wheel){
  const status=wheel.querySelector('.wheel-config-status'),clear=wheel.querySelector('[data-wheel-config-clear]');if(!status)return;
  const config=savedModelConfig(),time=config&&new Date(config.savedAt);
  status.textContent=config?tr('已保存配置（{0}），重新加载这个模型时自动恢复',time&&!Number.isNaN(time.getTime())?time.toLocaleString():'—'):'';
  status.hidden=!config;if(clear)clear.hidden=!config;
}
// animate: opened from a gear (第 65 节); re-renders while open must not replay the slide-in.
function renderWheelSettings(form,animate=false){
  const wheel=document.querySelector('#action-wheel'),forms=Array.isArray(form?.config_forms)?form.config_forms:[];
  actionWheelSettings=form;const fields=forms.map((field,index)=>{
    const plainTitle=wheelEscape(wheelText(field.title)||tr('设置 {0}', index+1)),title=minecraftTextHtml(wheelText(field.title)?field.title:tr('设置 {0}', index+1)),description=minecraftTextHtml(field.description||''),path=wheelEscape(field.value||'');
    if(field.type==='range'){
      const min=Number(field.min??0),max=Number(field.max??1),step=Number(field.step??0.01),current=Number(viewer.getMolangValue(path));
      const value=Number.isFinite(current)&&current>=min&&current<=max?current:min;
      const fill=max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0;
      return `<label class="wheel-setting range-setting"><span>${title}</span><output class="range-value-current">${value}</output><div class="material-slider" style="--range-fill:${fill}%;--thumb-position:${fill}%"><div class="material-slider-track"><span class="material-slider-inactive"></span><span class="material-slider-active"></span></div><input class="material-slider-input" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-wheel-value="${path}" aria-label="${plainTitle}"><div class="material-slider-thumb"><div class="range-value-indicator-container"><output class="range-value-bubble" aria-hidden="true"><span class="range-value-bubble-text">${value}</span></output></div><span class="material-slider-thumb-knob"></span></div></div>${description?`<small>${description}</small>`:''}</label>`;
    }
    if(field.type==='checkbox')return `<label class="wheel-setting check-setting"><input type="checkbox" data-wheel-value="${path}" aria-label="${plainTitle}" ${viewer.getMolangValue(path)>0?'checked':''}><span>${title}</span>${description?`<small>${description}</small>`:''}</label>`;
    if(field.type==='radio'){
      // MolangOption.ofIndex: the selected option is round(value) clamped to
      // the option list; picking one runs that option's whole script.
      const options=Object.entries(field.labels||{}),selected=radioSettingIndex(path,options.length);
      return `<fieldset class="wheel-setting radio-setting" data-wheel-radio="${path}"><legend>${title}</legend><div>${options.map(([label,expr],i)=>`<label><input type="radio" name="wheel-radio-${index}" data-wheel-expression="${wheelEscape(expr)}" ${i===selected?'checked':''}><span>${minecraftTextHtml(label)}</span></label>`).join('')}</div>${description?`<small>${description}</small>`:''}</fieldset>`;
    }
    return '';
  }).join('');
  wheel.innerHTML=`<section class="wheel-settings${animate&&appSettings.wheelSettingsMotion!==false?' is-entering':''}" aria-label="${wheelEscape(wheelText(form?.name||form?.id))}"><header><strong>${minecraftTextHtml(form?.name||form?.id)}</strong><button type="button" data-wheel-settings-close aria-label="${tr('关闭设置')}">${icon('x')}</button></header><div class="wheel-config-bar" role="group" aria-label="${tr('模型配置')}"><button type="button" class="md-button text" data-wheel-config-save title="${tr('保存整个模型的当前配置（重新加载模型时自动恢复）')}">${materialIcon('save')}<span>${tr('保存')}</span></button><button type="button" class="md-button text" data-wheel-config-import title="${tr('从配置文件导入')}">${materialIcon('file_open')}<span>${tr('导入')}</span></button><button type="button" class="md-button text" data-wheel-config-export title="${tr('把整个模型的当前配置导出为文件，方便分享')}">${materialIcon('ios_share')}<span>${tr('导出')}</span></button><button type="button" class="md-button text" data-wheel-config-clear title="${tr('删除已保存的配置')}"${savedModelConfig()?'':' hidden'}>${materialIcon('delete')}<span>${tr('删除')}</span></button></div><p class="wheel-config-hint">${materialIcon('info')}<span>${tr('保存、导入、导出的都是整个模型所有设置面板的配置，不只是当前面板。')}</span></p><p class="wheel-config-status" role="status"></p><div class="wheel-settings-fields">${fields||`<p>${tr('此选项没有可调节的设置')}</p>`}</div></section>`;
  syncWheelConfigStatus(wheel);
  wheel.querySelector('[data-wheel-config-save]').onclick=()=>{const count=saveModelConfig();syncWheelConfigStatus(wheel);toast(count?tr('已保存当前配置（{0} 项），重新加载这个模型时会自动恢复',count):tr('这个模型没有可保存的配置'));};
  wheel.querySelector('[data-wheel-config-clear]').onclick=()=>{clearModelConfig();syncWheelConfigStatus(wheel);toast(tr('已删除保存的配置，下次加载使用模型默认值'));};
  wheel.querySelector('[data-wheel-config-export]').onclick=()=>exportModelConfig();
  wheel.querySelector('[data-wheel-config-import]').onclick=()=>pickModelConfigFile(wheel);
  wheel.querySelector('[data-wheel-settings-close]').onclick=()=>{
    // 第 65 节: slide out to the right before returning to the wheel (same setting as the slide-in).
    const panel=wheel.querySelector('.wheel-settings'),done=()=>{if(panel.isConnected&&actionWheelSettings===form){actionWheelSettings=null;renderActionWheel();}};
    if(panel.classList.contains('is-leaving'))return;
    if(appSettings.wheelSettingsMotion===false||matchMedia('(prefers-reduced-motion: reduce)').matches){done();return;}
    panel.classList.remove('is-entering');panel.classList.add('is-leaving');
    panel.addEventListener('animationend',done,{once:true});setTimeout(done,400);
  };
  wheel.querySelectorAll('[data-wheel-value]').forEach(input=>{
    if(input.type==='range'){
      const slider=input.closest('.material-slider');
      input.addEventListener('pointerdown',()=>slider.classList.add('is-adjusting'));
      input.addEventListener('focus',()=>slider.classList.add('is-adjusting'));
      input.addEventListener('blur',()=>slider.classList.remove('is-adjusting'));
      input.addEventListener('pointerup',()=>setTimeout(()=>slider.classList.remove('is-adjusting'),450));
      const syncSlider=()=>{const ratio=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min)||1);slider.style.setProperty('--range-fill',`${ratio*100}%`);slider.style.setProperty('--thumb-position',`${4+ratio*Math.max(0,slider.clientWidth-8)}px`);slider.querySelector('.range-value-bubble-text').textContent=input.value;};
      syncSlider();input.addEventListener('input',syncSlider);
    }
    input.addEventListener('input',()=>{const value=input.type==='checkbox'?(input.checked?1:0):Number(input.value);if(viewer.setMolangVariable(input.dataset.wheelValue,value)){const current=input.closest('.range-setting')?.querySelector('.range-value-current');if(current)current.textContent=String(value);}});
  });
  // Option scripts usually set other variables too (一键换装 sets every
  // clothing toggle), so refresh the rest of the form afterwards.
  wheel.querySelectorAll('[data-wheel-expression]').forEach(input=>input.addEventListener('change',()=>{if(input.checked&&viewer.executeMolang(input.dataset.wheelExpression))syncWheelSettings(wheel);}));
}
function radioSettingIndex(path,count){return Math.max(0,Math.min(count-1,Math.round(viewer.getMolangValue(path))));}
function syncWheelSettings(wheel){
  wheel.querySelectorAll('input[type="checkbox"][data-wheel-value]').forEach(input=>{input.checked=viewer.getMolangValue(input.dataset.wheelValue)>0;});
  wheel.querySelectorAll('input[type="range"][data-wheel-value]').forEach(input=>{
    const value=viewer.getMolangValue(input.dataset.wheelValue);if(value<Number(input.min)||value>Number(input.max)||Number(input.value)===value)return;
    input.value=String(value);input.dispatchEvent(new Event('input'));
  });
  wheel.querySelectorAll('[data-wheel-radio]').forEach(fieldset=>{const inputs=fieldset.querySelectorAll('input[type="radio"]'),selected=inputs[radioSettingIndex(fieldset.dataset.wheelRadio,inputs.length)];if(selected)selected.checked=true;});
}
function fitActionWheelControls(){
  const controls=document.querySelector('#action-wheel .action-wheel-controls'),breadcrumbs=controls?.querySelector('.wheel-breadcrumbs');if(!controls||!breadcrumbs||controls.closest('[hidden]'))return;
  const style=getComputedStyle(controls),children=[...controls.children],gaps=(Number.parseFloat(style.gap)||0)*Math.max(0,children.length-1),fixed=children.filter(child=>child!==breadcrumbs).reduce((width,child)=>width+child.getBoundingClientRect().width,0)+gaps+(Number.parseFloat(style.paddingLeft)||0)+(Number.parseFloat(style.paddingRight)||0)+2;
  const available=Math.max(0,window.innerWidth-20),pathWidth=Math.min(breadcrumbs.scrollWidth,Math.max(0,available-fixed));
  breadcrumbs.style.maxWidth=`${pathWidth}px`;controls.style.width=`${Math.min(available,fixed+pathWidth)}px`;
  // A path wider than the bar scrolls; keep the current level in view.
  breadcrumbs.scrollLeft=breadcrumbs.scrollWidth;
}
// keepFrame: a page turn swaps the sectors inside the existing SVG instead of
// replacing it, so the wheel's entry animation does not replay (it looked
// like the wheel closed and reopened).
function renderActionWheel({keepFrame=false}={}){
  const wheel=document.querySelector('#action-wheel');if(actionWheelSettings){renderWheelSettings(actionWheelSettings);return;}
  const entries=getWheelEntries(),pageSize=8,pageCount=Math.max(1,Math.ceil(entries.length/pageSize));actionWheelPage=Math.min(actionWheelPage,pageCount-1);
  const pageEntries=entries.slice(actionWheelPage*pageSize,(actionWheelPage+1)*pageSize),polar=(radius,angle)=>[120+Math.cos(angle)*radius,120+Math.sin(angle)*radius],gearButtons=[];
  const sectors=Array.from({length:8},(_,index)=>{
    const start=-Math.PI/2-Math.PI/8+index*Math.PI/4,end=start+Math.PI/4,[ix,iy]=polar(36,start),[ox,oy]=polar(110.4,start),[ex,ey]=polar(110.4,end),[fx,fy]=polar(36,end),[tx,ty]=polar(82.8,(start+end)/2),entry=pageEntries[index];
    const d=`M ${ix} ${iy} L ${ox} ${oy} A 110.4 110.4 0 0 1 ${ex} ${ey} L ${fx} ${fy} A 36 36 0 0 0 ${ix} ${iy} Z`;
    if(!entry)return `<g class="wheel-sector-empty"><path d="${d}"/></g>`;
    const styledLabel=wheelEntryStyledLabel(entry),displayLabel=wheelText(styledLabel)||entry.id,label=wheelEscape(displayLabel),form=wheelEntryForm(entry),group=wheelEntryGroup(entry),isPreviewAnimation=entry.id===WHEEL_PREVIEW_ANIMATION,animation=isPreviewAnimation?viewer.previewAnimationName:wheelEntryAnimation(entry);
    // A key with no clip, sub-wheel or settings form does nothing in the game either.
    const isReturn=entry.id===WHEEL_RETURN,isFolder=!isReturn&&(!!group||entry.id.startsWith('#')),isMissing=!isReturn&&!isFolder&&!animation,hint=isReturn?(actionWheelPath.length?tr('返回上一级'):tr('停止动作')):isFolder?tr('进入子目录'):animation?tr('播放 {0}', displayLabel):tr('模型没有对应动画');
    // The speaker sits between the hub and the label like in the exported wheel
    // image; with a settings gear both move apart so they never overlap.
    const mid=(start+end)/2,hasSound=appSettings.wheelSoundIcon&&!!animation&&!isFolder&&!isReturn&&wheelAnimationHasSound(viewer.animations?.[animation]),spread=form&&hasSound?0.17:0;
    const [gx,gy]=polar(48,mid-spread),[sx,sy]=polar(50,mid+spread);
    const sound=hasSound?`<g class="wheel-sector-sound" transform="translate(${sx} ${sy}) scale(1.25)" aria-hidden="true">${speakerIcon(0,0,'currentColor')}</g>`:'';
    if(form)gearButtons.push(`<button type="button" class="wheel-sector-gear-button" data-wheel-settings="${wheelEscape(form.id)}" style="left:${gx/240*100}%;top:${gy/240*100}%" aria-label="${tr('{0} 设置', label)}" title="${tr('{0} 设置', label)}">${materialIcon('settings')}</button>`);
    const isPlaying=animation&&viewer.animationName===animation;
    return `<g class="wheel-sector${isFolder||isReturn?' wheel-sector-folder':''}${isPreviewAnimation?' wheel-sector-preview':''}${isPlaying?' is-playing':''}${isMissing?' is-missing':''}" role="menuitem" tabindex="0" data-wheel-entry="${wheelEscape(entry.id)}" data-wheel-animation="${wheelEscape(animation||'')}" aria-label="${label}，${wheelEscape(hint)}"${isMissing?' aria-disabled="true"':''}${isPlaying?' aria-current="true"':''}><title>${label} · ${wheelEscape(hint)}</title><path d="${d}"/><text x="${tx}" y="${ty+3}" text-anchor="middle">${minecraftTextSvg(styledLabel)}</text>${sound}</g>`;
  }).join('');
  const breadcrumbs=[{id:'',label:tr('根目录')},...actionWheelPath.map(id=>{const group=viewer.customAnimationGroups.find(item=>String(item.id)===String(id));return{id:String(id),label:group?.name||id};})];
  const breadcrumbMarkup=breadcrumbs.map((crumb,index)=>{
    const label=wheelText(crumb.label)||String(crumb.id||tr('根目录')),isCurrent=index===breadcrumbs.length-1;
    const content=minecraftTextHtml(crumb.label||label),aria=wheelEscape(label);
    return `${index?'<span class="wheel-crumb-separator" aria-hidden="true">/</span>':''}${isCurrent?`<span class="wheel-crumb is-current" aria-current="location" aria-label="${aria}" title="${aria}">${content}</span>`:`<button type="button" class="wheel-crumb" data-wheel-depth="${index-1}" aria-label="${tr('返回{0}', aria)}" title="${tr('返回{0}', aria)}">${content}</button>`}`;
  }).join('');
  const controls=pageCount>1||actionWheelPath.length?`<div class="action-wheel-controls"><nav class="wheel-breadcrumbs" aria-label="${tr('动作轮盘路径')}">${breadcrumbMarkup}</nav><button type="button" id="wheel-prev" aria-label="${tr('上一页')}" ${actionWheelPage===0?'disabled':''}>${icon('chevron-left')}</button><span class="wheel-page-indicator" title="${tr('滚动鼠标滚轮翻页')}">${actionWheelPage+1} / ${pageCount}</span><button type="button" id="wheel-next" aria-label="${tr('下一页')}" ${actionWheelPage>=pageCount-1?'disabled':''}>${icon('chevron-right')}</button></div>`:'';
  const empty=entries.length?'':`<div class="action-wheel-empty">${tr('没有可用的额外动作')}</div>`;
  const svg=keepFrame&&wheel.querySelector(':scope>.action-wheel-svg');
  if(svg){
    const focused=document.activeElement?.id;
    svg.innerHTML=sectors;
    wheel.querySelectorAll(':scope>.action-wheel-controls,:scope>.wheel-sector-gear-button,:scope>.action-wheel-empty').forEach(element=>element.remove());
    svg.insertAdjacentHTML('beforebegin',controls);svg.insertAdjacentHTML('afterend',`${gearButtons.join('')}${empty}`);
    // The arrow that was pressed stays focused for keyboard paging.
    if(focused==='wheel-prev'||focused==='wheel-next')(wheel.querySelector(`#${focused}:not(:disabled)`)||wheel.querySelector('#wheel-prev:not(:disabled),#wheel-next:not(:disabled)'))?.focus();
  }else wheel.innerHTML=`${controls}<svg class="action-wheel-svg" viewBox="0 0 240 240" role="menu" aria-label="${tr('额外动作')}">${sectors}</svg>${gearButtons.join('')}${empty}`;
  fitActionWheelControls();
  
  wheel.querySelectorAll('[data-wheel-entry]').forEach(item=>{
    const activate=()=>{const id=item.dataset.wheelEntry,entry=entries.find(value=>value.id===id);pressWheelSector(item);if(id===WHEEL_RETURN){if(actionWheelPath.length){actionWheelPath.pop();actionWheelPage=0;renderActionWheel();}else{activateAnimation(findAnimation('idle'),tr('待机'));syncActionWheelPlaying();}return;}if(id.startsWith('#')){const group=wheelEntryGroup(entry);if(group){actionWheelPath.push(String(group.id));actionWheelPage=0;renderActionWheel();}else toast(tr('模型没有 {0} 子分类', id));return;}const entryLabel=wheelText(wheelEntryStyledLabel(entry)),animation=wheelEntryAnimation(entry);if(animation){activateAnimation(animation,entryLabel||animation,{once:true});syncActionWheelPlaying();return;}toast(tr('模型没有 {0} 动画', id));};
    item.onclick=()=>activate();item.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}};
  });
  wheel.querySelectorAll('[data-wheel-settings]').forEach(item=>{const open=event=>{event.stopPropagation();const form=getWheelForm(item.dataset.wheelSettings);if(form)renderWheelSettings(form,true);};item.onclick=open;item.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(event);}};});
  wheel.querySelectorAll('[data-wheel-depth]').forEach(item=>item.addEventListener('click',()=>{const depth=Number(item.dataset.wheelDepth);actionWheelPath=depth<0?[]:actionWheelPath.slice(0,depth+1);actionWheelPage=0;renderActionWheel();}));
  wheel.querySelector('#wheel-prev')?.addEventListener('click',()=>{actionWheelPage--;renderActionWheel({keepFrame:true});});
  wheel.querySelector('#wheel-next')?.addEventListener('click',()=>{actionWheelPage++;renderActionWheel({keepFrame:true});});
  document.querySelector('#action-wheel-close').onclick=closeActionWheel;
}
// Playing an action only moves the highlight; keep the current wheel elements
// so focus and pointer state are preserved.
function syncActionWheelPlaying(){
  const wheel=document.querySelector('#action-wheel');if(wheel.hidden||actionWheelSettings)return;
  wheel.querySelectorAll('[data-wheel-entry]').forEach(item=>{
    const playing=!!item.dataset.wheelAnimation&&viewer?.animationName===item.dataset.wheelAnimation;
    item.classList.toggle('is-playing',playing);if(playing)item.setAttribute('aria-current','true');else item.removeAttribute('aria-current');
  });
}
// 设置 → 轮盘按钮动效: a quick press without any outward overshoot.
function pressWheelSector(item){
  if(!appSettings.wheelBounce||item.classList.contains('is-missing')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  item.classList.remove('is-pressing');item.getBoundingClientRect();item.classList.add('is-pressing');
  item.onanimationend=event=>{if(event.animationName==='wheel-sector-press')item.classList.remove('is-pressing');};
}
function closeActionWheel(){document.querySelector('#action-wheel').hidden=true;document.querySelector('#action-wheel-button').setAttribute('aria-expanded','false');document.querySelector('#action-wheel-close').hidden=true;actionWheelPath=[];actionWheelPage=0;actionWheelSettings=null;}
// The close badge sits on the wheel button's top-right corner, wherever the toolbar lays it out.
function positionWheelClose(){const toolbar=document.querySelector('.viewer-tools').getBoundingClientRect(),button=document.querySelector('#action-wheel-button').getBoundingClientRect(),close=document.querySelector('#action-wheel-close');close.style.right=`${Math.max(0,toolbar.right-button.right-6)}px`;close.style.top=`${button.top-toolbar.top-6}px`;}
document.querySelector('#pose-walk').onclick=()=>needViewer()&&!mainStateForced()&&activateAnimation(findAnimation('walk'),tr('走'));
document.querySelector('#pose-run').onclick=()=>needViewer()&&!mainStateForced()&&activateAnimation(findAnimation('run'),tr('跑'));
document.querySelector('#pose-jump').onclick=()=>needViewer()&&!mainStateForced()&&activateAnimation(findAnimation('jump'),tr('跳'));
function openActionWheel(){renderActionWheel();document.querySelector('#action-wheel').hidden=false;fitActionWheelControls();document.querySelector('#action-wheel-button').setAttribute('aria-expanded','true');positionWheelClose();document.querySelector('#action-wheel-close').hidden=false;}
document.querySelector('#action-wheel-button').onclick=()=>{if(!needViewer())return;if(!document.querySelector('#action-wheel').hidden){closeActionWheel();return;}playControl?.unlock();openActionWheel();};
// 操控模式 (play-control.js): the canvas captures mouse and keyboard and the
// movement picks the main state; Esc releases the pointer (click the view to
// resume) and the toolbar button leaves the mode.
const MAIN_STATE_LABELS={idle:tr('待机'),walk:tr('走'),run:tr('跑'),jump:tr('跳'),sneak:tr('潜行'),sneaking:tr('潜行'),fly:tr('飞行'),elytra_fly:tr('鞘翅飞行'),swim:tr('游泳'),swim_stand:tr('水中')};
// 操控模式 item panel: hold K to pick what each hand holds, then Alt + left /
// right attacks with / uses it (ItemActions). Releasing K closes the panel
// and captures the mouse again.
const playItemPanel=document.querySelector('#play-item-panel');
let playItemPanelOpen=false,playItemHand='mainhand';
const PLAY_ITEM_ACTIONS=[['hold',tr('持')],['swing',tr('挥')],['use',tr('用')]];
function renderPlayItemPanel(){
  const hand=playItemHand,other=hand==='mainhand'?'offhand':'mainhand',animations=viewer?.animations||{};
  const menu=handItemMenu(animations,hand,undefined,handItems[other]);
  const triggers={hold:collectHoldTriggers(animations),...collectActionTriggers(animations)},fallbackSwing=hand==='mainhand'?'swing_hand':'swing_offhand';
  const entries=[menu.empty,...menu.matching,...menu.others].map(entry=>({...entry,clips:itemActionClips(animations,hand,entry.item,handItems[other],triggers)}));
  // An item "acts" when this model has a swing clip just for it or a use clip.
  const acts=entry=>entry.clips.use||entry.clips.swing&&entry.clips.swing!==fallbackSwing;
  const current=handItems[hand]?.key??'';
  const cell=entry=>{
    const tags=PLAY_ITEM_ACTIONS.filter(([key])=>entry.clips[key]).map(([key,label])=>`<span title="${wheelEscape(entry.clips[key])}">${label}</span>`).join('');
    return `<button type="button" class="play-item" role="radio" aria-checked="${entry.key===current}" data-play-item="${wheelEscape(entry.key)}" title="${wheelEscape(Object.values(entry.clips).filter(Boolean).join(' · ')||tr('该模型没有此物品的动画'))}"><span class="play-item-label">${wheelEscape(entry.label)}</span>${tags?`<span class="play-item-tags">${tags}</span>`:''}</button>`;
  };
  const group=(title,list)=>list.length?`<div class="play-item-subheader">${title}</div><div class="play-item-grid" role="radiogroup" aria-label="${title}">${list.map(cell).join('')}</div>`:'';
  const rest=entries.slice(1);
  playItemPanel.innerHTML=`<header><strong>${tr('选择物品')}</strong><div class="md-segmented play-item-hands" role="radiogroup" aria-label="${tr('选择手')}">${HANDS.map(item=>`<label><input type="radio" name="play-item-hand" value="${item}"${item===hand?' checked':''}>${materialIcon('check')}<span>${HAND_NAMES[item]}</span></label>`).join('')}</div></header>`
    +`<div class="play-item-body">${group(tr('空手'),[entries[0]])}${group(tr('有攻击或使用动画'),rest.filter(acts))}${group(tr('只有手持动画'),rest.filter(entry=>!acts(entry)&&entry.clips.hold))}${group(tr('其他物品'),rest.filter(entry=>!acts(entry)&&!entry.clips.hold))}</div>`
    +`<p class="play-item-note">${tr('松开 K 关闭 · Alt + 左键 攻击 · Alt + 右键 使用（按住拉弓、举盾、进食）')}</p>`;
  const byKey=new Map(entries.map(entry=>[entry.key,entry]));
  playItemPanel.querySelectorAll('[data-play-item]').forEach(button=>button.onclick=()=>{
    const entry=byKey.get(button.dataset.playItem);setHeldItem(hand,entry?.item||null);
    toast(`${HAND_NAMES[hand]}：${entry?.label||tr('空手')}`);
  });
  playItemPanel.querySelectorAll('input[name="play-item-hand"]').forEach(input=>input.onchange=()=>{if(input.checked){playItemHand=input.value;renderPlayItemPanel();}});
}
function openPlayItemPanel(){
  if(!playControl||playItemPanelOpen)return;
  closeActionWheel();playControl.unlock();
  playItemPanelOpen=true;renderPlayItemPanel();playItemPanel.hidden=false;
}
function closePlayItemPanel(relock=false){
  if(!playItemPanelOpen)return;
  playItemPanelOpen=false;playItemPanel.hidden=true;playItemPanel.replaceChildren();
  if(relock&&playControl)playControl.lock();
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&playItemPanelOpen){closePlayItemPanel();return;}
  if(!playControl||event.code!=='KeyK'||event.ctrlKey||event.altKey||event.metaKey||event.target.closest?.('input:not([type=radio]),textarea,select,[contenteditable]'))return;
  event.preventDefault();if(!event.repeat)openPlayItemPanel();
});
document.addEventListener('keyup',event=>{if(event.code==='KeyK'&&playItemPanelOpen){event.preventDefault();closePlayItemPanel(true);}});
function syncPlayControlUi(){
  const button=document.querySelector('#play-control-button'),hint=document.querySelector('#play-hint'),on=!!playControl,label=on?tr('退出操控模式'):tr('操控模式');
  button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));button.title=label;button.setAttribute('aria-label',label);
  document.querySelector('#viewport').classList.toggle('is-playing',on);if(!on)document.querySelector('#viewport').classList.remove('play-in-water');
  hint.hidden=!on;syncPlayView();
  if(!on){clearTimeout(playHintTimer);playHintKey=false;playHintShown=false;document.querySelector('#viewport').classList.remove('play-hud-hidden');return;}
  if(!playControl.locked){clearTimeout(playHintTimer);hint.className='play-hint';hint.textContent=tr('点击画面继续操控 · F5 切换人称 · Z 轮盘 · 再按工具栏操控按钮退出');return;}
  // The first capture after entering shows the whole keymap for a moment, then it folds into a chip.
  if(playHintKey)showPlayKeymap();else if(!playHintShown){playHintShown=true;showPlayKeymap(PLAY_HINT_TIME);}else foldPlayKeymap();
}
// The 操控模式 keymap: shown in full for PLAY_HINT_TIME after the mouse is
// first captured and while H is held, otherwise folded into a small "H 键位" chip.
const PLAY_KEYMAP=[
  [tr('移动'),[['WASD',tr('移动')],[tr('空格'),tr('跳跃')],['Shift',tr('潜行')],[tr('双击 W'),tr('疾跑')],[tr('双击空格'),tr('飞行')],[tr('空中按空格'),tr('鞘翅滑翔（角色状态里穿上鞘翅）')]]],
  [tr('水中'),[['X',tr('进入/离开水中')],[tr('空格'),tr('上浮')],['Shift',tr('下沉')],[tr('双击 W'),tr('游泳')]]],
  [tr('动作'),[[tr('Alt+左键'),tr('攻击')],[tr('Alt+右键'),tr('使用物品')],[tr('按住 K'),tr('选择物品')],['Z',tr('动作轮盘')]]],
  [tr('视角'),[['F5',tr('切换人称')],[tr('滚轮'),tr('缩放')],[tr('中键'),tr('恢复缩放')],[tr('右键拖动'),tr('移动视点')],[tr('双击右键'),tr('恢复视点')]]],
  [tr('其他'),[[tr('按住 H'),tr('查看键位')],['F1',tr('隐藏界面')],['Esc',tr('释放鼠标')]]],
];
const PLAY_HINT_TIME=4000;
let playHintTimer=0,playHintKey=false,playHintShown=false;
function showPlayKeymap(duration=0){
  const hint=document.querySelector('#play-hint');clearTimeout(playHintTimer);
  hint.className='play-hint play-keymap';
  hint.innerHTML=PLAY_KEYMAP.map(([title,keys])=>`<section><strong>${title}</strong>${keys.map(([key,action])=>`<span><kbd>${key}</kbd>${action}</span>`).join('')}</section>`).join('');
  if(duration)playHintTimer=setTimeout(foldPlayKeymap,duration);
}
function foldPlayKeymap(){
  const hint=document.querySelector('#play-hint');clearTimeout(playHintTimer);
  if(!playControl?.locked||playHintKey)return;
  hint.className='play-hint play-hint-chip';hint.innerHTML=`${materialIcon('keyboard')}<kbd>H</kbd><span>${tr('键位')}</span>`;
}
document.addEventListener('keydown',event=>{
  if(!playControl?.locked||event.ctrlKey||event.altKey||event.metaKey)return;
  // H shows the keymap while held; F1 hides every overlay of the view, like the game's F1.
  if(event.code==='KeyH'){event.preventDefault();if(!event.repeat){playHintKey=true;showPlayKeymap();}}
  else if(event.key==='F1'){event.preventDefault();if(!event.repeat)document.querySelector('#viewport').classList.toggle('play-hud-hidden');}
});
document.addEventListener('keyup',event=>{if(event.code==='KeyH'&&playHintKey){playHintKey=false;foldPlayKeymap();}});
// The current camera of 操控模式 (F5), shown at the top left of the view.
const PLAY_VIEW_LABELS={first:['visibility',tr('第一人称')],back:['person',tr('第三人称（背面）')],front:['face',tr('第三人称（正面）')]};
function syncPlayView(){
  const chip=document.querySelector('#play-view');chip.hidden=!playControl;if(!playControl)return;
  const [symbol,label]=PLAY_VIEW_LABELS[viewer.playView]||PLAY_VIEW_LABELS.back;
  // In water (X) a second segment says so; the view gets a blue tint.
  const water=playControl.inWater;document.querySelector('#viewport').classList.toggle('play-in-water',water);
  chip.innerHTML=`${materialIcon(symbol)}<span>${label}</span><kbd>F5</kbd>${water?`<span class="play-view-divider"></span>${materialIcon('pool')}<span>${tr('水中')}</span><kbd>X</kbd>`:''}`;
  chip.title=water?tr('当前人称：{0}，按 F5 切换；在水中，按 X 离开', label):tr('当前人称：{0}，按 F5 切换', label);
  chip.classList.remove('is-changed');chip.getBoundingClientRect();chip.classList.add('is-changed');
}
function showMainState(name){showAnimation(name,MAIN_STATE_LABELS[name]||name);syncActionWheelPlaying();}
function enterPlayControl(){
  if(!needViewer()||playControl)return;
  closeActionWheel();
  playControl=new PlayControl(document.querySelector('#scene'),{
    onState:name=>{if(!mainStateOverride)setMainState(name);},
    // AnimationLockEvent: movement, jump or sneak input stops a wheel action.
    onMoveInput:()=>{if(viewer.base)setMainState(playControl.state);},
    onLockChange:(locked,byCode)=>{
      // 3D view fullscreen: Esc (the browser releasing the mouse) leaves 操控模式, not the fullscreen.
      if(!locked&&!byCode&&fullscreenState().viewer){exitPlayControlByEscape();return;}
      syncPlayControlUi();
    },
    onPan:(dx,dy)=>viewer.panPlay(dx,dy),onPanReset:()=>viewer.resetPlayPan(),
    // A crossbow loads or fires, a fishing rod casts or reels in.
    onItemChange:(hand,item)=>setHeldItem(hand,item),
    onWaterChange:syncPlayView,
  });
  playControl.sensitivity=mouseSensitivity()/100;
  viewer.playing=true;setMainState('idle');
  viewer.setPlayControl(playControl);syncPlayControlUi();playControl.lock();
}
function exitPlayControl(){
  if(!playControl)return;
  closePlayItemPanel();playControl.dispose();playControl=null;syncPlayControlUi();
  if(viewer?.root){viewer.setPlayControl(null);setMainState('idle');}
}
document.querySelector('#play-control-button').onclick=()=>playControl?exitPlayControl():enterPlayControl();
// Esc in the 3D view's fullscreen (第 64 节): an open wheel / menu / panel closes
// first; in 操控模式 it leaves 操控模式 with a clear notice and the view stays
// fullscreen; otherwise it leaves the view's fullscreen. In the app's own
// fullscreen Esc does nothing. Whether an overlay was open is read in the
// capture phase, before the overlays' own Esc handlers close them.
let escapeOverlayOpen=false,escapeSwallowUntil=0,viewerNoticeTimer=0;
const VIEWER_OVERLAYS='#viewer-shell [role=menu]:not([hidden]), #viewer-shell [role=dialog]:not([hidden]), #viewer-shell [role=listbox]:not([hidden])';
// Rendered ones only: the wheel's inner SVG menu has no hidden attribute of its own.
window.addEventListener('keydown',event=>{if(event.key==='Escape')escapeOverlayOpen=[...document.querySelectorAll(VIEWER_OVERLAYS)].some(element=>element.getClientRects().length>0)||playItemPanelOpen;},true);
window.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.repeat||!fullscreenState().viewer||escapeOverlayOpen)return;
  event.preventDefault();
  if(playControl){exitPlayControlByEscape();return;}
  // The same Esc may also arrive after the pointer-lock release already left 操控模式.
  if(performance.now()<escapeSwallowUntil)return;
  setViewerFullscreen(false).catch(()=>{});
});
function exitPlayControlByEscape(){
  if(!playControl)return;
  exitPlayControl();escapeSwallowUntil=performance.now()+400;
  showViewerNotice('logout',tr('已退出操控模式'),tr('再按 Esc 退出全屏'));
}
function showViewerNotice(symbol,title,detail){
  const notice=document.querySelector('#viewer-notice');clearTimeout(viewerNoticeTimer);
  notice.innerHTML=`${materialIcon(symbol)}<span><strong>${title}</strong>${detail?`<span>${detail}</span>`:''}</span>`;
  notice.hidden=false;notice.classList.remove('is-shown');notice.getBoundingClientRect();notice.classList.add('is-shown');
  viewerNoticeTimer=setTimeout(hideViewerNotice,3000);
}
function hideViewerNotice(){clearTimeout(viewerNoticeTimer);const notice=document.querySelector('#viewer-notice');if(notice)notice.hidden=true;}
document.querySelector('#scene').addEventListener('click',()=>{if(!playControl||playControl.locked)return;closeActionWheel();playControl.lock();});
// The wheel zooms the follow camera (viewer.onWheel); a middle click restores the default zoom.
document.querySelector('#scene').addEventListener('mousedown',event=>{if(!playControl||event.button!==1)return;event.preventDefault();viewer.resetPlayZoom();});
// F5 cycles the camera like the game (first person → third person back → front) instead of reloading the page.
document.addEventListener('keydown',event=>{
  if(!playControl||event.key!=='F5'||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
  event.preventDefault();if(event.repeat)return;
  viewer.setPlayView(PLAY_VIEWS[(PLAY_VIEWS.indexOf(viewer.playView)+1)%PLAY_VIEWS.length]);syncPlayView();
});
// Z opens the wheel (releasing the pointer so its sectors can be clicked) and closes it again.
document.addEventListener('keydown',event=>{
  if(!playControl||event.code!=='KeyZ'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.target.closest?.('input,textarea,select,[contenteditable]'))return;
  event.preventDefault();
  if(document.querySelector('#action-wheel').hidden){playControl.unlock();openActionWheel();}
  else{closeActionWheel();playControl.lock();}
});
// Like the game, the mouse wheel pages the open wheel (down = next) instead of
// zooming; trackpad deltas are summed so one swipe turns one page.
let wheelScrollDelta=0,wheelScrollReset=0;
function turnActionWheelPage(step){
  const pageCount=Math.max(1,Math.ceil(getWheelEntries().length/8)),page=Math.min(pageCount-1,Math.max(0,actionWheelPage+step));
  if(page===actionWheelPage)return;actionWheelPage=page;renderActionWheel({keepFrame:true});
}
document.querySelector('#viewport').addEventListener('wheel',event=>{
  if(document.querySelector('#action-wheel').hidden||actionWheelSettings||!viewer)return;
  event.preventDefault();event.stopPropagation();
  if(Math.abs(event.deltaY)<Math.abs(event.deltaX))return;
  clearTimeout(wheelScrollReset);wheelScrollReset=setTimeout(()=>{wheelScrollDelta=0;},200);
  wheelScrollDelta+=event.deltaMode===0?event.deltaY:event.deltaY*40;
  if(Math.abs(wheelScrollDelta)<50)return;
  turnActionWheelPage(Math.sign(wheelScrollDelta));wheelScrollDelta=0;
},{capture:true,passive:false});
window.addEventListener('resize',fitActionWheelControls);
document.querySelector('#wheel-export-button').onclick=exportActionWheel;
document.querySelector('#center-view-button').onclick=()=>{if(!needViewer())return;if(playControl){viewer.resetPlayZoom();viewer.resetPlayPan();return;}viewer.reset();document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('selected',button.dataset.view==='front'));};
async function takeScreenshot(){if(!needViewer())return;try{const name=wheelText(activeModelName).replace(/[\\/:*?"<>|]/g,'_').trim()||'ysm-preview',{enabled,text,color,opacity}=watermarkSettings(),watermark={enabled,text,color,opacity:opacity/100};if(await savePng(await viewer.screenshot(watermark),`${name.slice(0,100)}.png`))toast(tr('截图已保存'));}catch(error){console.error(error);toast(tr('截图失败：{0}', error.message));}}
document.querySelector('#take-screenshot-button').onclick=takeScreenshot;
document.addEventListener('keydown',event=>{if(event.key==='F2'&&isAnyFullscreen()){event.preventDefault();takeScreenshot();}});
document.querySelector('#reset-pose-button').onclick=()=>{if(!needViewer())return;playControl?.reset();const idle=findAnimation('idle');if(idle)activateAnimation(idle,tr('待机'));else{viewer.time=0;viewer.applyFrame();viewer.onTime(viewer.time,viewer.duration);}};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('#action-wheel').hidden){closeActionWheel();document.querySelector('#action-wheel-button').focus();}});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{if(!needViewer())return;viewer.setView(b.dataset.view);document.querySelectorAll('[data-view]').forEach(v=>v.classList.toggle('selected',v===b));});
document.querySelectorAll('[data-animation]').forEach(b=>b.onclick=()=>{if(!needViewer()||mainStateForced())return;viewer.setAnimation(b.dataset.animation);document.querySelectorAll('[data-animation]').forEach(v=>v.classList.toggle('selected',v===b));document.querySelector('#animation-name').textContent=b.textContent.trim();syncPlay();});
function syncPlay(){const b=document.querySelector('#play-button');b.innerHTML=icon(viewer.playing?'pause':'play');b.setAttribute('aria-label',viewer.playing?tr('暂停动画'):tr('播放动画'));}
document.querySelector('#play-button').onclick=()=>{if(needViewer()){viewer.playing=!viewer.playing;syncPlay();}};
document.querySelector('#timeline').oninput=e=>{if(needViewer()){viewer.seek(Number(e.target.value));syncPlay();}};
document.querySelector('#speed').onchange=e=>{if(needViewer())viewer.speed=Number(e.target.value);};
document.querySelector('#fullscreen-button').onclick=async()=>{try{await setViewerFullscreen();}catch{toast(tr('当前浏览器不支持全屏预览'));}};
onFullscreenChange(({app,viewer:viewerFull})=>{
  if(!viewerFull)hideViewerNotice();
  const b=document.querySelector('#fullscreen-button');const label=viewerFull?tr('退出全屏'):tr('全屏');b.innerHTML=materialIcon(viewerFull?'fullscreen_exit':'fullscreen');b.setAttribute('aria-label',label);b.title=label;
  const appFull=app&&!viewerFull;
  const a=document.querySelector('#app-fullscreen-button');const appLabel=appFull?tr('退出全屏'):tr('全屏');a.innerHTML=materialIcon(appFull?'fullscreen_exit':'fullscreen');a.setAttribute('aria-label',appLabel);a.title=`${appLabel}（F11）`;
});
window.addEventListener('resize',()=>{if(!document.querySelector('#action-wheel').hidden)positionWheelClose();});
showEmptyModel();
if(location.hash==='#preview'||location.hash==='#settings')selectTab(location.hash.slice(1));
document.querySelectorAll('.md-range').forEach(syncRangeFill);
// Left navigation rail: the viewer page and the model library (src/library/,
// loaded on first use and connected only through mountLibrary's options).
let libraryModule=null,viewerScroll=0;
async function showView(name){
  for(const item of document.querySelectorAll('.nav-rail-item')){if(item.dataset.nav===name)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
  const library=name==='library',shell=document.querySelector('.page-shell');
  // Both views scroll the window: keep the viewer's position while away
  // (the library restores its own).
  if(library&&!shell.hidden)viewerScroll=scrollY;
  const wasHidden=shell.hidden;
  shell.hidden=library;document.querySelector('#library-view').hidden=!library;
  viewer?.setActive(!library&&!document.querySelector('#preview-panel').hidden);
  if(!library){if(wasHidden)scrollTo(0,viewerScroll);return;}
  if(!libraryModule)libraryModule=import('./library/library-view.js').then(({ mountLibrary })=>mountLibrary(document.querySelector('#library-view'),{
    toast,
    openModel:openLibraryModel,
    cardWarmUp:cardWarmUpSeconds,
  })).catch(error=>{libraryModule=null;console.error(error);toast(tr('模型库加载失败：{0}', error.message));});
  else (await libraryModule)?.refresh();
}
// Library models remember their id so the quick switcher can mark the current one.
let libraryModelId=null;
async function openLibraryModel(byPath,name,model){await showView('viewer');await loadImportedModel(byPath,tr('模型库中的模型'),name);libraryModelId=viewer?.root?model.id:null;currentLibraryModel=viewer?.root&&/\.ysm$/i.test(model.fileName)?model:null;}
// L in the 3D view opens the quick model switcher (library covers in a column
// on the left, src/library/model-switcher.js, loaded on first use).
let modelSwitcher=null;
document.addEventListener('keydown',async event=>{
  if(event.code!=='KeyL'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.target.closest?.('input,textarea,select,[contenteditable]'))return;
  if(document.querySelector('.page-shell').hidden||document.querySelector('#preview-panel').hidden||document.querySelector('dialog[open]')||modelBusy)return;
  event.preventDefault();
  modelSwitcher??=import('./library/model-switcher.js').then(({ createModelSwitcher })=>createModelSwitcher(document.querySelector('#viewport'),{toast,currentId:()=>libraryModelId,openModel:openLibraryModel})).catch(error=>{modelSwitcher=null;console.error(error);toast(tr('快速切换加载失败：{0}', error.message));});
  const switcher=await modelSwitcher;
  if(!switcher||switcher.isOpen)return;
  playControl?.unlock();closeActionWheel();
  switcher.open();
});
document.querySelector('.nav-rail').onclick=event=>{const item=event.target.closest('[data-nav]');if(item)showView(item.dataset.nav);};
if(location.hash==='#library')showView('library');
setupScrollbars();
setupDesktop();
setupLogoFavicon();
// Double-clicked .ysm files and second starts of the app (第 54 节).
setupOpenFiles({
  async openFile(file){
    await showView('viewer');
    while(modelBusy)await new Promise(resolve=>setTimeout(resolve,200));
    try{await importModelArchive(file);}catch(error){console.error(error);toast(tr('加载出错：{0}', error.message||tr('模型文件格式无效')));}
  },
  alreadyRunning:()=>toast(tr('YSM模型工具已经在运行，不能多开')),
  onError:error=>{console.error(error);toast(tr('无法打开文件：{0}', error.message));},
});
