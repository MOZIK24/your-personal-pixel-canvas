import type { CanvasMeta, ExportPayload, ExportPiece, ExportVersion, PieceMeta } from '../types';

function jsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function pieceToDataUrl(blob: Blob): Promise<string> {
  if (blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/jpeg') {
    return blobToDataUrl(blob);
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return blobToDataUrl(blob);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

/** Encode blob into shared assets map if not already present. */
export async function ensureExportAsset(
  assets: Record<string, string>,
  assetId: string,
  blob: Blob | undefined,
): Promise<boolean> {
  if (!blob || assets[assetId]) return Boolean(assets[assetId]);
  assets[assetId] = await pieceToDataUrl(blob);
  return true;
}

/**
 * Build one version metadata; fills `assets` with data URLs (deduped by assetId).
 */
export async function buildExportVersion(
  id: string,
  label: string,
  canvas: CanvasMeta,
  pieces: PieceMeta[],
  getAssetBlob: (assetId: string) => Blob | undefined,
  allAssetIdsFor: (p: PieceMeta) => string[],
  assets: Record<string, string>,
): Promise<ExportVersion> {
  const exportPieces: ExportPiece[] = [];
  for (const p of pieces) {
    const ids = allAssetIdsFor(p);
    const frameAssetIds: string[] = [];
    for (const aid of ids) {
      const ok = await ensureExportAsset(assets, aid, getAssetBlob(aid));
      if (ok) frameAssetIds.push(aid);
    }
    if (frameAssetIds.length === 0) continue;
    const durations =
      p.frameDurations && p.frameDurations.length === frameAssetIds.length
        ? p.frameDurations
        : frameAssetIds.map(() => 100);
    exportPieces.push({
      id: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      zIndex: p.zIndex,
      comment: p.comment,
      opacity: p.opacity,
      frameAssetIds,
      durations,
    });
  }
  exportPieces.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  return { id, label, canvas, pieces: exportPieces };
}

export function estimatePayloadBytes(payload: ExportPayload): number {
  return new Blob([JSON.stringify(payload)]).size;
}

/**
 * Single self-contained HTML with optional multiple save versions,
 * deduped assets, animation, pixel outline, eyedropper, version wheel, pinch-zoom.
 */
export function buildSelfContainedHtml(payload: ExportPayload): string {
  const data = jsonForScript(payload);
  const st = payload.style;
  const colors = st?.colors as (Record<string, string> & { bg?: string }) | undefined;
  const bg1 = colors?.bg1 ?? colors?.bg ?? '#16121f';
  const bg2 = colors?.bg2 ?? '#1e1a28';
  const topbar = colors?.topbar ?? '#2a2438';
  const accent = colors?.accent ?? '#6dcf9b';
  const button = colors?.button ?? '#3d2a5c';
  const titleCol = colors?.title ?? '#e8e6f0';
  const authorCol = colors?.author ?? '#9b8fc0';
  const topbarBg = st?.topbarImage
    ? `background-color:${topbar};background-image:url(${JSON.stringify(st.topbarImage)});background-size:cover;background-position:center`
    : `background:${topbar}`;
  const titleHtml =
    st?.showTitle !== false
      ? `<div id="brand" style="color:${titleCol};font-weight:700;flex-shrink:0">${escapeHtml(st?.title || payload.title || '')}</div>`
      : '';
  const authorRaw = (st?.authorText || '').trim();
  const authorHtml = authorRaw
    ? `<div id="author" style="color:${authorCol}">${linkifyAuthorHtml(authorRaw)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<title>${escapeHtml(payload.title || 'Pixel Canvas')}</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${bg1};font-family:Georgia,"Times New Roman",serif;touch-action:none}
#c{display:block;width:100%;height:100%;cursor:grab;image-rendering:pixelated}
#bar{position:fixed;top:0;left:0;right:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;${topbarBg};border-bottom:1px solid rgba(255,255,255,.08);color:${titleCol};font-size:13px;z-index:5}
#bar a{color:${accent}}
#bar button{background:${button};border:1px solid rgba(255,255,255,.12);color:${titleCol};border-radius:6px;padding:0;width:34px;height:34px;font:inherit;cursor:pointer;position:relative;z-index:2}
#bar button.active{color:#fff;background:${accent};border-color:${accent}}
#brand{position:relative;z-index:2;margin-right:8px}
#author{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font-size:12px;line-height:1.3;max-width:min(420px,40vw);max-height:44px;white-space:normal;overflow-x:hidden;overflow-y:auto;overflow-wrap:anywhere;word-break:break-word;pointer-events:auto;z-index:1;padding:0 6px 0 2px;background:transparent;border:none;box-shadow:none;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}
#author::-webkit-scrollbar{width:3px}
#author::-webkit-scrollbar-track{background:transparent}
#author::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:2px}
#ver-wrap{display:flex;align-items:center;gap:10px;margin-left:auto;position:relative;z-index:2}
#ver-wheel{position:relative;width:160px;height:72px;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(0,0,0,.25)}
#ver-wheel::before,#ver-wheel::after{content:"";position:absolute;left:0;right:0;height:22px;z-index:2;pointer-events:none}
#ver-wheel::before{top:0;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent)}
#ver-wheel::after{bottom:0;background:linear-gradient(0deg,rgba(0,0,0,.5),transparent)}
#ver-track{height:100%;overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none;-ms-overflow-style:none;padding:24px 0}
#ver-track::-webkit-scrollbar{display:none}
.ver-item{height:24px;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;font-size:12px;color:${authorCol};padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ver-item.active{color:${titleCol};font-weight:700}
#verlabel{color:${authorCol};font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hud{position:fixed;left:12px;bottom:12px;color:${authorCol};font-size:12px;opacity:.85;pointer-events:none;z-index:4}
#info{position:fixed;right:12px;bottom:12px;max-width:280px;background:${bg2};border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:12px;color:${titleCol};font-size:13px;display:none;z-index:6}
#info h3{margin:0 0 8px;font-size:14px}
#eye-dock{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:none;align-items:center;gap:8px;background:${button};border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:8px 14px;color:${titleCol};font-size:13px;z-index:8;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}
#eye-dock .swatch{width:20px;height:20px;border-radius:4px;border:1px solid #5a626a;flex-shrink:0}
#eye-loupe{position:fixed;pointer-events:none;display:none;z-index:7;width:72px}
#eye-loupe canvas{display:block;width:72px;height:72px;border:1px solid ${titleCol};border-radius:4px;image-rendering:pixelated;background:${bg1};box-shadow:0 4px 14px rgba(0,0,0,.4)}
#eye-loupe .swatch{position:absolute;left:50%;top:-28px;transform:translateX(-50%);width:22px;height:22px;border:1px solid ${titleCol};border-radius:3px}
</style>
</head>
<body>
<div id="bar">
  ${titleHtml}
  ${authorHtml}
  <div id="ver-wrap">
    <div id="ver-wheel"><div id="ver-track"></div></div>
    <span id="verlabel"></span>
  </div>
  <button type="button" id="outline" class="active" title="Outline">🟧</button>
  <button type="button" id="eyedrop" title="Eyedropper">💉</button>
</div>
<canvas id="c"></canvas>
<div id="hud">Drag / pan · Wheel / pinch zoom · Tap object · RMB palette</div>
<div id="eye-dock"><span class="swatch" id="eye-swatch"></span><span id="eye-text"></span></div>
<div id="eye-loupe"><span class="swatch" id="loupe-swatch"></span><canvas id="loupe-c" width="72" height="72"></canvas></div>
<div id="info"></div>
<script id="payload" type="application/json">${data}</script>
<script>
(function(){
  const payload = JSON.parse(document.getElementById('payload').textContent);
  const styleColors = (payload.style && payload.style.colors) || {};
  const BG1 = styleColors.bg1 || styleColors.bg || ${JSON.stringify(bg1)};
  const BG2 = styleColors.bg2 || ${JSON.stringify(bg2)};
  const versions = payload.versions || [];
  const assetUrls = payload.assets || {};
  let vi = 0;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = { x: 0, y: 0, scale: 1 };
  const images = new Map();
  const outlines = new Map();
  const imageDataCache = new Map();
  const CELL = 512;
  let cells = new Map();
  let dragging = false, lastX = 0, lastY = 0, raf = 0;
  let showOutline = true, eyedrop = false, selectedId = null;
  let pinnedHex = '';
  let touchPan = false, pinching = false, lastDist = 0;
  const verTrack = document.getElementById('ver-track');
  const verWrap = document.getElementById('ver-wrap');
  const infoEl = document.getElementById('info');
  const eyeEl = document.getElementById('eye-dock');
  const eyeSwatch = document.getElementById('eye-swatch');
  const eyeText = document.getElementById('eye-text');
  const loupeEl = document.getElementById('eye-loupe');
  const loupeC = document.getElementById('loupe-c');
  const loupeCtx = loupeC.getContext('2d');
  const loupeSwatch = document.getElementById('loupe-swatch');
  const outlineBtn = document.getElementById('outline');
  const eyedropBtn = document.getElementById('eyedrop');
  loupeCtx.imageSmoothingEnabled = false;
  let isTouch = false;

  function cur(){ return versions[vi]; }
  function key(cx,cy){ return cx+':'+cy; }
  function frameIds(p){ return p.frameAssetIds || []; }

  function loadImages(version){
    if (!version) return;
    for (const p of version.pieces){
      frameIds(p).forEach(function(aid){
        if (images.has(aid)) return;
        const url = assetUrls[aid];
        if (!url) return;
        const img = new Image();
        img.src = url;
        images.set(aid, img);
      });
    }
  }

  function indexPieces(version){
    cells = new Map();
    if (!version) return;
    for (const p of version.pieces){
      const x0 = Math.floor(p.x/CELL), y0 = Math.floor(p.y/CELL);
      const x1 = Math.floor((p.x+Math.max(p.w-1,0))/CELL);
      const y1 = Math.floor((p.y+Math.max(p.h-1,0))/CELL);
      for (let cy=y0; cy<=y1; cy++) for (let cx=x0; cx<=x1; cx++){
        const k = key(cx,cy);
        let arr = cells.get(k); if (!arr){ arr=[]; cells.set(k,arr); }
        arr.push(p);
      }
    }
  }

  function frameIndex(p, now){
    const durs = p.durations || [100];
    const n = frameIds(p).length || 1;
    if (n<=1) return 0;
    let total = 0; for (let i=0;i<n;i++) total += durs[i]||100;
    let t = now % total;
    for (let i=0;i<n;i++){ t -= durs[i]||100; if (t<0) return i; }
    return n-1;
  }

  function activeAssetId(p, now){
    const ids = frameIds(p);
    if (!ids.length) return null;
    return ids[frameIndex(p, now)] || ids[0];
  }

  function query(vx,vy,vw,vh){
    const x0=Math.floor(vx/CELL), y0=Math.floor(vy/CELL);
    const x1=Math.floor((vx+vw)/CELL), y1=Math.floor((vy+vh)/CELL);
    const seen=new Set(), out=[];
    for (let cy=y0; cy<=y1; cy++) for (let cx=x0; cx<=x1; cx++){
      const arr=cells.get(key(cx,cy)); if(!arr) continue;
      for (const p of arr){
        if (seen.has(p.id)) continue; seen.add(p.id);
        if (p.x<vx+vw && p.x+p.w>vx && p.y<vy+vh && p.y+p.h>vy) out.push(p);
      }
    }
    out.sort(function(a,b){ return a.zIndex-b.zIndex; });
    return out;
  }

  function ensureOutline(img, k){
    if (outlines.has(k) || !img.complete || !img.naturalWidth) return outlines.get(k);
    const w=img.naturalWidth, h=img.naturalHeight;
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const g=c.getContext('2d'); g.drawImage(img,0,0);
    const id=g.getImageData(0,0,w,h); const d=id.data;
    const o=g.createImageData(w,h); const od=o.data;
    function op(x,y){ if(x<0||y<0||x>=w||y>=h) return false; return d[(y*w+x)*4+3]>8; }
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){
      if (!op(x,y)) continue;
      if (op(x-1,y)&&op(x+1,y)&&op(x,y-1)&&op(x,y+1)) continue;
      const i=(y*w+x)*4; od[i]=196; od[i+1]=92; od[i+2]=38; od[i+3]=255;
    }
    g.clearRect(0,0,w,h); g.putImageData(o,0,0);
    outlines.set(k,c);
    return c;
  }

  function getImageData(img, k){
    if (imageDataCache.has(k)) return imageDataCache.get(k);
    if (!img.complete || !img.naturalWidth) return null;
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g=c.getContext('2d'); g.drawImage(img,0,0);
    const id=g.getImageData(0,0,c.width,c.height);
    imageDataCache.set(k,id); return id;
  }

  function fit(){
    const v=cur(); if(!v) return;
    const pad=0.9;
    const w=canvas.clientWidth||window.innerWidth, h=canvas.clientHeight||window.innerHeight;
    const sx=(w/v.canvas.width)*pad, sy=(h/v.canvas.height)*pad;
    cam.scale=Math.min(sx,sy);
    cam.x=(w-v.canvas.width*cam.scale)/2;
    cam.y=(h-v.canvas.height*cam.scale)/2;
  }

  function zoomAt(factor, cx, cy){
    const old=cam.scale; const next=Math.min(64, Math.max(0.01, old*factor));
    cam.x=cx-(cx-cam.x)*(next/old);
    cam.y=cy-(cy-cam.y)*(next/old);
    cam.scale=next;
  }

  function requestRender(){ if(raf) return; raf=requestAnimationFrame(function(){ raf=0; render(); }); }

  function render(){
    const v=cur(); if(!v) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=window.innerWidth, h=window.innerHeight;
    if (canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){
      canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
      canvas.style.width=w+'px'; canvas.style.height=h+'px';
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle=BG1; ctx.fillRect(0,0,w,h);
    ctx.save();
    ctx.translate(cam.x,cam.y); ctx.scale(cam.scale,cam.scale);
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle=BG2; ctx.fillRect(0,0,v.canvas.width,v.canvas.height);
    const margin=64;
    const vx=-cam.x/cam.scale-margin, vy=-cam.y/cam.scale-margin;
    const vw=w/cam.scale+margin*2, vh=h/cam.scale+margin*2;
    const visible=query(vx,vy,vw,vh);
    const now=performance.now();
    for (const p of visible){
      const aid=activeAssetId(p, now);
      if (!aid) continue;
      const img=images.get(aid);
      if (!img||!img.complete||!img.naturalWidth) continue;
      const alpha = (p.opacity==null)?1:p.opacity;
      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
      if (showOutline && selectedId===p.id){
        const ol=ensureOutline(img, aid+'ol');
        if (ol) ctx.drawImage(ol, p.x, p.y, p.w, p.h);
      }
      ctx.restore();
    }
    ctx.restore();
    if (versions.some(function(ver){ return ver.pieces.some(function(p){ return frameIds(p).length>1; }); }))
      requestRender();
  }

  function hit(wx,wy){
    const v=cur(); if(!v) return null;
    const list=query(wx-1,wy-1,2,2).slice().reverse();
    const now=performance.now();
    for (const p of list){
      if (wx<p.x||wy<p.y||wx>=p.x+p.w||wy>=p.y+p.h) continue;
      const aid=activeAssetId(p, now);
      const img=aid?images.get(aid):null;
      const id=img?getImageData(img,aid+'id'):null;
      if (!id) return p;
      const lx=Math.floor(wx-p.x), ly=Math.floor(wy-p.y);
      if (lx<0||ly<0||lx>=id.width||ly>=id.height) continue;
      if (id.data[(ly*id.width+lx)*4+3]>8) return p;
    }
    return null;
  }

  function sampleAt(wx,wy){
    const p=hit(wx,wy);
    if (!p) return null;
    const aid=activeAssetId(p, performance.now());
    const img=aid?images.get(aid):null;
    const id=img?getImageData(img,aid+'id'):null;
    if (!id) return null;
    const lx=Math.floor(wx-p.x), ly=Math.floor(wy-p.y);
    if (lx<0||ly<0||lx>=id.width||ly>=id.height) return null;
    const i=(ly*id.width+lx)*4;
    const a=id.data[i+3];
    if (a<8) return null;
    return { r:id.data[i], g:id.data[i+1], b:id.data[i+2], a:a, lx:lx, ly:ly, img:img, p:p };
  }

  function toHex(r,g,b){
    return '#'+[r,g,b].map(function(v){return v.toString(16).padStart(2,'0');}).join('');
  }

  function pinColor(hex){
    pinnedHex = hex;
    eyeEl.style.display='flex';
    eyeSwatch.style.background=hex||'transparent';
    eyeText.textContent=hex||'empty';
  }

  function updateLoupe(clientX, clientY, sample){
    if (!eyedrop){ loupeEl.style.display='none'; return; }
    loupeEl.style.display='block';
    var ox = isTouch ? 0 : 28;
    var oy = isTouch ? 28 : -88;
    var left = clientX + ox;
    var top = clientY + oy;
    left = Math.max(8, Math.min(left, window.innerWidth - 80));
    top = Math.max(8, Math.min(top, window.innerHeight - 90));
    loupeEl.style.left=left+'px';
    loupeEl.style.top=top+'px';
    loupeCtx.fillStyle='#1a1c1e';
    loupeCtx.fillRect(0,0,72,72);
    if (sample && sample.img && sample.img.complete){
      const src=9;
      const half=(src-1)/2;
      loupeCtx.imageSmoothingEnabled=false;
      loupeCtx.drawImage(
        sample.img,
        sample.lx-half, sample.ly-half, src, src,
        0, 0, 72, 72
      );
      const hex=toHex(sample.r,sample.g,sample.b);
      loupeSwatch.style.background=hex;
      loupeSwatch.style.display='block';
      loupeCtx.strokeStyle='#e8e2d6';
      loupeCtx.lineWidth=2;
      loupeCtx.strokeRect(31,31,10,10);
    } else {
      loupeSwatch.style.display='none';
    }
  }

  function showInfo(p){
    if (!p){ infoEl.style.display='none'; return; }
    infoEl.style.display='block';
    const n=frameIds(p).length;
    infoEl.innerHTML='<h3>Object</h3><div>'+p.w+'×'+p.h+' @ ('+p.x+', '+p.y+')</div>'+
      (p.comment?('<p>'+String(p.comment).replace(/</g,'&lt;')+'</p>'):'<p><i>No comment</i></p>')+
      (n>1?('<div>Frames: '+n+'</div>'):'');
  }

  function syncWheelActive(){
    const items=verTrack.querySelectorAll('.ver-item');
    items.forEach(function(el,i){
      el.classList.toggle('active', i===vi);
    });
    const lab=cur();
    document.getElementById('verlabel').textContent=lab?(lab.label||lab.id):'';
  }

  function switchVersion(i, scrollInto){
    if (!versions.length) return;
    vi=Math.max(0, Math.min(versions.length-1, i));
    selectedId=null; showInfo(null);
    loadImages(cur()); indexPieces(cur());
    // Keep camera so the canvas stays put across versions
    syncWheelActive();
    if (scrollInto){
      const el=verTrack.children[vi];
      if (el) el.scrollIntoView({ block:'center', behavior:'smooth' });
    }
    requestRender();
  }

  function buildWheel(){
    verTrack.innerHTML='';
    if (versions.length<=1){
      verWrap.style.display=versions.length? 'flex':'none';
      if (versions.length===1){
        const d=document.createElement('div');
        d.className='ver-item active';
        d.textContent=versions[0].label||versions[0].id;
        verTrack.appendChild(d);
      }
      return;
    }
    verWrap.style.display='flex';
    versions.forEach(function(v,i){
      const d=document.createElement('div');
      d.className='ver-item'+(i===0?' active':'');
      d.textContent=v.label||v.id;
      d.dataset.i=String(i);
      d.addEventListener('click', function(){ switchVersion(i, true); });
      verTrack.appendChild(d);
    });
    let scrollTimer=0;
    verTrack.addEventListener('scroll', function(){
      clearTimeout(scrollTimer);
      scrollTimer=setTimeout(function(){
        const mid=verTrack.scrollTop+verTrack.clientHeight/2;
        let best=0, bestDist=1e9;
        for (let i=0;i<verTrack.children.length;i++){
          const el=verTrack.children[i];
          const c=el.offsetTop+el.offsetHeight/2;
          const d=Math.abs(c-mid);
          if (d<bestDist){ bestDist=d; best=i; }
        }
        if (best!==vi) switchVersion(best, false);
        else syncWheelActive();
      }, 80);
    });
  }

  function extractPalette(id, maxColors){
    const max=Math.max(1, Math.min(128, maxColors||128));
    const data=id.data, w=id.width, h=id.height;
    const counts=new Map();
    for (let i=0;i<w*h;i++){
      const o=i*4;
      if (data[o+3]<16) continue;
      const r=data[o], g=data[o+1], b=data[o+2];
      const k=(r<<16)|(g<<8)|b;
      const prev=counts.get(k);
      if (prev) prev.n++;
      else counts.set(k, { r:r, g:g, b:b, n:1 });
    }
    let list=Array.from(counts.values());
    if (!list.length) return [];
    function lum(c){ return 0.2126*c.r+0.7152*c.g+0.0722*c.b; }
    list.sort(function(a,b){ return lum(a)-lum(b); });
    if (list.length>max){
      const reduced=[];
      for (let bucket=0; bucket<max; bucket++){
        const start=Math.floor((bucket*list.length)/max);
        const end=Math.floor(((bucket+1)*list.length)/max);
        if (start>=end) continue;
        let best=list[start];
        for (let i=start+1;i<end;i++) if (list[i].n>best.n) best=list[i];
        reduced.push(best);
      }
      list=reduced;
    }
    const seen=new Set(), out=[];
    list.sort(function(a,b){ return lum(a)-lum(b); });
    for (const c of list){
      const k=(c.r<<16)|(c.g<<8)|c.b;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ r:c.r, g:c.g, b:c.b });
    }
    return out;
  }

  function downloadPalettePng(colors, filename){
    if (!colors.length) return;
    const scale=8;
    const src=document.createElement('canvas');
    src.width=colors.length; src.height=1;
    const sctx=src.getContext('2d');
    const img=sctx.createImageData(colors.length, 1);
    for (let i=0;i<colors.length;i++){
      const c=colors[i], o=i*4;
      img.data[o]=c.r; img.data[o+1]=c.g; img.data[o+2]=c.b; img.data[o+3]=255;
    }
    sctx.putImageData(img,0,0);
    const out=document.createElement('canvas');
    out.width=colors.length*scale; out.height=scale;
    const octx=out.getContext('2d');
    octx.imageSmoothingEnabled=false;
    octx.drawImage(src,0,0,out.width,out.height);
    out.toBlob(function(blob){
      if (!blob) return;
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=filename||'palette.png'; a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  outlineBtn.addEventListener('click', function(){
    showOutline=!showOutline;
    outlineBtn.classList.toggle('active', showOutline);
    requestRender();
  });
  eyedropBtn.addEventListener('click', function(){
    eyedrop=!eyedrop;
    eyedropBtn.classList.toggle('active', eyedrop);
    canvas.style.cursor=eyedrop?'crosshair':'grab';
    if (!eyedrop){
      loupeEl.style.display='none';
      if (!pinnedHex) eyeEl.style.display='none';
    } else if (pinnedHex){
      eyeEl.style.display='flex';
      eyeSwatch.style.background=pinnedHex;
      eyeText.textContent=pinnedHex;
    }
  });

  eyeEl.addEventListener('click', function(){
    if (!pinnedHex) return;
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(pinnedHex).then(function(){
        eyeText.textContent=pinnedHex+' · copied';
        setTimeout(function(){ if(pinnedHex) eyeText.textContent=pinnedHex; }, 900);
      });
    }
  });

  buildWheel();
  if (versions.length){
    switchVersion(0, true);
    fit();
    requestRender();
  }
  window.addEventListener('resize', function(){ requestRender(); });

  function clientToWorld(clientX, clientY){
    const rect=canvas.getBoundingClientRect();
    const sx=clientX-rect.left, sy=clientY-rect.top;
    return { wx:(sx-cam.x)/cam.scale, wy:(sy-cam.y)/cam.scale, sx:sx, sy:sy };
  }

  canvas.addEventListener('mousedown', function(e){
    if (e.button===2) return;
    isTouch=false;
    const w=clientToWorld(e.clientX, e.clientY);
    if (eyedrop){
      const s=sampleAt(w.wx,w.wy);
      if (s) pinColor(toHex(s.r,s.g,s.b));
      else pinColor('');
      updateLoupe(e.clientX, e.clientY, s);
      return;
    }
    const p=hit(w.wx,w.wy);
    if (p){ selectedId=p.id; showInfo(p); requestRender(); }
    else { selectedId=null; showInfo(null); requestRender(); }
    dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.style.cursor='grabbing';
  });
  canvas.addEventListener('contextmenu', function(e){
    e.preventDefault();
    const w=clientToWorld(e.clientX, e.clientY);
    const p=hit(w.wx,w.wy);
    if (!p) return;
    selectedId=p.id; showInfo(p); requestRender();
    const aid=activeAssetId(p, performance.now());
    const img=aid?images.get(aid):null;
    const id=img?getImageData(img,aid+'id'):null;
    if (!id){
      document.getElementById('hud').textContent='Palette: image not ready';
      return;
    }
    const colors=extractPalette(id, 128);
    if (!colors.length){
      document.getElementById('hud').textContent='Palette: no opaque colors';
      return;
    }
    downloadPalettePng(colors, 'palette-'+(p.id||'obj').slice(0,8)+'.png');
    document.getElementById('hud').textContent='Palette PNG · '+colors.length+' colors';
    setTimeout(function(){
      document.getElementById('hud').textContent='Drag / pan · Wheel / pinch zoom · Tap object · RMB palette';
    }, 1600);
  });
  window.addEventListener('mouseup', function(){ dragging=false; canvas.style.cursor=eyedrop?'crosshair':'grab'; });
  window.addEventListener('mousemove', function(e){
    if (eyedrop){
      const w=clientToWorld(e.clientX, e.clientY);
      updateLoupe(e.clientX, e.clientY, sampleAt(w.wx,w.wy));
      return;
    }
    if (!dragging) return;
    cam.x+=e.clientX-lastX; cam.y+=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; requestRender();
  });
  canvas.addEventListener('wheel', function(e){
    e.preventDefault();
    const factor=e.deltaY<0?1.1:1/1.1;
    zoomAt(factor, e.clientX, e.clientY);
    requestRender();
  }, {passive:false});

  canvas.addEventListener('touchstart', function(e){
    isTouch=true;
    if (e.touches.length===1){
      const t=e.touches[0];
      if (eyedrop){
        const w=clientToWorld(t.clientX, t.clientY);
        const s=sampleAt(w.wx,w.wy);
        if (s) pinColor(toHex(s.r,s.g,s.b));
        else pinColor('');
        updateLoupe(t.clientX, t.clientY, s);
        return;
      }
      touchPan=true; pinching=false;
      lastX=t.clientX; lastY=t.clientY;
      const w=clientToWorld(t.clientX, t.clientY);
      const p=hit(w.wx,w.wy);
      if (p){ selectedId=p.id; showInfo(p); requestRender(); }
    } else if (e.touches.length===2){
      touchPan=false; pinching=true;
      lastDist=Math.hypot(
        e.touches[0].clientX-e.touches[1].clientX,
        e.touches[0].clientY-e.touches[1].clientY
      );
    }
  }, {passive:true});

  canvas.addEventListener('touchmove', function(e){
    e.preventDefault();
    if (e.touches.length===1 && touchPan && !eyedrop){
      const t=e.touches[0];
      cam.x+=t.clientX-lastX; cam.y+=t.clientY-lastY;
      lastX=t.clientX; lastY=t.clientY; requestRender();
    } else if (e.touches.length===2 && pinching){
      const newDist=Math.hypot(
        e.touches[0].clientX-e.touches[1].clientX,
        e.touches[0].clientY-e.touches[1].clientY
      );
      const factor=newDist/(lastDist||newDist);
      const cx=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const cy=(e.touches[0].clientY+e.touches[1].clientY)/2;
      zoomAt(factor, cx, cy);
      lastDist=newDist; requestRender();
    } else if (e.touches.length===1 && eyedrop){
      const t=e.touches[0];
      const w=clientToWorld(t.clientX, t.clientY);
      const s=sampleAt(w.wx,w.wy);
      updateLoupe(t.clientX, t.clientY, s);
    }
  }, {passive:false});

  canvas.addEventListener('touchend', function(e){
    if (e.touches.length<2) pinching=false;
    if (e.touches.length<1){
      touchPan=false;
      if (eyedrop){
        loupeEl.style.display='none';
      }
    }
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linkifyAuthorHtml(text: string): string {
  const escaped = escapeHtml(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
  return escaped.replace(
    /(https?:\/\/[^\s&<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}

export function downloadTextFile(filename: string, content: string, mime = 'text/html;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
