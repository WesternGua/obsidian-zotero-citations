import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {alignLocatorPreview} from "../src/LocatorPreviewAlignment";
import {CitationManager as CM} from "../src/CitationManager";
import {CslEngine} from "../src/CslEngine";
import {displayCitationBody,citationBody} from "../src/CitationContent";
// @ts-ignore test-only private export
import {mountLocatorEditor} from "test-footnote-extension";
const open=(i:number)=>`\uE000zl:${i}\uE001`,close="\uE000/zl\uE001",entry=(i:number)=>`\uE000ze:${i}\uE001`;
const clean=(s:string)=>s.replace(/\uE000[^\uE001]*\uE001/g,"");
const marked="Title"+entry(0)+", journal 1199, "+open(0)+"1199–1211"+close+" (2021).";
const stored="Title, journal 1199, 1199–1211 (2021), https://doi.org/10.1093/icc/dtab061.";
const mapped=alignLocatorPreview(marked,stored)!;assert.equal(clean(mapped),stored);assert.ok(mapped.includes(open(0)+"1199–1211"+close));assert.ok(!mapped.includes(open(0)+"1199,"));
assert.equal(alignLocatorPreview(marked,clean(marked)),marked);
const suffixStored="Updated title, journal 1199, 1199–1211 (2021).";assert.equal(clean(alignLocatorPreview(marked,suffixStored)!),suffixStored);
assert.equal(alignLocatorPreview(open(0)+"123"+close,"different 123 text"),null);
const repeated="One "+open(0)+"5"+close+"; middle changed; Two "+open(1)+"5"+close+".";const remapped=alignLocatorPreview(repeated,"One 5; updated middle; Two 5.")!;assert.equal(clean(remapped),"One 5; updated middle; Two 5.");assert.ok(remapped.includes(open(0)+"5"+close));assert.ok(remapped.includes(open(1)+"5"+close));
async function run(){
 const runtime=process.env.ZOTERO_CITATIONS_DOM_TEST_RUNTIME;
 if(!runtime){console.log("Locator alignment tests passed; isolated DOM test requires ZOTERO_CITATIONS_DOM_TEST_RUNTIME.");return;}
 const require=createRequire(path.join(runtime,"package.json"));const {JSDOM}=require("jsdom"),MarkdownIt=require("markdown-it");const dom=new JSDOM("<!doctype html><body></body>");const saved=new Map<string,any>();for(const key of ["window","document","NodeFilter","HTMLElement"]){saved.set(key,(globalThis as any)[key]);(globalThis as any)[key]=dom.window[key];}
 const md=new MarkdownIt({linkify:true});(globalThis as any).__zoteroTestRender=(s:string)=>md.render(s);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"zotero-locator-link-"));
 try{
  fs.writeFileSync(path.join(temp,"note.csl"),`<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note"><info><title>Test</title><id>http://www.zotero.org/styles/note</id><updated>2026-10-04T00:00:00Z</updated></info><citation><layout suffix="."><group delimiter=", "><text variable="title" font-style="italic"/><text variable="page-first"/><text variable="locator"/><text variable="URL"/></group></layout></citation></style>`);
  const item:any={key:"JACOBID1",itemType:"journalArticle",title:"Ecosystems and Competition Law in Theory and Practice",pages:"1199–1229",URL:"https://doi.org/10.1093/icc/dtab061",creators:[]};
  CslEngine.refreshConfiguration(temp,"en-US",true);
  const original=CM.buildEndnoteDef("8",item,"note","p. 1199–1211")+" 自写注释。";const parsed=CM.parseEndnoteDefs(original)[0];const before=displayCitationBody(citationBody(original,"endnote"));CslEngine.refreshConfiguration(temp,"en-US",false);
  for(const cached of [false,true]){
   let fetched=0;const plugin:any={settings:{cslStyle:"note",language:"en"},getCached:()=>cached?item:undefined,fetchAndCache:async()=>{fetched++;return item;},api:{ping:async()=>true}};
   const preview=document.createElement("div");(preview as any).empty=()=>preview.replaceChildren();preview.innerHTML=md.render(before);document.body.append(preview);const text=preview.textContent;
   await mountLocatorEditor(preview,{app:{plugins:{plugins:{"zotero-citations":plugin}}},edit:{kind:"endnote",entries:parsed.entries,original,label:"8",from:0,to:original.length},getSourcePath:()=>"Codex插件测试/定位链接.md"},preview,{},()=>{});
   assert.equal(fetched,cached?0:1);assert.equal(preview.querySelectorAll(".zotero-locator-fallback").length,0);assert.equal(preview.querySelector(".zotero-locator-chip")?.textContent,"1199–1211");assert.equal(preview.textContent,text);assert.equal(preview.querySelector("a")?.getAttribute("href"),item.URL);assert.ok(preview.textContent?.includes("自写注释"));
   preview.querySelector(".zotero-locator-chip")!.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true}));assert.equal((preview.querySelector("input") as HTMLInputElement).value,"1199–1211");preview.remove();
  }
  // A failed lookup still uses a confirmed citation boundary, without changing text.
  const preview=document.createElement("div");(preview as any).empty=()=>preview.replaceChildren();preview.innerHTML=md.render(before);document.body.append(preview);
  const plugin:any={settings:{cslStyle:"note"},getCached:()=>undefined,fetchAndCache:async()=>{throw Error("offline");},api:{ping:async()=>false}};
  await mountLocatorEditor(preview,{app:{plugins:{plugins:{"zotero-citations":plugin}}},edit:{kind:"endnote",entries:parsed.entries,original,label:"8",from:0,to:original.length},getSourcePath:()=>"Codex插件测试/定位链接.md"},preview,{},()=>{});assert.equal(preview.querySelectorAll(".zotero-locator-fallback").length,0);assert.equal(preview.querySelector(".zotero-locator-chip")?.textContent,"1199–1211");assert.equal(preview.querySelector("a")?.getAttribute("href"),item.URL);preview.remove();
  console.log("Locator preview: cold cache, changed article URL setting, exact range alignment, DOI/comment preservation, repeated values and lookup failures passed.");
 }finally{delete (globalThis as any).__zoteroTestRender;for(const [key,value]of saved)(globalThis as any)[key]=value;dom.window.close();fs.rmSync(temp,{recursive:true,force:true});}
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
