// 操控模式: drive the player like the game's third-person view. The canvas
// captures the mouse (pointer lock) and the keyboard; WASD moves, Space jumps,
// Shift sneaks, a double-tapped W sprints and a double-tapped Space toggles
// flying; with an elytra equipped (角色状态), Space in the air glides
// (elytra_fly); X puts the player in water or takes it out (Space swims up, Shift
// sinks, sprinting swims and flight is off while in water); holding the right button drags the viewpoint, Alt + left attacks
// and Alt + right uses the held item (hand-items.js ItemActions). Z for the
// wheel is handled by the page, since it also works while the wheel holds
// the pointer. Independent of Three.js: the viewer reads `yaw`, `bodyYaw`,
// `pitch` and `position` every frame and the main state comes back through
// onState.

import { ItemActions } from './hand-items.js';

// Blocks per second, from vanilla movement attributes (20 ticks/s). A double
// tap is two presses within 7 ticks (sprintTriggerTime / jumpTriggerTime).
const SPEED={walk:4.317,sprint:5.612,sneak:1.295,fly:10.92,flySprint:21.78,flyVertical:7.5};
// In water (blocks/s): walking against water drag, sprint-swimming, rising
// with Space, sinking with Shift and drifting down with no input.
const WATER={walk:1.97,swim:5.5,rise:2,dive:2,sink:0.6};
// Elytra gliding (LivingEntity.travel, fall flying): gravity per tick, and a
// still elytra_fly pose glides level at the speed that branch settles on
// (pitch 0: 29.6 blocks/s ahead, sinking 3 blocks/s).
const GLIDE_GRAVITY=0.08,GLIDE_POSE={speed:29.6,vertical:-3};
const JUMP_VELOCITY=8.4,GRAVITY=32,DOUBLE_TAP=350,MOUSE_SENSITIVITY=0.0025,MIN_PITCH=-1.2,MAX_PITCH=1.45;
// AnimationRegister's limb-swing threshold, as a horizontal speed.
const WALKING_SPEED=0.3;
// How fast the body turns to the movement direction (exponential rate per second).
const BODY_TURN_RATE=10;
// AnimatableEntity clamps the head to ±85° from the body.
const HEAD_YAW_LIMIT=85*Math.PI/180;
const KEYS=['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight'];
// LocalPlayer.aiStep: using an item scales the movement input by 0.2.
const USING_ITEM_SPEED=0.2;
// Camera views in Minecraft's CameraType (F5) order; the index is ysm.person_view.
export const PLAY_VIEWS=['first','back','front'];

/**
 * The main state AnimationManager picks, walking AnimationRegister's
 * priorities top-down: the first true predicate wins whether or not the model
 * has that clip (a missing clip just leaves the main slot empty).
 */
export function selectMainState({flying,onGround,sneaking,sprinting,walking,swimming=false,inWater=false,gliding=false}){
  if(swimming)return 'swim';
  // fly (creative flight, Abilities.flying) and elytra_fly (Pose.FALL_FLYING)
  // are both HIGH, registered in this order.
  if(flying)return 'fly';
  if(gliding)return 'elytra_fly';
  if(inWater&&!onGround)return 'swim_stand';
  if(!onGround)return 'jump';
  if(sneaking)return walking?'sneak':'sneaking';
  if(sprinting)return 'run';
  return walking?'walk':'idle';
}

// Molang sees the player in Minecraft's frame: the viewer's world turned 180°
// about Y (x and z negated), so a heading h (radians, facing (-sin h, -cos h))
// is the entity yaw -h in degrees, which faces (-sin yRot, cos yRot) in that
// frame. The body heading stands in for the player's yaw: the camera orbits
// freely, so yaw-driven secondary motion follows the visible body.
const minecraftYaw=heading=>-heading*180/Math.PI;
// The view pitch in degrees, positive looking down (Entity.xRot).
const minecraftPitch=pitch=>pitch*180/Math.PI;
const wrapDegrees=value=>{const wrapped=((value%360)+540)%360-180;return wrapped===-180?180:wrapped;};
// LivingEntity.travel keeps deltaMovement after friction: on ground
// 0.6 × 0.91 of the tick's displacement, in the air 0.91.
const GROUND_FRICTION=0.546,AIR_FRICTION=0.91,WATER_FRICTION=0.8;
// Entity gravity per tick: a standing player keeps deltaMovement.y = -0.08 × 0.98.
const RESTING_DELTA_Y=-0.0784;

/**
 * Sets the movement queries ModernYSM computes (QueryBinding / YSMBinding /
 * MathInterpolation) from a frame of `control`, or from a still pose when
 * `control` is a main state name: 'walk' and 'run' report the walking or
 * sprinting speed in place, 'jump' and 'fly' are airborne, 'elytra_fly'
 * glides level, 'swim' swims ahead and 'swim_stand' floats in water,
 * anything else stands still.
 */
export function bindMovementQueries(context,control){
  const {query,ysm}=context,moving=typeof control==='object'&&control;
  const pose=moving?null:String(control||'idle');
  const onGround=moving?control.onGround:!['jump','fly','elytra_fly','swim','swim_stand'].includes(pose);
  const flying=moving?control.flying:pose==='fly',sneaking=moving?control.sneaking:false;
  const gliding=moving?!!control.gliding:pose==='elytra_fly';
  const inWater=moving?control.inWater:pose==='swim'||pose==='swim_stand',swimming=moving?control.swimming:pose==='swim';
  // Swimming is sprinting in water (Player.updateSwimming).
  const sprinting=moving?control.sprinting&&(control.state==='run'||swimming):pose==='run'||swimming;
  // Horizontal speed (blocks/s) and the frame's displacement in Minecraft's frame.
  const posed=pose==='walk'?SPEED.walk:pose==='run'?SPEED.sprint:pose==='swim'?WATER.swim:pose==='elytra_fly'?GLIDE_POSE.speed:0;
  const speed=moving?Math.hypot(control.velocity.x,control.velocity.z):posed;
  const dt=moving?control.frame.dt:0,heading=moving?control.bodyYaw:0;
  const dx=moving?-control.frame.dx:0,dy=moving?control.frame.dy:0,dz=moving?-control.frame.dz:0;
  const yRot=minecraftYaw(heading);
  // The glide's velocity is already deltaMovement after its drag.
  query.ground_speed=speed*(gliding?1:inWater&&!flying?WATER_FRICTION:onGround?GROUND_FRICTION:AIR_FRICTION);
  ysm.ground_speed2=dt>0?Math.hypot(dx,dz)/dt:speed;
  const posedVertical=pose==='elytra_fly'?GLIDE_POSE.vertical:0;
  query.vertical_speed=dt>0?dy/dt:posedVertical;
  // A still pose: the glide sinks, creative flight hovers, the rest stand.
  const deltaY=moving&&!onGround?control.velocity.y/20*(gliding?1:flying?0.6:inWater?WATER_FRICTION:0.98):moving?RESTING_DELTA_Y:posedVertical?posedVertical/20:flying?0:RESTING_DELTA_Y;
  ysm.delta_movement_length=Math.hypot(query.ground_speed/20,deltaY);
  query.yaw_speed=moving?control.yawSpeed:0;
  query.is_on_ground=onGround?1:0;
  query.is_jumping=!flying&&!onGround&&!inWater?1:0;
  query.is_sneaking=sneaking?1:0;ysm.is_sneak=query.is_sneaking;
  query.is_sprinting=sprinting?1:0;
  // The water fills the whole view, so the eyes are under water too.
  query.is_swimming=swimming?1:0;query.is_in_water=inWater?1:0;ysm.eye_in_water=query.is_in_water;
  query.body_y_rotation=wrapDegrees(yRot);
  // AnimatableEntity model data: netHeadYaw = -clamp(wrap(head - body), ±85)
  // and headPitch = -xRot. The head's turn comes from PlayControl.headYaw
  // (turned by the mouse, back in line with the body while walking).
  const lookYRot=moving?minecraftYaw(control.bodyYaw+control.headYaw):yRot,xRot=moving?minecraftPitch(control.pitch):0;
  query.head_x_rotation=ysm.head_yaw=-Math.max(-85,Math.min(85,wrapDegrees(lookYRot-yRot)));
  query.head_y_rotation=ysm.head_pitch=-xRot;
  query.eye_target_x_rotation=xRot;query.eye_target_y_rotation=lookYRot;
  query.walk_distance=moving?control.walkDistance:0;query.modified_distance_moved=query.walk_distance;
  // Direction.fromYRot → get3DDataValue: south 3, west 4, north 2, east 5.
  query.cardinal_facing_2d=[3,4,2,5][Math.floor(yRot/90+0.5)&3];
  const position=moving?[-control.position.x,control.position.y,-control.position.z]:[0,0,0],delta=[dx,dy,dz];
  query.position=axis=>position[axis]??0;query.position_delta=axis=>delta[axis]??0;
  // MathInterpolation: the movement direction against the view yaw (cos / sin).
  // A still pose that walks moves straight ahead.
  if(moving&&Math.hypot(dx,dz)>=1e-4){
    const angle=wrapDegrees(Math.atan2(dz,dx)*180/Math.PI-(90-wrapDegrees(-yRot)))*Math.PI/180;
    ysm.input_vertical=Math.cos(angle);ysm.input_horizontal=Math.sin(angle);
  }else{ysm.input_vertical=!moving&&posed?1:0;ysm.input_horizontal=0;}
  // LivingEntity xxa/zza: the raw left/forward impulses, ×0.3 while sneaking.
  const impulse=sneaking?0.3:1;
  // Gliding needs no key, so the still elytra pose has no forward input.
  ysm.zza=moving?control.input.forward*impulse:posed&&!gliding?1:0;ysm.xxa=moving?-control.input.strafe*impulse:0;ysm.yya=0;
}

export class PlayControl {
  /**
   * `onState(name)` runs when the main state changes, `onMoveInput()` on each
   * frame with movement/jump/sneak input (the game then stops a wheel action),
   * `onLockChange(locked)` when the pointer is captured or released,
   * `onPan(dx,dy)` with the mouse movement (pixels) while the right button is
   * held, and `onPanReset()` on a double right-click. `actions` takes the
   * Alt + left / right clicks; the viewer ticks it with the held items and
   * `onItemChange(hand, item)` reports an item the use turned into another.
   * `onWaterChange(inWater)` runs when X puts the player in or out of water.
   * `elytra` says an elytra is worn (the viewer sets it from 角色状态).
   */
  constructor(canvas,{onState,onMoveInput,onLockChange,onPan,onPanReset,onItemChange,onWaterChange}={}){
    this.canvas=canvas;this.onState=onState;this.onWaterChange=onWaterChange;this.onMoveInput=onMoveInput;this.onLockChange=onLockChange;this.onPan=onPan;this.onPanReset=onPanReset;
    this.panning=false;this.lastRightDown=-Infinity;this.actions=new ItemActions({onItemChange});this.actionButtons=new Set();
    // Multiplier on MOUSE_SENSITIVITY (设置 → 操控 → 光标灵敏度).
    this.sensitivity=1;this.elytra=false;this.keys=new Set();this.lastTap={};this.reset();
    this.handleKeyDown=this.handleKeyDown.bind(this);this.handleKeyUp=this.handleKeyUp.bind(this);
    this.handleMouseMove=this.handleMouseMove.bind(this);this.handleLockChange=this.handleLockChange.bind(this);this.handleBlur=()=>{this.keys.clear();this.panning=false;this.releaseActions();};
    this.handleMouseDown=this.handleMouseDown.bind(this);this.handleMouseUp=this.handleMouseUp.bind(this);this.handleContextMenu=event=>{if(this.locked)event.preventDefault();};
    document.addEventListener('keydown',this.handleKeyDown);document.addEventListener('keyup',this.handleKeyUp);
    document.addEventListener('mousemove',this.handleMouseMove);document.addEventListener('pointerlockchange',this.handleLockChange);
    document.addEventListener('mousedown',this.handleMouseDown);document.addEventListener('mouseup',this.handleMouseUp);document.addEventListener('contextmenu',this.handleContextMenu);
    window.addEventListener('blur',this.handleBlur);
  }
  reset(){
    // yaw/pitch aim the camera; bodyYaw is where the model faces.
    // headYaw is the head's turn from the body (radians, like bodyYaw).
    this.yaw=0;this.bodyYaw=0;this.headYaw=0;this.pitch=0.25;this.position={x:0,y:0,z:0};this.velocity={x:0,y:0,z:0};
    this.flying=false;this.sprinting=false;this.sneaking=false;this.onGround=true;this.state='idle';this.keys.clear();
    this.inWater=false;this.swimming=false;this.gliding=false;this.glideClock=0;
    this.actions.reset();this.actionButtons.clear();
    // Inputs of the last frame and what bindMovementQueries reads: the frame's
    // displacement and length, walked distance, and the per-tick yaw speed.
    this.input={forward:0,strafe:0};this.frame={dx:0,dy:0,dz:0,dt:0};this.walkDistance=0;
    this.tickClock=0;this.tickYRot=0;this.yawSpeed=0;
    // First-person hand sway and view bob (LocalPlayer xBob/yBob, Player.bob).
    this.xBob=minecraftPitch(this.pitch);this.yBob=minecraftYaw(this.yaw);this.bob=0;
  }
  get locked(){return document.pointerLockElement===this.canvas;}
  lock(){
    if(this.locked)return;
    // requestPointerLock returns a promise in Chromium; a refused request (no user gesture) must not throw.
    try{const request=this.canvas.requestPointerLock();request?.catch?.(()=>{});}catch{}
  }
  // unlockedByCode tells the Z wheel / item panel release apart from the browser's Esc (第 64 节).
  unlock(){if(this.locked){this.unlockingByCode=true;document.exitPointerLock();}}
  handleLockChange(){
    const byCode=!!this.unlockingByCode;if(this.locked||byCode)this.unlockingByCode=false;
    if(!this.locked){this.keys.clear();this.panning=false;this.releaseActions();}
    this.onLockChange?.(this.locked,byCode);
  }
  releaseActions(){this.actions.releaseAll();this.actionButtons.clear();}
  // Alt + left / right press the attack / use key until that button is
  // released. Holding the right button drags the viewpoint; two presses
  // within DOUBLE_TAP put it back over the model.
  handleMouseDown(event){
    if(!this.locked)return;
    if(event.altKey&&(event.button===0||event.button===2)){
      event.preventDefault();this.actionButtons.add(event.button);
      this.actions.press(event.button===0?'attack':'use');return;
    }
    if(event.button!==2)return;
    event.preventDefault();
    const now=performance.now();
    if(now-this.lastRightDown<DOUBLE_TAP){this.lastRightDown=-Infinity;this.onPanReset?.();}
    else this.lastRightDown=now;
    this.panning=true;
  }
  handleMouseUp(event){
    if(this.actionButtons.delete(event.button)){this.actions.release(event.button===0?'attack':'use');return;}
    if(event.button===2)this.panning=false;
  }
  handleMouseMove(event){
    if(!this.locked)return;
    if(this.panning){this.onPan?.(event.movementX,event.movementY);return;}
    const scale=MOUSE_SENSITIVITY*this.sensitivity;
    const turn=-event.movementX*scale;this.yaw+=turn;
    // Looking around turns the head from the body, up to ±85°.
    this.headYaw=Math.max(-HEAD_YAW_LIMIT,Math.min(HEAD_YAW_LIMIT,this.headYaw+turn));
    this.pitch=Math.min(MAX_PITCH,Math.max(MIN_PITCH,this.pitch+event.movementY*scale));
  }
  handleKeyDown(event){
    if(!this.locked)return;
    // Alt only modifies clicks; keep the browser from acting on it.
    if(event.key==='Alt'){event.preventDefault();return;}
    if(event.code==='KeyX'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();if(!event.repeat)this.setInWater(!this.inWater);return;}
    if(!KEYS.includes(event.code))return;
    event.preventDefault();
    if(event.repeat)return;
    const now=performance.now(),doubleTap=now-(this.lastTap[event.code]??-Infinity)<DOUBLE_TAP;
    this.lastTap[event.code]=doubleTap?-Infinity:now;
    if(event.code==='KeyW'&&doubleTap&&!this.isSneaking()&&!this.actions.usingHand)this.sprinting=true;
    if(event.code==='Space'&&!this.inWater){
      // Space swims up in water, so a double tap there does not start flight.
      if(doubleTap){this.flying=!this.flying;this.velocity.y=0;if(this.flying)this.gliding=false;}
      // LocalPlayer.aiStep → tryToStartFallFlying: a fresh jump press in the
      // air, not flying, with an elytra worn starts gliding. It runs after the
      // double tap, so the tap that ends flight in the air glides at once.
      if(!this.flying&&!this.gliding&&this.elytra&&this.position.y>0){this.gliding=true;this.glideClock=0;}
    }
    this.keys.add(event.code);
  }
  handleKeyUp(event){
    if(event.key==='Alt'&&this.locked){event.preventDefault();return;}
    if(!KEYS.includes(event.code))return;
    if(this.locked)event.preventDefault();
    this.keys.delete(event.code);
  }
  /** Puts the player in water or takes it out; entering water ends flight. */
  setInWater(inWater){
    inWater=!!inWater;if(inWater===this.inWater)return;
    this.inWater=inWater;if(inWater){this.flying=false;this.gliding=false;}else this.swimming=false;
    this.onWaterChange?.(inWater);
  }
  isSneaking(){return this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');}
  /**
   * One game tick of elytra flight (LivingEntity.travel, fall flying). The
   * look is the camera: forward (-sin yaw, -cos yaw), pitch > 0 looks down
   * like Entity.xRot. Velocity is blocks/s, the game's deltaMovement × 20.
   */
  glideTick(){
    const f=this.pitch,cos=Math.cos(f),lx=-Math.sin(this.yaw)*cos,lz=-Math.cos(this.yaw)*cos;
    let x=this.velocity.x/20,y=this.velocity.y/20,z=this.velocity.z/20;
    const i=Math.hypot(lx,lz),j=Math.hypot(x,z),l=cos*cos;
    y+=GLIDE_GRAVITY*(-1+l*0.75);
    if(y<0&&i>0){const m=y*-0.1*l;x+=lx*m/i;y+=m;z+=lz*m/i;}
    if(f<0&&i>0){const m=j*-Math.sin(f)*0.04;x-=lx*m/i;y+=m*3.2;z-=lz*m/i;}
    if(i>0){x+=(lx/i*j-x)*0.1;z+=(lz/i*j-z)*0.1;}
    this.velocity.x=x*0.99*20;this.velocity.y=y*0.98*20;this.velocity.z=z*0.99*20;
  }
  /** Advances movement by `delta` seconds and reports state changes. */
  update(delta){
    const keys=this.keys,sneakKey=this.isSneaking();
    // LivingEntity.updateFallFlying: taking the elytra off ends the glide.
    if(this.gliding&&!this.elytra)this.gliding=false;
    const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
    if(forward||strafe||keys.has('Space')||sneakKey)this.onMoveInput?.();
    // Sprinting stops when W is released or the player sneaks on the ground;
    // in water Shift only sinks. Sprinting in water is swimming.
    const water=this.inWater&&!this.flying;
    if(forward<=0||(sneakKey&&!this.flying&&!water))this.sprinting=false;
    this.swimming=water&&this.sprinting;
    const sneaking=sneakKey&&!this.flying&&this.onGround;
    this.input={forward,strafe};this.sneaking=sneaking;
    const speed=(this.flying?(this.sprinting?SPEED.flySprint:SPEED.fly):water?(this.swimming?WATER.swim:sneaking?Math.min(SPEED.sneak,WATER.walk):WATER.walk):sneaking?SPEED.sneak:this.sprinting?SPEED.sprint:SPEED.walk)*(this.actions.usingHand?USING_ITEM_SPEED:1);
    // Movement is relative to the camera: forward is (-sin yaw, -cos yaw), right
    // is (cos yaw, -sin yaw). A heading h faces (-sin h, -cos h) likewise.
    const length=Math.hypot(forward,strafe)||1,sin=Math.sin(this.yaw),cos=Math.cos(this.yaw);
    const targetX=(-sin*forward+cos*strafe)/length*speed,targetZ=(-cos*forward-sin*strafe)/length*speed;
    // Ground control is quick, air control slow; flight sits between.
    const grip=1-Math.exp(-delta*(this.flying?6:water?4:this.onGround?14:3));
    // A glide ignores the movement keys: the look steers it (glideTick).
    if(!this.gliding){this.velocity.x+=(targetX-this.velocity.x)*grip;this.velocity.z+=(targetZ-this.velocity.z)*grip;}
    // The body turns toward the movement direction, so walking back (S) shows
    // the model's front; standing still keeps it and the camera orbits freely.
    // Gliding, it faces where the player looks.
    if(this.gliding){
      const turn=this.yaw-this.bodyYaw,wrapped=turn-Math.PI*2*Math.round(turn/(Math.PI*2));
      this.bodyYaw+=wrapped*(1-Math.exp(-delta*BODY_TURN_RATE));this.headYaw=0;
    }else if(forward||strafe){
      const turn=Math.atan2(-targetX,-targetZ)-this.bodyYaw,wrapped=turn-Math.PI*2*Math.round(turn/(Math.PI*2));
      this.bodyYaw+=wrapped*(1-Math.exp(-delta*BODY_TURN_RATE));
    }
    // Walking turns the body toward the movement, which is where the player
    // faces, so the head eases back in line and turns with the body; it
    // stays there when the player stops until the mouse turns it again.
    if(forward||strafe)this.headYaw*=Math.exp(-delta*BODY_TURN_RATE);
    if(this.flying){
      const vertical=((keys.has('Space')?1:0)-(sneakKey?1:0))*SPEED.flyVertical;
      this.velocity.y+=(vertical-this.velocity.y)*grip;
    }else if(this.gliding){
      // The glide runs on game ticks; movement integrates every frame.
      this.glideClock+=delta;
      while(this.glideClock>=0.05){this.glideClock-=0.05;this.glideTick();}
    }else if(water){
      // Swimming heads where the camera looks (pitch > 0 looks down); Space
      // rises and Shift sinks, otherwise the player drifts down slowly.
      const dive=this.swimming?-Math.sin(this.pitch)*WATER.swim:0;
      const vertical=keys.has('Space')||sneakKey?(keys.has('Space')?WATER.rise:0)-(sneakKey?WATER.dive:0):this.swimming?0:-WATER.sink;
      this.velocity.y+=(vertical+dive-this.velocity.y)*grip;
    }else{
      // Holding Space keeps jumping on landing, as in the game.
      if(this.onGround&&keys.has('Space'))this.velocity.y=JUMP_VELOCITY;
      this.velocity.y-=GRAVITY*delta;
    }
    const {x,y,z}=this.position;
    this.position.x+=this.velocity.x*delta;this.position.y+=this.velocity.y*delta;this.position.z+=this.velocity.z*delta;
    if(this.position.y<=0){
      this.position.y=0;this.velocity.y=Math.max(0,this.velocity.y);
      // Touching the ground ends creative flight and the glide.
      if(this.flying&&!keys.has('Space'))this.flying=false;
      this.gliding=false;
    }
    this.onGround=!this.flying&&this.position.y<=0&&this.velocity.y<=0;
    this.frame={dx:this.position.x-x,dy:this.position.y-y,dz:this.position.z-z,dt:delta};
    // Entity.move: walkDist grows by 0.6 per block walked horizontally.
    this.walkDistance+=Math.hypot(this.frame.dx,this.frame.dz)*0.6;
    // PlayerEntityFrameState.updateHeadYaw: yaw speed (degrees/s) is sampled once per game tick.
    const ticks=Math.floor((this.tickClock+delta)*20)-Math.floor(this.tickClock*20);this.tickClock+=delta;
    if(ticks>0){const yRot=minecraftYaw(this.bodyYaw);this.yawSpeed=(yRot-this.tickYRot)*20/ticks;this.tickYRot=yRot;}
    // Per tick: xBob/yBob close half the gap to the view rotation; bob moves
    // 40% toward the tick's horizontal movement (capped at 0.1) on the ground.
    const perTick=(rate)=>1-Math.pow(1-rate,delta*20);
    this.xBob+=(minecraftPitch(this.pitch)-this.xBob)*perTick(0.5);this.yBob+=(minecraftYaw(this.yaw)-this.yBob)*perTick(0.5);
    const bobTarget=this.onGround?Math.min(0.1,Math.hypot(this.velocity.x,this.velocity.z)*GROUND_FRICTION/20):0;
    this.bob+=(bobTarget-this.bob)*perTick(0.4);
    const walking=Math.hypot(this.velocity.x,this.velocity.z)>WALKING_SPEED&&(forward!==0||strafe!==0);
    const state=selectMainState({flying:this.flying,onGround:this.onGround,sneaking,sprinting:this.sprinting&&walking,walking,swimming:this.swimming,inWater:this.inWater,gliding:this.gliding});
    if(state!==this.state){this.state=state;this.onState?.(state);}
  }
  dispose(){
    this.unlock();
    document.removeEventListener('keydown',this.handleKeyDown);document.removeEventListener('keyup',this.handleKeyUp);
    document.removeEventListener('mousemove',this.handleMouseMove);document.removeEventListener('pointerlockchange',this.handleLockChange);
    document.removeEventListener('mousedown',this.handleMouseDown);document.removeEventListener('mouseup',this.handleMouseUp);document.removeEventListener('contextmenu',this.handleContextMenu);
    window.removeEventListener('blur',this.handleBlur);
  }
}
