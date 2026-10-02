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

/*
 * Neste arquivo eu atuo principalmente como intermediário para obter e devolver os produtos de radar.
 * Na revisão, quero conferir se seleção de produto, área, quantidade de frames, timestamps, limites geográficos
 * e tratamento de respostas incompletas mantêm a informação original sem introduzir uma falsa sensação de
 * simultaneidade ou qualidade. Também quero documentar claramente o que vem da REDEMET/DECEA e o que é
 * processamento posterior do MONI.
 */



const BASE="https://api-redemet.decea.mil.br";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"content-type, apikey, authorization","Cache-Control":"public, max-age=60, s-maxage=60"};
const TYPES=new Set(["maxcappi","10km","07km","05km","03km"]);
const RADARS:Record<string,string>={al:"Almenara/MG",be:"Belém/PA",bv:"Boa Vista/RR",cn:"Canguçu/RS",cz:"Cruzeiro do Sul/AC",ga:"Gama/DF",jr:"Jaraguari/MS",mq:"Macapá/AP",mo:"Maceió/AL",mn:"Manaus/AM",mi:"Morro da Igreja/SC",nt:"Natal/RN",pl:"Petrolina/PE",pc:"Pico do Couto/RJ",pv:"Porto Velho/RO",sv:"Salvador/BA",sn:"Santarém/PA",st:"Santa Teresa/MG",sg:"Santiago/RS",sf:"São Francisco/MG",ua:"São Gabriel da Cachoeira/AM",sl:"São Luís/MA",sr:"São Roque/SP",tt:"Tabatinga/AM",tf:"Tefé/AM",tm:"Três Marias/MG"};
const out=(d:unknown,status=200)=>Response.json(d,{status,headers:CORS});
export default{async fetch(req:Request){
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="GET")return out({ok:false,error:"method not allowed"},405);
 try{
  const key=Deno.env.get("REDEMET_API_KEY");if(!key)throw new Error("REDEMET_API_KEY não configurada");
  const u=new URL(req.url),area=(u.searchParams.get("area")||"all").toLowerCase(),tipo=(u.searchParams.get("tipo")||"maxcappi").toLowerCase(),anima=Math.max(1,Math.min(15,Math.floor(Number(u.searchParams.get("anima")||1)||1)));
  if(area!=="all"&&!RADARS[area])return out({ok:false,error:"radar inválido",area},400);if(!TYPES.has(tipo))return out({ok:false,error:"produto inválido",tipo},400);

  const qs=new URLSearchParams({anima:String(anima)});if(area!=="all")qs.set("area",area);
  const rr=await fetch(`${BASE}/produtos/radar/${tipo}?${qs}`,{headers:{"X-Api-Key":key,"Accept":"application/json"}});const raw=await rr.text();
  if(!rr.ok)return out({ok:false,source:"REDEMET / DECEA",error:`REDEMET HTTP ${rr.status}`},502);
  let p:any;try{p=JSON.parse(raw);}catch{return out({ok:false,source:"REDEMET / DECEA",error:"JSON inválido da REDEMET"},502);}
  const objs=(Array.isArray(p?.data?.radar)?p.data.radar:[]).flat(Infinity).filter((x:any)=>x&&typeof x==="object");
  const cand=area==="all"?objs:objs.filter((x:any)=>String(x.localidade||"").toLowerCase()===area);
  const seen=new Set<string>();const images=cand.filter((x:any)=>typeof x.path==="string"&&x.path&&!seen.has(x.path)&&seen.add(x.path)).map((x:any)=>({radar:x.nome??RADARS[String(x.localidade||"").toLowerCase()]??"Radar",area:String(x.localidade||"").toLowerCase(),type:tipo,timestamp:x.data??null,image:x.path,radius_km:Number(x.raio)||null,center:{lat:Number(x.lat_center)||null,lon:Number(x.lon_center)||null},bounds:{south:Number(x.lat_min),west:Number(x.lon_min),north:Number(x.lat_max),east:Number(x.lon_max)},size:Number(x.tamanho)||null}));
  const active=[...new Set(images.map((x:any)=>x.area).filter(Boolean))];
  return out({ok:true,source:"REDEMET / DECEA",product:tipo,scope:area==="all"?"brasil":area,generated:new Date().toISOString(),diagnostic:{redemet_status:p?.status??null,redemet_message:p?.message??null,requested:anima,raw_objects:objs.length,unique_images:images.length,active_radars:active.length},active_radars:active,images});
 }catch(e){console.error(e);return out({ok:false,source:"REDEMET / DECEA",generated:new Date().toISOString(),error:String(e)},503);}
}};
