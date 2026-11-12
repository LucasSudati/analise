/**
 * MAXCAPPI — vetorização experimental de classes de cores.
 * Trabalho com a grade classificada, sem mudar os pixels usados na análise.
 * Cada pixel é representado por um quadrado; preservo os buracos e ilhas.
 * As coordenadas são aproximadas pelos bounds recebidos do radar.
 */
export type VectorBounds = {south:number;west:number;north:number;east:number};
export type VectorFeature = {
  type:"Feature";
  properties:{radar:string;class_code:number;class_name:string;ring_count:number;pixel_area:number;perimeter_km_approx:number};
  geometry:{type:"MultiPolygon";coordinates:number[][][][]};
};
const NAMES=["none","blue","cyan","green","yellow_orange","red","magenta"];
type Point=[number,number];
type Ring=Point[];
const key=(x:number,y:number)=>x+","+y;
const area=(ring:Ring)=>{
  let sum=0;
  for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
  return sum/2;
};
const inside=(p:Point,ring:Ring)=>{
  let yes=false;
  for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
    const a=ring[i],b=ring[j];
    if(((a[1]>p[1])!==(b[1]>p[1])) &&
       p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
};
function simplify(r:Ring,tolerance:number):Ring {
  // Removo vértices colineares mesmo no modo sem perda.
  let pts=r.slice(0,-1);
  if(pts.length<4)return r;
  let changed=true;
  while(changed && pts.length>3){
    changed=false;
    const next:Ring=[];
    for(let i=0;i<pts.length;i++){
      const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
      const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(cross===0)changed=true;else next.push(b);
    }
    if(next.length<3)break;
    pts=next;
  }
  if(tolerance>0 && pts.length>4){
    // A simplificação aproximada é opt-in; a topologia precisa ser validada.
    const sq=tolerance*tolerance, kept:Ring=[];
    for(let i=0;i<pts.length;i++){
      const a=pts[(i-1+pts.length)%pts.length], b=pts[i], c=pts[(i+1)%pts.length];
      const dx=c[0]-a[0],dy=c[1]-a[1],den=dx*dx+dy*dy;
      const t=den?Math.max(0,Math.min(1,((b[0]-a[0])*dx+(b[1]-a[1])*dy)/den)):0;
      const ex=b[0]-(a[0]+t*dx),ey=b[1]-(a[1]+t*dy);
      if(ex*ex+ey*ey>=sq)kept.push(b);
    }
    if(kept.length>=3 && Math.sign(area([...kept,kept[0]]))===Math.sign(area([...pts,pts[0]])))pts=kept;
  }
  return [...pts,pts[0]];
}
function perimeter(r:Ring,b:VectorBounds,w:number,h:number):number {
  const latMid=(b.south+b.north)/2*Math.PI/180;
  const dx=111.32*Math.cos(latMid)*Math.abs(b.east-b.west)/w;
  const dy=111.32*Math.abs(b.north-b.south)/h;
  let result=0;
  for(let i=1;i<r.length;i++)result+=Math.hypot((r[i][0]-r[i-1][0])*dx,(r[i][1]-r[i-1][1])*dy);
  return result;
}
export function vectorizeMaxcappi(
  klass:Uint8Array,width:number,height:number,bounds:VectorBounds,radar:string,
  options:{maxEdges?:number;maxRings?:number;tolerancePx?:number}={}
) {
  if(klass.length!==width*height || width<1 || height<1)throw new Error("Grade MAXCAPPI inválida");
  const maxEdges=options.maxEdges??300000,maxRings=options.maxRings??5000;
  const tolerance=Math.max(0,Math.min(1,options.tolerancePx??0));
  const features:VectorFeature[]=[];
  let edgeCount=0,ringCount=0;
  const toGeo=(p:Point):Point=>[
    Number((bounds.west+p[0]/width*(bounds.east-bounds.west)).toFixed(6)),
    Number((bounds.north-p[1]/height*(bounds.north-bounds.south)).toFixed(6))
  ];
  for(let code=1;code<NAMES.length;code++){
    // Cada borda orientada deixa o interior à direita no espaço de imagem.
    const edges=new Map<string,Point[]>();
    const add=(x:number,y:number,nx:number,ny:number)=>{
      edgeCount++;
      if(edgeCount>maxEdges)throw new Error("Limite de bordas excedido: ajuste maxEdges");
      const k=key(x,y),arr=edges.get(k)??[];
      arr.push([nx,ny]);edges.set(k,arr);
    };
    let pixels=0;
    const at=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&klass[y*width+x]===code;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      if(!at(x,y))continue;
      pixels++;
      if(!at(x,y-1))add(x,y,x+1,y);
      if(!at(x+1,y))add(x+1,y,x+1,y+1);
      if(!at(x,y+1))add(x+1,y+1,x,y+1);
      if(!at(x-1,y))add(x,y+1,x,y);
    }
    if(!pixels)continue;
    const loops:Ring[]=[];
    // Nos vértices de contato diagonal priorizo a curva com giro à direita.
    while(edges.size){
      const startKey=edges.keys().next().value as string;
      const p=startKey.split(",").map(Number) as Point;
      let current=p,previous:Point|null=null;
      const ring:Ring=[p];
      let steps=0;
      while(true){
        const k=key(current[0],current[1]),choices=edges.get(k);
        if(!choices?.length)throw new Error("Contorno aberto detectado");
        let idx=0;
        if(previous && choices.length>1){
          const dx=current[0]-previous[0],dy=current[1]-previous[1];
          let best=-Infinity;
          for(let j=0;j<choices.length;j++){
            const q=choices[j],ux=q[0]-current[0],uy=q[1]-current[1];
            const turn=dx*uy-dy*ux;
            // Preferência por giro horário na grade de imagem.
            const priority=turn>0?3:turn===0?2:1;
            if(priority>best){best=priority;idx=j;}
          }
        }
        const next=choices.splice(idx,1)[0];
        if(!choices.length)edges.delete(k);
        previous=current;current=next;ring.push(current);
        if(++steps>maxEdges)throw new Error("Percurso de contorno acima do limite");
        if(current[0]===p[0]&&current[1]===p[1])break;
      }
      if(ring.length>=4 && area(ring)!==0){
        ringCount++;if(ringCount>maxRings)throw new Error("Limite de anéis excedido");
        loops.push(simplify(ring,tolerance));
      }
    }
    // Borda externa tem área positiva no sistema de pixels (y para baixo).
    const outers=loops.filter(r=>area(r)>0).sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
    const holes=loops.filter(r=>area(r)<0);
    const shapes=outers.map(r=>({outer:r,holes:[] as Ring[]}));
    for(const hole of holes){
      const p=hole[0];
      const owner=shapes.filter(s=>inside(p,s.outer)).sort((a,b)=>Math.abs(area(a.outer))-Math.abs(area(b.outer)))[0];
      if(!owner)throw new Error("Buraco sem contorno externo");
      owner.holes.push(hole);
    }
    const polygons=shapes.map(s=>[s.outer,...s.holes].map(r=>r.map(toGeo)));
    const length=loops.reduce((sum,r)=>sum+perimeter(r,bounds,width,height),0);
    features.push({
      type:"Feature",
      properties:{radar,class_code:code,class_name:NAMES[code],ring_count:loops.length,pixel_area:pixels,perimeter_km_approx:Number(length.toFixed(2))},
      geometry:{type:"MultiPolygon",coordinates:polygons}
    });
  }
  return {
    type:"FeatureCollection" as const,
    format:"geojson",
    source:"classified_png_palette",
    lossy:tolerance>0,
    tolerance_px:tolerance,
    width,height,features,
    stats:{edges:edgeCount,rings:ringCount,classes:features.length}
  };
}
