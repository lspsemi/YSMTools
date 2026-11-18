// Molang 监视器 (第 61 节): message link between the viewer page (role 'host')
// and the inspector window (role 'window'). Desktop: Tauri events, which reach
// every window of the app. Browser (dev server): a BroadcastChannel between the
// page and its popup. Messages are plain objects with a `type`.
export const isDesktop=typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
const CHANNEL='ysm-molang-inspector';

/** Starts listening; `onMessage(message)` gets only the other side's messages. */
export async function openLink(role,onMessage){
  const receive=message=>{if(message&&typeof message==='object'&&message.role!==role)onMessage(message);};
  if(isDesktop){
    const {emit,listen}=await import('@tauri-apps/api/event');
    const unlisten=await listen(CHANNEL,event=>receive(event.payload));
    return {send:message=>{emit(CHANNEL,{...message,role}).catch(()=>{});},close:unlisten};
  }
  const channel=new BroadcastChannel(CHANNEL);
  channel.onmessage=event=>receive(event.data);
  return {send:message=>channel.postMessage({...message,role}),close:()=>channel.close()};
}

const PATH_SCOPES={v:'v',variable:'v',ctrl:'ctrl',ysm:'ysm',q:'q',query:'q'};
/**
 * A lockable variable path (第 66 节) such as `v.speed`, `query.is_in_water` or
 * `v.roaming.size` → {scope, keys, path} with the short scope name, or null.
 */
export function parseMolangPath(text){
  const match=/^\s*([A-Za-z]+)((?:\.[A-Za-z_]\w*)+)\s*$/.exec(String(text??''));
  const scope=match&&PATH_SCOPES[match[1].toLowerCase()];if(!scope)return null;
  const keys=match[2].slice(1).split('.');
  return {scope,keys,path:`${scope}.${keys.join('.')}`};
}
