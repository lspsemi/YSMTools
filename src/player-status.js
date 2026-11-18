import { tr } from './i18n.js';
// 角色状态 menu: the player state the game feeds to Molang that the viewer has
// no world for (health, hunger, armor, potion effects, weather, biome). The
// values default to a healthy player standing in the open in plains, with no
// armor and no effects; bindPlayerStatus writes them into a Molang context.
// Independent of Three.js and the DOM so the settings UI can use it directly.

export const STATUS_LIMITS={health:{min:0,max:100},maxHealth:{min:1,max:100},food:{min:0,max:20},armorValue:{min:0,max:30},effectLevel:{min:0,max:5}};
export const ARMOR_SLOTS=[['helmet',tr('头盔')],['chest',tr('胸甲')],['legs',tr('护腿')],['boots',tr('靴子')],['elytra',tr('鞘翅')]];
export const WEATHERS=[[0,tr('晴天')],[1,tr('下雨')],[2,tr('雷暴')]];

// Vanilla 1.20.1 mob effects (ysm.effect_level reads amplifier + 1).
export const EFFECTS=[
  ['speed',tr('速度')],['slowness',tr('缓慢')],['haste',tr('急迫')],['mining_fatigue',tr('挖掘疲劳')],['strength',tr('力量')],['instant_health',tr('瞬间治疗')],['instant_damage',tr('瞬间伤害')],
  ['jump_boost',tr('跳跃提升')],['nausea',tr('反胃')],['regeneration',tr('生命恢复')],['resistance',tr('抗性提升')],['fire_resistance',tr('抗火')],['water_breathing',tr('水下呼吸')],
  ['invisibility',tr('隐身')],['blindness',tr('失明')],['night_vision',tr('夜视')],['hunger',tr('饥饿')],['weakness',tr('虚弱')],['poison',tr('中毒')],['wither',tr('凋零')],
  ['health_boost',tr('生命提升')],['absorption',tr('伤害吸收')],['saturation',tr('饱和')],['glowing',tr('发光')],['levitation',tr('飘浮')],['luck',tr('幸运')],['unluck',tr('霉运')],
  ['slow_falling',tr('缓降')],['conduit_power',tr('潮涌能量')],['dolphins_grace',tr('海豚的恩惠')],['bad_omen',tr('不祥之兆')],['hero_of_the_village',tr('村庄英雄')],['darkness',tr('黑暗')],
].map(([id,label])=>({id:`minecraft:${id}`,label}));

// A selection of vanilla biomes with the biome tags models test through
// q.biome_has_any_tag / biome_has_all_tags (vanilla `minecraft:` tags plus
// Forge's common `forge:` ones), whether rain falls there, and the dimension;
// `group` sorts them by climate for the menu.
const HOT=['minecraft:snow_golem_melts','forge:is_hot'],DRY=['forge:is_dry'],COLD=['forge:is_cold','forge:is_snowy'];
const OVERWORLD='minecraft:is_overworld';
export const BIOMES=[
  ['plains',tr('平原'),'temperate',[OVERWORLD,'forge:is_plains'],'rain'],
  ['forest',tr('森林'),'temperate',[OVERWORLD,'minecraft:is_forest'],'rain'],
  ['birch_forest',tr('桦木森林'),'temperate',[OVERWORLD,'minecraft:is_forest'],'rain'],
  ['cherry_grove',tr('樱花树林'),'temperate',[OVERWORLD,'minecraft:is_mountain'],'rain'],
  ['taiga',tr('针叶林'),'cold',[OVERWORLD,'minecraft:is_taiga','forge:is_coniferous'],'rain'],
  ['snowy_plains',tr('雪原'),'cold',[OVERWORLD,...COLD,'forge:is_plains'],'snow'],
  ['jungle',tr('丛林'),'hot',[OVERWORLD,'minecraft:is_jungle','forge:is_hot','forge:is_wet','forge:is_dense'],'rain'],
  ['swamp',tr('沼泽'),'water',[OVERWORLD,'forge:is_swamp','forge:is_wet'],'rain'],
  ['savanna',tr('热带草原'),'hot',[OVERWORLD,'minecraft:is_savanna',...HOT,...DRY,'forge:is_sparse'],'none'],
  ['desert',tr('沙漠'),'hot',[OVERWORLD,...HOT,...DRY,'forge:is_desert','forge:is_sandy'],'none'],
  ['badlands',tr('恶地'),'hot',[OVERWORLD,'minecraft:is_badlands',...HOT,...DRY,'forge:is_sandy'],'none'],
  ['meadow',tr('草甸'),'temperate',[OVERWORLD,'minecraft:is_mountain'],'rain'],
  ['beach',tr('沙滩'),'water',[OVERWORLD,'minecraft:is_beach','forge:is_sandy'],'rain'],
  ['river',tr('河流'),'water',[OVERWORLD,'minecraft:is_river','forge:is_water'],'rain'],
  ['ocean',tr('海洋'),'water',[OVERWORLD,'minecraft:is_ocean','forge:is_water'],'rain'],
  ['mushroom_fields',tr('蘑菇岛'),'temperate',[OVERWORLD,'forge:is_mushroom','forge:is_rare'],'rain'],
  ['nether_wastes',tr('下界荒地'),'other',['minecraft:is_nether',...HOT,...DRY],'none','minecraft:the_nether'],
  ['the_end',tr('末地'),'other',['minecraft:is_end',...DRY,'forge:is_void'],'none','minecraft:the_end'],
].map(([id,label,group,tags,precipitation,dimension='minecraft:overworld'])=>({id:`minecraft:${id}`,label,group,tags,precipitation,dimension}));
// Groups for the menu, in display order.
export const BIOME_GROUPS=[['temperate',tr('温带')],['cold',tr('寒冷')],['hot',tr('炎热')],['water',tr('水域')],['other',tr('异界')]];

export const DEFAULT_STATUS=Object.freeze({health:20,maxHealth:20,food:20,armor:Object.freeze({helmet:false,chest:false,legs:false,boots:false,elytra:false}),armorValue:0,effects:Object.freeze({}),weather:0,openAir:true,biome:'minecraft:plains'});

const clamp=(value,{min,max},fallback)=>{const number=Math.round(Number(value));return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;};
// ResourceLocation.tryParse: a bare path is in the minecraft namespace.
const resourceLocation=value=>{const text=String(value??'').trim().toLowerCase();return text.includes(':')?text:`minecraft:${text}`;};

/** A complete, valid status from saved or partial values. */
export function normalizeStatus(value={}){
  const maxHealth=clamp(value.maxHealth,STATUS_LIMITS.maxHealth,DEFAULT_STATUS.maxHealth);
  const armor=Object.fromEntries(ARMOR_SLOTS.map(([slot])=>[slot,value.armor?.[slot]===true]));
  const effects={};
  for(const {id} of EFFECTS){const level=clamp(value.effects?.[id],STATUS_LIMITS.effectLevel,0);if(level)effects[id]=level;}
  return {
    health:Math.min(maxHealth,clamp(value.health,STATUS_LIMITS.health,DEFAULT_STATUS.health)),maxHealth,
    food:clamp(value.food,STATUS_LIMITS.food,DEFAULT_STATUS.food),armor,
    armorValue:clamp(value.armorValue,STATUS_LIMITS.armorValue,DEFAULT_STATUS.armorValue),effects,
    weather:WEATHERS.some(([id])=>id===value.weather)?value.weather:DEFAULT_STATUS.weather,
    openAir:value.openAir!==false,
    biome:BIOMES.some(biome=>biome.id===value.biome)?value.biome:DEFAULT_STATUS.biome,
  };
}

/** True when nothing differs from DEFAULT_STATUS. */
export function isDefaultStatus(value){return JSON.stringify(normalizeStatus(value))===JSON.stringify(normalizeStatus(DEFAULT_STATUS));}

// String arguments of every call to `name` (quotes may arrive JSON-escaped).
const callArguments=(scripts,name)=>{
  const values=[];
  for(const call of scripts.matchAll(new RegExp(`${name}\\s*\\(([^)]*)\\)`,'gi')))for(const id of call[1].replace(/\\/g,'').matchAll(/['"]([^'"]+)['"]/g))values.push(resourceLocation(id[1]));
  return values;
};
const reads=(scripts,pattern)=>new RegExp(`\\b(?:${pattern})\\b`,'i').test(scripts);
const Q='(?:q|query)\\.',Y='ysm\\.';

/** Effect ids that a model's scripts pass to ysm.effect_level, in first-use order. */
export function effectsUsedBy(scripts){return [...new Set(callArguments(String(scripts||''),'effect_level'))];}

/**
 * Which of the status values a model's scripts read, so the menu can put
 * them first: the Molang queries bindPlayerStatus feeds, the armor slots,
 * the effect ids, and the biomes whose tags (or dimension) the model tests.
 */
export function statusUsedBy(scripts){
  const text=String(scripts||''),equipment=reads(text,`${Q}equipment_count`);
  const slotQueries={helmet:'has_helmet',chest:'has_chest_plate',legs:'has_leggings',boots:'has_boots',elytra:'has_elytra'};
  const armor=ARMOR_SLOTS.map(([slot])=>slot).filter(slot=>equipment&&slot!=='elytra'||reads(text,`${Y}${slotQueries[slot]}`));
  const tags=new Set([...callArguments(text,'biome_has_any_tag'),...callArguments(text,'biome_has_all_tags')]),dimension=reads(text,`${Y}dimension_name`);
  const biomes=BIOMES.filter(biome=>biome.tags.some(tag=>tags.has(tag))||dimension&&biome.group==='other').map(biome=>biome.id);
  const rain=reads(text,`${Q}is_in_water_or_rain`);
  return {
    health:reads(text,`${Q}(?:health|max_health|health_percent)`),food:reads(text,`${Y}food_level`),
    armor,armorValue:reads(text,`(?:${Q}|${Y})armor_value`),effects:effectsUsedBy(text),
    weather:rain||reads(text,`${Y}weather`),openAir:rain||reads(text,`${Y}is_open_air`),
    // Rain only reaches the player where the biome has rain.
    biome:biomes.length>0||rain,biomes,biomeTags:[...tags],
  };
}

/**
 * Writes a status into a Molang context the way QueryBinding / YSMBinding
 * read the entity: health and food, the armor slots (an elytra fills the
 * chest slot, so it also counts as a chest item), effect levels, weather and
 * the biome at the player's position.
 */
export function bindPlayerStatus(context,value){
  const status=normalizeStatus(value),{query,ysm}=context,biome=BIOMES.find(entry=>entry.id===status.biome);
  query.health=status.health;query.max_health=status.maxHealth;query.health_percent=status.health/status.maxHealth*100;
  ysm.food_level=status.food;
  const {helmet,chest,legs,boots,elytra}=status.armor,chestItem=chest||elytra;
  ysm.has_helmet=helmet?1:0;ysm.has_chest_plate=chestItem?1:0;ysm.has_leggings=legs?1:0;ysm.has_boots=boots?1:0;ysm.has_elytra=elytra?1:0;
  query.equipment_count=[helmet,chestItem,legs,boots].filter(Boolean).length;
  ysm.armor_value=status.armorValue;query.armor_value=status.armorValue;
  ysm.effect_level=(...ids)=>ids.reduce((sum,id)=>sum+(status.effects[resourceLocation(id)]||0),0);
  // ClientLevel.isThundering → 2, isRaining → 1. Rain reaches the player only
  // in the open and where the biome has rain (Entity.isInRain).
  ysm.weather=status.weather;ysm.is_open_air=status.openAir?1:0;
  query.is_in_water_or_rain=status.weather>0&&status.openAir&&biome.precipitation==='rain'?1:0;
  const hasTag=id=>biome.tags.includes(resourceLocation(id));
  query.biome_has_any_tag=(...tags)=>tags.some(hasTag)?1:0;
  query.biome_has_all_tags=(...tags)=>tags.every(hasTag)?1:0;
  ysm.dimension_name=biome.dimension;
}
