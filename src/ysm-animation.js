import { sampleChannel } from './animation.js';
import { compileMolang } from './molang.js';
import { perlinNoise3 } from './stb-perlin.js';

// YSM's Molang math.sin/cos accept degrees (see YSM MathBinding/Sin/Cos),
// unlike JavaScript's native radian-based trigonometry.
const math={pi:Math.PI,e:Math.E,sin:v=>Math.sin(v*Math.PI/180),cos:v=>Math.cos(v*Math.PI/180),tan:v=>Math.tan(v*Math.PI/180),asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,sqrt:Math.sqrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,round:Math.round,pow:Math.pow,exp:Math.exp,log:Math.log,min:Math.min,max:Math.max,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lerp:(a,b,t)=>a+(b-a)*t,to_radians:v=>v*Math.PI/180,to_degrees:v=>v*180/Math.PI,mod:(a,b)=>a%b,trunc:Math.trunc,sign:Math.sign,ln:Math.log,random:(a,b)=>a+Math.random()*(b-a),random_integer:(a,b)=>Math.round(a+Math.random()*(b-a)),die_roll:(n,a,b)=>{let sum=0;for(let i=0;i<n;i++)sum+=a+Math.random()*(b-a);return sum;},die_roll_integer:(n,a,b)=>{let sum=0;for(let i=0;i<n;i++)sum+=Math.round(a+Math.random()*(b-a));return sum;},hermite_blend:t=>3*t*t-2*t*t*t,min_angle:a=>{a%=360;if(a>=180)a-=360;if(a<-180)a+=360;return a;},lerprotate:(a,b,t)=>{let d=((b-a)%360+540)%360-180;return a+d*t;}};
const expressionCache=new Map();
const proxyCache=new WeakMap(),proxyTargets=new WeakMap(),placeholders=new WeakSet();
const makeProxy=(target={})=>{
  if(proxyCache.has(target))return proxyCache.get(target);
  const proxy=new Proxy(target,{get(o,k){
    if(k in o){const value=o[k];return value&&typeof value==='object'?makeProxy(value):value;}
    if(k===Symbol.toPrimitive)return ()=>0;
    if(k==='valueOf')return ()=>0;
    if(k==='toString')return ()=>"0";
    if(typeof k==='symbol')return undefined;
    // Unset Molang variables read as 0 but remain "unset" for `??`.
    const placeholder={};placeholders.add(placeholder);
    return o[k]=makeProxy(placeholder);
  },set(o,k,v){o[k]=v;return true;}});
  proxyCache.set(target,proxy);proxyCache.set(proxy,proxy);proxyTargets.set(proxy,target);return proxy;
};
const rawTarget=value=>proxyTargets.get(value)||value;
const isPlaceholder=value=>placeholders.has(value)&&!Object.keys(value).length;
// Left operand of Molang's `??`: undefined when the variable was never set.
function lookupMolang(root,keys){
  let value=rawTarget(root);
  for(const key of keys){if(!value||typeof value!=='object'||!(key in value))return undefined;value=value[key];}
  if(value&&typeof value==='object'){value=rawTarget(value);return isPlaceholder(value)?undefined:value;}
  return value;
}
// Compiled code reads and writes the plain objects behind the variable
// proxies. That is the per-frame hot path (physics rigs run thousands of
// statements per frame), so it must not go through Proxy traps or create
// placeholders: a missing key is an unset variable and reads as 0. The proxy
// view still serves code outside Molang (viewer.getMolangValue and friends).
const UNSET=Object.freeze(Object.create(null));
// One property step with the same results as the proxy's get trap: objects
// yield UNSET for missing keys, primitives index natively (null throws, which
// aborts the statement like the original TypeError did).
const step=(o,k)=>o!==null&&typeof o==='object'?(k in o?o[k]:UNSET):o[k];
function readValue(value){
  if(value===null||typeof value!=='object')return value;
  if(value===UNSET)return 0;
  value=rawTarget(value);return isPlaceholder(value)?0:value;
}
// Assignment walks like the proxy did but stores real structs, never proxies.
const child=(o,k)=>{if(o!==null&&typeof o==='object'){if(k in o)return o[k];const struct={};o[k]=struct;return struct;}return o[k];};
// Generated code used to run sloppy, where assigning to a primitive's
// property is ignored; this module is strict, so guard it explicitly.
function assign(o,k,value){if(o!==null&&typeof o==='object')o[k]=value;else if(o===null||o===undefined)throw new TypeError('invalid assignment');return value;}
// Reading a never-set variable yields Molang's 0. A bare placeholder object is
// truthy in JavaScript, which would flip `!v.x` and `v.x ? a : b`.
function valueMolang(value){
  if(value===null||typeof value!=='object')return value;
  if(value===UNSET)return 0;
  const target=proxyTargets.get(value)||value;
  return placeholders.has(target)&&!Object.keys(target).length?0:value;
}
const BREAK=Symbol('break');
function truthyMolang(value){if(typeof value==='number')return value!==0&&value===value;value=valueMolang(value);return typeof value==='string'?value!=='':typeof value==='object'?value!==null:Boolean(value)&&!Number.isNaN(value);}
// Runtime helpers referenced by code from compileMolang().
// ValueConversions.asFloat(): NaN and missing values are 0, booleans 1/0, other objects 1.
function numberMolang(value){if(typeof value==='number')return value===value?value:0;value=valueMolang(value);if(typeof value==='number')return Number.isNaN(value)?0:value;if(typeof value==='boolean')return value?1:0;if(value===null||value===undefined)return 0;return 1;}
const molangRuntime={BREAK,value:valueMolang,lookup:lookupMolang,truthy:truthyMolang,num:numberMolang,
  g1:(o,a)=>readValue(step(o,a)),
  g2:(o,a,b)=>readValue(step(step(o,a),b)),
  g3:(o,a,b,c)=>readValue(step(step(step(o,a),b),c)),
  gn(o,keys){for(const key of keys)o=step(o,key);return readValue(o);},
  s1:(o,a,value)=>assign(o,a,value),
  s2:(o,a,b,value)=>assign(child(o,a),b,value),
  s3:(o,a,b,c,value)=>assign(child(child(o,a),b),c,value),
  sn(o,keys,value){for(let i=0;i<keys.length-1;i++)o=child(o,keys[i]);return assign(o,keys[keys.length-1],value);},
  // Receiver of a nested call such as q.a.b(): undefined when unset.
  owner(o,keys){for(const key of keys)o=step(o,key);return o===UNSET?undefined:o;},
  div(a,b){const divisor=numberMolang(b);return divisor===0?0:numberMolang(a)/divisor;},
  // Unknown functions (unsupported queries) evaluate to 0, as in YSM.
  call(owner,name,args){const fn=owner?.[name];if(typeof fn!=='function')return 0;try{return fn(...args.map(valueMolang))??0;}catch{return 0;}},
  member(object,key){if(object===null||object===undefined)return 0;return valueMolang(object[key]??0);},
  loop(count,body){const n=Math.min(1024,Math.max(0,Math.floor(Number(count)||0)));for(let i=0;i<n;i++)if(body()===BREAK)break;return 0;},
  forEach(list,assign,body){if(!list||typeof list[Symbol.iterator]!=='function')return 0;for(const item of list){assign(item);if(body()===BREAK)break;}return 0;},
};
function compiledMolang(source){
  let entry=expressionCache.get(source);
  if(!entry){
    try{const {body,usesTemp,usesContext,writes}=compileMolang(source);entry={fn:new Function('v','ysm','query','ctrl','math','t','ctx','H',body),usesTemp,usesContext,writes};}
    catch{entry={fn:()=>0,usesTemp:false,usesContext:false,writes:false};}
    expressionCache.set(source,entry);
  }
  return entry;
}
// Raw storage behind the context's variable proxies, resolved once per context.
const contextRoots=new WeakMap();
function rootsOf(ctx){
  let roots=contextRoots.get(ctx);
  if(!roots||roots.vSource!==ctx.v||roots.ysmSource!==ctx.ysm||roots.querySource!==ctx.query||roots.ctrlSource!==ctx.ctrl){
    roots={vSource:ctx.v,ysmSource:ctx.ysm,querySource:ctx.query,ctrlSource:ctx.ctrl,v:rawTarget(ctx.v),ysm:rawTarget(ctx.ysm),query:rawTarget(ctx.query),ctrl:rawTarget(ctx.ctrl)};
    contextRoots.set(ctx,roots);
  }
  return roots;
}
// Each call gets fresh temp./context. storage, created only when referenced.
function runCompiled(entry,ctx,roots){
  try{return entry.fn(roots.v,roots.ysm,roots.query,roots.ctrl,math,entry.usesTemp?{}:null,entry.usesContext?(ctx.molangContext?rawTarget(ctx.molangContext):{}):null,molangRuntime);}catch{return 0;}
}
function runMolang(source,ctx){return runCompiled(compiledMolang(source),ctx,rootsOf(ctx));}
// IPhysics.setArgs: a first_order and a second_order call with the same name
// share one PhysicsManager entry, whichever kind created it.
function setPhysicsArgs(state,input,a,b,c){
  state.input=Number(input)||0;
  if(state.type==='first')state.response=Number(a);
  else{state.frequency=Number(a);state.coefficient=Number(b);state.response=Number(c);}
}
export function createYsmAnimationContext(){
  const ysmValues={},variables=makeProxy({roaming:{}}),ysm=makeProxy(Object.assign(ysmValues,{'has_boots':0,'has_helmet':0,'has_chest_plate':0,'has_leggings':0,'food_level':20,'head_yaw':0,'head_pitch':0})),query=makeProxy({'health':20,'health_percent':100,'max_health':20,'armor_value':0,'body_y_rotation':0,'eye_target_y_rotation':0,'head_x_rotation':0,'head_y_rotation':0,'eye_target_x_rotation':0,'anim_time':0,'life_time':0}),ctrl=makeProxy({playing_extra_animation:0});
  const context={v:variables,variable:variables,ysm,query,q:query,ctrl,math,time:0,lifeTime:0,physics:new Map(),boneRotationResolver:null,boneParamResolver:null};
  // YSM's secondary motion is stateful. Keep the same spring instance per
  // named Molang function across frames, just like its PhysicsManager.
  ysm.second_order=(name,input,frequency=1,coefficient=1,response=1)=>{
    const key=String(name??'');if(!key)return 0;
    const state=context.physics.get(key);
    if(!state){context.physics.set(key,{input:Number(input)||0,inputFunction:0,lastSimulation:0,lastSimulationDot:0,frequency:Number(frequency),coefficient:Number(coefficient),response:Number(response)});return Number(input)||0;}
    setPhysicsArgs(state,input,frequency,coefficient,response);
    return state.lastSimulation;
  };
  // FirstOrderFunction: the first call returns the input, later calls the filtered value.
  ysm.first_order=(name,input,response=1)=>{
    const key=String(name??'');if(!key)return 0;
    const state=context.physics.get(key);
    if(!state){context.physics.set(key,{type:'first',input:Number(input)||0,response:Number(response),lastSimulation:0});return Number(input)||0;}
    setPhysicsArgs(state,input,response,0,0);
    return state.lastSimulation;
  };
  ysm.perlin_noise=(seed,x,y=0,z=0)=>perlinNoise3(x,y,z,Math.trunc(Number(seed)||0));
  // YSMBinding.isCloseEyes: closed for the ticks strictly between 85 and 90 of
  // every 90-tick cycle (the game offsets the cycle by uuid % 10 ticks; the
  // viewer's player uses 0).
  Object.defineProperty(ysmValues,'is_close_eyes',{enumerable:true,configurable:true,get(){const phase=(context.lifeTime*20)%90;return phase>85&&phase<90?1:0;}});
  ysm.bone_rot=name=>context.boneRotationResolver?.(String(name??''))||{x:0,y:0,z:0};
  // bone_pos / bone_scale / bone_pivot_abs (BoneParamFunction), read like bone_rot.
  ysm.bone_pos=name=>context.boneParamResolver?.('position',String(name??''))||{x:0,y:0,z:0};
  ysm.bone_scale=name=>context.boneParamResolver?.('scale',String(name??''))||{x:0,y:0,z:0};
  ysm.bone_pivot_abs=name=>context.boneParamResolver?.('pivot_abs',String(name??''))||{x:0,y:0,z:0};
  // SoundFunction: play_sound(id, name[, flags[, volume[, pitch]]]); flag 4 loops.
  // Contexts without an audio player (the character card) stay silent.
  // context.audioChannel is the channel of the controller being evaluated
  // (set by YsmControllerRuntime); flag 2 / global:true uses the global one.
  context.audio=null;context.audioChannel=null;
  const channelFor=global=>global?context.audio?.global:(context.audioChannel||context.audio?.global);
  // Numeric ids: 0 is untracked and negative ids are rejected (SoundFunction).
  const soundId=id=>typeof id==='number'?(id<0?undefined:id===0?0:`n:${id}`):`s:${id}`;
  ysm.play_sound=(id,name,flags=0,volume=1,pitch=1)=>{
    const key=soundId(id),bits=Number(flags)||0;if(key===undefined||bits<0||bits>7)return 0;
    // SoundFunction stops the sound at once for the preview entity (hasCustomTexture).
    if(context.previewEntity)return 0;
    return channelFor(bits&2)?.play(name,{id:key,force:(bits&1)===1,loop:(bits&4)===4,volume:Number(volume)||1,pitch:Number(pitch)||1})?1:0;
  };
  ysm.stop_sound=(id,global=0)=>{const key=soundId(id);return key&&channelFor(global)?.stop(key)?1:0;};
  ysm.stop_all_sounds=(global=0)=>{channelFor(global)?.stopAll();return 1;};
  return context;
}

// Matches YSM PhysicsManager.update() plus SecondOrder.update(). Called once
// before evaluating each rendered frame, so every expression sees the same
// spring state and keyframes remain independent of the number of bones.
/**
 * Makes `context` read and write the same v.roaming struct as `source`, as
 * the first-person arm entity does with the player's (setRoamingProperties).
 */
export function shareRoamingVariables(context,source){rawTarget(context.v).roaming=rawTarget(source.v).roaming;}
export function advanceYsmPhysics(context,timeStep){
  if(!context?.physics||!(timeStep>0))return;
  for(const state of context.physics.values()){
    // FirstOrder.update
    if(state.type==='first'){const k=timeStep/state.response;state.lastSimulation=(1-k)*state.lastSimulation+k*state.input;continue;}
    const frequency=Math.max(0.001,Math.min(5,Number.isFinite(state.frequency)?state.frequency:1));
    const coefficient=Math.max(0,Math.min(1,Number.isFinite(state.coefficient)?state.coefficient:1));
    const response=Number.isFinite(state.response)?state.response:1;
    const k1=coefficient/Math.PI/frequency;
    const k2=1/(2*Math.PI*frequency)/(2*Math.PI*frequency);
    const k3=response*coefficient/2/Math.PI/frequency;
    const inputDot=(state.input-state.inputFunction)/timeStep;
    state.inputFunction=state.input;
    const maxTimeStep=Math.sqrt(4*k2+k1*k1)-k1;
    const cycles=Math.max(1,Math.ceil(timeStep/Math.max(maxTimeStep,1e-6)));
    const dt=timeStep/cycles;
    for(let i=0;i<cycles;i++){
      state.lastSimulation+=dt*state.lastSimulationDot;
      state.lastSimulationDot+=dt*(k3*inputDot+state.input-state.lastSimulation-k1*state.lastSimulationDot)/k2;
    }
  }
}
function evalExpr(expr,ctx){
  if(typeof expr==='number')return expr;
  if(typeof expr==='boolean')return expr?1:0;
  if(typeof expr!=='string'||!expr.trim())return 0;
  const source=expr.trim();
  return valueMolang(runMolang(source,ctx))??0;
}
/**
 * Molang 监视器 (第 61 节): the raw result of an expression (number, string or
 * struct), without the numeric coercion evaluateMolang applies. Throws on a
 * syntax error so the inspector can say so; runtime errors still yield 0.
 */
export function inspectMolang(expression,context){
  const source=String(expression??'').trim();if(!source)return 0;
  compileMolang(source);
  return readValue(runMolang(source,context))??0;
}
/**
 * Molang 监视器: every value currently stored in a context's v. / ctrl. /
 * ysm. / q. scopes as [{path, value}]. Never-set placeholders and functions are
 * skipped; structs are flattened (`v.roaming.size`). Reads raw storage, so it
 * creates no placeholders and does not disturb `??`.
 */
export function inspectMolangScopes(context,limit=4000){
  const out=[],seen=new WeakSet();
  const walk=(prefix,object,depth)=>{
    for(const key of Object.keys(object)){
      if(out.length>=limit)return;
      let value;try{value=object[key];}catch{continue;}
      if(typeof value==='function')continue;
      const path=`${prefix}.${key}`;
      if(value&&typeof value==='object'){
        value=rawTarget(value);
        if(value===UNSET||isPlaceholder(value)||seen.has(value))continue;
        seen.add(value);
        if(depth<6)walk(path,value,depth+1);
        continue;
      }
      out.push({path,value});
    }
  };
  for(const [name,root] of [['v',context?.v],['ctrl',context?.ctrl],['ysm',context?.ysm],['q',context?.query]])if(root)walk(name,rawTarget(root),0);
  return out;
}
// Molang 监视器 锁定 (第 66 节): a locked variable becomes an accessor on the
// raw storage whose getter returns the locked value and whose setter ignores
// writes, so every reader (compiled Molang, the proxies, the viewer's own
// per-frame query updates) sees the value and no script can change it.
const LOCK=Symbol('molang-lock');
const LOCK_ROOTS={v:'v',ctrl:'ctrl',ysm:'ysm',q:'query'};
function lockOwner(context,scope,keys,create){
  let owner=context?.[LOCK_ROOTS[scope]];if(!owner)return null;
  owner=rawTarget(owner);
  for(const key of keys.slice(0,-1)){
    let next=owner[key];
    if(next===null||typeof next!=='object'){if(!create)return null;next={};owner[key]=next;}
    owner=rawTarget(next);
  }
  return owner;
}
/** Locks `scope.keys…` of a context to a number or string. Returns false when it cannot. */
export function lockMolangVariable(context,{scope,keys},value){
  const owner=lockOwner(context,scope,keys,true),key=keys[keys.length-1];if(!owner)return false;
  const current=Object.getOwnPropertyDescriptor(owner,key);
  if(current?.get?.[LOCK]){current.get[LOCK].value=value;return true;}
  if(current&&!current.configurable)return false;
  const lock={value,original:current||null},get=()=>lock.value;get[LOCK]=lock;
  Object.defineProperty(owner,key,{configurable:true,enumerable:true,get,set(){}});
  return true;
}
/** Releases a lock: a plain variable keeps the locked value, a built-in getter comes back. */
export function unlockMolangVariable(context,{scope,keys}){
  const owner=lockOwner(context,scope,keys,false),key=keys[keys.length-1];if(!owner)return;
  const current=Object.getOwnPropertyDescriptor(owner,key),lock=current?.get?.[LOCK];if(!lock)return;
  if(lock.original?.get)Object.defineProperty(owner,key,lock.original);
  else Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:lock.value});
}
/** Whether that variable is currently locked in this context. */
export function isMolangVariableLocked(context,{scope,keys}){
  const owner=lockOwner(context,scope,keys,false);
  return !!owner&&!!Object.getOwnPropertyDescriptor(owner,keys[keys.length-1])?.get?.[LOCK];
}
export function evaluateMolang(expression,context){
  const value=evalExpr(expression,context);
  return typeof value==='boolean'?(value?1:0):Number(value)||0;
}
function evaluated(value,ctx,fallback){
  if(Array.isArray(value))return value.map(v=>Number(evalExpr(v,ctx))||0);
  if(value&&typeof value==='object'){
    if('post'in value||'pre'in value)return {...value,...('post'in value?{post:evaluated(value.post,ctx,fallback)}:{}),...('pre'in value?{pre:evaluated(value.pre,ctx,fallback)}:{})};
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='lerp_mode'?v:evaluated(v,ctx,fallback)]));
  }
  if(value===undefined)return fallback;
  // A single expression fills all three axes with the same IValue and
  // Vector3v.eval() runs it once per axis, so scripts that assign variables
  // (accumulators, first-order filters) take effect three times per frame.
  if(typeof value==='string'&&compiledMolang(value.trim()).writes)return [0,1,2].map(i=>{const n=Number(evalExpr(value,ctx));return Number.isFinite(n)?n:fallback[i];});
  const n=Number(evalExpr(value,ctx));return Number.isFinite(n)?n:fallback;
}
// The statements executeMolangStatement() would run, compiled up front.
function compileStatementList(statements){
  const compiled=[];
  for(const statement of Array.isArray(statements)?statements:[statements]){
    const source=String(statement??'').trim();if(!source||source.startsWith("'")||source.startsWith('"'))continue;
    compiled.push(compiledMolang(source));
  }
  return compiled;
}
function runStatementList(compiled,context){const roots=rootsOf(context);for(const entry of compiled)runCompiled(entry,context,roots);}
export function executeMolangStatement(statement,context){
  const source=String(statement??'').trim();if(!source||source.startsWith("'")||source.startsWith('"'))return;
  runMolang(source,context);
}
const statementListCache=new WeakMap();
export function executeMolangStatements(statements,context){
  if(!Array.isArray(statements)){executeMolangStatement(statements,context);return;}
  let compiled=statementListCache.get(statements);
  if(!compiled){compiled=compileStatementList(statements);statementListCache.set(statements,compiled);}
  runStatementList(compiled,context);
}
// YSMFolderDeserializer: a missing animation_length never ends; "loop" is
// true (loop), "hold_on_last_frame", or anything else / absent (play once).
export function animationLength(animation){
  const length=Number(animation?.animation_length);
  return animation?.animation_length!==undefined&&Number.isFinite(length)&&length>=0?length:Infinity;
}
export function animationLoopMode(animation){
  const loop=animation?.loop;
  if(loop===true||loop==='true')return 'loop';
  return loop==='hold_on_last_frame'?'hold':'once';
}
// BoneAnimationQueue.setBlendWeight() clamps negative weights to zero.
export function animationBlendWeight(animation,context){
  if(animation?.blend_weight===undefined)return 1;
  return Math.max(0,evaluateMolang(animation.blend_weight,context));
}
// Sorted events per animation: precompiled timeline statements plus
// sound_effects keyframes ({"t": {"effect": name}} or a list of them).
const timelineCache=new WeakMap();
function timelineEvents(animation){
  let events=timelineCache.get(animation);
  if(!events){
    const timeline=animation.timeline&&typeof animation.timeline==='object'?animation.timeline:{};
    const sounds=animation.sound_effects&&typeof animation.sound_effects==='object'?animation.sound_effects:{};
    events=[
      ...Object.entries(timeline).map(([t,expr])=>({t:Number(t),compiled:compileStatementList(expr)})),
      ...Object.entries(sounds).flatMap(([t,value])=>(Array.isArray(value)?value:[value]).map(item=>({t:Number(t),sound:String(item?.effect??'')})).filter(item=>item.sound)),
    ].filter(e=>Number.isFinite(e.t)).sort((a,b)=>a.t-b.t);
    timelineCache.set(animation,events);
  }
  return events;
}
export function executeTimeline(animation,time,ctx,state,loop){
  if(!animation||typeof animation!=='object')return;
  const events=timelineEvents(animation);if(!events.length)return;
  const length=animationLength(animation);
  let current=time,cycle=0;
  if(loop&&length>0&&Number.isFinite(length)){cycle=Math.floor(time/length);current=time%length;}
  const run=(event)=>{if(event.compiled)runStatementList(event.compiled,ctx);else (ctx.audioChannel||ctx.audio?.global)?.play(event.sound);};
  if(state.last<0){for(const e of events)if(e.t<=current)run(e);}
  else if(cycle!==state.cycle||current<state.last){for(const e of events)if(e.t>state.last||e.t<=current)run(e);}
  else for(const e of events)if(e.t>state.last&&e.t<=current)run(e);
  state.last=current;state.cycle=cycle;
}

// Samples every animated bone at local time t. Values are in Bedrock units
// (degrees / pixels / scale factors); channels the animation lacks are null.
// Keyframed channels ({"0.0": …, "0.5": …}) are compiled once into sorted
// times and keyframes. Like GeckoLib's BoneKeyFrame, sampling then evaluates
// only the keyframes of the current segment: the begin point at a segment's
// start, end then begin for LinearKeyFrame, left/begin/end/right for
// CatmullRomKeyFrame. Evaluating every keyframe each frame cost ~33 ms for a
// clip with 150k keyframes, and ran Molang writes the game never runs.
const keyframeCache=new WeakMap();
function compiledKeyframes(channel){
  let compiled=keyframeCache.get(channel);
  if(!compiled){
    // Number keys: "0" and "0.0" are one keyframe (the later entry wins).
    const byTime=new Map();
    for(const [key,value] of Object.entries(channel)){const time=Number(key);if(Number.isFinite(time))byTime.set(time,value);}
    const times=[...byTime.keys()].sort((a,b)=>a-b);
    compiled={times:Float64Array.from(times),frames:times.map(time=>byTime.get(time))};
    keyframeCache.set(channel,compiled);
  }
  return compiled;
}
const isKeyframed=channel=>channel!==null&&typeof channel==='object'&&!Array.isArray(channel)&&!('post'in channel)&&!('pre'in channel);
// One side of a keyframe: "post" is where a segment starts, "pre" where it
// ends; a keyframe without that side uses the other or its plain value.
function keyframePoint(frame,side,context,fallback){
  let value=frame;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&('post'in value||'pre'in value))value=side==='pre'?value.pre??value.post:value.post??value.pre;
  value=evaluated(value,context,fallback);
  const values=Array.isArray(value)?value:[value,value,value];
  return values.map((v,i)=>typeof v==='number'&&Number.isFinite(v)?v:fallback[i]);
}
function sampleKeyframes(channel,t,context,fallback){
  const {times,frames}=compiledKeyframes(channel),count=times.length;
  if(!count)return fallback;
  if(t<=times[0])return keyframePoint(frames[0],'post',context,fallback);
  let low=0,high=count;
  while(low<high){const mid=(low+high)>>1;if(times[mid]>t)high=mid;else low=mid+1;}
  if(low>=count)return keyframePoint(frames[count-1],'post',context,fallback);
  const first=frames[low-1],second=frames[low],fraction=(t-times[low-1])/(times[low]-times[low-1]);
  // YSMFolderDeserializer also accepts "step": hold the start value.
  if(first?.lerp_mode==='step'||fraction<=0)return keyframePoint(first,'post',context,fallback);
  // GeckoLib/YSM selects the destination keyframe's easing when it is
  // Catmull-Rom, otherwise it inherits the start keyframe's easing. Either
  // endpoint can therefore make this segment a spline.
  if(second?.lerp_mode==='catmullrom'||first?.lerp_mode==='catmullrom'){
    const before=keyframePoint(frames[Math.max(0,low-2)],'post',context,fallback),a=keyframePoint(first,'post',context,fallback);
    const b=keyframePoint(second,'pre',context,fallback),after=keyframePoint(frames[Math.min(count-1,low+1)],'pre',context,fallback);
    return a.map((v,i)=>0.5*((2*v)+(-before[i]+b[i])*fraction+(2*before[i]-5*v+4*b[i]-after[i])*fraction**2+(-before[i]+3*v-3*b[i]+after[i])*fraction**3));
  }
  const b=keyframePoint(second,'pre',context,fallback),a=keyframePoint(first,'post',context,fallback);
  return a.map((v,i)=>v+(b[i]-v)*fraction);
}
function sampleBoneChannel(channel,t,context,fallback){
  return isKeyframed(channel)?sampleKeyframes(channel,t,context,fallback):sampleChannel(evaluated(channel,context,fallback),t,fallback);
}
export function sampleAnimationBones(animation,t,context,index,visit){
  context.time=t;context.query.anim_time=t;
  for(const [name,channels] of Object.entries(animation?.bones||{})){
    const id=index.get(name);if(id===undefined)continue;
    visit(id,
      channels.rotation!==undefined?sampleBoneChannel(channels.rotation,t,context,[0,0,0]):null,
      channels.position!==undefined?sampleBoneChannel(channels.position,t,context,[0,0,0]):null,
      channels.scale!==undefined?sampleBoneChannel(channels.scale,t,context,[1,1,1]):null);
  }
}
