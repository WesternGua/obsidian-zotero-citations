import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { CitationManager as CM } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import { readingFootnoteDoubleClick } from "../src/extensions/FootnoteNavigation";
// @ts-ignore esbuild test-only module
import { mountLocatorEditor } from "test-footnote-extension";

async function run() {
 const runtime=process.env.ZOTERO_CITATIONS_DOM_TEST_RUNTIME;
 if (!runtime) { console.log("Isolated DOM tests skipped: set ZOTERO_CITATIONS_DOM_TEST_RUNTIME to a directory containing jsdom and markdown-it.");return; }
 const require=createRequire(path.join(runtime,"package.json"));
 const {JSDOM}=require("jsdom");const MarkdownIt=require("markdown-it");
 const dom=new JSDOM("<!doctype html><body></body>");
 const saved=new Map<string,any>();
 for (const key of ["window","document","NodeFilter","HTMLElement"]) { saved.set(key,(globalThis as any)[key]);(globalThis as any)[key]=dom.window[key]; }
 const md=new MarkdownIt();(globalThis as any).__zoteroTestRender=(markdown:string)=>md.render(markdown);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"zotero-isolated-ui-"));
 try {
  fs.writeFileSync(path.join(temp,"test-note.csl"),`<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note"><info><title>Isolated</title><id>http://www.zotero.org/styles/test-note</id><updated>2026-10-03T00:00:00Z</updated></info><citation><layout suffix="."><group delimiter=", "><text variable="title" font-style="italic"/><text variable="locator"/></group></layout></citation></style>`);
  CslEngine.refreshConfiguration(temp,"en-US",false);
  const item={key:"TESTONE1",itemType:"book",title:"Test title 10",creators:[]};
  const range="159–174, 191–195, 341–344";
  for (const suffix of [""," 自写注释 2025，页码 10。\n\n    第二段。"]){
   for (const legacy of [false,true]) {
    const original=CM.buildEndnoteDef("2",item,"test-note","para. "+range).replace(legacy?"<!-- /zotero-citation -->":"NEVER_MATCH","")+suffix;
    const parsed=CM.parseEndnoteDefs(original)[0];
    const plugin:any={settings:{cslStyle:"test-note",language:"en"},getCached:()=>item,api:{ping:async()=>true}};
    const app:any={plugins:{plugins:{"zotero-citations":plugin}}};
    const preview=dom.window.document.createElement("div");preview.empty=()=>preview.replaceChildren();dom.window.document.body.append(preview);
    const edit={kind:"endnote",entries:parsed.entries,original,label:"2",from:0,to:original.length};
    await mountLocatorEditor(preview,{app,edit,getSourcePath:()=>"Codex插件测试/Zotero Citations 回归测试.md"},preview,{},()=>{});
    const chips=preview.querySelectorAll(".zotero-locator-chip");assert.equal(chips.length,1);const chip=chips[0];
    assert.equal(chip.textContent,range);assert.equal(chip.classList.contains("zotero-locator-fallback"),false);
    assert.ok(chip.closest("p"));assert.ok(preview.textContent.includes("Test title 10"));if(suffix)assert.ok(preview.textContent.includes("自写注释"));
    chip.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true}));
    const input=chip.querySelector("input");const select=chip.querySelector("select");
    assert.equal(input.value,range);assert.equal(select.value,"paragraph");assert.equal(select.options.length,27);
    assert.equal(input.style.width,(range.length+2)+"ch");
    input.value=range+", 401–499, 501–599";input.dispatchEvent(new dom.window.Event("input"));assert.equal(input.style.width,(input.value.length+2)+"ch");
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));assert.equal(chip.textContent,range);assert.equal(chip.querySelector("input"),null);
    preview.remove();
   }
  }
  const pane=dom.window.document.createElement("div");pane.className="markdown-reading-view";
  pane.innerHTML='<p><a class="footnote-ref" href="#fn-1">1</a> <a class="footnote-ref" href="#fn-1">1</a></p><ol><li id="fn-1"><span class="zotero-footnote-definition-number">1</span> Text</li></ol>';
  dom.window.document.body.append(pane);const refs=pane.querySelectorAll("a");const def=pane.querySelector("li");let destination:any;
  for(const el of [refs[0],refs[1],def])el.scrollIntoView=()=>{destination=el;};
  for(const el of [refs[1],def.querySelector("span")])el.addEventListener("dblclick",readingFootnoteDoubleClick);
  refs[1].dispatchEvent(new dom.window.MouseEvent("dblclick",{bubbles:true,cancelable:true}));assert.equal(destination,def);
  def.querySelector("span").dispatchEvent(new dom.window.MouseEvent("dblclick",{bubbles:true,cancelable:true}));assert.equal(destination,refs[1]);
  console.log("Isolated DOM: annotated and legacy multi-range inline chips, growing input, cancellation and reading-mode return navigation passed.");
 } finally {fs.rmSync(temp,{recursive:true,force:true});delete (globalThis as any).__zoteroTestRender;for(const [key,value]of saved)(globalThis as any)[key]=value;dom.window.close();}
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
