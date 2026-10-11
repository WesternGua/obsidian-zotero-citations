import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {CitationManager as CM} from "../src/CitationManager";
import {CslEngine} from "../src/CslEngine";
import {citationBody,displayCitationBody,resolveCitationContent} from "../src/CitationContent";
// @ts-ignore private test-only exports
import {mountLocatorEditor,showRenderedPopover,destroyActivePopover} from "test-footnote-extension";
async function run(){
 const runtime=process.env.ZOTERO_CITATIONS_DOM_TEST_RUNTIME;
 if(!runtime){console.log("Hover commentary DOM tests require ZOTERO_CITATIONS_DOM_TEST_RUNTIME.");return;}
 const req=createRequire(path.join(runtime,"package.json"));const {JSDOM}=req("jsdom"),MarkdownIt=req("markdown-it");const dom=new JSDOM('<!doctype html><body><div id="other-plugin">Other plugin untouched</div></body>');
 const saved=new Map<string,any>();for(const key of ["window","document","NodeFilter","HTMLElement"]){saved.set(key,(globalThis as any)[key]);(globalThis as any)[key]=dom.window[key];}
 const md=new MarkdownIt({linkify:true});(globalThis as any).__zoteroTestRender=(s:string)=>md.render(s);
 const proto=dom.window.HTMLElement.prototype;proto.empty=function(){this.replaceChildren();};proto.setText=function(s:string){this.textContent=s;};proto.addClass=function(s:string){this.classList.add(s);};proto.createDiv=function(opts:any={}){const el=this.ownerDocument.createElement("div");if(opts.cls)el.className=opts.cls;for(const [key,val]of Object.entries(opts.attr||{}))el.setAttribute(key,val);this.append(el);return el;};
 dom.window.requestAnimationFrame=(cb:any)=>dom.window.setTimeout(()=>cb(0),0);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"zotero-hover-comment-"));const oldInstalled=CslEngine.installedStyleIds,oldPreview=CslEngine.formatLocatorPreview;
 try{
  fs.writeFileSync(path.join(temp,"note.csl"),`<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note"><info><title>Test</title><id>http://www.zotero.org/styles/note</id><updated>2026-10-05T00:00:00Z</updated></info><citation><layout suffix="."><group delimiter=", "><text variable="title" font-style="italic"/><text variable="locator"/></group></layout></citation></style>`);
  CslEngine.refreshConfiguration(temp,"en-US",false);const item={key:"STYLIAN1",itemType:"journalArticle",title:"Market definition in ecosystems",creators:[]};
  const citation='Konstantinos Stylianou and Bruno Carballa-Smichowski, *Journal of Antitrust Enforcement*, 14(2), July 2026, pp. 179–213, DOI 10.1093/jaenfo/jnae046。';
  const tail='参见第2节、第3节、第4节及第5节。第7—8页 **自写注释**。全文 https://example.org/article 。\n\n    第二段注释。';
  const original='[^eco-stylianou]: <!-- zotero:STYLIAN1:sec.%202-5 -->\n    '+citation+' <!-- /zotero-citation -->'+tail;
  const parsed=CM.parseEndnoteDefs(original)[0];assert.equal(parsed.entries[0].page,"sec. 2-5");
  let scans=0,formats=0;CslEngine.installedStyleIds=()=>{scans++;throw Error("Hover must never scan other styles");};CslEngine.formatLocatorPreview=(...args:any[])=>{formats++;return (oldPreview as any).apply(CslEngine,args);};
  const plugin:any={settings:{cslStyle:"note"},getCached:()=>item,api:{ping:async()=>true}};const app:any={plugins:{plugins:{"zotero-citations":plugin}}};
  const spec:any={app,edit:{kind:"endnote",entries:parsed.entries,original,label:parsed.label,from:0,to:original.length},getSourcePath:()=>"Codex test/comment.md",markdown:displayCitationBody(citationBody(original,"endnote")),fallbackText:"Footnote visible immediately"};
  const preview=document.createElement("div");preview.innerHTML=md.render(spec.markdown);document.body.append(preview);await mountLocatorEditor(preview,spec,preview,{},()=>{});
  assert.equal(scans,0);assert.equal(formats,1);assert.equal(preview.querySelectorAll(".zotero-locator-fallback").length,0);
  const chip=preview.querySelector(".zotero-locator-chip")!;assert.equal(chip.textContent,"2-5");assert.ok(chip.closest("p"));assert.ok(preview.textContent!.indexOf("2-5")<preview.textContent!.indexOf("参见第2节"));assert.ok(preview.textContent!.includes("pp. 179–213"));assert.ok(preview.textContent!.includes("第二段注释"));assert.equal(preview.querySelector("a")?.getAttribute("href"),"https://example.org/article");
  const copy=preview.cloneNode(true) as HTMLElement;copy.querySelector(".zotero-locator-chip")!.remove();assert.ok(copy.textContent!.includes(citation.replace(/\*/g,"")));assert.equal(copy.textContent!.includes("2-5"),false);
  chip.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true}));assert.equal((chip.querySelector("select") as HTMLSelectElement).value,"section");assert.equal((chip.querySelector("input") as HTMLInputElement).value,"2-5");
  (chip.querySelector("input") as HTMLInputElement).dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));preview.remove();
  // Even a legacy preview must only check the selected style, without a global scan.
  const built=CM.buildEndnoteDef("3",item,"note","sec. 2-5").replace("<!-- /zotero-citation -->","")+" Note.";const legacy=CM.parseEndnoteDefs(built)[0];assert.ok(resolveCitationContent(citationBody(built,"endnote"),legacy.entries,new Map([[item.key,item]]),"note",false,false).safe);assert.equal(scans,0);
  // The popup exists synchronously; formatting starts only after Markdown completes.
  let finish:any;const waiting=new Promise<string>(resolve=>finish=resolve);let renders=0;(globalThis as any).__zoteroTestRender=(s:string)=>++renders===1?waiting:md.render(s);formats=0;const target=document.createElement("sup");target.textContent="1";document.body.append(target);
  showRenderedPopover(target,spec);const popup=document.querySelector(".zotero-footnote-popover")!;assert.ok(popup);assert.equal(popup.textContent,"Footnote visible immediately");assert.equal(formats,0);
  finish(md.render(spec.markdown));for(let i=0;i<30&&!popup.querySelector(".zotero-locator-chip");i++)await new Promise(r=>setTimeout(r,10));assert.equal(popup.querySelector(".zotero-locator-chip")?.textContent,"2-5");assert.equal(scans,0);destroyActivePopover();target.remove();assert.equal(document.querySelector(".zotero-footnote-popover"),null);assert.equal(document.getElementById("other-plugin")!.textContent,"Other plugin untouched");
  console.log("Hover: no exhaustive style scan, immediate popup, section control before commentary, multiline/DOI/link preservation and legacy fast path passed.");
 }finally{destroyActivePopover();CslEngine.installedStyleIds=oldInstalled;CslEngine.formatLocatorPreview=oldPreview;delete (globalThis as any).__zoteroTestRender;for(const [key,val]of saved)(globalThis as any)[key]=val;dom.window.close();fs.rmSync(temp,{recursive:true,force:true});}
}
void run().catch(e=>{console.error(e);process.exitCode=1;});
