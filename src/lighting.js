// 光照调节: the main 3D view's light rig. The defaults are the rig the viewer
// always used (hemisphere 2.8 + a key light from (-3, 7, 5)), which the
// character card keeps.
// exposure 1 without the filmic curve (linear tone mapping) is the untouched
// picture; `filmic` switches the main renderer to ACES.
export const DEFAULT_LIGHTING=Object.freeze({azimuth:149,elevation:50,intensity:1.8,ambient:2.8,color:'#ffffff',exposure:1,filmic:false,bloom:false,bloomStrength:1.2,bloomRadius:0.5,bloomGlowOnly:true,bloomThreshold:0.9,marker:false});

export const LIGHTING_LIMITS=Object.freeze({
  azimuth:{min:0,max:359,step:1},
  elevation:{min:-30,max:90,step:1},
  intensity:{min:0,max:10,step:0.1},
  ambient:{min:0,max:10,step:0.1},
  exposure:{min:0.2,max:3,step:0.05},
  bloomStrength:{min:0,max:3,step:0.05},
  bloomRadius:{min:0,max:1,step:0.05},
  // "All highlights" mode: linear brightness where surfaces start to glow.
  bloomThreshold:{min:0.3,max:3,step:0.05},
});

/** Unit vector toward the key light. The default camera looks along +z, so +x is screen left. */
export function lightDirection(azimuth,elevation){
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180;
  return {x:-Math.sin(a)*Math.cos(e),y:Math.sin(e),z:-Math.cos(a)*Math.cos(e)};
}

/** Clamps saved settings to valid values, filling gaps with the defaults. */
export function normalizeLighting(saved={}){
  const result={...DEFAULT_LIGHTING};
  for(const [key,{min,max}] of Object.entries(LIGHTING_LIMITS)){const value=Number(saved?.[key]);if(Number.isFinite(value))result[key]=Math.min(max,Math.max(min,value));}
  if(/^#[0-9a-f]{6}$/i.test(saved?.color))result.color=saved.color.toLowerCase();
  result.filmic=saved?.filmic===true;result.marker=saved?.marker===true;
  result.bloom=saved?.bloom===true;result.bloomGlowOnly=saved?.bloomGlowOnly!==false;
  return result;
}
