import { evaluateMolang, executeMolangStatements, animationLength, animationLoopMode, animationBlendWeight, executeTimeline, sampleAnimationBones } from './ysm-animation.js';
import { collectHoldTriggers, collectActionTriggers, resolveHoldAnimation, resolveSwingAnimation, resolveUseAnimation, mainAnimationFor } from './hand-items.js';

const DEG=Math.PI/180;
const BUILTIN_STATE='ysm-builtin';
const ENTRY_STATE_PREFIX='ysm-entry-';
// EquipmentSlot.values() order in Minecraft 1.20.
const EQUIPMENT_SLOTS=['mainhand','offhand','feet','legs','chest','head'];

export function mergeControllerFiles(files=[]){
  const merged={};
  for(const file of files){
    const controllers=file?.animation_controllers||file?.['minecraft:animation_controllers']||{};
    for(const [name,controller] of Object.entries(controllers))merged[name]=controller;
  }
  return merged;
}

// Convert Bedrock/YSM controller JSON into ordered states. State and
// transition order matters because the first true transition wins.
export function normalizeControllers(rawControllers={}){
  const normalized=new Map();
  for(const [name,controller] of Object.entries(rawControllers||{})){
    const states=new Map();
    for(const [stateName,state] of Object.entries(controller?.states||{})){
      const transitions=[];
      for(const entry of state?.transitions||[]){
        if(!entry||typeof entry!=='object')continue;
        for(const [target,condition] of Object.entries(entry))transitions.push({target,condition:String(condition??'')});
      }
      const animations=[];
      for(const entry of Array.isArray(state?.animations)?state.animations:[]){
        if(typeof entry==='string'){if(entry)animations.push({name:entry,condition:null});continue;}
        if(!entry||typeof entry!=='object')continue;
        for(const [animation,condition] of Object.entries(entry))if(animation)animations.push({name:animation,condition:typeof condition==='string'||typeof condition==='number'?condition:null});
      }
      const soundEffects=(Array.isArray(state?.sound_effects)?state.sound_effects:state?.sound_effects?[state.sound_effects]:[]).map(item=>String(item?.effect??item??'')).filter(Boolean);
      states.set(stateName,{animations,transitions,on_entry:Array.isArray(state?.on_entry)?state.on_entry:[],on_exit:Array.isArray(state?.on_exit)?state.on_exit:[],sound_effects:soundEffects,blend:blendCurve(state?.blend_transition)});
    }
    normalized.set(name,{initial_state:controller?.initial_state||controller?.initial||'default',states});
  }
  return normalized;
}

// Transition curves (JsonAnimationControllerUtils.getBlendTransition): a
// number is a linear blend over that many seconds (TicksInterpolator); an
// object maps seconds to the old pose's weight, 1 → 0
// (LinearKeyframeInterpolator). `factor(t)` is how far the bones have moved
// to the new clip t seconds in; null means no transition.
function ticksCurve(seconds){const length=Number(seconds);return length>0?{length,factor:t=>t/length}:null;}
export function blendCurve(value){
  if(typeof value==='number')return ticksCurve(value);
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const points=Object.entries(value).map(([key,weight])=>[Number.parseFloat(key),Number(weight)]).filter(([key,weight])=>Number.isFinite(key)&&Number.isFinite(weight)).sort((a,b)=>a[0]-b[0]);
  if(points.length<2||!(points.at(-1)[0]>0))return null;
  const segments=points.slice(1).map(([end,weight],i)=>({start:points[i][0],end,from:1-points[i][1],to:1-weight}));
  return {length:points.at(-1)[0],factor:t=>{
    const segment=segments.find(item=>t<=item.end)||segments.at(-1);
    if(t<=segment.start)return segment.from;if(t>=segment.end)return segment.to;
    return segment.from+(segment.to-segment.from)*(t-segment.start)/(segment.end-segment.start);
  }};
}
// The built-in controllers' transition (main, hold, use, vehicle, passenger: 0.1 s).
const BUILTIN_BLEND=ticksCurve(0.1);
// AnimationControllerInstance ends a PLAY_ONCE clip (or a stopped built-in
// one) by fading its last pose out over 3 ticks; AnimationData likewise eases
// a bone no layer drives any more back to rest over 3 ticks.
const ENDING_TIME=3/20,RESET_TIME=3/20;

// MathUtil.nlerpEulerAngles on bone params (radians, the rest pose
// included): ZYX Euler angles → quaternions, normalized lerp, back to ZYX.
function quaternionZYX(x,y,z){
  const cx=Math.cos(x/2),sx=Math.sin(x/2),cy=Math.cos(y/2),sy=Math.sin(y/2),cz=Math.cos(z/2),sz=Math.sin(z/2);
  return [cz*cy*sx-sz*sy*cx,cz*sy*cx+sz*cy*sx,sz*cy*cx-cz*sy*sx,cz*cy*cx+sz*sy*sx];
}
function nlerpEuler(t,from,to,out){
  const a=quaternionZYX(from[0],from[1],from[2]),b=quaternionZYX(to[0],to[1],to[2]);
  const sign=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]>=0?1:-1,q=a.map((value,i)=>value*(1-t)+b[i]*t*sign);
  const length=Math.hypot(...q)||1,[x,y,z,w]=q.map(value=>value/length);
  out[0]=Math.atan2(y*z+w*x,0.5-x*x-y*y);out[1]=Math.asin(Math.max(-1,Math.min(1,-2*(x*z-w*y))));out[2]=Math.atan2(x*y+w*z,0.5-y*y-z*z);
}
const lerp=(t,a,b)=>a+(b-a)*t;

// Per-controller bone accumulator. Inside one controller state YSM sums the
// weighted rotations/positions of all active animations and multiplies their
// scales (AnimationControllerRuntime.BoneBlendState). Layers then overwrite
// earlier layers channel by channel (AnimationProcessor.applyTransform).
class BoneLayer {
  constructor(count){
    this.rotation=new Float32Array(count*3);this.position=new Float32Array(count*3);this.scale=new Float32Array(count*3);this.flags=new Uint8Array(count);this.touched=[];
    // Per bone channel (rotation, position, scale): the TransitionVector3f
    // percentCompleted (0 = replace the layers below, p = blend toward them)
    // and, while a JSON state blends in, the pose it starts from.
    this.percent=new Float32Array(count*3);this.factor=new Float32Array(count*3);this.from=new Array(count*3);
  }
  clear(){for(const id of this.touched)this.flags[id]=0;this.touched.length=0;}
  /**
   * Adds a clip's bone values. `source` is null for a running clip,
   * {begin:factor, from} for a JSON state's clip blending in (the first
   * source of a channel decides; the sum then moves from `from`), or
   * {end:p, json} for a clip fading out (ConstantPoint).
   */
  add(id,rotation,position,scale,weight,source=null){
    const o=id*3;
    if(!this.flags[id]){this.touched.push(id);this.rotation.fill(0,o,o+3);this.position.fill(0,o,o+3);this.scale.fill(1,o,o+3);this.percent.fill(1,o,o+3);this.factor.fill(NaN,o,o+3);}
    const ending=source?.end!==undefined,percent=ending?source.end:0;
    if(ending&&source.json)weight*=1-percent;
    const channel=(bit,c)=>{
      if(!(this.flags[id]&bit)&&source?.begin!==undefined){this.factor[o+c]=source.begin;this.from[o+c]=source.from;}
      this.flags[id]|=bit;if(percent<this.percent[o+c])this.percent[o+c]=percent;
    };
    if(rotation){channel(1,0);for(let i=0;i<3;i++)this.rotation[o+i]+=rotation[i]*weight;}
    if(position){channel(2,1);for(let i=0;i<3;i++)this.position[o+i]+=position[i]*weight;}
    if(scale){channel(4,2);for(let i=0;i<3;i++)this.scale[o+i]*=1+(scale[i]-1)*weight;}
  }
  // additiveRotation mirrors the deprecated parallel mode, which adds its
  // rotation on top of the layers below instead of replacing it. `driven`
  // collects which channels any layer wrote this frame.
  writeTo(skeleton,additiveRotation=false,driven=null){
    const params=skeleton.params,rest=skeleton.rest,value=[0,0,0];
    for(const id of this.touched){
      const p=id*9,o=id*3,flags=this.flags[id];
      if(driven)driven[id]|=flags;
      if(flags&1){
        const x=this.rotation[o]*DEG,y=this.rotation[o+1]*DEG,z=this.rotation[o+2]*DEG;
        if(additiveRotation){params[p]-=x;params[p+1]-=y;params[p+2]+=z;}
        else{
          value[0]=rest[o]-x;value[1]=rest[o+1]-y;value[2]=rest[o+2]+z;
          if(!Number.isNaN(this.factor[o])){const from=this.from[o];nlerpEuler(this.factor[o],from?[from[p],from[p+1],from[p+2]]:[rest[o],rest[o+1],rest[o+2]],value,value);}
          const percent=this.percent[o];
          if(percent>0)nlerpEuler(percent,value,[params[p],params[p+1],params[p+2]],value);
          params[p]=value[0];params[p+1]=value[1];params[p+2]=value[2];
        }
      }
      for(const [bit,c,offset,values,neutral] of [[2,1,3,this.position,0],[4,2,6,this.scale,1]]){
        if(!(flags&bit))continue;
        const from=this.from[o+c],factor=this.factor[o+c],percent=this.percent[o+c];
        for(let i=0;i<3;i++){
          let v=values[o+i];
          if(!Number.isNaN(factor))v=lerp(factor,from?from[p+offset+i]:neutral,v);
          if(percent>0)v=lerp(percent,v,params[p+offset+i]);
          params[p+offset+i]=v;
        }
      }
    }
  }
}

// Samples a clip's bone values once, to hold them (a fading clip's last pose).
function captureBones(animation,time,context,index){
  const values=[];
  sampleAnimationBones(animation,time,context,index,(id,rotation,position,scale)=>values.push([id,rotation,position,scale]));
  return values;
}
// The previous frame's final bone params: the pose a transition starts from.
const poseSnapshot=context=>context.previousBoneParams?Float32Array.from(context.previousBoneParams):null;

function sampleInto(layer,animation,time,loopMode,context,index){
  const length=animationLength(animation);
  let t=time;
  if(loopMode==='loop'){if(length>0&&Number.isFinite(length))t=((time%length)+length)%length;else if(length===0)t=0;}
  else if(time>=length&&loopMode==='once')return false;
  else t=Math.min(time,length);
  const weight=animationBlendWeight(animation,context);
  sampleAnimationBones(animation,t,context,index,(id,rotation,position,scale)=>layer.add(id,rotation,position,scale,weight));
  return true;
}

// AnimationControllerInstance marks a clip finished once its local time
// passes the end; a looping clip stays "finished" after its first pass.
function slotFinished(animation,loopMode,elapsed){
  const length=animationLength(animation);
  return loopMode==='once'?elapsed>=length:elapsed>length;
}
// A JSON state's clip at `elapsed` seconds after the state was entered:
// BEGINNING_TRANSITION (frozen at 0 while the bones blend in), then RUNNING
// from 0, and for PLAY_ONCE an ENDING_TRANSITION fade.
function slotPhase(slot,animation,elapsed){
  const blend=slot.blend;
  if(blend&&elapsed<blend.length)return {begin:blend.factor(elapsed),local:0};
  const local=blend?elapsed-blend.length:elapsed,length=animationLength(animation);
  if(animationLoopMode(animation)==='once'&&local>=length)return {end:(local-length)/ENDING_TIME,local:length};
  return {local};
}

// One Bedrock animation controller (AnimationControllerRuntime). Each state's
// clips start at the moment the state is entered.
class ControllerInstance {
  constructor(name,definition,builtin=null){this.name=name;this.definition=definition;this.builtin=builtin;this.reset();}
  // transitionValues: each transition condition's value the last time this state was checked (Molang 监视器, 第 66 节).
  reset(){this.stateName=null;this.state=null;this.enterTime=0;this.slots=[];this.transitionState=null;this.transitionValues=[];this.finished=[0,0];}
  snapshot(){return {stateName:this.stateName,state:this.state,enterTime:this.enterTime,slots:this.slots.map(slot=>({...slot,timeline:{...slot.timeline}}))};}
  restore(saved){Object.assign(this,saved);}
  enter(stateName,state,context,now){
    if(this.state)executeMolangStatements(this.state.on_exit,context);
    executeMolangStatements(state.on_entry,context);
    context.audioChannel?.stopAll();
    for(const effect of state.sound_effects||[])context.audioChannel?.play(effect);
    this.stateName=stateName;this.state=state;this.enterTime=now;
    const playsClips=stateName!==BUILTIN_STATE&&!stateName.startsWith(ENTRY_STATE_PREFIX);
    // Every clip of the state blends in from the pose the bones had (the previous frame's).
    const from=playsClips&&state.blend&&state.animations.length?poseSnapshot(context):null;
    this.slots=playsClips?state.animations.map(entry=>({name:entry.name,condition:entry.condition,active:true,timeline:{last:-1,cycle:0},blend:state.blend,from,ending:null,timelineDone:false})):[];
  }
  update(context,now,animations){
    const visited=new Set();
    for(let guard=0;guard<64&&this.step(context,now,animations,visited);guard++)if(this.slots.length)break;
    for(const slot of this.slots){
      if(slot.condition!==null)slot.active=evaluateMolang(slot.condition,context)!==0;
      const animation=animations[slot.name];
      if(!slot.active||!animation)continue;
      // Timeline events run only while RUNNING (the rest up to the end when a PLAY_ONCE clip finishes).
      const loopMode=animationLoopMode(animation),phase=slotPhase(slot,animation,now-this.enterTime);
      if(phase.begin!==undefined||slot.timelineDone)continue;
      if(phase.end!==undefined)slot.timelineDone=true;
      context.query.anim_time=phase.local;
      executeTimeline(animation,phase.local,context,slot.timeline,loopMode==='loop');
    }
  }
  step(context,now,animations,visited){
    const states=this.definition.states;
    if(!this.state){
      const initial=states.get(this.definition.initial_state);if(!initial)return false;
      visited.add(this.definition.initial_state);this.enter(this.definition.initial_state,initial,context,now);return true;
    }
    // query.all_animations_finished / any_animation_finished (PlaybackFlags).
    let active=0,allFinished=true,anyFinished=false;
    for(const slot of this.slots){
      const animation=animations[slot.name];if(!slot.active)continue;active++;
      const phase=animation&&slotPhase(slot,animation,now-this.enterTime);
      if(!animation||phase.end!==undefined||phase.begin===undefined&&slotFinished(animation,animationLoopMode(animation),phase.local))anyFinished=true;else allFinished=false;
    }
    if(!active)anyFinished=true;
    const query=context.query;query.all_animations_finished=allFinished?1:0;query.any_animation_finished=anyFinished?1:0;
    // Remember what each condition evaluated to (null = not reached) for the Molang 监视器.
    const transitions=this.state.transitions,values=this.transitionValues;
    this.transitionState=this.state;values.length=transitions.length;values.fill(null);this.finished[0]=query.all_animations_finished;this.finished[1]=query.any_animation_finished;
    try{
      for(let i=0;i<transitions.length;i++){
        const transition=transitions[i],value=transition.condition?evaluateMolang(transition.condition,context):1;
        values[i]=value;
        if(value===0)continue;
        const next=states.get(transition.target);
        if(!next||visited.has(transition.target))return false;
        visited.add(transition.target);this.enter(transition.target,next,context,now);return true;
      }
      return false;
    }finally{query.all_animations_finished=0;query.any_animation_finished=0;}
  }
  contribute(layer,context,now,animations,index){
    // The built-in predicate takes over with this state's blend_transition (CompositeAnimationController).
    if(this.stateName===BUILTIN_STATE){this.builtin?.(layer,context,now,{blend:this.state.blend,epoch:this.enterTime});return;}
    for(const slot of this.slots){
      const animation=animations[slot.name];if(!slot.active||!animation)continue;
      const phase=slotPhase(slot,animation,now-this.enterTime),weight=animationBlendWeight(animation,context);
      if(phase.end!==undefined){
        if(phase.end>=1)continue;
        slot.ending??=captureBones(animation,phase.local,context,index);
        for(const [id,rotation,position,scale] of slot.ending)layer.add(id,rotation,position,scale,weight,{end:phase.end,json:true});
      }else if(phase.begin!==undefined)sampleAnimationBones(animation,0,context,index,(id,rotation,position,scale)=>layer.add(id,rotation,position,scale,weight,{begin:phase.begin,from:slot.from}));
      else sampleInto(layer,animation,phase.local,animationLoopMode(animation),context,index);
    }
  }
}

// A built-in (predicate) controller's AnimationControllerInstance. A new clip
// blends in over `blend` from the bones' pose, frozen at its first frame:
// rotation by nlerp, position lerped and scaled by lerp(f, 1, weight), scale
// straight to the clip (isScaleTransitionSpecial). When the predicate stops
// (no clip), the last pose fades out over 3 ticks.
class ClipPlayer {
  constructor(){this.name=null;this.epoch=undefined;this.ending=null;this.last=null;}
  // stopTransition: the next clip (even the same one) starts over at once.
  restart(){this.name=undefined;}
  play(layer,clip,context,now,skeleton,{blend=null,epoch}={}){
    const index=skeleton.index;
    // A JSON controller re-entering ysm-builtin restarts the predicate (clearAnimation, no fade).
    if(epoch!==this.epoch){this.epoch=epoch;this.name=null;this.ending=null;this.last=null;}
    const name=clip?.name??null;
    if(name!==this.name){
      if(name===null){if(this.last&&!this.ending)this.ending={start:now,weight:this.last.weight,values:captureBones(this.last.animation,this.last.time,context,index)};}
      else{this.start=now;this.blend=blend;this.from=blend?poseSnapshot(context):null;this.ending=null;}
      this.name=name;
    }
    if(!clip){
      const ending=this.ending;if(!ending)return;
      const percent=(now-ending.start)/ENDING_TIME;if(percent>=1){this.ending=null;this.last=null;return;}
      for(const [id,rotation,position,scale] of ending.values)layer.add(id,rotation,position,scale,ending.weight,{end:percent,json:false});
      return;
    }
    const {animation,time,mode}=clip,weight=animationBlendWeight(animation,context),length=animationLength(animation);
    this.last={animation,weight,time:mode==='loop'?(length>0&&Number.isFinite(length)?((time%length)+length)%length:0):Math.min(time,length)};
    const elapsed=now-this.start;
    if(!this.blend||elapsed>=this.blend.length){sampleInto(layer,animation,time,mode,context,index);return;}
    const factor=this.blend.factor(elapsed),from=this.from,rest=skeleton.rest,value=[0,0,0];
    sampleAnimationBones(animation,0,context,index,(id,rotation,position,scale)=>{
      const p=id*9,o=id*3;let blendedRotation=null,blendedPosition=null;
      if(rotation){
        value[0]=rest[o]-rotation[0]*weight*DEG;value[1]=rest[o+1]-rotation[1]*weight*DEG;value[2]=rest[o+2]+rotation[2]*weight*DEG;
        nlerpEuler(factor,from?[from[p],from[p+1],from[p+2]]:[rest[o],rest[o+1],rest[o+2]],value,value);
        blendedRotation=[(rest[o]-value[0])/DEG,(rest[o+1]-value[1])/DEG,(value[2]-rest[o+2])/DEG];
      }
      if(position){const scaleBy=lerp(factor,1,weight);blendedPosition=position.map((v,i)=>lerp(factor,from?from[p+3+i]:0,v)*scaleBy);}
      if(blendedRotation||blendedPosition)layer.add(id,blendedRotation,blendedPosition,null,1);
      if(scale)layer.add(id,null,null,scale,weight);
    });
  }
}

// Recreates PlayerAnimationController's processor pipeline for a third-person
// player without armor: the controller order, which controller
// names claim which slot, and how plain parallelN clips fill unclaimed slots.
export class YsmControllerRuntime {
  /**
   * With `arm`, builds FirstPersonArmAnimationController instead: the
   * "fp.arm.misc" controller, the fp.arm parallel slots (controllers
   * "fp.arm.parallel_*" and the fp_arm clips parallel0..7) and the
   * "fp.arm.armor_*" controllers, over the first-person arm model.
   */
  constructor(controllers=new Map(),animations={},{preview=false,arm=false}={}){
    this.controllers=controllers instanceof Map?controllers:normalizeControllers(controllers);
    this.animations=animations||{};
    this.layers=[];this.timelines=new Map();this.holdTriggers=collectHoldTriggers(this.animations);this.actionTriggers=collectActionTriggers(this.animations);this.holdStates={};this.players=new Map();
    const names=[...this.controllers.keys()];
    const controller=(name,builtin=null)=>{const definition=this.controllers.get(name);if(definition)this.layers.push({instance:new ControllerInstance(name,definition,builtin)});};
    // ControllerSlotBinder: "player.<slot>" plus "player.<slot>_*", sorted.
    const prefix=arm?'fp.arm':'player',prefixPattern=prefix.replace('.','\\.');
    const slotGroup=slot=>{const pattern=new RegExp(`^${prefixPattern}\\.${slot}(_.+)?$`);for(const name of names.filter(item=>pattern.test(item)).sort())controller(name);};
    // ParallelProcessor: controllers "player.<slot>_*" and clips "<slot>0".."<slot>7".
    // Only the "parallel" group is built in the deprecated (additive rotation)
    // mode; "pre_parallel" layers overwrite like any other controller.
    const parallelGroup=(slot,additive=false)=>{
      const slots=new Map(),pattern=new RegExp(`^${prefixPattern}\\.${slot}_.+`),clipPattern=new RegExp(`^${slot}[0-7]$`);
      for(const name of names)if(pattern.test(name))slots.set(name,null);
      for(const [name,clip] of Object.entries(this.animations))if(clipPattern.test(name)&&!isEmptyAnimation(clip))slots.set(`${prefix}.${slot}_${name.slice(slot.length)}`,name);
      for(const key of [...slots.keys()].sort()){
        const linked=slots.get(key),builtin=linked?(layer,context,now,options)=>this.sampleBuiltin(layer,key,linked,context,now,options):null;
        if(this.controllers.has(key))this.layers.push({instance:new ControllerInstance(key,this.controllers.get(key),builtin),additive});
        else if(linked)this.layers.push({builtin,builtinKey:key,linked,additive});
      }
    };
    this.layer=null;this.mainRequest=null;this.capRequest=null;
    if(arm){
      controller('fp.arm.misc');parallelGroup('parallel',true);
      if(!preview)for(const slot of EQUIPMENT_SLOTS)controller(`fp.arm.armor_${slot}`);
      return;
    }
    parallelGroup('pre_parallel');
    controller('player.vehicle');
    slotGroup('pre_main');
    if(this.controllers.has('player.main'))controller('player.main',(layer,context,now,options)=>this.sampleMain(layer,context,now,options));
    else this.layers.push({main:true});
    slotGroup('post_main');
    // The hold, swing and use predicates stop for the GUI preview entity.
    const predicate=(key,sample)=>{
      const builtin=preview?null:sample;
      if(this.controllers.has(key))controller(key,builtin);else if(builtin)this.layers.push({builtin,builtinKey:key});
    };
    const hold=hand=>predicate(`player.hold_${hand}`,(layer,context,now,options)=>this.sampleHold(layer,hand,context,now,options));
    slotGroup('pre_hold');hold('offhand');hold('mainhand');slotGroup('post_hold');
    slotGroup('pre_swing');predicate('player.swing',(layer,context,now,options)=>this.sampleSwing(layer,context,now,options));slotGroup('post_swing');
    slotGroup('pre_use');predicate('player.use',(layer,context,now,options)=>this.sampleUse(layer,context,now,options));slotGroup('post_use');
    controller('player.passenger');
    // The cap controller plays wheel actions on top of main, so a clip only
    // overrides the bones it animates (a sound-only clip keeps idle running).
    this.layers.push({cap:true});
    // GUI-only controllers of the preview entity (PlayerAnimationController
    // "gui_hover" / "gui_focus"): ModelButton loops `hover` / `hover_fadeout`
    // / `focus` on them (see setGuiAnimations).
    if(preview){this.layers.push({gui:'hover'});this.layers.push({gui:'focus'});}
    parallelGroup('parallel',true);
    // ArmorSlotProcessor only runs outside the GUI preview.
    if(!preview)for(const slot of EQUIPMENT_SLOTS)controller(`player.armor_${slot}`);
    this.layer=null;this.mainRequest=null;this.capRequest=null;
  }
  /**
   * Molang 监视器 (第 66 节): every JSON controller in execution order with its
   * state, the time spent in it, the state's clips and what each transition
   * condition evaluated to on the last check (null = not reached, or the
   * state changed since).
   */
  inspect(now){
    const out=[];
    for(const layer of this.layers){
      const instance=layer.instance;if(!instance)continue;
      const state=instance.state,fresh=state&&instance.transitionState===state;
      out.push({name:instance.name,state:instance.stateName,time:state?Math.max(0,now-instance.enterTime):0,
        clips:instance.slots.map(slot=>({name:slot.name,active:!!slot.active,missing:!this.animations[slot.name]})),
        finished:fresh?[...instance.finished]:null,
        transitions:state?state.transitions.map((transition,i)=>({target:transition.target,condition:transition.condition,value:fresh?instance.transitionValues[i]??null:null})):[]});
    }
    return out;
  }
  reset(){for(const layer of this.layers)layer.instance?.reset();this.timelines.clear();this.holdStates={};this.actionStates={};this.guiStates={};this.players.clear();this.lastDriven?.fill(-Infinity);}
  player(key){let player=this.players.get(key);if(!player){player=new ClipPlayer();this.players.set(key,player);}return player;}
  snapshot(){return {instances:this.layers.map(layer=>layer.instance?.snapshot()),timelines:new Map([...this.timelines].map(([key,value])=>[key,{...value}])),holdStates:structuredClone(this.holdStates)};}
  restore(saved){this.layers.forEach((layer,i)=>{if(layer.instance&&saved.instances[i])layer.instance.restore(saved.instances[i]);});this.timelines=saved.timelines;this.holdStates=saved.holdStates||{};}
  timeline(key){let state=this.timelines.get(key);if(!state){state={last:-1,cycle:0};this.timelines.set(key,state);}return state;}
  // Built-in parallel clips are always played as LOOP (NamedAnimationPredicate).
  sampleBuiltin(layer,key,name,context,now,{blend=null,epoch}={}){
    const animation=this.animations[name];if(!animation)return;
    if(this.advance){context.query.anim_time=now;executeTimeline(animation,now,context,this.timeline(key),true);}
    this.player(key).play(layer,{name,animation,time:now,mode:'loop'},context,now,this.skeleton,{blend,epoch});
  }
  // The hold predicates pick a clip from the held item (context.handItems) and
  // play it with its own loop type (format >= 19); a new clip starts from 0
  // and stops the controller's sounds.
  sampleHold(layer,hand,context,now,{blend=BUILTIN_BLEND,epoch}={}){
    // checkSwingAndUse: a hand that swings or uses its item pauses (adds nothing, keeps its clip).
    const actions=context.itemActions;
    if(actions&&(actions.swinging&&actions.swingingArm===hand||actions.usingHand===hand))return;
    const name=resolveHoldAnimation(hand,context.handItems,this.holdTriggers,{sprinting:context.ctrl.run===1});
    let state=this.holdStates[hand];
    if(!state||state.name!==name){
      state=this.holdStates[hand]={name,start:now};
      this.timelines.delete(`hold:${hand}`);context.audioChannel?.stopAll();
    }
    const animation=name&&this.animations[name],time=now-state.start,mode=animation&&animationLoopMode(animation);
    if(animation&&this.advance){context.query.anim_time=time;executeTimeline(animation,time,context,this.timeline(`hold:${hand}`),mode==='loop');}
    this.player(`hold:${hand}`).play(layer,animation?{name,animation,time,mode}:null,context,now,this.skeleton,{blend,epoch});
  }
  // Plays an action predicate's clip (with its own loop type) from state.start;
  // null fades the last pose out.
  playAction(layer,key,state,context,now,options){
    const animation=state?.name&&this.animations[state.name],time=now-(state?.start??now),mode=animation&&animationLoopMode(animation);
    // A finished PLAY_ONCE clip ends (fades out) even while the predicate continues.
    const ended=animation&&mode==='once'&&time>=animationLength(animation);
    if(animation&&!ended&&this.advance){context.query.anim_time=time;executeTimeline(animation,time,context,this.timeline(key),mode==='loop');}
    this.player(key).play(layer,animation&&!ended?{name:state.name,animation,time,mode}:null,context,now,this.skeleton,options);
  }
  // ItemHoldAnimationPredicate: while swinging, the swinging hand's clip;
  // each new swing (swingTime 0) restarts it without a transition. After
  // the swing the clip CONTINUEs to its end.
  sampleSwing(layer,context,now,{blend=null,epoch}={}){
    const actions=context.itemActions;let state=this.actionStates?.swing;
    if(actions?.swinging){
      const name=resolveSwingAnimation(actions.swingingArm,context.handItems,this.actionTriggers);
      if(!state||state.seq!==actions.swingSeq||state.name!==name){
        state=(this.actionStates??={}).swing={name,start:now,seq:actions.swingSeq};
        this.timelines.delete('swing');context.audioChannel?.stopAll();this.player('swing').restart();
      }
    }
    this.playAction(layer,'swing',state,context,now,{blend,epoch});
  }
  // InteractionHandAnimationPredicate: while an item is used, the using
  // hand's clip (LOOP for old formats); the first tick skips the transition.
  // Releasing the item STOPs it.
  sampleUse(layer,context,now,{blend=BUILTIN_BLEND,epoch}={}){
    const actions=context.itemActions,hand=actions?.usingHand;let state=this.actionStates?.use;
    if(!hand){if(this.actionStates)this.actionStates.use=null;this.playAction(layer,'use',null,context,now,{blend,epoch});return;}
    const name=resolveUseAnimation(hand,context.handItems,this.actionTriggers),fresh=!state||state.seq!==actions.useSeq;
    if(fresh||state.name!==name){
      state=(this.actionStates??={}).use={name,start:now,seq:actions.useSeq};
      this.timelines.delete('use');context.audioChannel?.stopAll();if(fresh)this.player('use').restart();
    }
    this.playAction(layer,'use',state,context,now,{blend:fresh?null:blend,epoch});
  }
  // The main slot's built-in AnimationManager plays the selected clip as LOOP;
  // a request with loop:false plays it once and holds the end pose.
  sampleMain(layer,context,now,{blend=BUILTIN_BLEND,epoch}={}){
    const request=this.mainRequest,name=request&&mainAnimationFor(request.name,context.handItems,this.animations),animation=name&&this.animations[name];
    const loop=request?.loop!==false;
    if(animation&&this.advance){context.query.anim_time=request.time;executeTimeline(animation,request.time,context,this.timeline(`main:${name}`),loop);}
    this.player('main').play(layer,animation?{name,animation,time:request.time,mode:loop?'loop':'hold'}:null,context,now,this.skeleton,{blend,epoch});
  }
  // PlayerBaseAnimationPredicate sets the wheel action with the clip's own loop
  // type; a finished PLAY_ONCE clip no longer contributes.
  // The cap controller has no blend-in; a stopped action fades out over 3 ticks.
  sampleCap(layer,context,now){
    const request=this.capRequest,animation=request&&this.animations[request.name];
    const loop=request?.mode==='loop';
    if(animation&&this.advance){context.query.anim_time=request.time;executeTimeline(animation,request.time,context,this.timeline(`cap:${request.name}`),loop);}
    this.player('cap').play(layer,animation?{name:request.name,animation,time:request.time,mode:loop?'loop':'hold'}:null,context,now,this.skeleton);
  }
  /** Starts or stops a wheel action on the cap layer: its timeline restarts and its old sounds stop. */
  restartCap(){
    for(const key of [...this.timelines.keys()])if(key.startsWith('cap:'))this.timelines.delete(key);
    for(const entry of this.layers)if(entry.cap)entry.channel?.stopAll();
  }
  /**
   * ModelButton.renderWidget picks the clips of the preview entity's GUI
   * controllers each frame: `hover` while hovered, `hover_fadeout` for its
   * length after the mouse leaves, `focus` while focused, otherwise "empty"
   * (a model may define a clip with that name). Null stops the controller.
   */
  setGuiAnimations({hover=null,focus=null}={}){this.guiNames={hover,focus};}
  // PredicateBasedController with a 0-tick transition: the clip always plays
  // as LOOP. A new name clears the old clip at once (clearAnimation, no fade)
  // and stops the controller's sounds; so does every loop wrap
  // (executeRemainingEvents resets the SoundKeyFrameExecutor).
  sampleGui(layer,slot,context,now){
    const key=`gui:${slot}`,name=this.guiNames?.[slot]||null;
    let state=(this.guiStates??={})[slot];
    if(!state||state.name!==name){
      state=this.guiStates[slot]={name,start:now,cycle:0};
      this.timelines.delete(key);this.players.delete(key);context.audioChannel?.stopAll();
    }
    const animation=name&&this.animations[name];if(!animation)return;
    const time=now-state.start,length=animationLength(animation);
    if(this.advance){
      const cycle=length>0&&Number.isFinite(length)?Math.floor(time/length):0;
      if(cycle!==state.cycle){state.cycle=cycle;context.audioChannel?.stopAll();}
      context.query.anim_time=time;executeTimeline(animation,time,context,this.timeline(key),true);
    }
    this.player(key).play(layer,{name,animation,time,mode:'loop'},context,now,this.skeleton);
  }
  /** Stops every sound this runtime's controllers started. */
  stopSounds(){for(const entry of this.layers)entry.channel?.stopAll();}
  /** Restarts the main clip: its timeline fires again and its old sounds stop. */
  restartMain(name){
    this.timelines.delete(`main:${name}`);this.timelines.delete(`main:tac:${name}`);
    for(const entry of this.layers)if(entry.main||entry.instance?.name==='player.main')entry.channel?.stopAll();
  }
  apply({skeleton,context,now,main,cap=null,advance=true}){
    const count=skeleton.count;
    if(!this.layer||this.layer.flags.length!==count){
      this.layer=new BoneLayer(count);this.driven=new Uint8Array(count);
      this.lastDriven=new Float64Array(count*3).fill(-Infinity);this.lastValues=new Float32Array(count*9);
    }
    this.skeleton=skeleton;this.index=skeleton.index;this.advance=advance;this.mainRequest=main;this.capRequest=cap;
    const layer=this.layer,animations=this.animations,driven=this.driven;
    for(const entry of this.layers){
      layer.clear();
      // The card (preview entity) is silent except for its GUI controllers' clips.
      const audio=entry.gui?context.guiAudio:context.audio;
      if(audio&&!entry.channel)entry.channel=audio.createChannel();
      context.audioChannel=audio?entry.channel:null;
      if(entry.instance){if(advance)entry.instance.update(context,now,animations);entry.instance.contribute(layer,context,now,animations,this.index);}
      else if(entry.main)this.sampleMain(layer,context,now);
      else if(entry.cap)this.sampleCap(layer,context,now);
      else if(entry.gui)this.sampleGui(layer,entry.gui,context,now);
      else entry.builtin(layer,context,now);
      layer.writeTo(skeleton,entry.additive&&(!entry.instance||entry.instance.stateName===BUILTIN_STATE),driven);
    }
    this.easeUndrivenBones(skeleton,now);
    context.audioChannel=null;context.query.anim_time=main?.time??now;
  }
  // AnimationProcessor: a bone channel no layer drove this frame eases from
  // its last driven value back to rest over 3 ticks (rotation by nlerp).
  easeUndrivenBones(skeleton,now){
    const params=skeleton.params,rest=skeleton.rest,driven=this.driven,lastDriven=this.lastDriven,last=this.lastValues,value=[0,0,0];
    for(let id=0;id<skeleton.count;id++){
      const p=id*9,o=id*3,flags=driven[id];driven[id]=0;
      for(let c=0;c<3;c++){
        const offset=p+c*3;
        if(flags&(1<<c)){lastDriven[o+c]=now;for(let i=0;i<3;i++)last[offset+i]=params[offset+i];continue;}
        const progress=(now-lastDriven[o+c])/RESET_TIME;
        if(!(progress<1))continue;
        if(c===0){nlerpEuler(Math.max(0,progress),[last[offset],last[offset+1],last[offset+2]],[rest[o],rest[o+1],rest[o+2]],value);params[offset]=value[0];params[offset+1]=value[1];params[offset+2]=value[2];}
        else for(let i=0;i<3;i++)params[offset+i]=lerp(Math.max(0,progress),last[offset+i],c===1?0:1);
      }
    }
  }
}

// Animation.isEmpty(): no bone channels and no timeline/sound events.
function isEmptyAnimation(animation){
  const has=value=>value&&typeof value==='object'&&Object.keys(value).length>0;
  return !has(animation?.bones)&&!has(animation?.timeline)&&!has(animation?.sound_effects)&&!has(animation?.particle_effects);
}
