import { tr } from '../i18n.js';
import { readConfig } from '../app-config.js';
// The 2:3 character cover shared by the library grid, its detail list and the
// viewer's quick model switcher, plus the saved library order the switcher
// follows. Styles are in library.css.

export const icon=name=>`<span class="material-symbol-icon" aria-hidden="true">${name}</span>`;
export const escapeText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
export const sorters={recent:(a,b)=>b.importedAt-a.importedAt,name:(a,b)=>collator.compare(a.name,b.name),size:(a,b)=>b.size-a.size};
// View settings of the library page, saved in Config/settings.json (第 51 节).
export function readSavedView(){const view=readConfig('libraryView');return view&&typeof view==='object'?view:{};}

// The cover button: a name placeholder until the image arrives (revealCover).
// attributes: e.g. 'data-action="open" aria-label="…"'.
export function coverButtonHtml(model,attributes,hover=tr('{0} 查看', icon('view_in_ar'))){
  return `<button class="library-cover" type="button" ${attributes}>
          <span class="library-cover-placeholder">${icon('person')}<span>${escapeText(model.name)}</span></span>
          <img alt="" decoding="async" hidden>
          <span class="library-cover-hover">${hover}</span>
        </button>`;
}
export function revealCover(img,url){
  if(!url||!img)return;
  img.onload=()=>{img.hidden=false;img.previousElementSibling.hidden=true;};img.src=url;
}
