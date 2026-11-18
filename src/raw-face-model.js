import * as THREE from 'three';
import { tr } from './i18n.js';

// V3 model geometry after decryption/decompression. This is the original
// serialized face data, before YSMParser's Blockbench cube reconstruction.
export function parseRawFaceModel(buffer){
  const view=new DataView(buffer),decoder=new TextDecoder(),bytes=new Uint8Array(buffer);
  let offset=0;
  const requireBytes=n=>{if(n<0||offset+n>view.byteLength)throw new Error(tr('YSM 几何数据不完整'));};
  const varint=()=>{let value=0,shift=0;for(let i=0;i<5;i++){requireBytes(1);const byte=view.getUint8(offset++);value+=(byte&127)*2**shift;if(!(byte&128))return value;shift+=7;}throw new Error(tr('YSM 几何计数无效'));};
  const float=()=>{requireBytes(4);const value=view.getFloat32(offset,true);offset+=4;return value;};
  const string=()=>{const length=varint();requireBytes(length);const value=decoder.decode(bytes.subarray(offset,offset+length));offset+=length;return value;};
  const vector=()=>[float(),float(),float()];
  const count=varint();if(count>100000)throw new Error(tr('YSM 骨骼数量无效'));
  const bones=[];let faceTotal=0;
  for(let i=0;i<count;i++){
    const parent=string(),cubeCount=varint(),faces=[];
    if(cubeCount>1000000)throw new Error(tr('YSM 方块数量无效'));
    for(let c=0;c<cubeCount;c++){
      const faceCount=varint();faceTotal+=faceCount;if(faceTotal>2000000)throw new Error(tr('YSM 面数量无效'));
      for(let f=0;f<faceCount;f++){
        const normal=vector(),vertices=[];
        for(let v=0;v<4;v++)vertices.push({position:vector(),uv:[float(),float()]});
        faces.push({normal,vertices});
      }
      varint();varint();varint(); // Cube runtime fields.
    }
    const name=string();for(let j=0;j<5;j++)varint();
    bones.push({name,parent,pivot:vector(),rotation:vector(),faces});
  }
  const identifier=string(),textureHeight=float(),textureWidth=float();
  float();float();const boundsOffsetCount=varint();if(boundsOffsetCount>1000)throw new Error(tr('YSM 边界数据无效'));
  for(let i=0;i<boundsOffsetCount;i++)float();
  float();float();const hasInfo=varint();
  if(hasInfo)throw new Error(tr('暂不支持带旧版信息段的原始 YSM 几何'));
  varint();varint();varint();
  if(offset!==view.byteLength)throw new Error(tr('YSM 几何数据长度不符'));
  return {bones,faceTotal,identifier,textureWidth,textureHeight};
}

// A small alpha occupancy grid keeps face classification conservative without
// retaining the full decoded image or scanning every pixel for every face.
export function buildTextureAlphaCoverage(pixels,width,height){
  const tileSize=4,columns=Math.ceil(width/tileSize),rows=Math.ceil(height/tileSize),stride=columns+1;
  const flags=new Uint8Array(columns*rows);
  let hasTranslucency=false;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const alpha=pixels[(y*width+x)*4+3];
    if(alpha>0&&alpha<255)hasTranslucency=true;
    if(alpha>=253)flags[(y>>2)*columns+(x>>2)]|=1;
    else if(alpha>=26)flags[(y>>2)*columns+(x>>2)]|=2;
  }
  const opaque=new Uint32Array(stride*(rows+1)),translucent=new Uint32Array(stride*(rows+1));
  for(let y=0;y<rows;y++){
    let opaqueRow=0,translucentRow=0;
    for(let x=0;x<columns;x++){
      const flag=flags[y*columns+x];opaqueRow+=flag&1;translucentRow+=(flag>>1)&1;
      const i=(y+1)*stride+x+1;
      opaque[i]=opaque[i-stride]+opaqueRow;translucent[i]=translucent[i-stride]+translucentRow;
    }
  }
  const contains=(sum,x0,y0,x1,y1)=>sum[y1*stride+x1]-sum[y0*stride+x1]-sum[y1*stride+x0]+sum[y0*stride+x0]>0;
  const classify=(u0,v0,u1,v1)=>{
    if(!Number.isFinite(u0)||!Number.isFinite(v0)||!Number.isFinite(u1)||!Number.isFinite(v1))return 3;
    // Nearest sampling and rasterized edge rounding can reach an adjacent texel.
    const x0=Math.max(0,Math.min(width-1,Math.floor(u0*width)-1))>>2;
    const y0=Math.max(0,Math.min(height-1,Math.floor(v0*height)-1))>>2;
    const x1=(Math.max(0,Math.min(width-1,Math.ceil(u1*width)+1))>>2)+1;
    const y1=(Math.max(0,Math.min(height-1,Math.ceil(v1*height)+1))>>2)+1;
    return (contains(opaque,x0,y0,x1,y1)?1:0)|(contains(translucent,x0,y0,x1,y1)?2:0);
  };
  return {hasTranslucency,classify};
}

export function buildRawFaceModel(raw,material,alphaCoverage=null){
  const {bones,faceTotal}=raw,names=new Map();
  bones.forEach((bone,i)=>{if(!names.has(bone.name))names.set(bone.name,i);});
  const skeletonBones=bones.map(bone=>({name:bone.name,parentIdx:bone.parent&&names.has(bone.parent)?names.get(bone.parent):-1,pivot:bone.pivot,rotation:bone.rotation}));
  const positions=new Float32Array(faceTotal*12),normals=new Float32Array(faceTotal*12),uvs=new Float32Array(faceTotal*8),uvRects=new Float32Array(faceTotal*16),vertexBones=new Float32Array(faceTotal*4),vertexGlow=new Float32Array(faceTotal*4);
  const faceCoverage=new Float32Array(faceTotal*6),boneGroups=new Map(),boneFaceStarts=new Uint32Array(bones.length+1);
  const boneBounds=new Float32Array(bones.length*6),boneHasDrawFaces=new Uint8Array(bones.length);
  let faceIndex=0;
  bones.forEach((bone,bi)=>{
    boneFaceStarts[bi]=faceIndex;
    const group=new THREE.Group();group.name=bone.name;group.userData.boneIndex=bi;boneGroups.set(bone.name,group);
    const glow=bone.name.startsWith('ysmGlow')?1:0;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const face of bone.faces){
      const uv=face.vertices.map(v=>v.uv),u0=Math.min(...uv.map(p=>p[0])),v0=Math.min(...uv.map(p=>p[1])),u1=Math.max(...uv.map(p=>p[0])),v1=Math.max(...uv.map(p=>p[1]));
      for(let v=0;v<4;v++){
        const vertex=face.vertices[v],i=faceIndex*4+v;
        positions.set(vertex.position,i*3);normals.set(face.normal,i*3);uvs.set(vertex.uv,i*2);
        uvRects.set([u0,v0,u1,v1],i*4);vertexBones[i]=bi;vertexGlow[i]=glow;
        const [x,y,z]=vertex.position;
        minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);
        maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);
      }
      const a=face.vertices[0].position,b=face.vertices[1].position,d=face.vertices[3].position;
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
      faceCoverage.set([bi,u0,v0,u1,v1,Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)],faceIndex*6);
      faceIndex++;
    }
    if(bone.faces.length)boneBounds.set([(minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2,(maxX-minX)/2,(maxY-minY)/2,(maxZ-minZ)/2],bi*6);
  });
  boneFaceStarts[bones.length]=faceIndex;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geometry.setAttribute('ysmUvRect',new THREE.BufferAttribute(uvRects,4));
  geometry.setAttribute('ysmBoneIndex',new THREE.BufferAttribute(vertexBones,1));
  geometry.setAttribute('ysmGlow',new THREE.BufferAttribute(vertexGlow,1));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;
  const boneTexture=new THREE.DataTexture(new Float32Array(Math.max(bones.length,1)*32),8,Math.max(bones.length,1),THREE.RGBAFormat,THREE.FloatType);
  boneTexture.magFilter=THREE.NearestFilter;boneTexture.minFilter=THREE.NearestFilter;boneTexture.generateMipmaps=false;boneTexture.needsUpdate=true;
  const root=new THREE.Group();root.add(mesh);
  root.userData.bones=boneGroups;root.userData.skeletonBones=skeletonBones;root.userData.mesh=mesh;root.userData.boneTexture=boneTexture;
  const alphaMasks=new Uint8Array(faceTotal),viewGeometries=new Map();
  const makeViewGeometry=key=>{
    const target=key==='main'?geometry:new THREE.BufferGeometry();
    if(target!==geometry)for(const [name,attribute] of Object.entries(geometry.attributes))target.setAttribute(name,attribute);
    const indices=new Uint32Array(faceTotal*12),indexAttribute=new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage);
    target.setIndex(indexAttribute);
    const entry={geometry:target,indices,indexAttribute,drawnBones:new Uint8Array(bones.length),candidateBones:new Uint8Array(bones.length),dirty:true,stats:null};
    viewGeometries.set(key,entry);return entry;
  };
  const appendFace=(indices,offset,i)=>{const v=i*4;indices[offset]=v;indices[offset+1]=v+1;indices[offset+2]=v+2;indices[offset+3]=v;indices[offset+4]=v+2;indices[offset+5]=v+3;};
  const rebuild=(entry,visibleBones)=>{
    let opaqueCount=0,translucentCount=0,visibleBoneCount=0;
    const indices=entry.indices;
    for(let bi=0;bi<bones.length;bi++)if(visibleBones[bi]){
      visibleBoneCount++;
      for(let i=boneFaceStarts[bi];i<boneFaceStarts[bi+1];i++)if(alphaMasks[i]&1){appendFace(indices,opaqueCount,i);opaqueCount+=6;}
    }
    for(let bi=0;bi<bones.length;bi++)if(visibleBones[bi]){
      for(let i=boneFaceStarts[bi];i<boneFaceStarts[bi+1];i++)if(alphaMasks[i]&2){appendFace(indices,opaqueCount+translucentCount,i);translucentCount+=6;}
    }
    entry.geometry.clearGroups();
    if(opaqueCount)entry.geometry.addGroup(0,opaqueCount,0);
    if(translucentCount)entry.geometry.addGroup(opaqueCount,translucentCount,1);
    if(opaqueCount+translucentCount){entry.indexAttribute.clearUpdateRanges();entry.indexAttribute.addUpdateRange(0,opaqueCount+translucentCount);entry.indexAttribute.needsUpdate=true;}
    entry.drawnBones.set(visibleBones);entry.dirty=false;
    return entry.stats={opaqueFaces:opaqueCount/6,translucentFaces:translucentCount/6,totalFaces:faceTotal,visibleBones:visibleBoneCount};
  };
  const mainView=makeViewGeometry('main');
  root.userData.setAlphaCoverage=coverage=>{
    for(let i=0;i<faceTotal;i++){
      const c=i*6;alphaMasks[i]=coverage?.classify(faceCoverage[c+1],faceCoverage[c+2],faceCoverage[c+3],faceCoverage[c+4])??3;
    }
    boneHasDrawFaces.fill(0);
    for(let bi=0;bi<bones.length;bi++)for(let i=boneFaceStarts[bi];i<boneFaceStarts[bi+1];i++)if(alphaMasks[i]){boneHasDrawFaces[bi]=1;break;}
    for(const entry of viewGeometries.values())entry.dirty=true;
    const allBones=new Uint8Array(bones.length).fill(1);
    return rebuild(mainView,allBones);
  };
  root.userData.alphaDrawStats=root.userData.setAlphaCoverage(alphaCoverage);
  const frustum=new THREE.Frustum(),projectionView=new THREE.Matrix4(),boneMatrix=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4(),box=new THREE.Box3();
  root.userData.prepareCulling=(camera,key='main')=>{
    let entry=viewGeometries.get(key);if(!entry)entry=makeViewGeometry(key);
    root.updateWorldMatrix(true,false);camera.updateWorldMatrix(true,false);
    frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const data=boneTexture.image.data,visibleBones=entry.candidateBones,world=root.matrixWorld;
    visibleBones.fill(0);
    let changed=entry.dirty;
    for(let bi=0;bi<bones.length;bi++){
      if(!boneHasDrawFaces[bi]||data[bi*32+28]<0.5){if(entry.drawnBones[bi])changed=true;continue;}
      worldMatrix.multiplyMatrices(world,boneMatrix.fromArray(data,bi*32));
      const m=worldMatrix.elements,o=bi*6,x=boneBounds[o],y=boneBounds[o+1],z=boneBounds[o+2],ex=boneBounds[o+3],ey=boneBounds[o+4],ez=boneBounds[o+5];
      const cx=m[0]*x+m[4]*y+m[8]*z+m[12],cy=m[1]*x+m[5]*y+m[9]*z+m[13],cz=m[2]*x+m[6]*y+m[10]*z+m[14];
      const rx=Math.abs(m[0])*ex+Math.abs(m[4])*ey+Math.abs(m[8])*ez,ry=Math.abs(m[1])*ex+Math.abs(m[5])*ey+Math.abs(m[9])*ez,rz=Math.abs(m[2])*ex+Math.abs(m[6])*ey+Math.abs(m[10])*ez;
      box.min.set(cx-rx,cy-ry,cz-rz);box.max.set(cx+rx,cy+ry,cz+rz);
      const visible=!Number.isFinite(cx+cy+cz+rx+ry+rz)||frustum.intersectsBox(box);
      visibleBones[bi]=visible?1:0;if(visibleBones[bi]!==entry.drawnBones[bi])changed=true;
    }
    if(changed)rebuild(entry,visibleBones);
    mesh.geometry=entry.geometry;
    return root.userData.cullStats=entry.stats;
  };
  root.userData.disposeExtraGeometries=()=>{for(const entry of viewGeometries.values())if(entry.geometry!==mesh.geometry)entry.geometry.dispose();};
  const visibility=new Uint8Array(bones.length).fill(1);let animationVisibility=null;
  const syncBoneVisibility=()=>{const data=boneTexture.image.data;for(let i=0;i<bones.length;i++)data[i*32+28]=visibility[i]&&(!animationVisibility||animationVisibility[i])?1:0;boneTexture.needsUpdate=true;};
  root.userData.getBoneVisibility=()=>new Uint8Array(visibility);
  root.userData.setBoneVisible=(name,visible)=>{const id=names.get(name);if(id===undefined)return;for(let i=0;i<bones.length;i++){let p=i;while(p>=0){if(p===id){visibility[i]=visible?1:0;break;}p=skeletonBones[p]?.parentIdx??-1;}}syncBoneVisibility();};
  root.userData.setAnimationBoneVisibility=mask=>{animationVisibility=new Uint8Array(mask);syncBoneVisibility();};
  root.userData.syncBoneVisibility=syncBoneVisibility;
  root.userData.visibleTextureCoverage=()=>{const data=boneTexture.image.data,out=[];for(let i=0;i<faceCoverage.length;i+=6)if(data[faceCoverage[i]*32+28]&&faceCoverage[i+5]>0)out.push(...faceCoverage.subarray(i+1,i+6));return new Float32Array(out);};
  root.userData.updateBoneTexture=(matrices,normalMatrices)=>{const data=boneTexture.image.data;for(let bi=0;bi<bones.length;bi++){const base=bi*32;data.set(matrices.subarray(bi*16,bi*16+16),base);data.set(normalMatrices.subarray(bi*9,bi*9+9),base+16);}boneTexture.needsUpdate=true;};
  syncBoneVisibility();return root;
}
