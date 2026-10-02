/*
 * NOTAS PARA REVISÃO METEOROLÓGICA
 *
 * Comentei este arquivo pensando na revisão do tratamento dos dados, não só na parte de programação.
 * Quero que a análise considere principalmente: qualidade e origem do dado, resolução espacial e temporal,
 * filtros e limiares adotados, hipóteses físicas, possíveis falsos positivos/negativos e até onde o resultado
 * pode ou não ser interpretado meteorologicamente.
 *
 * Quando o código faz uma classificação, associação ou estimativa, isso não deve ser entendido automaticamente
 * como observação ou alerta oficial. Minha intenção é justamente identificar com a revisão quais critérios
 * precisam ser recalibrados, documentados ou substituídos por métodos meteorologicamente mais robustos.
 */

const map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([-29.19,-54.87],6);

const base=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',{
  maxZoom:16,
  attribution:'Tiles © Esri',
  className:'esri-dark'
}).addTo(map);

map.createPane('satellitePane');
map.createPane('infraredPane');
map.createPane('radarPane');
map.getPane('satellitePane').style.zIndex=250;
map.getPane('satellitePane').style.pointerEvents='none';
map.getPane('infraredPane').style.zIndex=260;
map.getPane('infraredPane').style.pointerEvents='none';
map.getPane('radarPane').style.zIndex=275;
map.getPane('radarPane').style.pointerEvents='none';

const weatherLayer=L.layerGroup().addTo(map);
const stormLayer=L.layerGroup().addTo(map);
const hailLayer=L.layerGroup().addTo(map);

const autoStormLayer=L.layerGroup().addTo(map);
const autoHailLayer=L.layerGroup().addTo(map);
const detectedStormLayer=L.layerGroup().addTo(map);
let satelliteLayer=null;
let satelliteEnabled=false;
let infraredLayer=null;
let infraredEnabled=false;

const GIBS_WMS='https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';

function clock(){const d=new Date();document.querySelector('#clock').textContent=d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'})+' BRT';}
clock();setInterval(clock,1000);
map.on('mousemove',e=>document.querySelector('#coords').textContent=`LAT ${e.latlng.lat.toFixed(3)} / LON ${e.latlng.lng.toFixed(3)}`);

map.on('click',e=>{if(window._pickMode)return;inspect(e.latlng.lat,e.latlng.lng);});

document.querySelector('#rain').onchange=e=>setPrecipitation(e.target.checked);
document.querySelector('#storms').onchange=e=>{const on=e.target.checked;on?(map.addLayer(stormLayer),map.addLayer(autoStormLayer)):(map.removeLayer(stormLayer),map.removeLayer(autoStormLayer));if(on&&!maxcappiData)refreshMaxcappi(true);};
document.querySelector('#hail').onchange=e=>{const on=e.target.checked;on?(map.addLayer(hailLayer),map.addLayer(autoHailLayer)):(map.removeLayer(hailLayer),map.removeLayer(autoHailLayer));if(on&&!maxcappiData)refreshMaxcappi(true);};

function roundedUtc(offsetHours=0){
  const d=new Date(Date.now()-offsetHours*3600000);
  d.setUTCSeconds(0,0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes()/10)*10);
  return d;
}
function isoMinute(d){return d.toISOString().replace(/\.000Z$/,'Z');}
function labelTime(d){return d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})+' BRT';}

function buildSatellite(offsetHours=0){
  if(offsetHours<0){if(satelliteLayer)map.removeLayer(satelliteLayer);satelliteLayer=null;setSatStatus('SEM DADOS FUTUROS');return;}
  const stale=window._satStale=window._satStale||[];if(satelliteLayer)stale.push(satelliteLayer);
  const options={
    layers:'GOES-East_ABI_GeoColor',
    format:'image/png',
    transparent:true,
    opacity:Number(document.querySelector('#satOpacity')?.value||72)/100,
    pane:'satellitePane',
    attribution:'NASA GIBS / GOES-East ABI',
    _moniRefresh:String(Date.now())
  };

  if(offsetHours>0) options.time=isoMinute(roundedUtc(offsetHours));
  satelliteLayer=L.tileLayer.wms(GIBS_WMS,options);
  satelliteLayer.on('loading',()=>setSatStatus('CARREGANDO…'));
  const me=satelliteLayer;me.on('load',()=>{while(stale.length){const o=stale.shift();if(o!==me)map.removeLayer(o);}setSatStatus(offsetHours===0?'LIVE · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):labelTime(roundedUtc(offsetHours)));});
  satelliteLayer.on('tileerror',()=>setSatStatus('SEM FRAME'));
  if(satelliteEnabled) satelliteLayer.addTo(map);
}
function setSatStatus(text){const el=document.querySelector('#satStatus');if(el)el.textContent=text;}

document.querySelector('#sat').onchange=e=>{
  satelliteEnabled=e.target.checked;
  document.querySelector('#satControls').classList.toggle('visible',satelliteEnabled);
  if(satelliteEnabled){
    if(!satelliteLayer)buildSatellite(12-Number(timeline.value)); else satelliteLayer.addTo(map);
  }else if(satelliteLayer){map.removeLayer(satelliteLayer);(window._satStale||[]).splice(0).forEach(l=>map.removeLayer(l));setSatStatus('DESLIGADO');}
};

document.querySelector('#satOpacity').oninput=e=>{document.querySelector('#opacityValue').textContent=e.target.value+'%';if(satelliteLayer)satelliteLayer.setOpacity(Number(e.target.value)/100);};

let infraredRequestId=0;
function irViewportUrl(offsetHours=0){
  const b=map.getBounds(), sw=mercatorXY(b.getSouth(),b.getWest()), ne=mercatorXY(b.getNorth(),b.getEast());
  const size=map.getSize();
  const scale=Math.min(2,window.devicePixelRatio||1.5);
  const w=Math.max(800,Math.min(2048,Math.round(size.x*scale)));
  const h=Math.max(500,Math.min(2048,Math.round(size.y*scale)));
  const params=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:'GOES-East_ABI_Band13_Clean_Infrared',STYLES:'',FORMAT:'image/png',TRANSPARENT:'true',SRS:'EPSG:3857',BBOX:`${sw[0]},${sw[1]},${ne[0]},${ne[1]}`,WIDTH:String(w),HEIGHT:String(h)});
  if(offsetHours>0)params.set('TIME',isoMinute(roundedUtc(offsetHours)));
  else params.set('_moni',String(Date.now()));
  return GIBS_WMS+'?'+params.toString();
}
function buildInfrared(offsetHours=0){
  const requestId=++infraredRequestId;
  if(offsetHours<0){if(infraredLayer)map.removeLayer(infraredLayer);infraredLayer=null;setIrStatus('SEM DADOS FUTUROS');return;}
  if(!infraredEnabled)return;
  setIrStatus('CARREGANDO…');
  const b=map.getBounds(), url=irViewportUrl(offsetHours);
  const img=new Image(); img.crossOrigin='anonymous';
  img.onload=()=>{
    if(requestId!==infraredRequestId||!infraredEnabled)return;
    const prev=infraredLayer;infraredLayer=L.imageOverlay(url,b,{opacity:.78,pane:'infraredPane',interactive:false,attribution:'NASA GIBS / GOES-East ABI Band 13'}).addTo(map);if(prev)map.removeLayer(prev);
    setIrStatus(offsetHours===0?'LIVE':labelTime(roundedUtc(offsetHours)));
    updateZoomNotice();
  };
  img.onerror=()=>{if(requestId===infraredRequestId)setIrStatus('SEM IMAGEM');};
  img.src=url;
}
function setIrStatus(text){const el=document.querySelector('#irStatus');if(el)el.textContent=text;}
function updateZoomNotice(){
  const n=document.querySelector('#zoomNotice'); if(!n)return;
  n.classList.toggle('visible',infraredEnabled && map.getZoom()>=9);
}
document.querySelector('#ir').onchange=e=>{
  infraredEnabled=e.target.checked;
  if(infraredEnabled){
    if(satelliteEnabled){document.querySelector('#sat').checked=false;satelliteEnabled=false;if(satelliteLayer)map.removeLayer(satelliteLayer);document.querySelector('#satControls').classList.remove('visible');setSatStatus('DESLIGADO');}
    buildInfrared(12-Number(timeline.value));
  }else{infraredRequestId++;if(infraredLayer)map.removeLayer(infraredLayer);infraredLayer=null;setIrStatus('OFF');updateZoomNotice();}
};

const timeline=document.querySelector('#timeline');
function applyTimeline(){
  const n=12-Number(timeline.value);
  document.querySelector('#timeLabel').textContent=n===0?'AGORA':n>0?`-${n} h`:`+${-n} h`;
  if(satelliteEnabled)buildSatellite(n);
  if(infraredEnabled)buildInfrared(n);
  renderPoint();
}
timeline.oninput=()=>{renderPoint();const n=12-Number(timeline.value);document.querySelector('#timeLabel').textContent=n===0?'AGORA':n>0?`-${n} h`:`+${-n} h`;};
timeline.onchange=applyTimeline;

let playTimer=null;
document.querySelector('#play').onclick=()=>{
  if(playTimer){clearInterval(playTimer);playTimer=null;document.querySelector('#play').textContent='▶';return;}
  document.querySelector('#play').textContent='■';
  let v=0;
  playTimer=setInterval(()=>{
    timeline.value=v;applyTimeline();v++;
    if(v>24){clearInterval(playTimer);playTimer=null;document.querySelector('#play').textContent='▶';}
  },1400);
};

let satRefreshTimer=null;
function refreshLiveSatellite(){
  if(Number(timeline.value)!==12 || document.hidden || !navigator.onLine)return;
  if(satelliteEnabled)buildSatellite(0);
  if(infraredEnabled)buildInfrared(0);
}
function startSatelliteRefresh(){
  clearInterval(satRefreshTimer);
  satRefreshTimer=setInterval(refreshLiveSatellite,120000);
}
startSatelliteRefresh();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLiveSatellite();});
window.addEventListener('online',refreshLiveSatellite);

function mercatorXY(lat, lon){
  const R=6378137, x=R*lon*Math.PI/180;
  const y=R*Math.log(Math.tan(Math.PI/4 + Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/360));
  return [x,y];
}
function wmsIrUrl(bounds,w,h,offsetHours){
  const sw=mercatorXY(bounds.getSouth(),bounds.getWest());
  const ne=mercatorXY(bounds.getNorth(),bounds.getEast());
  const params=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:'GOES-East_ABI_Band13_Clean_Infrared',STYLES:'',FORMAT:'image/png',TRANSPARENT:'true',SRS:'EPSG:3857',BBOX:`${sw[0]},${sw[1]},${ne[0]},${ne[1]}`,WIDTH:String(w),HEIGHT:String(h)});
  if(offsetHours>0) params.set('TIME',isoMinute(roundedUtc(offsetHours)));
  return GIBS_WMS+'?'+params.toString();
}
// Este detector usa a cor da imagem IR como aproximação para localizar topos frios.
// É uma heurística visual, não uma recuperação física direta da temperatura de brilho. Quero avaliar se essa
// abordagem deve ser substituída por valores radiométricos e quais falsos positivos ela pode produzir.
function isColdCore(r,g,b,a){
  if(a<80) return false;

  const red = r>150 && r>g*1.15 && r>b*1.5;
  const orange = r>170 && g>55 && g<190 && b<90;
  const yellow = r>175 && g>150 && b<95;
  return red||orange||yellow;
}
// Aqui agrupo pixels do IR que passaram pelo critério de topo frio.
// Os valores de área e as classes resultantes são experimentais. Quero revisar se tamanho de núcleo, resolução
// da imagem e projeção justificam esses cortes e deixar claro que topo frio não confirma granizo.
async function scanInfraredCores(){
  const btn=document.querySelector('#scanStorms'), count=document.querySelector('#coreCount');
  if(!infraredEnabled){ setIrStatus('LIGUE O IR'); return; }
  if(12-Number(timeline.value)<0){setIrStatus('SEM DADOS FUTUROS');return;}
  btn.disabled=true; btn.textContent='ANALISANDO…'; detectedStormLayer.clearLayers();
  const bounds=map.getBounds(), W=480, H=320, offset=12-Number(timeline.value);
  try{
    const img=new Image(); img.crossOrigin='anonymous';
    const loaded=new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
    img.src=wmsIrUrl(bounds,W,H,offset); await loaded;
    const cv=document.createElement('canvas'); cv.width=W;cv.height=H;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,W,H);
    const px=ctx.getImageData(0,0,W,H).data, step=4, gw=Math.floor(W/step), gh=Math.floor(H/step);
    const mask=new Uint8Array(gw*gh);
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      let hits=0,total=0;
      for(let yy=0;yy<step;yy+=2)for(let xx=0;xx<step;xx+=2){const x=gx*step+xx,y=gy*step+yy,i=(y*W+x)*4;total++;if(isColdCore(px[i],px[i+1],px[i+2],px[i+3]))hits++;}
      if(hits>=Math.max(1,total/3))mask[gy*gw+gx]=1;
    }
    const seen=new Uint8Array(mask.length), comps=[];
    for(let i=0;i<mask.length;i++) if(mask[i]&&!seen[i]){
      const q=[i];seen[i]=1;let n=0,sx=0,sy=0,minx=1e9,miny=1e9,maxx=0,maxy=0;
      while(q.length){const j=q.pop(),x=j%gw,y=(j/gw)|0;n++;sx+=x;sy+=y;minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<gw&&ny<gh){const k=ny*gw+nx;if(mask[k]&&!seen[k]){seen[k]=1;q.push(k);}}}
      }
      if(n>=4) comps.push({n,cx:sx/n,cy:sy/n,minx,miny,maxx,maxy});
    }
    const midLat=(bounds.getNorth()+bounds.getSouth())/2,cellKm2=((bounds.getEast()-bounds.getWest())*111.32*Math.cos(midLat*Math.PI/180)/gw)*((bounds.getNorth()-bounds.getSouth())*110.57/gh);
    comps.forEach(c=>c.km2=c.n*cellKm2);comps.sort((a,b)=>b.km2-a.km2);const chosen=comps.filter(c=>c.km2>=150).slice(0,24);
    chosen.forEach((c,k)=>{
      const lon=bounds.getWest()+(c.cx/gw)*(bounds.getEast()-bounds.getWest());
      const lat=bounds.getNorth()-(c.cy/gh)*(bounds.getNorth()-bounds.getSouth());
      const strength=c.km2>=2300?'SEVERA':c.km2>=840?'FORTE':'CONVECTIVA';
      const color=strength==='SEVERA'?'#ff4d4d':strength==='FORTE'?'#ff9a3d':'#ffd34d';
      const radius=Math.max(8000,Math.min(80000,Math.sqrt(c.km2/Math.PI)*1000));
      L.circle([lat,lon],{radius,color,weight:2,fillColor:color,fillOpacity:.07,dashArray:'5 4'})
        .bindTooltip(`IR-${String(k+1).padStart(2,'0')} · ${strength}<br>Núcleo frio experimental · ~${Math.round(c.km2)} km²`)
        .addTo(detectedStormLayer);
      L.marker([lat,lon],{icon:L.divIcon({className:'storm-id',html:`IR-${String(k+1).padStart(2,'0')}`,iconSize:[48,16],iconAnchor:[24,8]})}).addTo(detectedStormLayer);
    });
    count.textContent=String(chosen.length); setIrStatus(chosen.length?'ANALISADO':'SEM NÚCLEOS');
  }catch(err){console.error(err);setIrStatus('ANÁLISE FALHOU');count.textContent='--';}
  finally{btn.disabled=false;btn.textContent='ANALISAR NÚCLEOS IR';}
}
document.querySelector('#scanStorms').onclick=scanInfraredCores;
document.querySelector('#storms').addEventListener('change',e=>e.target.checked?map.addLayer(detectedStormLayer):map.removeLayer(detectedStormLayer));
map.on('moveend',()=>{detectedStormLayer.clearLayers();document.querySelector('#coreCount').textContent='0';updateZoomNotice();});

map.createPane('boundaryPane');
map.getPane('boundaryPane').style.zIndex=650;
map.getPane('boundaryPane').style.pointerEvents='none';
const worldBoundaries=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,pane:'boundaryPane',opacity:.96,attribution:'Esri boundaries & places'}).addTo(map);
const brazilBorders=L.layerGroup().addTo(map);
async function loadBrazilBorders(){
  const status=document.querySelector('#borderStatus');
  try{
    const url='https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF';
    const r=await fetchT(url); if(!r.ok) throw Error('HTTP '+r.status);
    const gj=await r.json();
    L.geoJSON(gj,{pane:'boundaryPane',style:{color:'#d9f1ff',weight:1.15,opacity:.88,fill:false,className:'boundary-state'}}).addTo(brazilBorders);
    status.textContent='IBGE + ESRI'; status.classList.add('live');
  }catch(err){console.warn('IBGE borders:',err);status.textContent='ESRI';status.classList.add('live');}
}
loadBrazilBorders();
document.querySelector('#borders').onchange=e=>{const on=e.target.checked;for(const l of [worldBoundaries,brazilBorders])on?map.addLayer(l):map.removeLayer(l);const st=document.querySelector('#borderStatus');st.textContent=on?'ON':'OFF';st.classList.toggle('live',on);};

map.createPane('windPane');map.getPane('windPane').style.zIndex=455;map.getPane('windPane').style.pointerEvents='none';
const arrCv=document.createElement('canvas'),windCv=document.createElement('canvas');
for(const c of [arrCv,windCv]){c.style.cssText='position:absolute;left:0;top:0;pointer-events:none;display:none';map.getPane('windPane').appendChild(c);}
let windEnabled=false,windRequest=0,wf=null,parts=[],windRaf=0,lat_u=null,lat_v=null,lw=0,lh=0,SU=0,SV=0;
const LSTEP=16, WK=.07, WCOL=['#e6eef2','#ffe28a','#ffb14a','#ff6a4a'];
const wBucket=sp=>sp<15?0:sp<30?1:sp<50?2:3;
function windAt(lat,lon){ 
  const fx=Math.max(0,Math.min(wf.cols-1,(lon-wf.west)/(wf.east-wf.west)*(wf.cols-1))),fy=Math.max(0,Math.min(wf.rows-1,(lat-wf.south)/(wf.north-wf.south)*(wf.rows-1)));
  const x0=Math.min(wf.cols-2,Math.floor(fx)),y0=Math.min(wf.rows-2,Math.floor(fy)),tx=fx-x0,ty=fy-y0,k=(x,y)=>y*wf.cols+x,m=(a)=>(a[k(x0,y0)]*(1-tx)+a[k(x0+1,y0)]*tx)*(1-ty)+(a[k(x0,y0+1)]*(1-tx)+a[k(x0+1,y0+1)]*tx)*ty;
  return [m(wf.u),m(wf.v)];
}
function buildLattice(){ 
  const s=map.getSize();lw=Math.ceil(s.x/LSTEP)+2;lh=Math.ceil(s.y/LSTEP)+2;lat_u=new Float32Array(lw*lh);lat_v=new Float32Array(lw*lh);
  for(let j=0;j<lh;j++)for(let i=0;i<lw;i++){const ll=map.containerPointToLatLng([i*LSTEP,j*LSTEP]),w=windAt(ll.lat,ll.lng);lat_u[j*lw+i]=w[0];lat_v[j*lw+i]=w[1];}
}
function sample(x,y){
  const fx=Math.max(0,Math.min(lw-2,x/LSTEP)),fy=Math.max(0,Math.min(lh-2,y/LSTEP)),i=fx|0,j=fy|0,tx=fx-i,ty=fy-j,a=j*lw+i,b=a+lw;
  SU=(lat_u[a]*(1-tx)+lat_u[a+1]*tx)*(1-ty)+(lat_u[b]*(1-tx)+lat_u[b+1]*tx)*ty;
  SV=(lat_v[a]*(1-tx)+lat_v[a+1]*tx)*(1-ty)+(lat_v[b]*(1-tx)+lat_v[b+1]*tx)*ty;
}
function drawArrows(){
  const ctx=arrCv.getContext('2d'),w=arrCv.width,h=arrCv.height,G=34;ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineWidth=1.2;ctx.globalAlpha=.6;
  for(let y=G/2;y<h;y+=G)for(let x=G/2;x<w;x+=G){
    sample(x,y);const sp=Math.hypot(SU,SV);if(sp<1)continue;const L=Math.min(22,7+sp*.3),a=Math.atan2(-SV,SU),dx=Math.cos(a)*L/2,dy=Math.sin(a)*L/2,hx=x+dx,hy=y+dy;
    ctx.strokeStyle=WCOL[wBucket(sp)];ctx.beginPath();ctx.moveTo(x-dx,y-dy);ctx.lineTo(hx,hy);
    ctx.moveTo(hx,hy);ctx.lineTo(hx-Math.cos(a-.5)*4,hy-Math.sin(a-.5)*4);ctx.moveTo(hx,hy);ctx.lineTo(hx-Math.cos(a+.5)*4,hy-Math.sin(a+.5)*4);ctx.stroke();
  }
}
function seedP(p){
  p.x=Math.random()*windCv.width;p.y=Math.random()*windCv.height;

  p.age=Math.floor(Math.random()*24);p.max=28+Math.random()*38;
}
function clearWindCanvas(){
  const ctx=windCv.getContext('2d');
  ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  ctx.clearRect(0,0,windCv.width,windCv.height);ctx.restore();
}
function windFrame(){
  if(!windEnabled||!wf)return;
  const ctx=windCv.getContext('2d'),w=windCv.width,h=windCv.height;

  ctx.save();
  ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=1;
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(0,0,w,h);
  ctx.restore();
  ctx.save();ctx.globalCompositeOperation='source-over';ctx.lineWidth=1.05;ctx.globalAlpha=.72;ctx.lineCap='round';
  const segs=[[],[],[],[]];
  for(const p of parts){
    sample(p.x,p.y);const sp=Math.hypot(SU,SV);
    if(sp<.5||p.age++>p.max||p.x<0||p.y<0||p.x>w||p.y>h){seedP(p);continue;}

    const mag=Math.max(.001,sp),step=Math.min(2.4,.45+sp*.035);
    const nx=p.x+(SU/mag)*step,ny=p.y-(SV/mag)*step;
    segs[wBucket(sp)].push(p.x,p.y,nx,ny);p.x=nx;p.y=ny;
  }
  segs.forEach((a,b)=>{if(!a.length)return;ctx.strokeStyle=WCOL[b];ctx.beginPath();for(let k=0;k<a.length;k+=4){ctx.moveTo(a[k],a[k+1]);ctx.lineTo(a[k+2],a[k+3]);}ctx.stroke();});
  ctx.restore();
  windRaf=requestAnimationFrame(windFrame);
}
function placeWind(){
  const s=map.getSize();
  for(const c of [arrCv,windCv]){
    if(c.width!==s.x||c.height!==s.y){c.width=s.x;c.height=s.y;}
    L.DomUtil.setPosition(c,map.containerPointToLayerPoint([0,0]));c.style.display='block';c.style.opacity=1;
  }

  arrCv.style.display='none';arrCv.getContext('2d').clearRect(0,0,arrCv.width,arrCv.height);
  clearWindCanvas();
  const n=Math.max(550,Math.min(2200,Math.round(s.x*s.y/700)));
  parts.length=0;for(let i=0;i<n;i++){const p={};seedP(p);parts.push(p);}
  if(wf){buildLattice();cancelAnimationFrame(windRaf);windRaf=requestAnimationFrame(windFrame);}
}
async function refreshWind(){
  if(!windEnabled)return;const req=++windRequest,b=map.getBounds(),sz=map.getSize();
  const cols=Math.max(6,Math.min(14,Math.round(sz.x/90))),rows=Math.max(5,Math.min(10,Math.round(sz.y/90))),lats=[],lons=[];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){lats.push((b.getSouth()+y/(rows-1)*(b.getNorth()-b.getSouth())).toFixed(3));lons.push((b.getWest()+x/(cols-1)*(b.getEast()-b.getWest())).toFixed(3));}
  const st=document.querySelector('#windStatus');st.textContent='CARREGANDO';st.classList.remove('live');
  try{
    const r=await fetchT('https://api.open-meteo.com/v1/forecast?latitude='+lats.join(',')+'&longitude='+lons.join(',')+'&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh',15000);
    if(!r.ok)throw Error('HTTP '+r.status);const raw=await r.json();if(req!==windRequest||!windEnabled)return;
    const arr=Array.isArray(raw)?raw:[raw],u=[],v=[];
    arr.forEach(d=>{const c=d.current||{},s=Number(c.wind_speed_10m||0),a=Number(c.wind_direction_10m||0)*Math.PI/180;u.push(-s*Math.sin(a));v.push(-s*Math.cos(a));});
    wf={cols,rows,south:b.getSouth(),north:b.getNorth(),west:b.getWest(),east:b.getEast(),u,v};
    placeWind();st.textContent='LIVE';st.classList.add('live');
  }catch(err){console.warn('Vento:',err);st.textContent='ERRO';}
}
document.querySelector('#wind').onchange=e=>{
  windEnabled=e.target.checked;const st=document.querySelector('#windStatus');
  if(windEnabled){placeWind();refreshWind();}
  else{cancelAnimationFrame(windRaf);for(const c of [arrCv,windCv]){c.getContext('2d').clearRect(0,0,c.width,c.height);c.style.display='none';}st.textContent='OFF';st.classList.remove('live');}
};
map.on('zoomstart movestart',()=>{if(windEnabled){cancelAnimationFrame(windRaf);clearWindCanvas();for(const c of [arrCv,windCv])c.style.opacity=0;}});
map.on('moveend resize',()=>{if(windEnabled&&wf)placeWind();});

let radarEnabled=false,radarTimer=null,radarAnimTimer=null,radarPlaying=false,radarReq=0,radarFrameIndex=0;
let radarFrames=[],radarOverlays=[],radarLatest=[];
const RADAR_API=(window.MONI_CONFIG&&window.MONI_CONFIG.radarApiUrl)||((window.MONI_CONFIG?.supabaseUrl||'')+'/functions/v1/radar');
function setRadarStatus(t,live=false){const e=document.querySelector('#radarStatus');if(!e)return;e.textContent=t;e.classList.toggle('live',live);}
function radarDate(ts){if(!ts)return null;const d=new Date(String(ts).replace(' ','T')+'Z');return Number.isNaN(d.getTime())?null:d;}
function radarStamp(ts){const d=radarDate(ts);return d?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+'Z':'--';}
function clearRadarOverlays(){radarOverlays.forEach(x=>map.removeLayer(x));radarOverlays=[];}
function drawRadarImages(images,label){
  if(!radarEnabled)return;clearRadarOverlays();const opacity=Number(document.querySelector('#radarOpacity')?.value||58)/100;
  for(const im of images){const b=im.bounds;if(!b||![b.south,b.west,b.north,b.east].every(Number.isFinite)||!im.image)continue;
    const ov=L.imageOverlay(im.image,[[b.south,b.west],[b.north,b.east]],{opacity,pane:'radarPane',interactive:false,attribution:'REDEMET / DECEA'}).addTo(map);radarOverlays.push(ov);
  }
  document.querySelector('#radarFrame').textContent=label||`${images.length} RADARES`;
}
// Aqui retenho a imagem mais recente de cada radar.
// Quero avaliar o impacto de combinar radares com horários diferentes, porque um mosaico visualmente simultâneo
// pode conter observações com defasagens relevantes em tempestades de rápida evolução.
function latestPerRadar(all){
  const by=new Map();for(const im of all){if(!im?.image)continue;const k=String(im.area||im.radar||im.image),t=radarDate(im.timestamp)?.getTime()||0,old=by.get(k),ot=old?(radarDate(old.timestamp)?.getTime()||0):-1;if(!old||t>ot)by.set(k,im);}return [...by.values()];
}
// Aqui agrupo imagens em intervalos temporais para animação.
// Quero verificar se a tolerância temporal usada para formar cada quadro é adequada para comparar evolução entre radares.
function buildRadarFrames(all){
  const uniq=new Map();for(const im of all){if(im?.image&&!uniq.has(im.image))uniq.set(im.image,im);}
  const bins=new Map();for(const im of uniq.values()){const ms=radarDate(im.timestamp)?.getTime();if(!Number.isFinite(ms))continue;const k=Math.round(ms/(10*60000));if(!bins.has(k))bins.set(k,[]);bins.get(k).push(im);}
  return [...bins.entries()].sort((a,b)=>a[0]-b[0]).map(([k,images])=>({time:new Date(k*10*60000).toISOString(),images}));
}
function showRadarFrame(i){if(!radarEnabled||!radarFrames.length)return;radarFrameIndex=((i%radarFrames.length)+radarFrames.length)%radarFrames.length;const f=radarFrames[radarFrameIndex];drawRadarImages(f.images,`${radarFrameIndex+1}/${radarFrames.length} · ${radarStamp(f.time)}`);}
async function refreshRadar(){
  if(!radarEnabled)return;const req=++radarReq;setRadarStatus('ATUALIZANDO…');
  try{
    const r=await fetch(`${RADAR_API}?area=all&tipo=maxcappi&anima=5`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json();if(req!==radarReq||!radarEnabled)return;if(!data?.ok)throw new Error(data?.error||'REDEMET sem resposta');
    const images=Array.isArray(data.images)?data.images:[];radarLatest=latestPerRadar(images);radarFrames=buildRadarFrames(images);
    if(!radarLatest.length){clearRadarOverlays();setRadarStatus('SEM DADOS');document.querySelector('#radarFrame').textContent='--';return;}
    stopRadarAnimation();drawRadarImages(radarLatest,`${radarLatest.length} RADARES · ATUAL`);
    const times=radarLatest.map(x=>radarDate(x.timestamp)?.getTime()).filter(Number.isFinite),newest=times.length?Math.max(...times):0,age=newest?Math.max(0,Math.round((Date.now()-newest)/60000)):null;
    setRadarStatus(`${radarLatest.length} RADARES · ${age??'--'} MIN`,true);
  }catch(err){console.warn('Radar REDEMET',err);clearRadarOverlays();setRadarStatus('INDISPONÍVEL');document.querySelector('#radarFrame').textContent='--';}
}
function stopRadarAnimation(){clearInterval(radarAnimTimer);radarAnimTimer=null;radarPlaying=false;const b=document.querySelector('#radarPlay');if(b)b.textContent='▶ ANIMAR RADAR';}
function toggleRadarAnimation(){
  if(radarPlaying){stopRadarAnimation();drawRadarImages(radarLatest,`${radarLatest.length} RADARES · ATUAL`);return;}if(radarFrames.length<2)return;
  radarPlaying=true;document.querySelector('#radarPlay').textContent='■ PARAR ANIMAÇÃO';radarFrameIndex=0;showRadarFrame(0);radarAnimTimer=setInterval(()=>showRadarFrame((radarFrameIndex+1)%radarFrames.length),1100);
}
function setRadar(on){radarEnabled=on;document.querySelector('#radarControls').classList.toggle('visible',on);if(on){refreshRadar();clearInterval(radarTimer);radarTimer=setInterval(refreshRadar,120000);}else{radarReq++;clearInterval(radarTimer);radarTimer=null;stopRadarAnimation();clearRadarOverlays();radarFrames=[];radarLatest=[];setRadarStatus('OFF');document.querySelector('#radarFrame').textContent='--';}}
document.querySelector('#radar').onchange=e=>setRadar(e.target.checked);
document.querySelector('#radarPlay').onclick=toggleRadarAnimation;
document.querySelector('#radarOpacity').oninput=e=>{document.querySelector('#radarOpacityValue').textContent=e.target.value+'%';radarOverlays.forEach(x=>x.setOpacity(Number(e.target.value)/100));};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&radarEnabled)refreshRadar();});

let lightningEnabled=false,glmTimer=null,glmRequest=0,glmFeatures=[];
const GLM_API=(window.MONI_CONFIG&&window.MONI_CONFIG.glmApiUrl)||((window.MONI_CONFIG?.supabaseUrl||'')+'/functions/v1/glm');
const GLM_BOUNDS={south:-54,west:-90,north:15,east:-30};
function setGlmStatus(t,mode=''){const st=document.querySelector('#glmStatus');if(!st)return;st.textContent=t;st.dataset.mode=mode;}

const GlmCanvasLayer=L.Layer.extend({
  onAdd(map){
    this._map=map; this._canvas=L.DomUtil.create('canvas','glm-canvas');
    this._canvas.style.position='absolute'; this._canvas.style.pointerEvents='none';
    const pane=map.getPane('overlayPane'); pane.appendChild(this._canvas);
    map.on('move zoom resize',this._reset,this); this._reset();
  },
  onRemove(map){map.off('move zoom resize',this._reset,this);this._canvas?.remove();this._canvas=null;},
  _reset(){
    if(!this._map||!this._canvas)return;
    const size=this._map.getSize(),dpr=Math.min(window.devicePixelRatio||1,2);
    this._canvas.width=Math.max(1,Math.round(size.x*dpr));this._canvas.height=Math.max(1,Math.round(size.y*dpr));
    this._canvas.style.width=size.x+'px';this._canvas.style.height=size.y+'px';
    L.DomUtil.setPosition(this._canvas,this._map.containerPointToLayerPoint([0,0]));
    const ctx=this._canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);this._draw(ctx,size);
  },
  redraw(){this._reset();},
  _draw(ctx,size){
    ctx.clearRect(0,0,size.x,size.y); if(!lightningEnabled||!glmFeatures.length)return;
    const z=this._map.getZoom(),now=Date.now(),bounds=this._map.getBounds().pad(.15);
    const visible=glmFeatures.filter(f=>bounds.contains([f.lat,f.lon])&&f.age<=900);
    if(z>=8){

      for(const f of visible){
        const p=this._map.latLngToContainerPoint([f.lat,f.lon]);
        const age=Math.max(0,(now-Date.parse(f.time))/1000),a=age<300?.95:age<600?.62:.32,r=age<300?3.0:age<600?2.4:1.8;
        ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=`rgba(255,216,74,${a})`;ctx.fill();
      }
      return;
    }

    const cell=z<=3?2.0:z<=4?1.25:z<=5?.7:z<=6?.35:.18;
    const bins=new Map();
    for(const f of visible){
      const iy=Math.floor((f.lat+90)/cell),ix=Math.floor((f.lon+180)/cell),k=iy+':'+ix;
      let b=bins.get(k);if(!b)bins.set(k,b={lat:0,lon:0,n:0,recent:0});
      b.lat+=f.lat;b.lon+=f.lon;b.n++;if(f.age<300)b.recent++;
    }
    for(const b of bins.values()){
      const lat=b.lat/b.n,lon=b.lon/b.n,p=this._map.latLngToContainerPoint([lat,lon]);
      const r=Math.min(z<=4?16:13,3+Math.sqrt(b.n)*1.15),fresh=b.recent/Math.max(1,b.n);
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=`rgba(255,200,45,${.28+.5*fresh})`;ctx.fill();
      if(b.n>=4){ctx.font=`600 ${Math.max(9,Math.min(12,r*.8))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(255,248,210,.92)';ctx.fillText(String(b.n),p.x,p.y);}
    }
  }
});
const lightningLayer=new GlmCanvasLayer();
// Aqui recebo e filtro os flashes GLM recentes para a área monitorada.
// Quero revisar a janela de 15 minutos, latência da fonte, deduplicação e interpretação da contagem; a presença
// de raios é evidência de convecção, mas não deve ser tratada isoladamente como medida de severidade.

async function refreshGlm(){
  if(!lightningEnabled)return;
  const req=++glmRequest;setGlmStatus('ATUALIZANDO…','loading');
  try{

    const q=new URLSearchParams({south:String(GLM_BOUNDS.south),west:String(GLM_BOUNDS.west),north:String(GLM_BOUNDS.north),east:String(GLM_BOUNDS.east),minutes:'15'});
    const r=await fetch(GLM_API+'?'+q,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();if(req!==glmRequest||!lightningEnabled)return;
    const now=Date.now();
    glmFeatures=(d.flashes||[]).map(f=>({lat:+f.lat,lon:+f.lon,time:f.time,age:Math.max(0,(now-Date.parse(f.time))/1000)}))
      .filter(f=>Number.isFinite(f.lat)&&Number.isFinite(f.lon)&&f.lat>=GLM_BOUNDS.south&&f.lat<=GLM_BOUNDS.north&&f.lon>=GLM_BOUNDS.west&&f.lon<=GLM_BOUNDS.east&&f.age<=900);
    lightningLayer.redraw();
    const ageMin=d.latest?Math.max(0,Math.round((now-Date.parse(d.latest))/60000)):null;
    if(d.source_ok===false)setGlmStatus('DADOS INDISPONÍVEIS','offline');
    else if(glmFeatures.length===0)setGlmStatus('SEM ATIVIDADE · LIVE','live');
    else setGlmStatus(`${glmFeatures.length.toLocaleString('pt-BR')} FLASHES · ${ageMin??0} MIN`,'live');
    renderPoint();
  }catch(err){console.warn('GLM',err);if(req===glmRequest)setGlmStatus('DADOS INDISPONÍVEIS','offline');}
}
function setGlm(on){
  lightningEnabled=on;
  if(on){lightningLayer.addTo(map);refreshGlm();clearInterval(glmTimer);glmTimer=setInterval(refreshGlm,60000);}
  else{map.removeLayer(lightningLayer);clearInterval(glmTimer);glmTimer=null;glmRequest++;glmFeatures=[];setGlmStatus('OFF');renderPoint();}
}
document.querySelector('#lightning').onchange=e=>setGlm(e.target.checked);

const FIRE_LAYER_CONFIG={provider:'NASA GIBS',wms:GIBS_WMS,layer:'GOES-East_ABI_FireTemp',enabled:false};
let irMoveTimer=null;map.on('moveend',()=>{if(windEnabled){clearTimeout(window._wm);window._wm=setTimeout(refreshWind,400);}if(infraredEnabled){clearTimeout(irMoveTimer);irMoveTimer=setTimeout(()=>buildInfrared(12-Number(timeline.value)),180);} });

let userMarker=null,userAccuracy=null,userPosition=null,userWatchId=null,firstUserFix=true;
const locationStatus=document.querySelector('#locationStatus');
function setLocationStatus(t,ok=false){if(!locationStatus)return;locationStatus.textContent=t;locationStatus.classList.toggle('active',ok);}
function applyUserPosition(pos){
  const lat=pos.coords.latitude,lon=pos.coords.longitude,acc=pos.coords.accuracy||0;
  userPosition={lat,lon,accuracy:acc,ts:Date.now()};
  try{localStorage.setItem('moni.lastLocation',JSON.stringify(userPosition));}catch(_e){}
  if(userMarker)map.removeLayer(userMarker);if(userAccuracy)map.removeLayer(userAccuracy);
  userAccuracy=L.circle([lat,lon],{radius:acc,color:'#4ab8ff',weight:1,fillColor:'#4ab8ff',fillOpacity:.06,interactive:false}).addTo(map);
  userMarker=L.marker([lat,lon],{zIndexOffset:1000,icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:'<div class=\"user-location\"></div>'})}).bindTooltip('Você está aqui').addTo(map);
  setLocationStatus(`● LOCALIZAÇÃO ATIVA · ±${Math.round(acc)} m`,true);
  renderLegend();
  if(firstUserFix){firstUserFix=false;map.flyTo([lat,lon],Math.max(map.getZoom(),9));inspect(lat,lon);}
}
function startAutomaticLocation(){
  if(!navigator.geolocation){setLocationStatus('LOCALIZAÇÃO NÃO SUPORTADA');return;}

  try{
    const cached=JSON.parse(localStorage.getItem('moni.lastLocation')||'null');
    if(cached&&Number.isFinite(cached.lat)&&Number.isFinite(cached.lon)&&Date.now()-(cached.ts||0)<6*60*60e3){
      userPosition=cached;
      setLocationStatus(`◌ ÚLTIMA LOCALIZAÇÃO · ±${Math.round(cached.accuracy||0)} m`);
    }
  }catch(_e){}
  setLocationStatus('◎ LOCALIZAÇÃO AUTOMÁTICA · SOLICITANDO…');

  navigator.geolocation.getCurrentPosition(applyUserPosition,err=>{
    if(!userPosition)setLocationStatus(err.code===1?'LOCALIZAÇÃO DESATIVADA PELO USUÁRIO':'LOCALIZAÇÃO TEMPORARIAMENTE INDISPONÍVEL');
  },{enableHighAccuracy:false,timeout:12000,maximumAge:300000});

  userWatchId=navigator.geolocation.watchPosition(applyUserPosition,err=>{
    if(!userPosition)setLocationStatus(err.code===1?'LOCALIZAÇÃO DESATIVADA PELO USUÁRIO':'LOCALIZAÇÃO TEMPORARIAMENTE INDISPONÍVEL');
  },{enableHighAccuracy:true,timeout:30000,maximumAge:120000});
}
startAutomaticLocation();

let swRegistration=null,lastNotifiedRisk=Number(localStorage.getItem('moni.lastRisk')||-1);
async function registerMoniSW(){if(!('serviceWorker' in navigator))return null;try{swRegistration=await navigator.serviceWorker.register('./sw.js');return swRegistration}catch(e){console.warn('SW',e);return null}}
registerMoniSW();
async function enableNotifications(){
  if(!('Notification' in window)){toast('Notificações não são suportadas neste navegador.');return;}
  const permission=await Notification.requestPermission();
  const b=document.querySelector('#notifyBtn');
  if(permission==='granted'){localStorage.setItem('moni.notifications','1');if(b){b.textContent='🔔 ALERTAS DO DISPOSITIVO ATIVOS';b.classList.add('active');}await registerMoniSW();toast('Alertas do dispositivo ativados.');}
  else{localStorage.setItem('moni.notifications','0');if(b)b.textContent='🔕 ALERTAS NÃO AUTORIZADOS';}
}
function notificationIcon(title='',body='',tag=''){
  const s=`${title} ${body} ${tag}`.toLowerCase();

  if(/granizo|hail/.test(s)) return meteoIcon('hail');
  if(/raio|relâmp|lightning|descarga elétrica/.test(s)) return meteoIcon('lightning-bolt');
  if(/tempestade|storm|célula|celula/.test(s)) return meteoIcon('thunderstorms-day-rain');
  if(/chuva|precipita|rain|alagamento|enchente|inunda/.test(s)) return meteoIcon('extreme-rain');
  if(/vento|rajada|wind/.test(s)) return meteoIcon('wind');
  if(/neblina|nevoeiro|fog/.test(s)) return meteoIcon('fog-day');
  if(/fogo|incêndio|incendio|queimada|smoke/.test(s)) return meteoIcon('smoke');

  const glyph = /abrigo/.test(s) ? '⌂'
    : /distribui|mantimento|alimento|doaç|doacao|arrecada/.test(s) ? '▣'
    : /água|agua/.test(s) ? '●'
    : /energia|luz|poste|fio/.test(s) ? '⚡'
    : /árvore|arvore/.test(s) ? '▲'
    : /bloque|obstáculo|obstaculo|perigo/.test(s) ? '!'
    : /report|relato|comunidade/.test(s) ? '!'
    : null;

  if(glyph){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="%23081721"/><circle cx="48" cy="48" r="35" fill="%23132635" stroke="%235bd4ff" stroke-width="4"/><text x="48" y="61" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="700" fill="white">${glyph}</text></svg>`;
    return `data:image/svg+xml,${svg}`;
  }

  return meteoIcon('partly-cloudy-day');
}
async function deviceNotify(title,body,tag='moni',icon=null){
  if(localStorage.getItem('moni.notifications')!=='1'||Notification.permission!=='granted')return;
  const reg=swRegistration||await registerMoniSW();
  const selectedIcon=icon||notificationIcon(title,body,tag);
  const opts={body,tag,renotify:false,icon:selectedIcon,badge:selectedIcon,data:{url:location.href}};
  if(reg)reg.showNotification(title,opts);else new Notification(title,opts);
}
const notifyBtn=document.querySelector('#notifyBtn');if(notifyBtn){notifyBtn.onclick=enableNotifications;if(Notification.permission==='granted'&&localStorage.getItem('moni.notifications')==='1'){notifyBtn.textContent='🔔 ALERTAS DO DISPOSITIVO ATIVOS';notifyBtn.classList.add('active');}}

function fetchT(u,ms=10000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(u,{signal:c.signal}).finally(()=>clearTimeout(t));}
const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Precipitação V3: IMERG dá cobertura ampla; MAXCAPPI adiciona detalhe de radar onde existe cobertura.
// Não há interpolação artificial: preservamos a resolução nativa das imagens REDEMET.
map.createPane('rainPane');map.getPane('rainPane').style.zIndex=240;map.getPane('rainPane').style.pointerEvents='none';
map.createPane('precipHdPane');map.getPane('precipHdPane').style.zIndex=245;map.getPane('precipHdPane').style.pointerEvents='none';
const rainLayer=L.tileLayer.wms(GIBS_WMS,{layers:'IMERG_Precipitation_Rate',format:'image/png',transparent:true,opacity:.28,pane:'rainPane',attribution:'NASA GIBS / IMERG'}).addTo(map);
const precipHdLayer=L.layerGroup().addTo(map);
let precipHdTimer=null,precipHdReq=0;
function clearPrecipHd(){precipHdLayer.clearLayers();}
async function refreshPrecipHd(){
  if(!document.querySelector('#rain')?.checked)return;const req=++precipHdReq;
  try{
    const r=await fetch(`${RADAR_API}?area=all&tipo=maxcappi&anima=1`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json();if(req!==precipHdReq||!document.querySelector('#rain')?.checked)return;
    const imgs=latestPerRadar(Array.isArray(d?.images)?d.images:[]);clearPrecipHd();
    for(const im of imgs){const b=im?.bounds;if(!im?.image||!b)continue;L.imageOverlay(im.image,[[b.south,b.west],[b.north,b.east]],{opacity:.76,pane:'precipHdPane',interactive:false,attribution:'REDEMET / DECEA MAXCAPPI'}).addTo(precipHdLayer);}
  }catch(e){console.warn('Precipitação HD REDEMET',e);}
}
function setPrecipitation(on){
  if(on){map.addLayer(rainLayer);map.addLayer(precipHdLayer);refreshPrecipHd();clearInterval(precipHdTimer);precipHdTimer=setInterval(refreshPrecipHd,120000);}
  else{precipHdReq++;clearInterval(precipHdTimer);precipHdTimer=null;map.removeLayer(rainLayer);map.removeLayer(precipHdLayer);clearPrecipHd();}
}
// A opção inicia ligada no HTML.
refreshPrecipHd();precipHdTimer=setInterval(refreshPrecipHd,120000);

// Escala única de risco (heurística experimental, não é alerta oficial).
const LV=[
 {t:'BAIXO',c:'#5c7a8c',m:'Sem sinais fortes de tempestade.'},
 {t:'MODERADO',c:'#ffd34d',m:'Instabilidade: pancadas e raios possíveis.'},
 {t:'ALTO',c:'#ff9a3d',m:'Tempestade forte possível. Evite áreas abertas.'},
 {t:'MUITO ALTO',c:'#ff4d4d',m:'Risco de vento forte/granizo. Procure abrigo e siga a Defesa Civil.'}];
// Esta função produz uma escala de risco a partir de limiares meteorológicos.
// É uma heurística experimental. Quero revisar cada corte (CAPE, rajada, LI, CIN, precipitação e nível de
// congelamento), suas interações e se a mesma regra é válida para diferentes ambientes convectivos.
function riskAt(v){
  const {cape,gust,precip,li,cin,fz}=v; let l=0;
  if(cape>=800)l=1; if(cape>=1500||gust>=60)l=2; if(cape>=2500||gust>=80)l=3;
  if(l<3&&li!=null&&li<=-6&&cape>=1000)l++;
  if(l>0&&cin!=null&&Math.abs(cin)>200)l--;
  let n=0; if(cape>=1500)n++; if(cape>=2500)n++; if(li!=null&&li<=-6)n++; if(precip>=4)n++; if(fz!=null&&fz<4500&&cape>=1000)n++;
  return {l,hail:n>=4?'ALTO':n===3?'MODERADO':n>=1?'BAIXO':'MÍNIMO'};
}
const METEOCON='https:

const RISK_ICONS=['partly-cloudy-day','partly-cloudy-day-rain','thunderstorms-day-rain','thunderstorms-day-rain'];
function meteoIcon(name){return METEOCON+name+'.svg';}
function iconFallback(img){img.onerror=null;img.src=meteoIcon('not-available');}
function civilAlert(icon,title,text,level='info'){
  return `<div class="civil-alert ${level}"><img src="${meteoIcon(icon)}" alt="" onerror="iconFallback(this)"><div><b>${title}</b><small>${text}</small></div></div>`;
}
function kmDist(a,b,c,d){const R=6371,rad=Math.PI/180,dp=(c-a)*rad,dl=(d-b)*rad;const q=Math.sin(dp/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(q));}
// Aqui considero flashes dentro de um raio fixo do ponto.
// Quero avaliar se 50 km é uma escala adequada para o objetivo do produto e se a densidade/área deveria ser
// normalizada antes de usar a quantidade de flashes como evidência.
function nearbyLightning(lat,lon,km=50){return glmFeatures.filter(x=>x.age<=900&&kmDist(lat,lon,x.lat,x.lon)<=km);}
// Aqui uso relatos recentes da comunidade como evidência local.
// Esses relatos não são instrumentos meteorológicos; quero mantê-los claramente separados de observações
// oficiais e considerar validação, idade, distância e possibilidade de informação incorreta.
function nearbyWeatherReports(lat,lon,km=25){return reports.filter(r=>rAlive(r)&&['hail_now','storm_now','heavy_rain'].includes(r.k)&&kmDist(lat,lon,r.lat,r.lon)<=km);}
// Aqui traduzo códigos meteorológicos do modelo em situações exibidas ao usuário.
// Quero confirmar se os códigos e a interpretação estão corretos para a fonte e evitar que previsão/modelo seja
// apresentada com a mesma confiança de uma observação.
function wmoSituation(code){code=Number(code);if([96,99].includes(code))return {kind:'hail',level:3,title:'Tempestade com granizo indicada',text:'O modelo meteorológico indica tempestade com granizo neste horário.'};if([95,97].includes(code))return {kind:'storm',level:2,title:'Tempestade indicada',text:'Há indicação de tempestade neste horário.'};if([65,82].includes(code))return {kind:'rain',level:2,title:'Chuva intensa indicada',text:'Há indicação de chuva forte ou pancadas violentas.'};if([63,80,81].includes(code))return {kind:'rain',level:1,title:'Chuva na região',text:'Há indicação de chuva ou pancadas.'};return null;}
// Aqui combino modelo, GLM e relatos da comunidade em uma situação única.
// Este é um ponto especialmente importante para a revisão: as fontes têm naturezas, resoluções e incertezas
// diferentes. Quero avaliar se elevar o nível pelo maior sinal é justificável ou se é necessário ponderar
// qualidade, idade, distância e independência das evidências.
function fuseSituation(v,lat,lon){
  const base=riskAt(v), evidence=[], w=wmoSituation(v.weatherCode), bolts=nearbyLightning(lat,lon), reps=nearbyWeatherReports(lat,lon); let level=base.l, hail=base.hail;
  if(w){level=Math.max(level,w.level);evidence.push({...w,source:'modelo'});if(w.kind==='hail')hail='INDICADO';}
  if(v.precip>=8){level=Math.max(level,2);evidence.push({kind:'rain',level:2,title:'Chuva intensa',text:`Precipitação estimada em ${v.precip.toFixed(1)} mm/h.`,source:'modelo'});} else if(v.precip>=2){level=Math.max(level,1);evidence.push({kind:'rain',level:1,title:'Chuva',text:`Precipitação estimada em ${v.precip.toFixed(1)} mm/h.`,source:'modelo'});}
  if(bolts.length){level=Math.max(level,bolts.length>=8?2:1);const near=Math.min(...bolts.map(x=>kmDist(lat,lon,x.lat,x.lon)));evidence.push({kind:'lightning',level:bolts.length>=8?2:1,title:'Atividade elétrica próxima',text:`${bolts.length} detecções GLM em até 50 km; mais próxima a ~${Math.round(near)} km.`,source:'satélite'});}
  for(const r of reps){const t=rType(r.k); if(r.k==='hail_now'){level=Math.max(level,3);hail='RELATADO';}else level=Math.max(level,2);evidence.push({kind:r.k==='hail_now'?'hail':r.k==='storm_now'?'storm':'rain',level:r.k==='hail_now'?3:2,title:t.t+' relatado',text:`Relato da comunidade ${ago(r.ts)} a ~${Math.round(kmDist(lat,lon,r.lat,r.lon))} km.`,source:'comunidade'});}
  return {level:Math.min(3,level),hail,evidence,bolts,reps};
}
const RISK_METRIC_INFO={
  temp:{title:'Temperatura',icon:'./assets/meteocons/thermometer.svg',source:'Open-Meteo',field:'temperature_2m',treatment:'No horário atual, o MONI usa o valor current para o ponto selecionado. Ao mover a linha do tempo, usa a série horária.',note:'É um dado meteorológico de grade/modelo para as coordenadas selecionadas; não é uma medição de um termômetro instalado exatamente no ponto.'},
  rh:{title:'Umidade relativa',icon:'./assets/meteocons/humidity.svg',source:'Open-Meteo',field:'relative_humidity_2m',treatment:'O MONI usa current no horário atual e a série hourly nos demais horários da linha do tempo.',note:'Representa a umidade relativa estimada para a grade meteorológica correspondente ao ponto.'},
  precip:{title:'Precipitação',icon:'./assets/meteocons/raindrop.svg',source:'Open-Meteo',field:'precipitation',treatment:'Exibida em mm/h. O valor também entra na avaliação experimental de chuva e risco do MONI.',note:'É uma estimativa para o ponto/grade selecionado e pode diferir da chuva observada localmente.'},
  wind:{title:'Vento',icon:'./assets/meteocons/wind.svg',source:'Open-Meteo',field:'wind_speed_10m + wind_gusts_10m',treatment:'Velocidade do vento a 10 m em km/h. A rajada aparece junto quando supera o vento sustentado em mais de 5 km/h.',note:'Os valores são estimados para a grade meteorológica do ponto selecionado.'}
};
function closeRiskMetricInfo(){document.querySelector('#riskMetricInfo')?.remove();}
function openRiskMetricInfo(key,value,extra=''){
  const info=RISK_METRIC_INFO[key];if(!info)return;
  closeRiskMetricInfo();
  const el=document.createElement('div');el.id='riskMetricInfo';el.className='risk-metric-popover';
  el.innerHTML=`<div class="risk-metric-popover-head"><img src="${info.icon}" alt=""><div><b>${info.title}</b><strong>${value}${extra?` <small>${extra}</small>`:''}</strong></div><button type="button" aria-label="Fechar">×</button></div><div class="risk-metric-popover-body"><div><span>FONTE</span><b>${info.source}</b></div><div><span>DADO</span><code>${info.field}</code></div><p>${info.treatment}</p><p class="risk-metric-limit"><b>Limitação:</b> ${info.note}</p></div>`;
  document.body.appendChild(el);el.querySelector('button').onclick=closeRiskMetricInfo;requestAnimationFrame(()=>el.classList.add('on'));
}
document.addEventListener('click',e=>{const metric=e.target.closest?.('.riskbar-metric[data-metric]');if(metric){e.stopPropagation();openRiskMetricInfo(metric.dataset.metric,metric.dataset.value,metric.dataset.extra||'');return;}if(!e.target.closest?.('#riskMetricInfo'))closeRiskMetricInfo();});

function setRisk(L0,details={}){
  const b=document.querySelector('#civilRisk'),txt=document.querySelector('#civilRiskText'),card=document.querySelector('#civilRiskCard'),icon=document.querySelector('#civilRiskIcon');
  const idx=Math.max(0,LV.indexOf(L0));b.textContent='RISCO '+L0.t;b.style.color=L0.c;txt.textContent=L0.m+' Não substitui alertas oficiais.';card.dataset.level=String(idx);icon.src=meteoIcon(RISK_ICONS[idx]);
  const a=[], ev=details.evidence||[];
  const hailEv=ev.find(x=>x.kind==='hail'); if(hailEv)a.push(civilAlert('hail',hailEv.title,hailEv.text,'danger')); else if(details.hail==='ALTO'||details.hail==='MODERADO')a.push(civilAlert('hail','Possibilidade de granizo',details.hail==='ALTO'?'Condições atmosféricas mais favoráveis a granizo.':'Há sinais atmosféricos que merecem atenção para granizo.','danger'));
  const stormEv=ev.find(x=>x.kind==='storm'); if(stormEv)a.push(civilAlert('thunderstorms-day-rain',stormEv.title,stormEv.text,'danger'));
  const lightEv=ev.find(x=>x.kind==='lightning'); if(lightEv)a.push(civilAlert('lightning-bolt',lightEv.title,lightEv.text,'warning'));
  const rainEv=ev.find(x=>x.kind==='rain'); if(rainEv)a.push(civilAlert('rain',rainEv.title,rainEv.text,'warning'));
  if(Number(details.gust)>=80)a.push(civilAlert('tornado','Vento muito forte',`Rajadas estimadas em ${Math.round(details.gust)} km/h.`,'danger')); else if(Number(details.gust)>=60)a.push(civilAlert('wind','Vento forte',`Rajadas estimadas em ${Math.round(details.gust)} km/h.`,'warning'));
  document.querySelector('#civilAlerts').innerHTML=a.slice(0,4).join('');
  const bar=document.querySelector('#riskBar');
  const wxNum=(x,d=0)=>Number.isFinite(Number(x))?Number(x).toFixed(d):'--';
  const temp=wxNum(details.temp,1), rh=wxNum(details.rh,0), precip=wxNum(details.precip,1), wind=wxNum(details.wind,1), gust=wxNum(details.gust,1);
  const gustExtra=Number.isFinite(Number(details.gust))&&Number(details.gust)>Number(details.wind||0)+5?`<small>raj. ${gust}</small>`:'';
  bar.innerHTML=`
    <img class="riskbar-main-icon" src="${icon.src}" alt="">
    <div class="riskbar-copy"><b>RISCO ${L0.t}</b><span>${L0.m}</span></div>
    <div class="riskbar-weather" aria-label="Condições meteorológicas no ponto selecionado">
      <button type="button" class="riskbar-metric" data-metric="temp" data-value="${temp} °C" title="Temperatura — clique para detalhes"><img src="./assets/meteocons/thermometer.svg" alt=""><span>${temp} °C</span></button>
      <button type="button" class="riskbar-metric" data-metric="rh" data-value="${rh}%" title="Umidade relativa — clique para detalhes"><img src="./assets/meteocons/humidity.svg" alt=""><span>${rh}%</span></button>
      <button type="button" class="riskbar-metric" data-metric="precip" data-value="${precip} mm/h" title="Precipitação — clique para detalhes"><img src="./assets/meteocons/raindrop.svg" alt=""><span>${precip} mm/h</span></button>
      <button type="button" class="riskbar-metric" data-metric="wind" data-value="${wind} km/h" data-extra="${Number.isFinite(Number(details.gust))?`raj. ${gust} km/h`:''}" title="Vento — clique para detalhes"><img src="./assets/meteocons/wind.svg" alt=""><span>${wind} km/h</span>${gustExtra}</button>
    </div>`;
  bar.style.borderColor=bar.style.color=L0.c;
  bar.classList.add('on');
}

let pt=null;
async function inspect(lat,lon){
  const p=document.querySelector('#point');p.textContent='Carregando dados...';
  const hv='relative_humidity_2m,temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,cape,lifted_index,convective_inhibition,freezing_level_height'; const cv='temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m';
  try{
    const r=await fetchT(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${cv}&hourly=${hv}&past_hours=12&forecast_hours=13&wind_speed_unit=kmh&timezone=America%2FSao_Paulo`);
    if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();
    pt={lat,lon,h:d.hourly||{},current:d.current||{}}; renderPoint();
  }catch(e){p.textContent='Falha ao consultar dados meteorológicos. '+e.message;}
}
function renderPoint(){
  if(!pt||!pt.h.time)return;
  const i=Math.min(Number(timeline.value),pt.h.time.length-1),g=k=>(pt.h[k]||[])[i],n=Number(timeline.value)-12,cur=pt.current||{},now=n===0;
  const val=k=>now&&cur[k]!=null?cur[k]:g(k);
  const v={cape:Number(g('cape')||0),gust:Number(val('wind_gusts_10m')||0),precip:Number(val('precipitation')||0),weatherCode:Number(val('weather_code')||0),li:g('lifted_index'),cin:g('convective_inhibition'),fz:g('freezing_level_height')};
  const F=fuseSituation(v,pt.lat,pt.lon),L0=LV[F.level];

  const radarCell=moniNearestRadarCell(pt.lat,pt.lon,35);
  const ME=fuseStormEvidence({cell:radarCell,weather:v,lat:pt.lat,lon:pt.lon});
  const stormTxt=moniLevelText(ME.storm.level,'storm'),hailTxt=moniLevelText(ME.hail.level,'hail');
  const srcTxt=x=>x.length?x.map(q=>({radar:'REDEMET',modelo:'MODELO',glm:'GLM',satellite:'GOES',comunidade:'COMUNIDADE'}[q]||q.toUpperCase())).join(' + '):'--';
  document.querySelector('#point').innerHTML=`
    <div class="moni-point-head">${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)} · ${n===0?'AGORA':n>0?'+'+n+' h':n+' h'}</div>
    <div class="moni-point-weather">
      <div>TEMP <b>${val('temperature_2m')??'--'} °C</b></div>
      <div>PRECIP <b>${v.precip} mm/h</b></div>
      <div>UMIDADE <b>${val('relative_humidity_2m')??'--'} %</b></div>
      <div>NUVENS <b>${val('cloud_cover')??'--'} %</b></div>
      <div>VENTO <b>${val('wind_speed_10m')??'--'} km/h</b></div>
      <div>RAJADA <b>${v.gust} km/h</b></div>
      <div>CAPE <b>${v.cape} J/kg</b></div>
      <div>LI <b>${v.li??'--'}</b> · ISOTERMA 0° <b>${v.fz!=null?Math.round(v.fz):'--'} m</b></div>
    </div>
    <div class="moni-evidence-block">
      <div class="moni-evidence-title">ANÁLISE MULTIFONTE</div>
      <div class="moni-evidence-item">
        <span>TEMPESTADE</span>
        <b>${stormTxt}</b>
        <small>CONFIANÇA ${ME.storm.confidenceLabel}</small>
        <small>${srcTxt(ME.storm.sources)}</small>
      </div>
      <div class="moni-evidence-item">
        <span>GRANIZO</span>
        <b>${hailTxt}</b>
        <small>CONFIANÇA ${ME.hail.confidenceLabel}</small>
        <small>${srcTxt(ME.hail.sources)}</small>
      </div>
      <div class="moni-evidence-foot">
        RAIOS PRÓXIMOS <b>${F.bolts.length}</b><br>
        RELATOS METEO <b>${F.reps.length}</b><br>
        FOGO (CONDIÇÃO) <b>${fireWx(Number(val('relative_humidity_2m')),v.gust,v.precip,Number(val('temperature_2m')))}</b>
      </div>
    </div>`;
  setRisk(L0,{...v,temp:Number(val('temperature_2m')),rh:Number(val('relative_humidity_2m')),wind:Number(val('wind_speed_10m')),hail:F.hail,evidence:F.evidence});
  weatherLayer.clearLayers();stormLayer.clearLayers();hailLayer.clearLayers();
  L.circleMarker([pt.lat,pt.lon],{radius:5,weight:1,color:'#dce7ef',fillColor:'#37a8ff',fillOpacity:.9}).addTo(weatherLayer);
  if(ME.storm.level>0){
    const sc=['#37a8ff','#ffd84d','#ff9a3d','#ff4f57'][ME.storm.level];
    L.circle([pt.lat,pt.lon],{radius:25000,color:sc,weight:1,fillColor:sc,fillOpacity:.12})
      .bindTooltip(`${stormTxt} · confiança ${ME.storm.confidenceLabel}`)
      .bindPopup(`<b>${stormTxt}</b><br>Confiança: <b>${ME.storm.confidenceLabel}</b><br>Fontes: ${srcTxt(ME.storm.sources)}<br><small>Análise experimental multifuente do MONI. Não é alerta oficial.</small>`)
      .addTo(stormLayer);
  }
  if(ME.hail.level>0){
    L.circle([pt.lat,pt.lon],{radius:12000,color:'#d35cff',dashArray:'4 4',weight:2,fillOpacity:0})
      .bindTooltip(`Granizo: ${hailTxt} · confiança ${ME.hail.confidenceLabel}`)
      .bindPopup(`<b>${hailTxt} DE GRANIZO</b><br>Confiança: <b>${ME.hail.confidenceLabel}</b><br>Fontes: ${srcTxt(ME.hail.sources)}<br><small>Potencial experimental. Não significa granizo confirmado no solo.</small>`)
      .addTo(hailLayer);
  }
}

async function loadAlerts(){
  const el=document.querySelector('#alerts'),link='<a href="https://alertas2.inmet.gov.br" target="_blank" rel="noopener">alertas2.inmet.gov.br</a>';
  try{
    const r=await fetchT('https://apiprevmet3.inmet.gov.br/avisos/ativos');if(!r.ok)throw Error('HTTP '+r.status);
    const j=await r.json(),arr=Array.isArray(j)?j:Object.values(j||{}).flatMap(x=>Array.isArray(x)?x:[]);
    const top=arr.slice(0,3).map(a=>'• '+esc(`${a.severidade||''} ${a.descricao||a.titulo||a.aviso_tipo||'aviso'}`.trim())).join('<br>');
    el.innerHTML=`<b>AVISOS INMET ATIVOS (BR): ${arr.length}</b>${top?'<br>'+top:''}<br>${link}`;
  }catch(e){el.innerHTML='Avisos INMET indisponíveis agora. '+link;}
}
loadAlerts();setInterval(loadAlerts,600000);

document.querySelector('#menuBtn').onclick=()=>document.querySelector('aside').classList.toggle('open');
map.on('click',()=>document.querySelector('aside').classList.remove('open'));

function fireWx(rh,gust,p,t){if(!isFinite(rh))return '--';let n=0;if(rh<30)n+=2;else if(rh<45)n++;if(gust>=35)n++;if(t>=30)n++;if(p>0.2)n=0;return n>=4?'MUITO ALTA':n>=3?'ALTA':n>=2?'MÉDIA':'BAIXA';}

map.createPane('firePane');map.getPane('firePane').style.zIndex=470;
const fireLayer=L.layerGroup();
let fireData=[], fireLoadedAt=0, fireLoading=false;
const FIRE_REFRESH_MS=10*60*1000;
const FIRE_MAX_AGE_H=6;
const FIRE_THERMOMETER_ICON='./assets/meteocons/thermometer.svg'; 
const fireApi=window.MONI_CONFIG?.fireApiUrl || ((window.MONI_CONFIG?.supabaseUrl||'')+'/functions/v1/fires');
const setFire=(t,live)=>{const el=document.querySelector('#fireStatus');if(!el)return;el.textContent=t;el.classList.toggle('live',!!live);};
const escFire=s=>String(s??'--').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fireAgeText(min){if(!Number.isFinite(min))return '--';if(min<60)return `${Math.max(0,Math.round(min))} min`;return `${(min/60).toFixed(1)} h`;}
function fireStyle(ageMin){
  // As cores representam somente a RECÊNCIA da detecção, não intensidade de incêndio.
  if(ageMin<60)return {color:'#ff2d1a',label:'MUITO RECENTE'};
  if(ageMin<180)return {color:'#ff761a',label:'RECENTE'};
  if(ageMin<360)return {color:'#ffb020',label:'ÚLTIMAS 6 H'};
  return {color:'#8f98a3',label:'ANTIGO'};
}
function firePopup(f){
  const st=fireStyle(Number(f.age_minutes));
  return `<div class="moni-fire-popup">`+
    `<div class="fire-popup-title"><img src="${FIRE_THERMOMETER_ICON}" alt=""><b>FOCO TÉRMICO DETECTADO</b></div>`+ // [MONI ICON] thermal-hotspot / popup
    `<small>${st.label}</small><hr>`+
    `Observado: <b>${escFire(f.observed_local||f.observed_utc)}</b><br>`+
    `Idade: <b>${fireAgeText(Number(f.age_minutes))}</b><br>`+
    `Satélite: <b>${escFire(f.satellite)}</b><br>`+
    `Coordenadas: ${Number(f.lat).toFixed(4)}, ${Number(f.lon).toFixed(4)}<br>`+
    `<small>Fonte: INPE · Programa Queimadas<br>Detecção de anomalia térmica por satélite. Não confirma, isoladamente, um incêndio e não representa o perímetro ou a extensão de uma queimada.</small></div>`;
}
function renderFires(){
  fireLayer.clearLayers();
  if(!document.querySelector('#fires')?.checked)return;
  const b=map.getBounds().pad(.12), zoom=map.getZoom();
  let shown=0;
  for(const f of fireData){
    const lat=Number(f.lat),lon=Number(f.lon),age=Number(f.age_minutes);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(age)||age>FIRE_MAX_AGE_H*60)continue;
    if(!b.contains([lat,lon]))continue;
    const st=fireStyle(age);
    const radius=zoom<=4?4.5:6;
    const m=L.circleMarker([lat,lon],{
      radius,
      color:st.color,
      weight:1.2,
      fillColor:st.color,
      fillOpacity:.88,
      opacity:.98,
      pane:'firePane'
    });
    m.bindPopup(()=>firePopup(f),{maxWidth:300});
    m.addTo(fireLayer);shown++;
  }
  const badge=document.querySelector('#fireMapBadge span');
  if(badge)badge.textContent=`FOCOS TÉRMICOS · ${shown} NO MAPA · INPE`;
  setFire(`${shown} FOCOS`,true);
}
async function loadFires(force=false){
  if(fireLoading)return;
  if(!force && fireData.length && Date.now()-fireLoadedAt<FIRE_REFRESH_MS){renderFires();return;}
  fireLoading=true;setFire('CARREGANDO…');
  try{
    const r=await fetch(fireApi,{headers:{'apikey':window.MONI_CONFIG?.supabaseKey||'', 'Authorization':`Bearer ${window.MONI_CONFIG?.supabaseKey||''}`}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();if(!j?.ok||!Array.isArray(j?.fires))throw new Error(j?.error||'Resposta inválida');
    fireData=j.fires;fireLoadedAt=Date.now();renderFires();
  }catch(err){console.error('MONI thermal hotspots:',err);setFire('ERRO');}
  finally{fireLoading=false;}
}
document.querySelector('#fires').onchange=e=>{
  document.querySelector('#fireMapBadge')?.classList.toggle('on',e.target.checked);
  if(e.target.checked){fireLayer.addTo(map);loadFires(true);}else{map.removeLayer(fireLayer);setFire('OFF');}
  renderLegend();
};
map.on('moveend zoomend',()=>{if(document.querySelector('#fires')?.checked)renderFires();});
setInterval(()=>{if(document.querySelector('#fires')?.checked)loadFires(true);},FIRE_REFRESH_MS);

// ========================= legenda contextual =========================
// Mostra só o que está ativo no mapa; cores e limites vêm das mesmas constantes usadas nas camadas.
const lgOn=id=>{const el=document.querySelector('#'+id);return !!(el&&el.checked);};
const lgRow=(c,t,sm='')=>`<div class="row"><span class="sw" style="background:${c}"></span>${t}${sm?`<small>${sm}</small>`:''}</div>`;
const lgSec=(t,em,body,note='')=>`<div class="lg"><h4>${t}${em?`<em>${em}</em>`:''}</h4>${body}${note?`<p>${note}</p>`:''}</div>`;
function renderLegend(){
  const el=document.querySelector('#legendBox');
  if(!el)return;

  const on=id=>!!document.querySelector('#'+id)?.checked;
  const blocks=[];

  // RISCO — mesmas cores usadas atualmente pelo cálculo do MONI.
  blocks.push(`<div class="legend-card">
    <div class="legend-title">RISCO NO PONTO <span>clique no mapa</span></div>
    <div class="legend-row"><i style="--lc:#6f91a4"></i><b>BAIXO</b></div>
    <div class="legend-row"><i style="--lc:#ffd34d"></i><b>MODERADO</b><small>CAPE ≥ 800</small></div>
    <div class="legend-row"><i style="--lc:#ff9f43"></i><b>ALTO</b><small>CAPE ≥ 1500 · rajada ≥ 60</small></div>
    <div class="legend-row"><i style="--lc:#ff4d5e"></i><b>MUITO ALTO</b><small>CAPE ≥ 2500 · rajada ≥ 80</small></div>
    <p>Ajustado por índice de instabilidade (LI) e inibição (CIN). Vale para a hora da timeline.</p>
  </div>`);

  if(on('hail')) blocks.push(`<div class="legend-card">
    <div class="legend-title">GRANIZO <span>estimativa MONI</span></div>
    <div class="legend-row"><i style="--lc:#9a68ff"></i><b>Potencial de granizo</b><small>moderado / alto</small></div>
    <p>Estimativa experimental baseada nas condições atmosféricas do ponto.</p>
  </div>`);

  if(on('imerg')) blocks.push(`<div class="legend-card">
    <div class="legend-title">PRECIPITAÇÃO (IMERG) <span>NASA</span></div>
    <div class="legend-row"><i style="--lc:#68a9ff"></i><b>Precipitação estimada</b></div>
    <p>Produto IMERG com atraso de algumas horas. As cores do mapa seguem a escala do próprio produto.</p>
  </div>`);

  if(on('lightning')) blocks.push(`<div class="legend-card">
    <div class="legend-title">RAIOS (GLM) <span>NOAA · GOES</span></div>
    <div class="legend-row"><i style="--lc:#ffd84f"></i><b>Descarga detectada</b><small>últimos 15 min</small></div>
    <p>Quanto mais opaco, mais recente.</p>
  </div>`);

  if(on('fires')) blocks.push(`<div class="legend-card">
    <div class="legend-title">FOCOS TÉRMICOS <span>INPE</span></div>
    <div class="legend-row"><i style="--lc:#ff3b1f"></i><b>Muito recente</b><small>&lt; 1 h</small></div>
    <div class="legend-row"><i style="--lc:#ff8a22"></i><b>Recente</b><small>1–3 h</small></div>
    <div class="legend-row"><i style="--lc:#ffbd32"></i><b>Últimas 6 h</b><small>3–6 h</small></div>
    <p>Detecção de anomalia térmica por satélite. A cor indica a idade da detecção, não a intensidade de um incêndio.</p>
  </div>`);

  // Relatos atuais: legenda por função/categoria, em vez da antiga classificação
  // genérica verde/laranja/vermelho.
  blocks.push(`<div class="legend-card legend-reports">
    <div class="legend-title">RELATOS <span>comunidade</span></div>
    <div class="legend-row"><i style="--lc:#9a68ff"></i><b>Tempo severo / granizo</b></div>
    <div class="legend-row"><i style="--lc:#23a9ff"></i><b>Ajuda / recurso disponível</b></div>
    <div class="legend-row"><i style="--lc:#20e889"></i><b>Serviço disponível</b></div>
    <div class="legend-row"><i style="--lc:#ffb020"></i><b>Necessidade / atenção</b></div>
    <div class="legend-row"><i style="--lc:#ff4d5e"></i><b>Falta de serviço / perigo</b></div>
    <div class="legend-row"><i style="--lc:#ff641f"></i><b>Poste / fio caído</b></div>
    <p>Relatos enviados por usuários, não verificados. Cada tipo mantém seu ícone próprio no mapa e expira automaticamente.</p>
  </div>`);

  blocks.push(`<div class="legend-card">
    <div class="legend-title">LOCALIZAÇÃO</div>
    <div class="legend-row"><i style="--lc:#4dbdff"></i><b>Você está aqui</b></div>
  </div>`);

  blocks.push(`<div class="legend-disclaimer">Classificações de risco e estimativas do MONI são experimentais e não substituem alertas oficiais.</div>`);

  el.innerHTML=blocks.join('');
}
document.querySelector('aside').addEventListener('change',renderLegend);
// A localização agora é automática; não existe mais o antigo botão locateBtn.
renderLegend();

// ========================= relatos da comunidade =========================
// Relatos compartilhados via Supabase (config.js). Sem configuração, ficam só neste aparelho (localStorage).
const CFG=window.MONI_CONFIG||{},SB_ON=!!(CFG.supabaseUrl&&CFG.supabaseKey);
const sbFetch=(path,opt={})=>fetch(CFG.supabaseUrl+'/rest/v1/'+path,{...opt,headers:{apikey:CFG.supabaseKey,...(CFG.supabaseKey.startsWith('eyJ')?{Authorization:'Bearer '+CFG.supabaseKey}:{}),'Content-Type':'application/json',...(opt.headers||{})}});
const reportAssetKey=k=>({
  hail_now:'hail_now',storm_now:'storm_now',heavy_rain:'heavy_rain',
  fire_now:'fire_now',shelter:'shelter',collect:'collect',distrib:'distrib',
  tarp_have:'tarp_have',tarp_need:'tarp_need',tree:'tree',wire:'wire',
  power_on:'power_on',power_off:'power_off',water_on:'water_on',water_off:'water_off'
}[k]||'danger');
const reportMenuIcon=k=>`./assets/report-icons-v2/menu/${reportAssetKey(k)}.svg`;
const reportMarkerIcon=k=>`./assets/report-icons-v2/marker/${reportAssetKey(k)}.svg`;
const reportNotificationIcon=k=>`./assets/report-icons-v2/notification/${reportAssetKey(k)}.svg`;
const reportIcon=k=>reportMenuIcon(k);
const reportIconHtml=(k,t,cls='')=>`<img class="report-symbol ${cls}" src="${reportMenuIcon(k)}" alt="${esc(t||'Relato')}">`;
const RT=[
 {k:'hail_now',e:'🟣',t:'Granizo agora',c:'#d35cff',g:'meteo'},
 {k:'storm_now',e:'⛈️',t:'Tempestade forte agora',c:'#ff4d4d',g:'meteo'},
 {k:'heavy_rain',e:'🌧️',t:'Chuva intensa agora',c:'#4ab8ff',g:'meteo'},
 {k:'fire_now',e:'🔥',t:'Incêndio / queimada agora',c:'#ff5a1f',g:'perigo'},
 {k:'shelter',e:'🏠',t:'Abrigo',c:'#43df86',g:'ajuda'},
 {k:'collect',e:'📦',t:'Arrecadação de mantimentos',c:'#43df86',g:'ajuda'},
 {k:'distrib',e:'🍞',t:'Distribuição de mantimentos',c:'#43df86',g:'ajuda'},
 {k:'tarp_have',e:'⛺',t:'Lonas disponíveis',c:'#43df86',g:'ajuda'},
 {k:'tarp_need',e:'🏚️',t:'Precisa de lona',c:'#ffb14a',g:'necessidade'},
 {k:'tree',e:'🌳',t:'Árvore caída',c:'#ff4d4d',g:'perigo'},
 {k:'wire',e:'⚡',t:'Poste / fio caído',c:'#ff4d4d',g:'perigo'},
 {k:'power_on',e:'💡',t:'Com energia',c:'#43df86',g:'servico'},
 {k:'power_off',e:'🔌',t:'Sem energia',c:'#ffb14a',g:'servico'},
 {k:'water_on',e:'🚰',t:'Com água',c:'#43df86',g:'servico'},
 {k:'water_off',e:'🚱',t:'Sem água',c:'#ffb14a',g:'servico'}];
const RTTL={meteo:3,ajuda:48,necessidade:24,perigo:12,servico:12}; // validade em horas
const $=q=>document.querySelector(q), rType=k=>RT.find(t=>t.k===k);
const LSg=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}}, LSs=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
let reports=LSg('moni.reports',[]),myVotes=LSg('moni.votes',{}),rSel=null,lastSend=0;
const rLayer=L.layerGroup().addTo(map);
const rAlive=r=>{const t=rType(r.k);return !!t&&Date.now()-r.ts<RTTL[t.g]*36e5&&(r.gone||0)<3;};
const ago=ts=>{const m=Math.round((Date.now()-ts)/6e4);return m<1?'agora':m<60?`há ${m} min`:`há ${Math.round(m/60)} h`;};
function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(t._t);t._t=setTimeout(()=>t.hidden=true,3500);}
function drawReports(){
  rLayer.clearLayers();reports=reports.filter(rAlive);LSs('moni.reports',reports);
  for(const r of reports){const t=rType(r.k);
    const reportHtml=`<div class="rp rp-pin"><img class="report-pin-img" src="${reportMarkerIcon(r.k)}" alt="${esc(t.t)}"></div>`;
    const mk=L.marker([r.lat,r.lon],{icon:L.divIcon({className:'',iconSize:[42,51],iconAnchor:[21,49],html:reportHtml})});
    mk.bindPopup(`<b class="report-popup-title">${reportIconHtml(r.k,t.t,'report-symbol-inline')} ${esc(t.t)}</b><br><small>${ago(r.ts)} · ✔ ${r.ok||0} · ✖ ${r.gone||0}</small>${r.note?`<p>${esc(r.note)}</p>`:''}${t.k==='wire'?'<p class="rp-warn">Perigo: mantenha distância e avise a concessionária e a Defesa Civil (199).</p>':''}<div class="rp-route"><button data-route="1">➜ TRAÇAR ROTA ATÉ AQUI</button></div><div class="rp-btns"><button data-v="ok">✔ Ainda vale</button><button data-v="gone">✖ Não está mais</button></div>`);
    mk.on('popupopen',e=>{const root=e.popup.getElement();root.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>vote(r.id,b.dataset.v));const rb=root.querySelector('[data-route]');if(rb)rb.onclick=()=>routeToReport(r);});
    mk.addTo(rLayer);}
}
// ========================= navegação interna 2D / 3D =========================
let routeMap=null,routeReport=null,routeGeo=null,routeUserMarker=null,routeDestMarker=null,route3D=true,routeWatch=null;
const routeNav=document.getElementById('routeNav'),routeSummary=document.getElementById('routeSummary'),routeInstruction=document.getElementById('routeInstruction'),routeProgress=document.getElementById('routeProgress');
const routeKm=m=>m>=1000?`${(m/1000).toFixed(m>=10000?0:1)} km`:`${Math.round(m)} m`;
const routeTime=s=>{const m=Math.max(1,Math.round(s/60));return m>=60?`${Math.floor(m/60)} h ${m%60} min`:`${m} min`;};
function routeBearing(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lon-a.lon)*r;return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;}
function routeManeuver(step){const m=step?.maneuver||{},mod=m.modifier||'',type=m.type||'';if(type==='arrive')return 'Você chegou ao destino';if(type==='depart')return `Siga por ${step.name||'esta via'}`;const dirs={'left':'Vire à esquerda','right':'Vire à direita','slight left':'Mantenha-se levemente à esquerda','slight right':'Mantenha-se levemente à direita','sharp left':'Faça uma curva fechada à esquerda','sharp right':'Faça uma curva fechada à direita','straight':'Siga em frente','uturn':'Faça o retorno'};return `${dirs[mod]||'Continue'}${step.name?' em '+step.name:''}`;}
function routeSetMode(is3d){route3D=is3d;document.getElementById('routeMode').textContent=is3d?'3D':'2D';if(routeMap){routeMap.easeTo({pitch:is3d?62:0,bearing:is3d?(routeMap.getBearing()||0):0,duration:600});}}
async function routeToReport(r){
  if(!r)return;if(!userPosition){toast('Aguardando sua localização para calcular a rota.');return;}
  routeReport=r;routeNav.hidden=false;document.body.classList.add('route-open');routeSummary.textContent='Calculando…';routeInstruction.textContent='Calculando rota…';routeProgress.textContent='Sua localização → destino';
  try{
    const routeApi=window.MONI_CONFIG?.routeApiUrl || (window.MONI_CONFIG?.supabaseUrl ? window.MONI_CONFIG.supabaseUrl+'/functions/v1/route' : '');
    if(!routeApi)throw new Error('ROUTE_API_NOT_CONFIGURED');
    const u=`${routeApi}?from=${encodeURIComponent(userPosition.lat+','+userPosition.lon)}&to=${encodeURIComponent(r.lat+','+r.lon)}`;
    const res=await fetch(u,{headers:{'Accept':'application/json'}});
    const data=await res.json().catch(()=>({}));
    // route v2.1 devolve a rota principal em `route`.
    // Mantemos compatibilidade também com respostas OSRM puras (`routes[0]`).
    const rr=data.route || data.routes?.[0];
    if(!res.ok || data.ok===false || !rr?.geometry?.coordinates?.length){
      throw new Error(data.message || data.error || data.code || 'Sem rota');
    }
    routeGeo=rr.geometry;
    routeSummary.textContent=`${routeKm(rr.distance)} · ~${routeTime(rr.duration)}`;
    routeInstruction.textContent=routeManeuver(rr.legs?.[0]?.steps?.[0]);
    routeProgress.textContent=`Destino: ${rType(r.k)?.t||'relato da comunidade'}`;
    await initRouteMap(rr);
  }catch(e){console.error('Rota:',e);routeInstruction.textContent='Não foi possível calcular a rota';routeProgress.textContent=e?.message==='NoRoute'?'Não foi encontrada uma rota rodoviária entre os pontos.':'Serviço de rotas indisponível. Tente novamente em instantes.';}
}
async function initRouteMap(rr){
  // MapLibre GL JS v6 is loaded as an ES module. Wait briefly for the module
  // instead of treating a renderer-loading problem as a routing failure.
  if(!window.maplibregl){
    await new Promise((resolve,reject)=>{
      const done=()=>{ cleanup(); resolve(); };
      const fail=()=>{ cleanup(); reject(new Error('MapLibre não carregou')); };
      const cleanup=()=>{ clearTimeout(timer); window.removeEventListener('moni:maplibre-ready',done); };
      const timer=setTimeout(fail,8000);
      window.addEventListener('moni:maplibre-ready',done,{once:true});
      if(window.maplibregl) done();
    });
  }
  const maplibregl=window.maplibregl;
  if(!maplibregl?.Map) throw new Error('MapLibre indisponível');

  if(routeMap){routeMap.remove();routeMap=null;}
  routeMap=new maplibregl.Map({container:'route3dMap',style:'https://tiles.openfreemap.org/styles/liberty',center:[userPosition.lon,userPosition.lat],zoom:15,pitch:62,bearing:0,attributionControl:true});
  routeMap.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
  routeMap.on('load',()=>{
    routeMap.addSource('moni-route',{type:'geojson',data:{type:'Feature',properties:{},geometry:routeGeo}});
    routeMap.addLayer({id:'moni-route-shadow',type:'line',source:'moni-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#071017','line-width':10,'line-opacity':.55}});
    routeMap.addLayer({id:'moni-route-line',type:'line',source:'moni-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#42c7ff','line-width':6}});
    routeUserMarker=new maplibregl.Marker({element:Object.assign(document.createElement('div'),{className:'route-user'})}).setLngLat([userPosition.lon,userPosition.lat]).addTo(routeMap);
    const de=document.createElement('div');de.className='route-dest';de.textContent=rType(routeReport.k)?.e||'●';routeDestMarker=new maplibregl.Marker({element:de}).setLngLat([routeReport.lon,routeReport.lat]).addTo(routeMap);
    const coords=routeGeo.coordinates,b=new maplibregl.LngLatBounds(coords[0],coords[0]);coords.forEach(c=>b.extend(c));routeMap.fitBounds(b,{padding:{top:100,bottom:130,left:45,right:45},pitch:route3D?55:0,duration:700});setTimeout(()=>followRouteUser(userPosition),800);
  });
  if(routeWatch!==null)navigator.geolocation.clearWatch(routeWatch);
  if(navigator.geolocation)routeWatch=navigator.geolocation.watchPosition(pos=>{const np={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy,heading:pos.coords.heading};followRouteUser(np);},()=>{}, {enableHighAccuracy:true,maximumAge:3000,timeout:12000});
}
function followRouteUser(pos){if(!routeMap||!routeUserMarker)return;routeUserMarker.setLngLat([pos.lon,pos.lat]);const b=Number.isFinite(pos.heading)?pos.heading:(routeReport?routeBearing(pos,{lat:routeReport.lat,lon:routeReport.lon}):routeMap.getBearing());if(route3D)routeMap.easeTo({center:[pos.lon,pos.lat],zoom:16.5,pitch:62,bearing:b,duration:900,offset:[0,100]});const d=routeReport?kmDist(pos.lat,pos.lon,routeReport.lat,routeReport.lon):0;routeProgress.textContent=d<.05?'Você chegou ao destino':`${routeKm(d*1000)} em linha reta até o destino`;}
function endRoute(){if(routeWatch!==null&&navigator.geolocation){navigator.geolocation.clearWatch(routeWatch);routeWatch=null;}if(routeMap){routeMap.remove();routeMap=null;}routeNav.hidden=true;document.body.classList.remove('route-open');routeReport=routeGeo=routeUserMarker=routeDestMarker=null;}
document.getElementById('routeBack')?.addEventListener('click',endRoute);document.getElementById('routeEnd')?.addEventListener('click',endRoute);document.getElementById('routeMode')?.addEventListener('click',()=>routeSetMode(!route3D));

function vote(id,v){
  if(myVotes[id])return toast('Você já votou neste relato.');
  const r=reports.find(x=>x.id===id);if(!r)return;
  r[v]=(r[v]||0)+1;myVotes[id]=v;LSs('moni.votes',myVotes);
  if(SB_ON)sbFetch('rpc/vote_report',{method:'POST',body:JSON.stringify({rid:id,v})}).catch(()=>{});
  drawReports();map.closePopup();toast('Obrigado pelo voto.');
}
async function submitReport(lat,lon){
  if(!rSel)return toast('Escolha o tipo de relato.');
  if(Date.now()-lastSend<30000)return toast('Aguarde alguns segundos antes de enviar outro relato.');
  const r={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),k:rSel,lat:+lat.toFixed(rType(rSel).g==='ajuda'?4:3),lon:+lon.toFixed(rType(rSel).g==='ajuda'?4:3),note:$('#rsNote').value.trim().slice(0,140),ts:Date.now(),ok:0,gone:0};
  lastSend=Date.now();reports.push(r);LSs('moni.reports',reports);
  let msg='Relato salvo apenas neste aparelho.';
  if(SB_ON){r.local=true;
    try{const x=await sbFetch('reports?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({k:r.k,lat:r.lat,lon:r.lon,note:r.note})});
      if(x.ok){const j=await x.json();if(j[0]&&j[0].id)r.id=j[0].id;delete r.local;msg='Relato enviado. Obrigado!';}
      else{const er=await x.json().catch(()=>({}));msg=/limite/i.test(er.message||'')?'Limite de relatos atingido. Tente mais tarde.':'Não foi possível enviar; relato salvo só neste aparelho.';}
    }catch(e){msg='Sem conexão: relato salvo só neste aparelho.';}
    LSs('moni.reports',reports);}
  $('#reportSheet').hidden=true;drawReports();pullReports();if(pt)renderPoint();map.flyTo([r.lat,r.lon],Math.max(map.getZoom(),13));toast(msg);
}
const setRep=(t,ok)=>{const el=$('#repStatus');if(el){el.textContent=t;el.classList.toggle('live',!!ok);}};
async function pullReports(){
  if(!SB_ON){setRep('LOCAL');return;}
  try{
    const since=new Date(Date.now()-48*36e5).toISOString();
    const x=await sbFetch(`reports?select=id,k,lat,lon,note,ok,gone,ts&ts=gte.${encodeURIComponent(since)}&order=ts.desc&limit=500`);
    if(!x.ok){const er=await x.json().catch(()=>({}));console.warn('Relatos:',x.status,er);setRep('ERRO '+x.status);
      if(!window._repErr){window._repErr=1;toast('Relatos: erro '+x.status+(er.message?' — '+er.message:''));}return;}
    const remote=await x.json();
    const previousIds=new Set(reports.map(r=>r.id));
    const parsedRemote=remote.map(r=>({...r,ts:Date.parse(r.ts)}));
    if(userPosition&&localStorage.getItem('moni.notifications')==='1'){
      const nearbyNew=parsedRemote.filter(r=>!previousIds.has(r.id)&&Date.now()-r.ts<10*60e3&&kmDist(userPosition.lat,userPosition.lon,r.lat,r.lon)<=30);
      for(const r of nearbyNew.slice(0,3)){const t=rType(r.k);if(t)deviceNotify(`MONI · ${t.t}`,`Novo relato a aproximadamente ${Math.round(kmDist(userPosition.lat,userPosition.lon,r.lat,r.lon))} km de você.`,`report-${r.id}`,reportNotificationIcon(r.k));}
    }
    reports=parsedRemote.concat(reports.filter(l=>l.local));
    drawReports();setRep(remote.length+' · OK',true);
  }catch(e){console.warn('Relatos:',e);setRep('SEM REDE');}
}
// UI
const reportMenuIconForType=t=>reportMenuIcon(t.k);
$('#rsGrid').innerHTML=RT.map(t=>`<button data-k="${t.k}" style="--c:${t.c}"><img class="rs-type-icon" src="${reportMenuIconForType(t)}" alt="${esc(t.t)}"><span class="rs-type-label">${esc(t.t)}</span></button>`).join('');
$('#rsGrid').onclick=e=>{const b=e.target.closest('button');if(!b)return;rSel=b.dataset.k;window.MONI_REPORT_SELECTED=rSel;[...$('#rsGrid').children].forEach(x=>x.classList.toggle('sel',x===b));$('#rsWarn').textContent=rSel==='wire'?'Não se aproxime do fio. Avise a concessionária de energia e a Defesa Civil (199).':'';};
function openReportSheet(){
  rSel=null;window.MONI_REPORT_SELECTED=null;
  [...$('#rsGrid').children].forEach(x=>x.classList.remove('sel'));
  $('#rsNote').value='';
  $('#rsWarn').textContent='';
  const sheet=$('#reportSheet');
  sheet.hidden=false;
  sheet.removeAttribute('hidden');
  document.body.classList.add('report-open');
}
const reportFab=$('#reportFab');
// O botão principal é inicializado no HTML antes do app.js. Isso o mantém funcional
// mesmo se alguma integração meteorológica lançar erro durante a inicialização.
if(reportFab&&!window.MONI_OPEN_REPORT) reportFab.addEventListener('click',openReportSheet);
const closeSheet=()=>{if(window.MONI_CLOSE_REPORT)return window.MONI_CLOSE_REPORT();const sheet=$('#reportSheet');sheet.hidden=true;sheet.setAttribute('hidden','');document.body.classList.remove('report-open');};
$('#rsClose').onclick=closeSheet;$('.rs-back').onclick=closeSheet;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
$('#rsGps').onclick=()=>{
  rSel=rSel||window.MONI_REPORT_SELECTED||null;
  if(!rSel)return toast('Escolha o tipo de relato primeiro.');
  if(!navigator.geolocation)return toast('Localização não suportada neste navegador.');
  navigator.geolocation.getCurrentPosition(p=>submitReport(p.coords.latitude,p.coords.longitude),()=>toast('Não foi possível obter sua localização.'),{enableHighAccuracy:true,timeout:12000});
};
const endPick=()=>{window._pickMode=false;$('#pickHint').hidden=true;};
$('#rsPick').onclick=()=>{rSel=rSel||window.MONI_REPORT_SELECTED||null;if(!rSel)return toast('Escolha o tipo de relato primeiro.');closeSheet();window._pickMode=true;$('#pickHint').hidden=false;};
$('#pickCancel').onclick=()=>{endPick();$('#reportSheet').hidden=false;};
map.on('click',e=>{if(!window._pickMode)return;endPick();submitReport(e.latlng.lat,e.latlng.lng);});
$('#reports').onchange=e=>e.target.checked?rLayer.addTo(map):map.removeLayer(rLayer);
drawReports();pullReports();setInterval(()=>{drawReports();pullReports();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pullReports();});

// MONI MAXCAPPI Analyzer v5.4 — frontend V2 otimizado
// Canvas compartilhado + viewport culling + detalhe adaptativo por zoom

map.createPane('maxcappiPane');
map.getPane('maxcappiPane').style.zIndex=430;
const maxcappiRenderer=L.canvas({padding:.35,tolerance:6});
const maxcappiLayer=L.layerGroup();
const maxcappiCellLayer=L.layerGroup().addTo(maxcappiLayer);
const maxcappiTrackLayer=L.layerGroup().addTo(maxcappiLayer);
const maxcappiForecastLayer=L.layerGroup().addTo(maxcappiLayer);
const MAXCAPPI_ANALYZE_API=(window.MONI_CONFIG&&window.MONI_CONFIG.maxcappiAnalyzeUrl)||((window.MONI_CONFIG?.supabaseUrl||'')+'/functions/v1/maxcappi-analyze');
let maxcappiEnabled=false,maxcappiReq=0,maxcappiData=null,maxcappiDrawTimer=null;
const maxcappiClientHistory=new Map();

function mcNum(v,d=1){return Number.isFinite(Number(v))?Number(v).toFixed(d):'--';}
function mcEsc(v){return String(v??'--').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function mcColor(cell){
  const i=String(cell?.intensity||'').toLowerCase();
  if(i==='extreme')return '#d94cff'; if(i==='severe')return '#ff4f57'; if(i==='very_strong')return '#ff8b38'; if(i==='strong')return '#ffd84d'; if(i==='moderate')return '#5ee57c'; return '#57c7ff';
}
function mcQuality(t){
  const q=Number(t?.track_quality_score);
  if(!Number.isFinite(q))return ['SEM HISTÓRICO','mc-muted'];
  if(q>=.78)return ['ALTA','mc-good']; if(q>=.58)return ['MODERADA','mc-warn']; return ['BAIXA','mc-bad'];
}
function mcTrend(t){const x=t?.trend?.classification;return x==='intensifying'?'INTENSIFICANDO':x==='weakening'?'ENFRAQUECENDO':x==='stable'?'ESTÁVEL':'--';}
function mcForecastStatus(t){if(t?.forecast_status==='available')return 'DISPONÍVEL';if(t?.forecast_status==='blocked')return 'BLOQUEADA';return 'HISTÓRICO INSUFICIENTE';}
function setMaxcappiStatus(text,live=false){const e=document.querySelector('#maxcappiStatus');if(!e)return;e.textContent=text;e.classList.toggle('live',live);}
function clearMaxcappi(){maxcappiCellLayer.clearLayers();maxcappiTrackLayer.clearLayers();maxcappiForecastLayer.clearLayers();}
function rememberMaxcappi(cells){
  const alive=new Set();
  for(const c of cells){const id=c.tracking_id;if(!id)continue;alive.add(id);const lat=Number(c.lat),lon=Number(c.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const a=maxcappiClientHistory.get(id)||[];const last=a[a.length-1];if(!last||Math.abs(last.lat-lat)>.00001||Math.abs(last.lon-lon)>.00001)a.push({lat,lon,at:c.observed_at});while(a.length>8)a.shift();maxcappiClientHistory.set(id,a);}
  if(maxcappiClientHistory.size>2500)for(const k of maxcappiClientHistory.keys())if(!alive.has(k))maxcappiClientHistory.delete(k);
}
function mcPopup(c){
  const t=c.tracking||{},[ql,qc]=mcQuality(t),speed=t.smoothed_speed_kmh??t.speed_kmh,dir=t.smoothed_direction??t.direction;
  const validations=Array.isArray(t.forecast_validations)?t.forecast_validations.filter(v=>Number.isFinite(Number(v.error_km))):[];
  const val=validations.length?`<hr><div class="mc-muted">VALIDAÇÃO DO NOWCAST</div>${validations.map(v=>`<div>${mcEsc(v.target_minutes)} min · erro ${mcNum(v.error_km,1)} km · ${mcEsc(String(v.quality||'').toUpperCase())}</div>`).join('')}`:'';
  return `<div class="maxcappi-popup"><b>${mcEsc(c.tracking_id||c.id||'CÉLULA')}</b><div class="mc-grid"><span>Intensidade</span><b>${mcEsc(String(c.intensity||'--').toUpperCase())}</b><span>Máx. estimado</span><b>${mcNum(c.max_estimated_dbz,1)} dBZ</b><span>Área aprox.</span><b>${mcNum(c.approximate_area_km2,1)} km²</b><span>Núcleos</span><b>${mcEsc(c.core_count??0)}</b><span>Movimento</span><b>${mcEsc(dir||'--')} · ${mcNum(speed,1)} km/h</b><span>Tendência</span><b>${mcTrend(t)}</b><span>Rastreamento</span><b class="${qc}">${ql}</b><span>Previsão</span><b>${mcForecastStatus(t)}</b></div>${val}<hr><div class="mc-muted">Observação: ${mcEsc(c.observed_at||'--')}<br>Forecast é extrapolação linear experimental, não alerta oficial.</div></div>`;
}
function mcVisibleCells(cells){
  // Renderiza somente o que pode aparecer na tela. Um pequeno padding evita pop-in nas bordas.
  const b=map.getBounds().pad(.18);
  return cells.filter(c=>{const lat=Number(c.lat),lon=Number(c.lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&b.contains([lat,lon]);});
}
function mcAreaRadiusM(c){
  const a=Number(c?.approximate_area_km2);
  if(!Number.isFinite(a)||a<=0)return 6500;
  return Math.max(3500,Math.min(45000,Math.sqrt(a/Math.PI)*1000));
}
function mcStormClass(c){
  const i=String(c?.intensity||'').toLowerCase(),dbz=Number(c?.max_estimated_dbz),cores=Number(c?.core_count||0);
  if(i==='extreme'||i==='severe'||dbz>=55)return {level:3,label:'TEMPESTADE FORTE',color:'#ff4f57'};
  if(i==='very_strong'||dbz>=48||cores>=2)return {level:2,label:'TEMPESTADE',color:'#ff9a3d'};
  if(i==='strong'||dbz>=42)return {level:1,label:'CÉLULA CONVECTIVA',color:'#ffd84d'};
  return null;
}
function mcHailPotential(c){
  // Heurística conservadora baseada apenas na estrutura/intensidade do MAXCAPPI. Não confirma granizo no solo.
  const i=String(c?.intensity||'').toLowerCase(),dbz=Number(c?.max_estimated_dbz),mag=!!c?.has_magenta,cores=Number(c?.core_count||0);
  if(mag&&(i==='extreme'||dbz>=60))return {level:3,label:'POTENCIAL ALTO',color:'#d94cff'};
  if(mag||i==='severe'||dbz>=55)return {level:2,label:'POTENCIAL MODERADO',color:'#b65cff'};
  if((i==='very_strong'&&dbz>=50)||cores>=3&&dbz>=50)return {level:1,label:'POTENCIAL BAIXO',color:'#8f70ff'};
  return null;
}
// ========================= MOTOR DE EVIDÊNCIAS MONI · FASE 1 =========================
// Infraestrutura somente: não substitui a classificação atual nem altera o mapa.
const MONI_EVIDENCE_VERSION='0.1';
function moniClampLevel(v){return Math.max(0,Math.min(3,Number(v)||0));}
function moniConfidenceLabel(s){return s>=.78?'ALTA':s>=.48?'MODERADA':s>0?'BAIXA':'INDETERMINADA';}
function evidenceRadar(cell){
  if(!cell)return {source:'radar',available:false,storm:0,hail:0,weight:0,details:[]};
  const s=mcStormClass(cell),h=mcHailPotential(cell),dbz=Number(cell.max_estimated_dbz),details=[];
  if(Number.isFinite(dbz))details.push(`${dbz.toFixed(1)} dBZ`);if(cell.intensity)details.push(String(cell.intensity).toUpperCase());if(cell.has_magenta)details.push('núcleo magenta');
  return {source:'radar',available:true,storm:moniClampLevel(s?.level||0),hail:moniClampLevel(h?.level||0),weight:1,details};
}
function evidenceModel(v){
  if(!v)return {source:'modelo',available:false,storm:0,hail:0,weight:0,details:[]};
  const b=riskAt(v),details=[];
  const cape=Number(v.cape),li=Number(v.li),fz=Number(v.fz),gust=Number(v.gust);
  if(Number.isFinite(cape))details.push(`CAPE ${Math.round(cape)} J/kg`);
  if(Number.isFinite(li))details.push(`LI ${li.toFixed(1)}`);
  if(Number.isFinite(fz))details.push(`0 °C ${Math.round(fz)} m`);

  // Mantém riskAt() como base e acrescenta uma contribuição independente
  // para granizo usando CAPE + LI + nível de congelamento + rajada.
  let hail=b.hail==='ALTO'?3:b.hail==='MODERADO'?2:b.hail==='BAIXO'?1:0;
  let modelHail=0;
  if(Number.isFinite(cape)&&Number.isFinite(li)){
    if(cape>=2500&&li<=-5)modelHail=3;
    else if(cape>=1500&&li<=-3)modelHail=2;
    else if(cape>=800&&li<=-3)modelHail=1;
  }
  if(modelHail>0&&Number.isFinite(fz)){
    if(fz>=2500&&fz<=4200)modelHail=Math.min(3,modelHail+1);
    else if(fz>5200)modelHail=Math.max(0,modelHail-1);
  }
  if(modelHail>0&&Number.isFinite(gust)&&gust>=50)modelHail=Math.min(3,modelHail+1);
  hail=Math.max(hail,modelHail);

  return {source:'modelo',available:true,storm:moniClampLevel(b.l),hail:moniClampLevel(hail),weight:.75,details};
}
function evidenceLightning(lat,lon,km=50){
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon)))return {source:'glm',available:false,storm:0,hail:0,weight:0,details:[]};
  if(!lightningEnabled&&!glmFeatures.length)return {source:'glm',available:false,storm:0,hail:0,weight:0,details:['GLM sem dados carregados']};
  const b=nearbyLightning(Number(lat),Number(lon),km),n=b.length,near=n?Math.min(...b.map(x=>kmDist(Number(lat),Number(lon),x.lat,x.lon))):null;
  return {source:'glm',available:true,storm:n>=20?3:n>=8?2:n?1:0,hail:0,weight:.8,details:n?[`${n} detecções em ${km} km`,`mais próxima ~${Math.round(near)} km`]:['sem detecções próximas']};
}
function evidenceReports(lat,lon,km=25){
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon)))return {source:'comunidade',available:false,storm:0,hail:0,weight:0,details:[]};
  const rs=nearbyWeatherReports(Number(lat),Number(lon),km);let storm=0,hail=0;const details=[];
  for(const r of rs){if(r.k==='hail_now'){storm=Math.max(storm,3);hail=3;}else if(r.k==='storm_now')storm=Math.max(storm,2);else if(r.k==='heavy_rain')storm=Math.max(storm,1);details.push(rType(r.k).t);}
  return {source:'comunidade',available:true,storm,hail,weight:.7,details};
}
function evidenceSatellite(){return {source:'satellite',available:false,storm:0,hail:0,weight:0,details:['GOES-19 IR ainda sem dado numérico por ponto']};}
function fuseStormEvidence({cell=null,weather=null,lat=null,lon=null}={}){
  const evidence=[evidenceRadar(cell),evidenceModel(weather),evidenceLightning(lat,lon),evidenceSatellite(),evidenceReports(lat,lon)],available=evidence.filter(e=>e.available);
  function fuse(kind){const a=available.filter(e=>Number(e[kind])>0);if(!a.length)return {level:0,confidence:0,confidenceLabel:'INDETERMINADA',sources:[]};const level=Math.max(...a.map(e=>moniClampLevel(e[kind]))),support=a.reduce((s,e)=>s+e.weight*(e[kind]/3),0),diversity=Math.min(1,a.length/3),confidence=Math.min(1,(support/1.8)*.72+diversity*.28);return {level,confidence,confidenceLabel:moniConfidenceLabel(confidence),sources:a.map(e=>e.source)};}
  return {version:MONI_EVIDENCE_VERSION,storm:fuse('storm'),hail:fuse('hail'),evidence,missingSources:evidence.filter(e=>!e.available).map(e=>e.source)};
}
window.moniEvidenceAt=fuseStormEvidence;

function moniNearestRadarCell(lat,lon,maxKm=35){
  const cells=Array.isArray(maxcappiData?.cells)?maxcappiData.cells:[];
  let best=null,bestKm=Infinity;
  for(const c of cells){
    const a=Number(c?.lat),o=Number(c?.lon);
    if(!Number.isFinite(a)||!Number.isFinite(o))continue;
    const d=kmDist(Number(lat),Number(lon),a,o);
    if(d<bestKm){best=c;bestKm=d;}
  }
  return best&&bestKm<=maxKm?best:null;
}
function moniLevelText(n,kind='storm'){
  n=moniClampLevel(n);
  if(kind==='hail')return ['SEM INDICAÇÃO','POTENCIAL BAIXO','POTENCIAL MODERADO','POTENCIAL ALTO'][n];
  return ['SEM INDICAÇÃO','CÉLULA/CONVECÇÃO POSSÍVEL','TEMPESTADE POSSÍVEL','TEMPESTADE FORTE POSSÍVEL'][n];
}

function drawMaxcappiHazards(data){
  autoStormLayer.clearLayers();autoHailLayer.clearLayers();
  const cells=mcVisibleCells(Array.isArray(data?.cells)?data.cells:[]),z=map.getZoom();
  let ns=0,nh=0;
  for(const c of cells){const lat=Number(c.lat),lon=Number(c.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const r=mcAreaRadiusM(c);
    const st=mcStormClass(c);
    if(st&&document.querySelector('#storms')?.checked){L.circle([lat,lon],{radius:r,pane:'maxcappiPane',renderer:maxcappiRenderer,color:st.color,weight:z>=7?2:1,fillColor:st.color,fillOpacity:z>=7?.12:.08,interactive:true}).bindPopup(()=>`<div class="maxcappi-popup"><b>${st.label}</b><div class="mc-grid"><span>Intensidade</span><b>${mcEsc(String(c.intensity||'--').toUpperCase())}</b><span>Máx. estimado</span><b>${mcNum(c.max_estimated_dbz,1)} dBZ</b><span>Área aprox.</span><b>${mcNum(c.approximate_area_km2,1)} km²</b></div><hr><div class="mc-muted">Área automática derivada da célula MAXCAPPI. Não é alerta oficial.</div></div>`).addTo(autoStormLayer);ns++;}
    const hp=mcHailPotential(c);
    if(hp&&document.querySelector('#hail')?.checked){L.circle([lat,lon],{radius:Math.max(3000,r*.62),pane:'maxcappiPane',renderer:maxcappiRenderer,color:hp.color,weight:2,dashArray:'5 5',fillColor:hp.color,fillOpacity:.055,interactive:true}).bindPopup(()=>`<div class="maxcappi-popup"><b>${hp.label} DE GRANIZO</b><div class="mc-grid"><span>Refletividade estimada</span><b>${mcNum(c.max_estimated_dbz,1)} dBZ</b><span>Intensidade</span><b>${mcEsc(String(c.intensity||'--').toUpperCase())}</b><span>Núcleos</span><b>${mcEsc(c.core_count??0)}</b></div><hr><div class="mc-muted">Potencial experimental inferido do radar. Não significa granizo confirmado no solo.</div></div>`).addTo(autoHailLayer);nh++;}
  }
  const es=document.querySelector('#stormAutoCount'),eh=document.querySelector('#hailAutoCount');if(es)es.textContent=ns;if(eh)eh.textContent=nh;
}
function drawMaxcappi(data){
  clearMaxcappi();if(!maxcappiEnabled)return;
  const all=Array.isArray(data?.cells)?data.cells:[];rememberMaxcappi(all);
  const cells=mcVisibleCells(all),z=map.getZoom();
  const wantTracks=document.querySelector('#maxcappiTracks')?.checked!==false;
  const wantForecast=document.querySelector('#maxcappiForecast')?.checked!==false;
  const wantLabels=document.querySelector('#maxcappiLabels')?.checked!==false;
  // Em visão continental/nacional mantemos todos os pontos, mas não criamos centenas de linhas e labels.
  const showTracks=wantTracks&&z>=5,showForecast=wantForecast&&z>=5,showLabels=wantLabels&&z>=7;
  let forecastCount=0;
  for(const c of cells){
    const lat=Number(c.lat),lon=Number(c.lon),ll=[lat,lon],color=mcColor(c),t=c.tracking||{};
    const marker=L.circleMarker(ll,{pane:'maxcappiPane',renderer:maxcappiRenderer,radius:z>=7?(c.has_magenta?7:5):(c.has_magenta?5:3.5),color:'#071018',weight:z>=7?2:1,fillColor:color,fillOpacity:.92,interactive:true}).bindPopup(()=>mcPopup(c),{maxWidth:330});
    // Labels só em zoom local e apenas para tracks relevantes; evita centenas de elementos DOM.
    if(showLabels&&c.tracking_id&&(t.forecast_status==='available'||Number(t.track_quality_score)>=.58))marker.bindTooltip(String(c.tracking_id),{direction:'top',offset:[0,-6],className:'maxcappi-label',opacity:.9});
    marker.addTo(maxcappiCellLayer);
    if(showTracks&&c.tracking_id){const h=maxcappiClientHistory.get(c.tracking_id)||[];if(h.length>1)L.polyline(h.map(p=>[p.lat,p.lon]),{pane:'maxcappiPane',renderer:maxcappiRenderer,color,weight:2,opacity:.65,interactive:false}).addTo(maxcappiTrackLayer);}
    const fc=Array.isArray(t.forecast)?t.forecast:[];
    if(showForecast&&t.forecast_status==='available'&&fc.length){
      const valid=fc.filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon)));
      const pts=[ll,...valid.map(p=>[Number(p.lat),Number(p.lon)])];
      if(pts.length>1)L.polyline(pts,{pane:'maxcappiPane',renderer:maxcappiRenderer,color,weight:2,opacity:.78,dashArray:'5 7',interactive:false}).addTo(maxcappiForecastLayer);
      for(const p of valid){
        const pm=L.circleMarker([Number(p.lat),Number(p.lon)],{pane:'maxcappiPane',renderer:maxcappiRenderer,radius:3,color,weight:1,fillColor:'#071018',fillOpacity:.85,interactive:z>=7});
        // Tooltip permanente somente em zoom de cidade. Nos demais níveis o ponto continua visível sem DOM extra.
        if(z>=7)pm.bindTooltip(`+${p.minutes} min`,{permanent:true,direction:'right',offset:[4,0],className:'maxcappi-label',opacity:.85});
        pm.addTo(maxcappiForecastLayer);forecastCount++;
      }
    }
  }
  setMaxcappiStatus(`${cells.length}/${all.length} CÉL · ${forecastCount} PTS`,true);
  drawMaxcappiHazards(data);
}
function scheduleMaxcappiDraw(){
  if(!maxcappiEnabled||!maxcappiData)return;
  clearTimeout(maxcappiDrawTimer);maxcappiDrawTimer=setTimeout(()=>drawMaxcappi(maxcappiData),90);
}
async function refreshMaxcappi(force=false){
  const hazardsOn=document.querySelector('#storms')?.checked||document.querySelector('#hail')?.checked;
  if(!maxcappiEnabled&&!force&&!hazardsOn)return;const req=++maxcappiReq;if(maxcappiEnabled)setMaxcappiStatus('ANALISANDO…');
  try{const r=await fetch(MAXCAPPI_ANALYZE_API,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json();if(req!==maxcappiReq)return;if(!data?.ok)throw new Error(data?.error||'Analyzer sem resposta');maxcappiData=data;if(maxcappiEnabled)drawMaxcappi(data);else drawMaxcappiHazards(data);
  }catch(err){console.warn('MAXCAPPI Analyzer',err);if(maxcappiEnabled){setMaxcappiStatus('INDISPONÍVEL');clearMaxcappi();}}
}
function setMaxcappi(on){maxcappiEnabled=on;document.querySelector('#maxcappiControls')?.classList.toggle('visible',on);if(on){map.addLayer(maxcappiLayer);refreshMaxcappi();}else{maxcappiReq++;clearTimeout(maxcappiDrawTimer);map.removeLayer(maxcappiLayer);clearMaxcappi();setMaxcappiStatus('OFF');}}
document.querySelector('#maxcappiCells').onchange=e=>setMaxcappi(e.target.checked);
document.querySelector('#maxcappiRefresh').onclick=refreshMaxcappi;
for(const id of ['maxcappiTracks','maxcappiForecast','maxcappiLabels'])document.querySelector('#'+id).onchange=()=>scheduleMaxcappiDraw();
map.on('moveend zoomend',()=>{scheduleMaxcappiDraw();if(maxcappiData)drawMaxcappiHazards(maxcappiData);});
// Tempestades e granizo iniciam ligados: carrega a análise mesmo se a camada de células estiver desligada.
setTimeout(()=>refreshMaxcappi(true),250);

