import { tr } from './i18n.js';
// 设置 → 性能 → Benchmark: an overlay in the 3D view with the frame rate, a
// line chart of its fluctuation and a few render statistics. The viewer calls
// `sample()` once per rendered main-view frame (see ModelViewer.setBenchmark);
// nothing here runs while the setting is off.

const CHART_FRAMES=240;     // frames shown in the line chart (≈4 s at 60 FPS)
const STATS_FRAMES=600;     // frames used for min / max / 1% low (≈10 s at 60 FPS)
const GAP_MS=500;           // a longer interval is a pause (tab hidden, other tab), not a slow frame
const TEXT_INTERVAL_MS=250; // the numbers update 4 times per second so they stay readable

function formatCount(value){
  if(value>=1e6)return `${(value/1e6).toFixed(value>=1e7?0:1)}M`;
  if(value>=1e3)return `${(value/1e3).toFixed(value>=1e4?0:1)}k`;
  return String(value);
}
function gpuName(renderer){
  try{
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const name=String(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)||'');
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 4070"
    const angle=/^ANGLE \([^,]+,\s*(.+?)(?:\s*\(0x[0-9a-f]+\)|\s+Direct3D|\s+OpenGL|\s+Vulkan|,|\)$)/i.exec(name);
    return angle?angle[1].trim():name;
  }catch{return '';}
}

export function createBenchmarkHud(viewport){
  const el=document.createElement('div');
  el.className='benchmark-hud';el.id='benchmark-hud';el.hidden=true;el.setAttribute('aria-hidden','true');
  el.innerHTML=`<div class="benchmark-head"><span class="benchmark-fps"><strong data-b="fps">--</strong><span>FPS</span></span><span class="benchmark-frame" data-b="frame">-- ms</span></div>
<canvas class="benchmark-chart" width="240" height="64"></canvas>
<dl class="benchmark-stats">
<div><dt>${tr('平均')}</dt><dd data-b="avg">--</dd></div><div><dt>${tr('1% 低')}</dt><dd data-b="low">--</dd></div><div><dt>${tr('最低')}</dt><dd data-b="min">--</dd></div><div><dt>${tr('最高')}</dt><dd data-b="max">--</dd></div>
<div><dt>CPU</dt><dd data-b="cpu">--</dd></div><div><dt>${tr('绘制')}</dt><dd data-b="calls">--</dd></div><div><dt>${tr('三角面')}</dt><dd data-b="tris">--</dd></div><div><dt>${tr('内存')}</dt><dd data-b="heap">--</dd></div>
</dl>
<div class="benchmark-foot"><span data-b="size"></span><span data-b="gpu"></span></div>`;
  viewport.append(el);
  const fields=Object.fromEntries([...el.querySelectorAll('[data-b]')].map(node=>[node.dataset.b,node]));
  const canvas=el.querySelector('canvas'),context=canvas.getContext('2d');

  const frames=new Float32Array(STATS_FRAMES);let count=0,head=0; // ring of frame intervals (ms)
  let shownFps=0,cpuTotal=0,cpuFrames=0,lastNow=0,lastText=0,info=null,renderer=null,colors=null,sorted=new Float32Array(STATS_FRAMES);
  function reset(){shownFps=0;count=0;head=0;cpuTotal=0;cpuFrames=0;lastNow=0;lastText=0;}
  function frameAt(age){return frames[(head-1-age+STATS_FRAMES)%STATS_FRAMES];} // age 0 = newest

  function readColors(){
    const style=getComputedStyle(el),token=name=>style.getPropertyValue(name).trim();
    colors={line:token('--md-sys-color-primary'),grid:token('--md-sys-color-outline-variant'),label:token('--md-sys-color-on-surface-variant'),warn:token('--md-sys-color-tertiary'),bad:token('--md-sys-color-error')};
  }
  function tierColor(fps){return fps>=55?colors.line:fps>=30?colors.warn:colors.bad;}

  function drawChart(){
    const ratio=Math.min(window.devicePixelRatio||1,2),cssWidth=canvas.clientWidth||240,cssHeight=canvas.clientHeight||64;
    const width=Math.round(cssWidth*ratio),height=Math.round(cssHeight*ratio);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,cssWidth,cssHeight);
    const shown=Math.min(count,CHART_FRAMES);
    let peak=60;for(let i=0;i<shown;i++)peak=Math.max(peak,1000/frameAt(i));
    const top=Math.ceil(Math.min(peak,480)/30)*30,pad=2,y=fps=>pad+(cssHeight-pad*2)*(1-Math.min(fps,top)/top);
    // Reference lines at 60 and 30 FPS.
    context.font='10px system-ui,sans-serif';context.textBaseline='bottom';context.lineWidth=1;
    for(const mark of [60,30]){
      const at=Math.round(y(mark))+.5;
      context.strokeStyle=colors.grid;context.setLineDash([3,3]);context.beginPath();context.moveTo(0,at);context.lineTo(cssWidth,at);context.stroke();
      context.fillStyle=colors.label;context.fillText(String(mark),2,at-1);
    }
    context.setLineDash([]);
    if(shown<2)return;
    const step=cssWidth/(CHART_FRAMES-1),x=age=>cssWidth-age*step;
    context.beginPath();
    for(let age=0;age<shown;age++){const px=x(age),py=y(1000/frameAt(age));if(age)context.lineTo(px,py);else context.moveTo(px,py);}
    const color=tierColor(shownFps||1000/frameAt(0));
    context.strokeStyle=color;context.lineWidth=1.5;context.lineJoin='round';context.stroke();
    context.lineTo(x(shown-1),cssHeight);context.lineTo(cssWidth,cssHeight);context.closePath();
    context.fillStyle=color;context.globalAlpha=.16;context.fill();context.globalAlpha=1;
  }

  function updateText(cpu){
    // Current FPS: frames over the last second.
    let time=0,n=0;while(n<count&&time<1000){time+=frameAt(n);n++;}
    const fps=time?n*1000/time:0;
    let total=0;for(let i=0;i<count;i++){sorted[i]=frames[i];total+=frames[i];}
    const ranked=sorted.subarray(0,count).sort(),worst=Math.max(1,Math.floor(count/100));
    let worstTotal=0;for(let i=count-worst;i<count;i++)worstTotal+=ranked[i];
    shownFps=fps;fields.fps.textContent=String(Math.round(fps));fields.fps.parentElement.style.color=tierColor(fps);
    fields.frame.textContent=`${(time/n).toFixed(1)} ms`;
    fields.avg.textContent=(1000*count/total).toFixed(0);
    fields.low.textContent=(1000*worst/worstTotal).toFixed(0);
    fields.min.textContent=(1000/ranked[count-1]).toFixed(0);
    fields.max.textContent=(1000/ranked[0]).toFixed(0);
    fields.cpu.textContent=`${cpu.toFixed(1)} ms`;
    if(info){fields.calls.textContent=formatCount(info.calls);fields.tris.textContent=formatCount(info.triangles);}
    const memory=performance.memory;fields.heap.textContent=memory?`${Math.round(memory.usedJSHeapSize/1048576)} MB`:'—';
    if(renderer){const size=renderer.domElement;fields.size.textContent=`${size.width}×${size.height} @${renderer.getPixelRatio()}x`;}
  }

  return {
    element:el,
    /** Shows the overlay for `rendererInstance` (the viewer's WebGLRenderer), or hides it with null. */
    setRenderer(rendererInstance){
      renderer=rendererInstance;el.hidden=!renderer;reset();
      if(!renderer)return;
      readColors();fields.gpu.textContent=gpuName(renderer);fields.gpu.title=fields.gpu.textContent;
      for(const key of ['fps','avg','low','min','max','cpu','calls','tris','heap'])fields[key].textContent='--';
      fields.frame.textContent='-- ms';drawChart();
    },
    /** One rendered frame: rAF timestamp, CPU time spent on it (ms) and renderer.info.render. */
    sample(now,cpu,renderInfo){
      if(!renderer)return;
      const interval=lastNow?now-lastNow:0;lastNow=now;info=renderInfo;
      if(interval>0&&interval<GAP_MS){
        frames[head]=interval;head=(head+1)%STATS_FRAMES;count=Math.min(count+1,STATS_FRAMES);
        cpuTotal+=cpu;cpuFrames++;
      }
      if(!count)return;
      if(now-lastText>=TEXT_INTERVAL_MS){
        lastText=now;readColors();updateText(cpuFrames?cpuTotal/cpuFrames:cpu);cpuTotal=0;cpuFrames=0;
      }
      drawChart();
    }
  };
}
