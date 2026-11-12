import { vectorizeMaxcappi } from "./maxcappi-vectorize.ts";
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
const bounds={south:-1,west:-1,north:1,east:1};
const process=(rows:number[][])=>vectorizeMaxcappi(new Uint8Array(rows.flat()),rows[0].length,rows.length,bounds,"TEST");
Deno.test("um único pixel cria quadrilátero fechado",()=>{
  const r=process([[3]]);
  assertEquals(r.features.length,1);
  assertEquals(r.features[0].properties.pixel_area,1);
  assertEquals(r.features[0].geometry.coordinates[0][0].length,5);
});
Deno.test("ilhas separadas formam MultiPolygon",()=>{
  const r=process([[3,0,3]]);
  assertEquals(r.features[0].geometry.coordinates.length,2);
  assertEquals(r.features[0].properties.pixel_area,2);
});
Deno.test("buraco mantém anel interior",()=>{
  const r=process([[3,3,3],[3,0,3],[3,3,3]]);
  assertEquals(r.features[0].geometry.coordinates.length,1);
  assertEquals(r.features[0].geometry.coordinates[0].length,2);
  assertEquals(r.features[0].properties.pixel_area,8);
});
Deno.test("classes permanecem independentes",()=>{
  const r=process([[3,4],[5,6]]);
  assertEquals(r.features.map(f=>f.properties.class_code),[3,4,5,6]);
});
Deno.test("grade de tamanho incorreto é rejeitada",()=>{
  assertThrows(()=>vectorizeMaxcappi(new Uint8Array([3]),2,2,bounds,"TEST"));
});
Deno.test("limite de bordas é aplicado",()=>{
  assertThrows(()=>vectorizeMaxcappi(new Uint8Array([3]),1,1,bounds,"TEST",{maxEdges:2}));
});
