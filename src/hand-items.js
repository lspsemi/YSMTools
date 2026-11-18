import { tr } from './i18n.js';
// Held items for the main 3D view. The game picks the hold_mainhand /
// hold_offhand clip from the item in each hand (ConditionHold,
// InnerClassify, MainHandHoldPredicate, OffHandHoldPredicate) and exposes the
// items to Molang (ysm.has_mainhand, q.is_item_name_any, ...). The GUI preview
// entity holds nothing, so the character card never uses any of this.
export const HANDS=['mainhand','offhand'];

// UseAnim values except NONE (EquipmentUtil.getUseAnimByName).
const USE_ANIMS=new Set(['eat','drink','block','bow','spear','crossbow','spyglass','toot_horn','brush']);

// type = InnerClassify.getItemType, use = Item.getUseAnimation (1.20.1).
// `charged` is a loaded crossbow, `fishing` a rod whose bobber is out,
// `gun` a TaCZ gun ({id, type: its gun tab, aiming}).
export const ITEM_PRESETS=[
  {key:'diamond_sword',label:tr('钻石剑'),id:'minecraft:diamond_sword',type:'sword',tags:['minecraft:swords','minecraft:tools']},
  {key:'diamond_axe',label:tr('钻石斧'),id:'minecraft:diamond_axe',type:'axe',tags:['minecraft:axes','minecraft:tools']},
  {key:'diamond_pickaxe',label:tr('钻石镐'),id:'minecraft:diamond_pickaxe',type:'pickaxe',tags:['minecraft:pickaxes','minecraft:tools']},
  {key:'diamond_shovel',label:tr('钻石锹'),id:'minecraft:diamond_shovel',type:'shovel',tags:['minecraft:shovels','minecraft:tools']},
  {key:'diamond_hoe',label:tr('钻石锄'),id:'minecraft:diamond_hoe',type:'hoe',tags:['minecraft:hoes','minecraft:tools']},
  {key:'trident',label:tr('三叉戟'),id:'minecraft:trident',type:'spear',use:'spear'},
  {key:'mace',label:tr('重锤'),id:'minecraft:mace'},
  {key:'shield',label:tr('盾牌'),id:'minecraft:shield',type:'shield',use:'block'},
  {key:'bow',label:tr('弓'),id:'minecraft:bow',type:'bow',use:'bow'},
  {key:'crossbow',label:tr('弩'),id:'minecraft:crossbow',type:'crossbow',use:'crossbow'},
  {key:'charged_crossbow',label:tr('弩（已装填）'),id:'minecraft:crossbow',type:'crossbow',use:'crossbow',charged:true},
  {key:'fishing_rod',label:tr('钓鱼竿'),id:'minecraft:fishing_rod',type:'fishing_rod'},
  {key:'fishing_rod_cast',label:tr('钓鱼竿（抛竿中）'),id:'minecraft:fishing_rod',type:'fishing_rod',fishing:true},
  {key:'splash_potion',label:tr('喷溅药水'),id:'minecraft:splash_potion',type:'throwable_potion'},
  {key:'potion',label:tr('药水'),id:'minecraft:potion',use:'drink'},
  {key:'milk_bucket',label:tr('牛奶桶'),id:'minecraft:milk_bucket',use:'drink'},
  {key:'apple',label:tr('苹果'),id:'minecraft:apple',use:'eat'},
  {key:'carrot',label:tr('胡萝卜'),id:'minecraft:carrot',use:'eat'},
  {key:'golden_carrot',label:tr('金胡萝卜'),id:'minecraft:golden_carrot',use:'eat'},
  {key:'spyglass',label:tr('望远镜'),id:'minecraft:spyglass',use:'spyglass'},
  {key:'goat_horn',label:tr('山羊角'),id:'minecraft:goat_horn',use:'toot_horn'},
  {key:'brush',label:tr('刷子'),id:'minecraft:brush',use:'brush'},
  {key:'torch',label:tr('火把'),id:'minecraft:torch'},
  {key:'stone',label:tr('石头'),id:'minecraft:stone'},
  {key:'slashblade',label:tr('拔刀剑'),id:'slashblade:slashblade',type:'slashblade'},
  {key:'gohei',label:tr('御币'),id:'touhou_little_maid:hakurei_gohei',type:'gohei'},
  {key:'tacz_pistol',label:tr('手枪（TaCZ）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:glock_17',type:'pistol'}},
  {key:'tacz_pistol_aim',label:tr('手枪（TaCZ · 瞄准中）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:glock_17',type:'pistol',aiming:true}},
  {key:'tacz_rifle',label:tr('步枪（TaCZ）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:ak47',type:'rifle'}},
  {key:'tacz_rifle_aim',label:tr('步枪（TaCZ · 瞄准中）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:ak47',type:'rifle',aiming:true}},
  {key:'tacz_rpg',label:tr('火箭筒（TaCZ）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:rpg7',type:'rpg'}},
  {key:'tacz_rpg_aim',label:tr('火箭筒（TaCZ · 瞄准中）'),id:'tacz:modern_kinetic_gun',gun:{id:'tacz:rpg7',type:'rpg',aiming:true}},
];

// ResourceLocation.isValidResourceLocation, defaulting the namespace.
function resourceLocation(value){
  const text=String(value??'');const colon=text.indexOf(':');
  const namespace=colon<0?'minecraft':text.slice(0,colon),path=colon<0?text:text.slice(colon+1);
  return /^[a-z0-9_.-]*$/.test(namespace)&&/^[a-z0-9_./-]*$/.test(path)?`${namespace}:${path}`:null;
}

// ConditionHold / ConditionSwing / ConditionUse.addTest: the `<prefix>$id`,
// `<prefix>#tag` and `<prefix>:<type or UseAnim>` clips of the main table.
function collectConditionTest(animations,prefix){
  const size=prefix.length+1,test={prefix,ids:new Set(),tags:[],uses:new Set(),inner:new Set()};
  for(const name of Object.keys(animations||{})){
    if(name.length<=size)continue;
    const rest=name.slice(size),location=resourceLocation(rest);
    if(name.startsWith(`${prefix}$`)&&location)test.ids.add(location);
    if(name.startsWith(`${prefix}#`)&&location&&!test.tags.includes(location))test.tags.push(location);
    if(!name.startsWith(`${prefix}:`)||rest==='none')continue;
    if(USE_ANIMS.has(rest))test.uses.add(rest);
    test.inner.add(name);
  }
  return test;
}

/** ConditionHold.addTest over every main-table clip name, for both hands. */
export function collectHoldTriggers(animations={}){
  const triggers={};
  for(const hand of HANDS)triggers[hand]=collectConditionTest(animations,`hold_${hand}`);
  // ConditionTAC: "tac:<state>$<gun id>" clips for particular guns.
  triggers.tac={names:new Set(),ids:new Set()};
  for(const name of Object.keys(animations||{})){
    if(!name.startsWith('tac:'))continue;
    const split=name.indexOf('$'),id=split<0?null:resourceLocation(name.slice(split+1));
    if(id){triggers.tac.names.add(name);triggers.tac.ids.add(id);}
  }
  return triggers;
}

// ConditionHold.doTest: item id, then tags, then InnerClassify / UseAnim.
function conditionHold(hand,item,test){
  if(!item)return `hold_${hand}:empty`;
  return conditionMatch(item,test);
}
// The shared doIdTest → doTagTest → doExtraTest walk; '' when nothing matches.
function conditionMatch(item,test){
  const prefix=test.prefix,id=resourceLocation(item.id);
  if(id&&test.ids.has(id))return `${prefix}$${id}`;
  const tag=test.tags.find(tag=>item.tags?.includes(tag));
  if(tag)return `${prefix}#${tag}`;
  if(item.type&&test.inner.has(`${prefix}:${item.type}`))return `${prefix}:${item.type}`;
  if(item.use&&test.uses.has(item.use))return `${prefix}:${item.use}`;
  return '';
}

// TacAnimHandler.playGunAnimationWithMode: a gun-specific clip, else by gun tab.
function gunAnimation(prefix,gun,triggers){
  const id=resourceLocation(gun.id),named=`${prefix.slice(0,-1)}$${id}`;
  if(triggers.tac.ids.has(id)&&triggers.tac.names.has(named))return named;
  return prefix+(gun.type==='pistol'||gun.type==='rpg'?gun.type:'rifle');
}

/**
 * The clip the hold controller plays for `hand`, or '' when it stops.
 * `items` is {mainhand, offhand}; null is an empty hand. Swinging and using
 * items (which pause the hold controller) never happen in the viewer;
 * `sprinting` is the run pose (TacAnimHandler.handleTaczGunHold).
 */
export function resolveHoldAnimation(hand,items,triggers,{sprinting=false}={}){
  const item=items?.[hand]||null;
  if(hand==='mainhand'&&item?.gun)return gunAnimation(item.gun.aiming?'tac:aim:':sprinting?'tac:run:':'tac:hold:',item.gun,triggers);
  if(item?.charged)return `hold_${hand}:charged_crossbow`;
  if(hand==='mainhand'&&(items?.mainhand?.fishing||items?.offhand?.fishing))return 'hold_mainhand:fishing';
  return conditionHold(hand,item,triggers[hand]);
}

/** ConditionSwing / ConditionUse tests for both hands ("swing", "swing_offhand", "use_mainhand", "use_offhand"). */
export function collectActionTriggers(animations={}){
  return {
    swing:{mainhand:collectConditionTest(animations,'swing'),offhand:collectConditionTest(animations,'swing_offhand')},
    use:{mainhand:collectConditionTest(animations,'use_mainhand'),offhand:collectConditionTest(animations,'use_offhand')},
  };
}
/**
 * ItemHoldAnimationPredicate (the swing controller): the swinging hand's
 * `swing$id` / `#tag` / `:type` clip, else swing_hand / swing_offhand.
 */
export function resolveSwingAnimation(hand,items,triggers){
  const item=items?.[hand];
  return (item&&conditionMatch(item,triggers.swing[hand]))||(hand==='mainhand'?'swing_hand':'swing_offhand');
}
/** InteractionHandAnimationPredicate (the use controller): `use_<hand>$id` / `#tag` / `:type`, else use_<hand>. */
export function resolveUseAnimation(hand,items,triggers){
  const item=items?.[hand];
  return (item&&conditionMatch(item,triggers.use[hand]))||`use_${hand}`;
}
/** The hold, swing and use clips `item` plays in `hand` on this model ('' where the model has none). */
export function itemActionClips(animations,hand,item,otherItem=null,triggers={hold:collectHoldTriggers(animations),...collectActionTriggers(animations)}){
  const items=hand==='mainhand'?{mainhand:item,offhand:otherItem}:{mainhand:otherItem,offhand:item};
  const has=name=>name&&animations?.[name]?name:'';
  return {
    hold:has(resolveHoldAnimation(hand,items,triggers.hold)),
    swing:has(resolveSwingAnimation(hand,items,triggers)),
    use:item&&useDuration(item)?has(resolveUseAnimation(hand,items,triggers)):'',
  };
}

// Item.getUseDuration (1.20.1) by UseAnim, in ticks; a crossbow is
// CrossbowItem.getChargeDuration (25 without Quick Charge) + 3.
const USE_DURATIONS={eat:32,drink:32,block:72000,bow:72000,spear:72000,crossbow:28,spyglass:1200,toot_horn:140,brush:200};
const CROSSBOW_CHARGE=25,RIGHT_CLICK_DELAY=4,GOAT_HORN_COOLDOWN=140;
// Attributes.ATTACK_SPEED of the presets (4 for an empty hand and plain items).
const ATTACK_SPEEDS={sword:1.6,axe:1,pickaxe:1.2,shovel:1,hoe:4,spear:1.1};
const attackSpeed=item=>item?.id==='minecraft:mace'?0.6:ATTACK_SPEEDS[item?.type]??4;
// Right-clicking a loaded crossbow fires it instead of starting to use it.
const useDuration=item=>item?.charged?0:USE_DURATIONS[item?.use]||0;
// The preset the item turns into (loaded / unloaded crossbow, cast / reeled rod).
function itemVariant(item,patch,key){
  const preset=ITEM_PRESETS.find(entry=>entry.key===key);
  return preset&&preset.id===item.id?preset:{...item,...patch};
}

/** LivingEntity.getCurrentSwingDuration: haste (or conduit power) shortens it, mining fatigue lengthens it. */
export function swingDuration(effects={}){
  const haste=Math.max(effects.haste|0,effects.conduit_power|0),fatigue=effects.mining_fatigue|0;
  return haste?Math.max(1,6-haste):fatigue?6+fatigue*2:6;
}

/**
 * The attack and use keys of 操控模式, ticked like the game: Minecraft
 * handleKeybinds / startUseItem, LivingEntity.swing / updateSwingTime and
 * updatingUsingItem. Left (attack) swings the main hand, again each time a
 * held swing ends; right (use) tries the main hand and then the off hand:
 * items with a use animation are used while the key is held (food again
 * after each bite), a loaded crossbow fires, a fishing rod casts or reels in
 * and a splash potion is thrown (both swing). Items never run out.
 * `onItemChange(hand, item)` reports a crossbow that loads or fires and a rod
 * that casts or reels in. It also ticks the first-person main hand height
 * (ItemInHandRenderer.tick): attacking or switching items restarts the
 * attack cooldown (Player.resetAttackStrengthTicker) and the hand dips with
 * it; a new item only shows once the old one is lowered.
 */
export class ItemActions {
  constructor({onItemChange}={}){this.onItemChange=onItemChange;this.reset();}
  reset(){
    this.attackHeld=false;this.useHeld=false;this.attackClicks=0;this.useClicks=0;
    this.swinging=false;this.swingTime=0;this.swingingArm='mainhand';this.swingDuration=6;this.swingSeq=0;this.attackAnim=0;this.oAttackAnim=0;
    this.usingHand=null;this.ticksUsing=0;this.useDuration=0;this.useSeq=0;this.rightClickDelay=0;
    this.cooldowns=new Map();this.tickCount=0;this.clock=0;this.partial=0;
    // The hand starts lowered and rises, like on joining a world.
    this.attackStrengthTicker=0;this.lastMainHand=undefined;this.renderedMainHand=undefined;this.mainHandHeight=0;this.oMainHandHeight=0;
  }
  press(button){if(button==='attack'){this.attackHeld=true;this.attackClicks++;}else{this.useHeld=true;this.useClicks++;}}
  release(button){if(button==='attack')this.attackHeld=false;else this.useHeld=false;}
  releaseAll(){this.attackHeld=false;this.useHeld=false;}
  /** Advances `delta` seconds of game ticks; `swingTicks` comes from swingDuration. */
  update(delta,items,{swingTicks=6}={}){
    this.swingDuration=swingTicks;this.clock+=delta;
    const ticks=Math.floor(this.clock*20);this.clock-=ticks/20;
    for(let i=0;i<Math.min(ticks,10);i++)this.tick(items||{});
    this.partial=this.clock*20;
  }
  tick(items){
    this.tickCount++;this.attackStrengthTicker++;
    // Player.tick: another main-hand item restarts the attack cooldown.
    const main=items.mainhand||null;
    if(main!==this.lastMainHand){if(this.lastMainHand!==undefined&&main?.id!==this.lastMainHand?.id)this.attackStrengthTicker=0;this.lastMainHand=main;}
    if(this.usingHand){
      // Using an item swallows attack clicks; releasing the key releases the item.
      if(!this.useHeld)this.releaseUsing(items);
    }else{
      // Minecraft.startAttack on air: swing and reset the attack cooldown.
      if(this.attackClicks||this.attackHeld&&!this.swinging){this.swing('mainhand');this.attackStrengthTicker=0;}
      if(this.useClicks)this.startUseItem(items,true);
      else if(this.useHeld&&this.rightClickDelay===0)this.startUseItem(items,false);
    }
    this.attackClicks=0;this.useClicks=0;
    if(this.rightClickDelay>0)this.rightClickDelay--;
    if(this.usingHand){
      this.ticksUsing++;
      const item=items[this.usingHand];
      // A crossbow (useOnRelease) stays drawn; anything else finishes after its use duration.
      if(!item||!useDuration(item))this.stopUsing();
      else if(item.use!=='crossbow'&&this.ticksUsing>=this.useDuration)this.stopUsing();
    }
    this.oAttackAnim=this.attackAnim;
    if(this.swinging){if(++this.swingTime>=this.swingDuration){this.swingTime=0;this.swinging=false;}}
    else this.swingTime=0;
    this.attackAnim=this.swingTime/this.swingDuration;
    // ItemInHandRenderer.tick: the hand rises with the attack strength cubed
    // and drops (0.4 per tick at most) while the shown item is outdated.
    this.oMainHandHeight=this.mainHandHeight;
    if(this.renderedMainHand===undefined)this.renderedMainHand=main;
    const strength=Math.min(1,Math.max(0,(this.attackStrengthTicker+1)*attackSpeed(main)/20));
    this.mainHandHeight+=Math.min(0.4,Math.max(-0.4,(this.renderedMainHand===main?strength**3:0)-this.mainHandHeight));
    if(this.mainHandHeight<0.1)this.renderedMainHand=main;
  }
  // LivingEntity.swing: a swing past its halfway point starts over.
  swing(hand){
    if(this.swinging&&this.swingTime<Math.floor(this.swingDuration/2)&&this.swingTime>=0)return;
    this.swingTime=-1;this.swinging=true;this.swingingArm=hand;this.swingSeq++;
  }
  startUseItem(items,clicked){
    this.rightClickDelay=RIGHT_CLICK_DELAY;
    for(const hand of HANDS){const item=items[hand];if(item&&this.useItem(hand,item,clicked))return;}
  }
  // Item.use for the presets: true when the hand consumed the click.
  useItem(hand,item,clicked){
    if(item.gun)return false;
    if((this.cooldowns.get(item.id)??0)>this.tickCount)return false;
    if(item.charged){this.onItemChange?.(hand,itemVariant(item,{charged:false},'crossbow'));return true;}
    if(item.type==='fishing_rod'){
      // Held, the key would cast and reel in every 4 ticks; only clicks do here.
      if(clicked){this.onItemChange?.(hand,itemVariant(item,{fishing:!item.fishing},item.fishing?'fishing_rod':'fishing_rod_cast'));this.swing(hand);}
      return true;
    }
    if(item.type==='throwable_potion'){if(clicked)this.swing(hand);return true;}
    const duration=useDuration(item);if(!duration)return false;
    if(item.use==='toot_horn')this.cooldowns.set(item.id,this.tickCount+GOAT_HORN_COOLDOWN);
    this.usingHand=hand;this.ticksUsing=0;this.useDuration=duration;this.useSeq++;
    return true;
  }
  // CrossbowItem.releaseUsing loads it once drawn for the charge duration.
  releaseUsing(items){
    const hand=this.usingHand,item=items[hand];
    if(item?.use==='crossbow'&&!item.charged&&this.ticksUsing>=CROSSBOW_CHARGE)this.onItemChange?.(hand,itemVariant(item,{charged:true},'charged_crossbow'));
    this.stopUsing();
  }
  stopUsing(){this.usingHand=null;this.ticksUsing=0;this.useDuration=0;}
  /** 1 − the main hand height at the frame's partial tick (renderArmWithItem's equipProgress). */
  equipProgress(){return 1-(this.oMainHandHeight+(this.mainHandHeight-this.oMainHandHeight)*this.partial);}
  /** The main-hand item first person shows (ItemInHandRenderer.mainHandItem); undefined before the first tick. */
  get shownMainHand(){return this.renderedMainHand;}
  /** LivingEntity.getAttackAnim at the frame's partial tick. */
  attackTime(){let change=this.attackAnim-this.oAttackAnim;if(change<0)change+=1;return this.oAttackAnim+change*this.partial;}
}

/** Writes the swing and use queries (YSMBinding, QueryBinding) for `actions`, or idle hands for null. */
export function bindItemActionQueries(context,actions=null){
  const {query,ysm}=context,hand=actions?.usingHand;
  context.itemActions=actions;
  query.is_using_item=hand?1:0;
  query.item_in_use_duration=hand?actions.ticksUsing/20:0;
  query.item_max_use_duration=hand?actions.useDuration/20:0;
  query.item_remaining_use_duration=hand?(actions.useDuration-actions.ticksUsing)/20:0;
  ysm.swinging=actions?.swinging?1:0;ysm.swing_time=actions?.swingTime??0;
  ysm.swinging_arm=actions?.swingingArm==='offhand'?1:0;ysm.attack_time=actions?actions.attackTime():0;
}

/**
 * Menu entries for one hand: items that start a hold clip of this model
 * (including the model's own `$item` / `#tag` clips), then the other presets.
 * Each entry is {key, label, item, clip}; clip is '' when nothing plays.
 */
export function handItemMenu(animations,hand,triggers=collectHoldTriggers(animations),otherItem=null){
  const items=[...ITEM_PRESETS];
  for(const id of triggers[hand].ids)if(!items.some(item=>item.id===id))items.push({key:`id:${id}`,label:id,id});
  for(const tag of triggers[hand].tags)items.push({key:`tag:${tag}`,label:tr('#{0} 标签物品', tag),id:'',tags:[tag]});
  for(const id of triggers.tac.ids)if(!items.some(item=>item.gun?.id===id))items.push({key:`gun:${id}`,label:`${id}（TaCZ）`,id:'tacz:modern_kinetic_gun',gun:{id,type:'rifle'}});
  const entries=items.map(item=>{
    const held=hand==='mainhand'?{mainhand:item,offhand:otherItem}:{mainhand:otherItem,offhand:item};
    const clip=resolveHoldAnimation(hand,held,triggers);
    return {key:item.key,label:item.label,item,clip:clip&&animations?.[clip]?clip:''};
  });
  const emptyClip=`hold_${hand}:empty`;
  return {
    empty:{key:'',label:tr('空手'),item:null,clip:animations?.[emptyClip]?emptyClip:''},
    matching:entries.filter(entry=>entry.clip),
    others:entries.filter(entry=>!entry.clip),
  };
}

/**
 * TacCompat.handleTaczAnimState: with a gun in the main hand the main slot
 * plays "tac:<clip>" instead of <clip> when the model has it.
 */
export function mainAnimationFor(name,items,animations){
  return name&&items?.mainhand?.gun&&animations?.[`tac:${name}`]?`tac:${name}`:name;
}

/** Installs the held-item Molang queries on a context; context.handItems holds the items. */
export function bindHandItems(context,items={mainhand:null,offhand:null}){
  context.handItems=items;
  const {ysm,query}=context;
  ysm.has_mainhand=items.mainhand?1:0;ysm.has_offhand=items.offhand?1:0;
  ysm.mainhand_charged_crossbow=items.mainhand?.charged?1:0;ysm.offhand_charged_crossbow=items.offhand?.charged?1:0;
  // TacBinding's ctrl.tac_* variables follow the main-hand gun.
  const gun=items.mainhand?.gun,ctrl=context.ctrl;
  ctrl.tac_hold_gun=gun?1:0;ctrl.tac_gun_type=gun?.type||'';ctrl.tac_gun_id=gun?.id||'';ctrl.tac_is_aim=gun?.aiming?1:0;
  // q.is_item_name_any / equipped_item_*_tag(slot, ...): only the hands hold anything here.
  const held=slot=>context.handItems?.[String(slot??'').toLowerCase()]||null;
  const names=list=>list.map(resourceLocation);
  query.is_item_name_any=(slot,...ids)=>{const item=held(slot);return item?.id?names(ids).includes(resourceLocation(item.id))?1:0:0;};
  query.equipped_item_any_tag=(slot,...tags)=>{const item=held(slot);return item&&names(tags).some(tag=>item.tags?.includes(tag))?1:0;};
  query.equipped_item_all_tags=(slot,...tags)=>{const item=held(slot);return item&&names(tags).every(tag=>item.tags?.includes(tag))?1:0;};
  ysm.is_fishing=items.mainhand?.fishing||items.offhand?.fishing?1:0;
  // CtrlBinding hold / swing / use (HandRenderFunction): "empty", "$id",
  // "#tag" or ":type" (InnerClassify type or UseAnim) for a hand; swing and
  // use also need the player to be swinging / using an item (either hand).
  const handTest=active=>(slot,id)=>{
    const hand=String(slot??'').toLowerCase(),text=String(id??'');
    if(!HANDS.includes(hand)||!text.trim()||!active())return 0;
    const item=held(hand),rest=text.slice(1);
    if(!item)return text==='empty'?1:0;
    if(text.startsWith('$'))return rest===resourceLocation(item.id)?1:0;
    if(text.startsWith('#'))return item.tags?.includes(resourceLocation(rest))?1:0;
    if(text.startsWith(':'))return rest===item.type||rest===(item.use||'none')?1:0;
    return 0;
  };
  ctrl.hold=handTest(()=>true);
  ctrl.swing=handTest(()=>context.itemActions?.swinging);
  ctrl.use=handTest(()=>!!context.itemActions?.usingHand);
}
