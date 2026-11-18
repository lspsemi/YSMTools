import { tr } from './i18n.js';
// Draws a model's whole action wheel as an overview: every page of the root
// wheel and of each category, laid out as a tree (left to right by depth)
// with numbered connector lines from each folder or settings sector to the
// wheel or settings panel it opens. Wheels use the on-screen sector geometry
// (viewBox 240, 8 sectors, ring 36..110.4). Long trees can be split into
// pages that never cut a card; links between pages carry page references.

const WHEEL=240,INNER=36,OUTER=110.4,LABEL_RADIUS=82.8,ICON_RADIUS=50,BADGE_RADIUS=101,LABEL_WIDTH=62;
const CARD=280,CAPTION=34,WHEEL_PAD=20,WHEEL_CARD=CAPTION+WHEEL_PAD*2+WHEEL,ROW_GAP=18,COL_GAP=104,PAGE_GAP=12,PAGES_PER_ROW=4,MARGIN=28,HEADER=86;
const PANEL_LINE=17,PANEL_PAD=14,PANEL_TEXT=CARD-PANEL_PAD*2,PILL_ROOM=120;

const escapeXml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

// Minecraft draws text with a 1px shadow in the same hue at 25% brightness.
function shadowColor(color){
  const hex=/^#([0-9a-f]{6})$/i.exec(color||'');if(!hex)return null;
  const value=Number.parseInt(hex[1],16);
  return `rgb(${(value>>16&255)>>2},${(value>>8&255)>>2},${(value&255)>>2})`;
}
function runAttributes(run,fill){
  const attrs=[`fill="${escapeXml(fill)}"`];
  if(run.bold)attrs.push('font-weight="700"');
  if(run.italic)attrs.push('font-style="italic"');
  const decoration=[run.underline?'underline':'',run.strike?'line-through':''].filter(Boolean).join(' ');
  if(decoration)attrs.push(`text-decoration="${decoration}"`);
  return attrs.join(' ');
}
// One <text> line of formatted runs, with the shadow layer for coloured runs.
function textLine(runs,{x,y,size,anchor='middle',fill,weight=500,family}){
  const base=`x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" font-family="${escapeXml(family)}" text-anchor="${anchor}"`;
  const offset=Math.max(0.5,size/11);
  const shadow=runs.some(run=>shadowColor(run.color))?`<text ${base} transform="translate(${offset} ${offset})">${runs.map(run=>`<tspan ${runAttributes(run,shadowColor(run.color)||'transparent')}>${escapeXml(run.text)}</tspan>`).join('')}</text>`:'';
  return shadow+`<text ${base}>${runs.map(run=>`<tspan ${runAttributes(run,run.color||run.fill||fill)}>${escapeXml(run.text)}</tspan>`).join('')}</text>`;
}
const plainText=runs=>runs.map(run=>run.text).join('');
const wheelPlain=runs=>plainText(runs).trim();
// Splits formatted runs at a character index.
function splitRuns(runs,at){
  const first=[],second=[];let count=0;
  for(const run of runs){
    const chars=[...run.text];
    if(count+chars.length<=at)first.push(run);
    else if(count>=at)second.push(run);
    else{const cut=at-count;first.push({...run,text:chars.slice(0,cut).join('')});second.push({...run,text:chars.slice(cut).join('')});}
    count+=chars.length;
  }
  return [first,second];
}
// Greedy wrap of formatted runs to a pixel width.
function wrapRuns(runs,width,measure,size){
  const lines=[];let rest=runs;
  while(plainText(rest)){
    const chars=[...plainText(rest)];let fit=chars.length;
    while(fit>1&&measure(chars.slice(0,fit).join(''))*size/10>width)fit--;
    const [line,remaining]=splitRuns(rest,fit);lines.push(line);rest=remaining;
  }
  return lines.length?lines:[[]];
}

const polar=(radius,angle)=>[WHEEL/2+Math.cos(angle)*radius,WHEEL/2+Math.sin(angle)*radius];
function sectorGeometry(index){
  const start=-Math.PI/2-Math.PI/8+index*Math.PI/4,end=start+Math.PI/4,mid=(start+end)/2;
  const [ix,iy]=polar(INNER,start),[ox,oy]=polar(OUTER,start),[ex,ey]=polar(OUTER,end),[fx,fy]=polar(INNER,end);
  return {d:`M ${ix} ${iy} L ${ox} ${oy} A ${OUTER} ${OUTER} 0 0 1 ${ex} ${ey} L ${fx} ${fy} A ${INNER} ${INNER} 0 0 0 ${ix} ${iy} Z`,mid,label:polar(LABEL_RADIUS,mid),badge:polar(BADGE_RADIUS,mid)};
}
function gearIcon(x,y,color){
  const teeth=Array.from({length:8},(_,i)=>`<rect x="-1" y="-5" width="2" height="2.6" rx="0.4" transform="rotate(${i*45})"/>`).join('');
  return `<g transform="translate(${x} ${y})" fill="${color}">${teeth}<circle r="3.4" fill="none" stroke="${color}" stroke-width="1.8"/></g>`;
}
export function speakerIcon(x,y,color){
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M-4.5 -1.6 H-2.6 L0.4 -4.2 V4.2 L-2.6 1.6 H-4.5 Z" fill="${color}"/><path d="M2.1 -1.9 Q3.4 0 2.1 1.9"/><path d="M3.6 -3.6 Q6 0 3.6 3.6"/></g>`;
}
function folderIcon(x,y,color){
  return `<path transform="translate(${x-5} ${y-4})" d="M0 1.2 Q0 0 1.2 0 H3.8 L5 1.4 H8.8 Q10 1.4 10 2.6 V6.8 Q10 8 8.8 8 H1.2 Q0 8 0 6.8 Z" fill="${color}"/>`;
}
function badge(x,y,number,color,family){
  return `<circle cx="${x}" cy="${y}" r="7" fill="${color}"/><text x="${x}" y="${y+3.2}" font-size="9" font-weight="700" font-family="${escapeXml(family)}" text-anchor="middle" fill="#ffffff">${number}</text>`;
}

const SECTOR_STYLE={
  action:theme=>({fill:theme.sector,stroke:theme.sectorStroke,text:theme.onSurface}),
  audio:theme=>({fill:theme.audio,stroke:theme.sectorStroke,text:theme.onAudio}),
  folder:theme=>({fill:theme.folder,stroke:theme.sectorStroke,text:theme.onFolder}),
  return:theme=>({fill:theme.folder,stroke:theme.sectorStroke,text:theme.onFolder}),
  preview:()=>({fill:'#f3d58c',stroke:'#d9910d',text:'#704800'}),
  settings:theme=>({fill:theme.sector,stroke:theme.sectorStroke,text:theme.onSurface}),
  missing:theme=>({fill:theme.missing,stroke:theme.outline,text:theme.muted,dash:'3 2'}),
};

function sectorLabel(entry,style,[tx,ty],{family,textRuns,measure}){
  const runs=textRuns(entry.label).filter(run=>run.text),plain=plainText(runs);
  let lines=[runs],size=Math.min(11,LABEL_WIDTH/Math.max(1,measure(plain)/10));
  // Long labels wrap onto two lines rather than shrinking below 7px.
  if(size<7&&[...plain].length>1){
    lines=splitRuns(runs,Math.ceil([...plain].length/2));
    const widest=Math.max(...lines.map(line=>measure(plainText(line))));
    size=Math.max(5,Math.min(11,LABEL_WIDTH/Math.max(1,widest/10)));
  }
  size=Math.round(size*10)/10;
  const lineHeight=size*1.15,top=ty+size*0.36-(lines.length-1)*lineHeight/2;
  return lines.map((line,i)=>textLine(line,{x:tx,y:Math.round((top+i*lineHeight)*10)/10,size,fill:style.text,family})).join('');
}

function wheelSvg(page,links,{theme,family,textRuns,measure}){
  const sectors=Array.from({length:8},(_,index)=>{
    const {d,mid,label,badge:[bx,by]}=sectorGeometry(index),entry=page.entries[index];
    if(!entry)return `<path d="${d}" fill="${theme.empty}" stroke="${theme.sectorStroke}" stroke-width="1.4"/>`;
    const style=SECTOR_STYLE[entry.kind](theme);
    // Small markers between the hub and the label: folder, settings gear, sound.
    const icons=[entry.kind==='folder'?'folder':null,entry.settings?'gear':null,entry.sound?'sound':null].filter(Boolean);
    const iconMarkup=icons.map((icon,i)=>{
      const [x,y]=polar(ICON_RADIUS,mid+(i-(icons.length-1)/2)*0.2);
      return icon==='folder'?folderIcon(x,y,theme.onFolder):icon==='gear'?gearIcon(x,y,theme.muted):speakerIcon(x,y,entry.kind==='audio'?theme.onAudio:theme.muted);
    }).join('');
    const link=links.get(index);
    return `<path d="${d}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.4"${style.dash?` stroke-dasharray="${style.dash}"`:''}/>${sectorLabel(entry,style,label,{family,textRuns,measure})}${iconMarkup}${link?badge(bx,by,link.number,link.color,family):''}`;
  }).join('');
  const center=textLine([{text:`${page.page}/${page.pageCount}`}],{x:WHEEL/2,y:WHEEL/2+4,size:11,fill:theme.muted,family});
  return `<circle cx="${WHEEL/2}" cy="${WHEEL/2}" r="${INNER-4}" fill="${theme.surfaceContainer}"/>${sectors}${center}`;
}

const FIELD_TYPES={range:tr('滑块'),checkbox:tr('开关'),radio:tr('单选')};
// Rows of a settings panel: each field's type and title, then its range or options.
function panelRows(form,{textRuns,measure}){
  const rows=[];
  for(const field of form.fields){
    const head=[{text:`${FIELD_TYPES[field.type]||field.type}　`,bold:true},...textRuns(field.title)];
    for(const line of wrapRuns(head,PANEL_TEXT,measure,12))rows.push({runs:line,size:12,muted:false});
    if(field.detail)for(const line of wrapRuns(textRuns(field.detail),PANEL_TEXT-12,measure,11))rows.push({runs:line,size:11,muted:true,indent:12});
  }
  if(!rows.length)rows.push({runs:[{text:tr('没有可调节的设置')}],size:11,muted:true});
  return rows;
}

// Tree layout: each wheel (root or category) is shown as rows of up to
// `perRow` pages; rows and settings panels go in columns by depth, depth first, each no
// higher than the sector that opens it. With `band` set, a card that would
// cross a band boundary moves to the next band, so every band can become one
// output page without cutting a card.
function layoutTree({wheels,forms,helpers,band=null,perRow=PAGES_PER_ROW}){
  const nodes=[],links=[],placed=new Map(),columns=[],columnWidths=[];let linkNumber=0;
  const linkColor={folder:helpers.theme.primary,settings:helpers.theme.tertiary};
  const place=(node,depth,minY)=>{
    let y=Math.max(columns[depth]??0,minY);
    if(band){const end=(Math.floor(y/band)+1)*band;if(y+node.height>end)y=end;}
    columns[depth]=y+node.height+ROW_GAP;
    columnWidths[depth]=Math.max(columnWidths[depth]??0,node.width);
    Object.assign(node,{depth,y});nodes.push(node);return node;
  };
  const visitForm=(key,depth,minY)=>{
    if(placed.has(`form:${key}`))return placed.get(`form:${key}`);
    const form=forms.get(key);if(!form)return null;
    const rows=panelRows(form,helpers),height=CAPTION+PANEL_PAD+rows.reduce((sum,row)=>sum+(row.size===12?PANEL_LINE+2:PANEL_LINE),0)+PANEL_PAD;
    const node=place({type:'panel',form,rows,width:CARD,height},depth,minY);placed.set(`form:${key}`,node);return node;
  };
  const visitWheel=(key,depth,minY)=>{
    if(placed.has(key))return placed.get(key);
    const wheel=wheels.get(key);if(!wheel)return null;
    placed.set(key,null);
    let first=null,y=minY;
    for(let start=0;start<wheel.pages.length;start+=perRow){
      const pageIndexes=wheel.pages.map((_,i)=>i).slice(start,start+perRow);
      const node=place({type:'wheel',wheel,pageIndexes,width:pageIndexes.length*CARD+(pageIndexes.length-1)*PAGE_GAP,height:WHEEL_CARD,links:new Map()},depth,y);
      if(!first){first=node;placed.set(key,node);}
      for(const pageIndex of pageIndexes)wheel.pages[pageIndex].entries.forEach((entry,index)=>{
        const [,sy]=sectorGeometry(index).badge,anchorY=node.y+CAPTION+WHEEL_PAD+sy;
        let target=null,type=null;
        if(entry.target!=null&&entry.kind==='folder'){type='folder';target=placed.has(entry.target)?placed.get(entry.target):visitWheel(entry.target,depth+1,anchorY-CAPTION/2);}
        else if(entry.settings){type='settings';target=visitForm(entry.settings,depth+1,anchorY-CAPTION/2);}
        if(!target)return;
        target.number??=++linkNumber;
        node.links.set(`${pageIndex}:${index}`,{number:target.number,color:linkColor[type]});
        links.push({from:node,anchorY,to:target,color:linkColor[type],number:target.number});
      });
      y=node.y;
    }
    return first;
  };
  visitWheel('',0,0);
  const columnX=[];columnWidths.forEach((width,depth)=>{columnX[depth]=depth?columnX[depth-1]+columnWidths[depth-1]+COL_GAP:0;});
  for(const node of nodes)node.x=columnX[node.depth];
  return {nodes,links,contentWidth:Math.max(...nodes.map(node=>node.x+node.width)),contentHeight:Math.max(...nodes.map(node=>node.y+node.height)),tallest:Math.max(...nodes.map(node=>node.height))};
}

// Legend, wrapped to the image width; returns its markup and bottom edge.
function legendSvg(width,{theme,family,measure}){
  const items=[['action',tr('动作')],['audio',tr('仅声音的动作')],['folder',tr('子分类 / 返回')],['preview',tr('封面动画')],['missing',tr('模型中没有对应动画')],['icon:sound',tr('含声音')],['icon:gear',tr('打开设置面板')],['icon:folder',tr('进入子轮盘')],['icon:link',tr('连线：编号对应右侧的子轮盘或设置面板')]];
  let lx=MARGIN,ly=HEADER;const parts=[];
  for(const [kind,label] of items){
    const itemWidth=24+measure(label)*1.2+20;
    if(lx+itemWidth>width-MARGIN&&lx>MARGIN){lx=MARGIN;ly+=24;}
    let swatch;
    if(kind==='icon:sound')swatch=speakerIcon(lx+8,ly+10,theme.muted);
    else if(kind==='icon:gear')swatch=gearIcon(lx+8,ly+10,theme.muted);
    else if(kind==='icon:folder')swatch=folderIcon(lx+8,ly+10,theme.onFolder);
    else if(kind==='icon:link')swatch=`<path d="M${lx} ${ly+10} C ${lx+8} ${ly+10}, ${lx+8} ${ly+10}, ${lx+16} ${ly+10}" stroke="${theme.primary}" stroke-width="2" fill="none"/>${badge(lx+16,ly+10,1,theme.primary,family)}`;
    else{const style=SECTOR_STYLE[kind](theme);swatch=`<rect x="${lx}" y="${ly+2}" width="16" height="16" rx="4" fill="${style.fill}" stroke="${style.stroke}"${style.dash?` stroke-dasharray="${style.dash}"`:''}/>`;}
    parts.push(swatch+textLine([{text:label}],{x:lx+(kind==='icon:link'?30:22),y:ly+15,size:12,anchor:'start',fill:theme.muted,family}));
    lx+=itemWidth+(kind==='icon:link'?8:0);
  }
  return {markup:parts.join(''),bottom:ly+24};
}

function nodeSvg(node,x,y,{theme,family,textRuns},helpers){
  const number=node.number&&(node.type==='panel'||node.pageIndexes[0]===0)?badge(x+18,y+17,node.number,node.type==='panel'?theme.tertiary:theme.primary,family):'';
  if(node.type==='panel'){
    const id=node.form.id&&wheelPlain(textRuns(node.form.name))!==node.form.id?[{text:`　${node.form.id}`,fill:theme.muted}]:[];
    const caption=textLine([{text:tr('设置：')},...textRuns(node.form.name),...id],{x:x+(number?32:14),y:y+22,size:14,anchor:'start',fill:theme.onSurface,weight:600,family});
    let rowY=y+CAPTION+PANEL_PAD;
    const rows=node.rows.map(row=>{const step=row.size===12?PANEL_LINE+2:PANEL_LINE;rowY+=step;return textLine(row.runs,{x:x+PANEL_PAD+(row.indent||0),y:rowY-5,size:row.size,anchor:'start',fill:row.muted?theme.muted:theme.onSurface,family});}).join('');
    return `<rect x="${x}" y="${y}" width="${CARD}" height="${node.height}" rx="16" fill="${theme.card}" stroke="${theme.tertiary}" stroke-dasharray="5 3"/>${gearIcon(x+CARD-20,y+17,theme.muted)}${number}${caption}<line x1="${x+12}" y1="${y+CAPTION}" x2="${x+CARD-12}" y2="${y+CAPTION}" stroke="${theme.outline}"/>${rows}`;
  }
  const pathRuns=node.wheel.path.flatMap((label,index)=>[...(index?[{text:' / '}]:[]),...textRuns(label)]);
  return node.pageIndexes.map((pageIndex,i)=>{
    const page=node.wheel.pages[pageIndex],px=x+i*(CARD+PAGE_GAP),first=pageIndex===0;
    const caption=textLine(pathRuns,{x:px+(first&&number?32:14),y:y+22,size:14,anchor:'start',fill:theme.onSurface,weight:600,family});
    const pageLabel=page.pageCount>1?textLine([{text:tr('第 {0} / {1} 页', page.page, page.pageCount)}],{x:px+CARD-14,y:y+22,size:12,anchor:'end',fill:theme.muted,family}):'';
    const links=new Map([...node.links].filter(([key])=>key.startsWith(`${pageIndex}:`)).map(([key,value])=>[Number(key.split(':')[1]),value]));
    return `<rect x="${px}" y="${y}" width="${CARD}" height="${WHEEL_CARD}" rx="16" fill="${theme.card}" stroke="${theme.outline}"/>${first?number:''}${caption}${pageLabel}<g transform="translate(${px+WHEEL_PAD} ${y+CAPTION+WHEEL_PAD})">${wheelSvg(page,links,helpers)}</g>`;
  }).join('');
}

// A pill such as "③ → 第 2 页" or "③ 来自第 1 页" for links between pages.
function pageRefPill(x,y,number,label,color,{theme,family,measure},align='start'){
  const width=24+measure(label)*1.2+10,left=align==='end'?x-width:x;
  return `<rect x="${left}" y="${y-11}" width="${width}" height="22" rx="11" fill="${theme.card}" stroke="${color}" stroke-width="1.5"/>${badge(left+12,y,number,color,family)}${textLine([{text:label}],{x:left+23,y:y+4,size:11,anchor:'start',fill:theme.onSurface,weight:600,family})}`;
}

async function rasterize(svg,width,height,scale,mime){
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{
    const image=new Image();image.decoding='async';
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error(tr('轮盘图片渲染失败')));image.src=url;});
    // Stay inside Chromium's canvas limits (16384px per side, ~268M pixels) on huge wheel trees.
    const fit=Math.min(scale,16000/Math.max(width,height),Math.sqrt(2.4e8/(width*height)));
    const canvas=document.createElement('canvas');canvas.width=Math.round(width*fit);canvas.height=Math.round(height*fit);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error(tr('无法生成轮盘图片'))),mime,0.92));
    return {blob,width,height,pixelWidth:canvas.width,pixelHeight:canvas.height};
  }finally{URL.revokeObjectURL(url);}
}

/**
 * Renders the overview as one image, or as several pages when `paged` is set.
 * wheels: Map key -> {path:[label...], pages:[{page,pageCount,entries:[entry]}]}, root key ''.
 * entry: {label, kind, sound, settings:formKey|null, target:wheelKey|null}
 *   kind: action | audio | folder | return | preview | settings | missing.
 * forms: Map formKey -> {id, name, fields:[{type, title, detail}]}.
 * Resolves to [{blob, width, height, pixelWidth, pixelHeight}], one per page.
 */
export async function renderWheelOverview({title,subtitle,wheels,forms,theme,family,textRuns,paged=false,mime='image/png',scale=2}){
  const ctx=document.createElement('canvas').getContext('2d');
  const measure=text=>{ctx.font=`500 10px ${family}`;return ctx.measureText(text).width;};
  const helpers={theme,family,textRuns,measure};

  // Paged output keeps two wheel pages per row so columns, and so pages, stay narrow.
  const perRow=paged?2:PAGES_PER_ROW;
  let layout=layoutTree({wheels,forms,helpers,perRow});
  const fullWidth=Math.max(MARGIN*2+layout.contentWidth,720);
  let band=null;
  if(paged){
    // A4 portrait pages, never shorter than the tallest card.
    band=Math.max(layout.tallest+ROW_GAP,Math.round(fullWidth*Math.SQRT2)-legendSvg(fullWidth,helpers).bottom-16-MARGIN);
    layout=layoutTree({wheels,forms,helpers,band,perRow});
  }
  const pageOf=node=>band?Math.floor(node.y/band):0,pageCount=band?Math.max(...layout.nodes.map(pageOf))+1:1;

  const pages=[];
  for(let page=0;page<pageCount;page++){
    const offset=band?page*band:0,nodes=layout.nodes.filter(node=>pageOf(node)===page);
    // Each page is cropped to the columns it uses, keeping room for "来自第 N 页" pills.
    const incoming=layout.links.filter(link=>pageOf(link.to)===page&&pageOf(link.from)!==page);
    const left=band?Math.max(0,Math.min(...nodes.map(node=>node.x),...incoming.map(link=>link.to.x-PILL_ROOM))):0;
    const right=Math.max(...nodes.map(node=>node.x+node.width),...layout.links.filter(link=>pageOf(link.from)===page&&pageOf(link.to)!==page).map(link=>link.from.x+link.from.width+PILL_ROOM));
    const width=Math.max(MARGIN*2+right-left,720),legend=legendSvg(width,helpers),top=legend.bottom+16;
    const contentHeight=band?Math.max(...nodes.map(node=>node.y-offset+node.height)):layout.contentHeight;
    const height=top+contentHeight+MARGIN,ox=MARGIN-left,oy=top-offset;
    const connectors=[],pills=[];
    for(const {from,anchorY,to,color,number} of layout.links){
      const fromPage=pageOf(from),toPage=pageOf(to),x1=ox+from.x+from.width,y1=oy+anchorY,x2=ox+to.x,y2=oy+to.y+17;
      if(fromPage===page&&toPage===page){
        if(x2<=x1)continue;
        const bend=Math.max(24,(x2-x1)/2);
        connectors.push(`<path d="M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.75"/><circle cx="${x1}" cy="${y1}" r="3" fill="${color}"/>`);
      }else if(fromPage===page){
        connectors.push(`<path d="M ${x1} ${y1} H ${x1+10}" stroke="${color}" stroke-width="2"/><circle cx="${x1}" cy="${y1}" r="3" fill="${color}"/>`);
        pills.push(pageRefPill(x1+10,y1,number,tr('→ 第 {0} 页', toPage+1),color,helpers));
      }else if(toPage===page){
        connectors.push(`<path d="M ${x2-10} ${y2} H ${x2}" stroke="${color}" stroke-width="2"/>`);
        pills.push(pageRefPill(x2-10,y2,number,tr('来自第 {0} 页', fromPage+1),color,helpers,'end'));
      }
    }
    const pageSubtitle=pageCount>1?tr('{0} · 第 {1} / {2} 页', subtitle, page+1, pageCount):subtitle;
    const header=textLine(textRuns(title),{x:MARGIN,y:42,size:24,anchor:'start',fill:theme.onSurface,weight:700,family})
      +textLine([{text:pageSubtitle}],{x:MARGIN,y:68,size:13,anchor:'start',fill:theme.muted,family});
    const cards=nodes.map(node=>nodeSvg(node,ox+node.x,oy+node.y,helpers,helpers)).join('');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${theme.background}"/>${header}${legend.markup}${connectors.join('')}${cards}${pills.join('')}</svg>`;
    pages.push(await rasterize(svg,width,height,scale,mime));
  }
  return pages;
}

// Minimal PDF: one JPEG image per page, page size matching the image at 96 dpi.
export async function imagesToPdf(pages,title=''){
  const chunks=[],offsets=[];let length=0;
  const encoder=new TextEncoder();
  const push=data=>{const bytes=typeof data==='string'?encoder.encode(data):data;chunks.push(bytes);length+=bytes.length;};
  const object=(id,body)=>{offsets[id]=length;push(`${id} 0 obj\n`);for(const part of [].concat(body))push(part);push('\nendobj\n');};
  const utf16=text=>'<FEFF'+[...String(text)].map(ch=>{const code=ch.codePointAt(0);if(code<0x10000)return code.toString(16).padStart(4,'0');const v=code-0x10000;return ((v>>10)+0xd800).toString(16)+((v&0x3ff)+0xdc00).toString(16);}).join('')+'>';
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds=pages.map((_,i)=>3+i*3);
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`);
  for(const [i,page] of pages.entries()){
    const id=pageIds[i],w=+(page.width*0.75).toFixed(2),h=+(page.height*0.75).toFixed(2);
    const jpeg=new Uint8Array(await page.blob.arrayBuffer()),content=`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    object(id+1,[`<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,jpeg,'\nendstream']);
    object(id+2,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  const infoId=3+pages.length*3;
  object(infoId,`<< /Title ${utf16(title)} /Producer (YSM Preview) >>`);
  const xref=length,count=infoId+1;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({length:count-1},(_,i)=>`${String(offsets[i+1]).padStart(10,'0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks,{type:'application/pdf'});
}
