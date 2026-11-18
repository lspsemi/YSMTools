// Animated character card encoders (viewer only; library covers stay PNG).
// Each encoder takes composed card frames (a 2D canvas) in order and returns
// a Blob: GIF (gifenc, 1-bit alpha), APNG (lossless, full alpha) or MP4
// (WebCodecs H.264 via mp4-muxer, opaque on the card's matte colour).
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { tr } from './i18n.js';

export const CARD_EXPORT_FORMATS={
  gif:{label:'GIF',extension:'gif',mime:'image/gif',filter:{name:tr('GIF 动图'),extensions:['gif']},fps:[25,50]},
  apng:{label:'APNG',extension:'png',mime:'image/apng',filter:{name:tr('APNG 动图'),extensions:['png','apng']},fps:[30,60]},
  mp4:{label:'MP4',extension:'mp4',mime:'video/mp4',filter:{name:tr('MP4 视频'),extensions:['mp4']},fps:[30,60]}
};

export async function createCardEncoder(format,{width,height,fps,frameCount,matte='#1b171d'}){
  if(format==='gif')return gifEncoder(width,height,fps);
  if(format==='apng')return apngEncoder(width,height,fps,frameCount);
  if(format==='mp4')return mp4Encoder(width,height,fps,matte);
  throw new Error(tr('未知的导出格式：{0}', format));
}

// ---- GIF ----
// Pixels under half alpha become the reserved transparent index 255; the rest
// are quantized to 255 colours per frame in full RGB565 precision.
function gifEncoder(width,height,fps){
  const gif=GIFEncoder();let index=0;
  return {
    async addFrame(canvas){
      const rgba=canvas.getContext('2d').getImageData(0,0,width,height).data;
      let transparent=false;
      for(let i=3;i<rgba.length;i+=4){if(rgba[i]<128){transparent=true;rgba[i]=0;}else rgba[i]=255;}
      const palette=quantize(rgba,transparent?255:256,{format:'rgb565'}),pixels=applyPalette(rgba,palette,'rgb565');
      if(transparent){palette.push([0,0,0]);const clear=palette.length-1;for(let i=0,p=3;i<pixels.length;i++,p+=4)if(rgba[p]===0)pixels[i]=clear;}
      // GIF delays are centiseconds; accumulate so 30/60 fps keep real time.
      const delay=(Math.round((index+1)*100/fps)-Math.round(index*100/fps))*10;
      gif.writeFrame(pixels,width,height,{palette,delay,repeat:0,transparent,transparentIndex:transparent?palette.length-1:0,dispose:transparent?2:1});
      index++;
    },
    async finish(){gif.finish();return new Blob([gif.bytesView()],{type:'image/gif'});},
    close(){}
  };
}

// ---- APNG ----
const PNG_SIGNATURE=Uint8Array.of(137,80,78,71,13,10,26,10);
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function apngEncoder(width,height,fps,frameCount){
  if(typeof CompressionStream==='undefined')throw new Error(tr('当前环境不支持 APNG 压缩'));
  const ihdr=new Uint8Array(13);write32(ihdr,0,width);write32(ihdr,4,height);ihdr.set([8,6,0,0,0],8);
  const actl=new Uint8Array(8);write32(actl,0,frameCount);write32(actl,4,0);
  const [numerator,denominator]=fps>0&&fps<=65535?[1,fps]:[1,30];
  const chunks=[PNG_SIGNATURE,pngChunk('IHDR',ihdr),pngChunk('acTL',actl)];let sequence=0,index=0;
  return {
    async addFrame(canvas){
      const rgba=canvas.getContext('2d').getImageData(0,0,width,height).data;
      const fctl=new Uint8Array(26);write32(fctl,0,sequence++);write32(fctl,4,width);write32(fctl,8,height);
      write16(fctl,20,numerator);write16(fctl,22,denominator);
      chunks.push(pngChunk('fcTL',fctl));
      // Compress each frame right away; HD frames are megabytes uncompressed.
      const compressed=await deflate(scanlines(rgba,width,height));
      if(index===0)chunks.push(pngChunk('IDAT',compressed));
      else{const fdat=new Uint8Array(compressed.length+4);write32(fdat,0,sequence++);fdat.set(compressed,4);chunks.push(pngChunk('fdAT',fdat));}
      index++;
    },
    async finish(){chunks.push(pngChunk('IEND',new Uint8Array()));return new Blob(chunks,{type:'image/apng'});},
    close(){}
  };
}
function scanlines(rgba,width,height){
  const row=width*4,data=new Uint8Array((row+1)*height);
  for(let y=0;y<height;y++)data.set(rgba.subarray(y*row,(y+1)*row),y*(row+1)+1);
  return data;
}
async function deflate(data){
  const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function pngChunk(type,data){
  const out=new Uint8Array(data.length+12);
  write32(out,0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);write32(out,out.length-4,crc32(out.subarray(4,out.length-4)));return out;
}
function crc32(data){let crc=0xffffffff;for(const byte of data)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function write16(data,offset,value){data[offset]=(value>>>8)&255;data[offset+1]=value&255;}
function write32(data,offset,value){data[offset]=(value>>>24)&255;data[offset+1]=(value>>>16)&255;data[offset+2]=(value>>>8)&255;data[offset+3]=value&255;}

// ---- MP4 ----
// H.264 first (plays everywhere), VP9-in-MP4 as a fallback.
const MP4_CODECS=[['avc','avc1.640033'],['avc','avc1.4d0033'],['avc','avc1.42003e'],['vp9','vp09.00.51.08']];
export const mp4Bitrate=(width,height,fps)=>Math.min(40e6,Math.max(2e6,Math.round(width*height*fps*0.2)));
async function mp4Encoder(width,height,fps,matte){
  if(typeof VideoEncoder==='undefined')throw new Error(tr('当前环境不支持视频编码（WebCodecs）'));
  if(width%2||height%2)throw new Error(tr('MP4 尺寸必须为偶数'));
  const bitrate=mp4Bitrate(width,height,fps);
  let chosen=null;
  for(const [muxCodec,codec] of MP4_CODECS){
    const config={codec,width,height,bitrate,framerate:fps,...(muxCodec==='avc'?{avc:{format:'avc'}}:{})};
    try{if((await VideoEncoder.isConfigSupported(config)).supported){chosen={muxCodec,config};break;}}catch{}
  }
  if(!chosen)throw new Error(tr('当前环境无法编码 {0}×{1} 的视频，请降低分辨率', width, height));
  // Long recordings (up to 100 plays) can reach hundreds of MB: collect the
  // muxer's sequential writes as separate chunks instead of one growing
  // buffer; finalize only patches bytes already written (the mdat size).
  const output=chunkStore();
  const muxer=new Muxer({target:new StreamTarget({onData:output.write}),video:{codec:chosen.muxCodec,width,height,frameRate:fps},fastStart:false});
  let failure=null;
  const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{failure=error;}});
  encoder.configure(chosen.config);
  // MP4 has no alpha: flatten onto the card's own backdrop colour.
  const flat=document.createElement('canvas');flat.width=width;flat.height=height;
  const ctx=flat.getContext('2d');let index=0;
  const frameDuration=1e6/fps;
  return {
    async addFrame(canvas){
      if(failure)throw failure;
      ctx.fillStyle=matte;ctx.fillRect(0,0,width,height);ctx.drawImage(canvas,0,0);
      const frame=new VideoFrame(flat,{timestamp:Math.round(index*frameDuration),duration:Math.round(frameDuration)});
      encoder.encode(frame,{keyFrame:index%(fps*2)===0});frame.close();index++;
      while(encoder.encodeQueueSize>4&&!failure)await new Promise(resolve=>encoder.addEventListener('dequeue',resolve,{once:true}));
    },
    async finish(){
      await encoder.flush();if(failure)throw failure;encoder.close();
      muxer.finalize();return new Blob(output.chunks,{type:'video/mp4'});
    },
    close(){if(encoder.state!=='closed')encoder.close();}
  };
}
// Byte sink for StreamTarget: appends at the end, overwrites in place below it.
function chunkStore(){
  const chunks=[],starts=[];let end=0;
  return {chunks,write(data,position){
    if(position===end){starts.push(end);chunks.push(data.slice());end+=data.length;return;}
    if(position+data.length>end)throw new Error(tr('MP4 写入位置无效'));
    for(let i=0,offset=0;offset<data.length;i++){
      const chunk=chunks[i],start=starts[i];if(start+chunk.length<=position+offset)continue;
      const at=position+offset-start,count=Math.min(chunk.length-at,data.length-offset);
      chunk.set(data.subarray(offset,offset+count),at);offset+=count;
    }
  }};
}
