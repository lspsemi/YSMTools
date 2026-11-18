// 模型状态 panel: a small pill at the top of the 3D view showing what the
// model is doing — the current action or main state, a speaker with animated
// sound waves while a sound plays, and in 操控模式 the movement indicators
// (run / jump / fly / elytra glide / swim) with the active one animated.
// The caller builds a plain state object each frame; DOM writes happen only
// when a part of it changes (see 第 32 节: per-frame UI must skip unchanged writes).
import { tr } from './i18n.js';

export const MOVEMENT_INDICATORS=[
  {key:'run',icon:'sprint',label:()=>tr('跑')},
  {key:'jump',icon:'keyboard_double_arrow_up',label:()=>tr('跳')},
  {key:'fly',icon:'flight',label:()=>tr('飞行')},
  {key:'elytra_fly',icon:'paragliding',label:()=>tr('鞘翅飞行')},
  {key:'swim',icon:'pool',label:()=>tr('游泳')},
];
// Main states (play-control.js selectMainState) → the indicator they light.
const MOVEMENT_OF_STATE={run:'run',jump:'jump',fly:'fly',elytra_fly:'elytra_fly',swim:'swim',swim_stand:'swim'};
export const movementIndicator=state=>MOVEMENT_OF_STATE[state]||null;

const icon=name=>`<span class="material-symbol-icon" aria-hidden="true">${name}</span>`;
// Speaker body plus three waves; CSS shows the waves one by one, then hides them together.
const SPEAKER=`<svg class="model-status-speaker" viewBox="0 0 24 24" aria-hidden="true"><path class="speaker-body" d="M3 9.5h3.6L11 5.6v12.8l-4.4-3.9H3z"/><path class="speaker-wave w1" d="M14 9.6a3.4 3.4 0 0 1 0 4.8"/><path class="speaker-wave w2" d="M16.3 7.3a6.6 6.6 0 0 1 0 9.4"/><path class="speaker-wave w3" d="M18.6 5a9.8 9.8 0 0 1 0 14"/></svg>`;

export function createModelStatus(viewport){
  const root=document.createElement('div');
  root.className='model-status';root.id='model-status';root.setAttribute('role','status');root.hidden=true;
  root.innerHTML=`<span class="model-status-kind">${icon('accessibility_new')}</span><span class="model-status-label"></span><span class="model-status-sound" title="${tr('正在播放声音')}" hidden>${SPEAKER}</span><span class="model-status-moves" role="group" aria-label="${tr('移动状态')}" hidden>${MOVEMENT_INDICATORS.map(item=>`<span class="model-status-move" data-move="${item.key}" title="${item.label()}" aria-label="${item.label()}">${icon(item.icon)}</span>`).join('')}</span>`;
  viewport.append(root);
  const kind=root.querySelector('.model-status-kind .material-symbol-icon'),label=root.querySelector('.model-status-label'),sound=root.querySelector('.model-status-sound'),moves=root.querySelector('.model-status-moves');
  const moveItems=new Map([...moves.children].map(item=>[item.dataset.move,item]));
  let last={};
  /**
   * state: {visible, labelHtml, labelText, action (wheel action playing),
   * sound, play (操控模式), movement (indicator key or null)}
   */
  function update(state){
    const visible=!!state?.visible;
    if(visible!==last.visible)root.hidden=!visible;
    if(!visible){last={visible};return;}
    if(state.labelHtml!==last.labelHtml){label.innerHTML=state.labelHtml;label.title=state.labelText||'';}
    if(state.action!==last.action){kind.textContent=state.action?'animation':'accessibility_new';root.classList.toggle('is-action',!!state.action);}
    if(state.sound!==last.sound){sound.hidden=!state.sound;}
    if(state.play!==last.play)moves.hidden=!state.play;
    if(state.movement!==last.movement){
      for(const [key,item] of moveItems){const on=key===state.movement;item.classList.toggle('is-active',on);if(on)item.setAttribute('aria-current','true');else item.removeAttribute('aria-current');}
    }
    last={...state,visible};
  }
  return {element:root,update,dispose(){root.remove();}};
}
