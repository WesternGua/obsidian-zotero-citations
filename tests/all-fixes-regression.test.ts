import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { EditorState } from "@codemirror/state";
import { CitationManager as CM, type CitationIssue } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import Plugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { CitationIssueNavigator, citationIssueField, setCitationIssues, rebaseCitationIssues, captureCitationIssueOrigin } from "../src/extensions/CitationIssues";
import { ExportManager } from "../src/ExportManager";

const root=process.env.ZOTERO_CITATIONS_TEST_ROOT!;
CslEngine.refreshConfiguration(path.join(root,"tests/fixtures/styles"),"en-US",false);
const items=new Map(["TESTONE1","TESTTWO2"].map((key,i)=>[key,{key,itemType:"book",title:"Regression Book "+i,creators:[],date:"2025"}]));
const entries=[...items.values()].map((item,i)=>({item,page:i?"para. 90":"p. 159–174, 191–195, 341–344"}));
const suffix=" 自写说明 **完整保留**。";
function editor(initial:string,cursor=0){
 let value=initial,anchor=cursor,head=cursor,scroll={left:0,top:400};
 const position=(n:number)=>{const a=value.slice(0,n).split("\n");return {line:a.length-1,ch:a.at(-1)!.length};};
 const offset=(p:any)=>value.split("\n").slice(0,p.line).reduce((n,l)=>n+l.length+1,0)+p.ch;
 const e:any={getValue:()=>value,setValue:(v:string)=>{value=v;anchor=head=0;},offsetToPos:position,posToOffset:offset,
 getCursor:(kind?:string)=>position(kind==="from"?Math.min(anchor,head):kind==="to"?Math.max(anchor,head):head),setCursor:(p:any)=>anchor=head=offset(p),
 setSelection:(a:any,b:any)=>{anchor=offset(a);head=offset(b);},getScrollInfo:()=>({...scroll}),scrollTo:(left:number,top:number)=>scroll={left,top},scrollIntoView:()=>{},focus:()=>{},
 replaceRange:(text:string,a:any,b:any=a)=>{const from=offset(a),to=offset(b);value=value.slice(0,from)+text+value.slice(to);},replaceSelection:(text:string)=>{const from=Math.min(anchor,head),to=Math.max(anchor,head);value=value.slice(0,from)+text+value.slice(to);}};
 return e;
}
function plugin(e:any){const p:any=Object.create(Plugin.prototype);p.settings={...DEFAULT_SETTINGS,cslStyle:"apa",citationMode:"endnote"};p.itemCache=new Map(items);p.ensureInstalledStyle=()=>true;p.saveSettings=async()=>{};p.refocusObsidianWindow=()=>{};p.api={getItemsByKeys:async()=>items};p.app={workspace:{getActiveFile:()=>({path:"Regression.md"}),getActiveViewOfType:()=>({editor:e})}};return p;}
function deferred(){let resolve:any;const promise=new Promise<any>(r=>resolve=r);return {resolve,promise};}
async function run(){
 for(const source of ["endnote","inline","intext"] as const)for(const target of ["endnote","inline","intext"] as const){
  if(source===target)continue;
  const built=source==="endnote"?CM.buildEndnoteDefGroup("1",entries,"apa"):source==="inline"?CM.buildInlineFootnoteGroup(entries,"apa"):CM.buildInTextCitationGroup(entries,"apa");
  const input=source==="endnote"?"Body[^1].\n\n"+built+suffix:built.slice(0,-1)+suffix+"]";
  const e=editor(input);assert.equal(CM.refreshDocument(e,items,"apa",target),2);assert.ok(e.getValue().includes(suffix));assert.deepEqual(CM.parseAllCitations(e.getValue()).map(c=>c.key).sort(),[...items.keys()].sort());
  const missing=editor(input);const issues:CitationIssue[]=[];CM.refreshDocument(missing,new Map([[entries[0].item.key,entries[0].item]]),"apa",target,items,i=>issues.push(i));assert.equal(missing.getValue(),input);assert.ok(issues.some(i=>i.reason==="missing"));
 }
 const multi="Body[^1].\n\n"+CM.buildEndnoteDefGroup("1",entries,"apa")+suffix+"\n\n    第二段说明。";
 for(const mode of ["inline","intext"] as const){const e=editor(multi);const issues:CitationIssue[]=[];assert.equal(CM.refreshDocument(e,items,"apa",mode,items,i=>issues.push(i)),0);assert.equal(e.getValue(),multi);assert.equal(issues[0].reason,"multiline");}
 for(const kind of ["inline","intext"] as const){const built=kind==="inline"?CM.buildInlineFootnoteGroup(entries,"apa"):CM.buildInTextCitationGroup(entries,"apa");for(const input of ["```md\n"+built+"\n```","`"+built+"`","<!-- "+built+" -->"]){const e=editor(input);assert.equal(kind==="inline"?CM.refreshInline(e,items,"ieee"):CM.refreshInText(e,items,"ieee"),0);assert.equal(e.getValue(),input);}}
 const good=CM.buildEndnoteDef("1",entries[0].item,"apa","p. 10")+suffix;
 const broken="[^bad-A]: <!-- zotero:TESTONE1:p.%ZZ --> Damaged A<!-- /zotero-citation --> 保留。";
 const missing="[^bad-B]: <!-- zotero:NOTFOUND:p.%2010 --> Missing B<!-- /zotero-citation --> 保留。";
 const input="Text[^1] [^bad-A] [^bad-B].\n\n"+good+"\n\n"+broken+"\n\n"+missing;
 const changed=new Map([...items].map(([key,item])=>[key,{...item,title:item.title+" updated with more text"}]));
 const e=editor(input,4);const issues:CitationIssue[]=[];
 assert.equal(CM.refreshEndnotes(e,changed,"apa",items,undefined,i=>issues.push(i)),1);assert.equal(issues.length,2);assert.deepEqual(issues.map(i=>i.reason).sort(),["encoding","missing"]);assert.ok(e.getValue().includes(broken));assert.ok(e.getValue().includes(missing));assert.ok(e.getValue().includes(CM.buildEndnoteDef("1",changed.get("TESTONE1")!,"apa","p. 10")));
 assert.ok(CM.isInsideEndnoteRef(input,input.indexOf("[^bad-A]")+3));
 const rebased=rebaseCitationIssues(e.getValue(),issues);assert.equal(rebased[0].from,e.getValue().indexOf(broken));assert.equal(rebased[1].from,e.getValue().indexOf(missing));
 let state=EditorState.create({doc:e.getValue(),extensions:[citationIssueField]});state=state.update({effects:setCitationIssues.of(rebased)}).state;
 assert.equal(state.field(citationIssueField).decorations.size,2);state=state.update({changes:{from:0,insert:"new body\n"}}).state;assert.equal(state.field(citationIssueField).issues[0].from,rebased[0].from+9);assert.equal(state.field(citationIssueField).decorations.size,2);
 const refreshInput="Text[^1] [^2].\n\n"+good+"\n\n"+CM.buildEndnoteDef("2",entries[1].item,"apa","para. 90")+suffix;
 const refreshEditor=editor(refreshInput,4);const refreshPlugin=plugin(refreshEditor);refreshPlugin.api.getItemsByKeys=async()=>new Map([["TESTONE1",changed.get("TESTONE1")!]]);let reported:CitationIssue[]=[];
 refreshPlugin.showCitationIssues=(_editor:any,issues:CitationIssue[],count:number)=>{reported=issues;assert.equal(count,1);};await refreshPlugin.refreshAll(refreshEditor);assert.equal(reported.length,1);assert.equal(reported[0].reason,"missing");assert.ok(refreshEditor.getValue().includes(CM.buildEndnoteDef("2",entries[1].item,"apa","para. 90")+suffix));
 const legacy="Text[^1].\n\n"+CM.buildEndnoteDef("1",entries[0].item,"apa","p. 10").replace("<!-- /zotero-citation -->","")+suffix;
 const oldEditor=editor(legacy,6);const p=plugin(oldEditor);p.api.openCAYW=async()=>[{item:entries[1].item,locator:"90",locatorLabel:"paragraph"}];await p.insertOrEditCitation(oldEditor);assert.ok(oldEditor.getValue().includes("TESTTWO2"));assert.ok(oldEditor.getValue().endsWith(suffix));
 const concurrent=editor(legacy,6);const q=plugin(concurrent),d=deferred();q.api.openCAYW=()=>d.promise;const pending=q.insertOrEditCitation(concurrent);concurrent.setValue("typed during picker\n"+legacy);d.resolve([{item:entries[1].item,locator:"5",locatorLabel:"page"}]);await pending;assert.equal(concurrent.getValue(),"typed during picker\n"+legacy);
 const switched=editor(legacy,6);const r=plugin(switched),next=deferred();let active="Regression.md";r.app.workspace.getActiveFile=()=>({path:active});r.api.openCAYW=()=>next.promise;const wait=r.insertOrEditCitation(switched);active="Other.md";next.resolve([{item:entries[1].item,locator:"5",locatorLabel:"page"}]);await wait;assert.equal(switched.getValue(),legacy);
 const stale=editor(good);const parsed=CM.parseEndnoteDefs(good)[0];stale.setValue("changed\n"+good);assert.throws(()=>CM.replaceEndnoteDefGroup(stale,parsed,[entries[1]],"apa",items));assert.equal(stale.getValue(),"changed\n"+good);
 assert.equal(fs.existsSync(path.join(root,"src/modals/SearchModal.ts")),false);assert.ok(!fs.readFileSync(path.join(root,"src/main.ts"),"utf8").includes("openSearchFallback"));
 const exportDir=fs.mkdtempSync(path.join(os.tmpdir(),"zotero-port-regression-"));
 try{
  const filename=path.join(exportDir,"test.md");fs.writeFileSync(filename,"Text[^1].\n\n"+good);
  const resolver:any={pingBBT:async()=>true,getItemsByKeys:async()=>items,getCitationKeys:async()=>new Map([["TESTONE1","one"]]),getInstalledStyle:()=>({uri:"http://www.zotero.org/styles/apa",isNoteStyle:false,hasBibliography:true})};
  for(const port of [23119,23120,65535]){const prepared=await ExportManager.preparePandocInput(filename,resolver,{...DEFAULT_SETTINGS,cslStyle:"apa",zoteroPort:port});try{assert.ok(fs.readFileSync(prepared.filterPath!,"utf8").includes("127.0.0.1:"+port));}finally{await prepared.cleanup();}}
  for(const port of [0,-1,65536,1.5,NaN])await assert.rejects(()=>ExportManager.preparePandocInput(filename,resolver,{...DEFAULT_SETTINGS,cslStyle:"apa",zoteroPort:port}));
  assert.equal(fs.readFileSync(filename,"utf8"),"Text[^1].\n\n"+good);
 }finally{fs.rmSync(exportDir,{recursive:true,force:true});}
 const runtime=process.env.ZOTERO_CITATIONS_DOM_TEST_RUNTIME;
 if(runtime){
  const require=createRequire(path.join(runtime,"package.json"));const {JSDOM}=require("jsdom");const dom=new JSDOM('<!doctype html><body><div id="other-plugin">untouched</div></body>');const oldDocument=(globalThis as any).document;(globalThis as any).document=dom.window.document;
  try{
   e.setCursor(e.offsetToPos(4));const origin=captureCitationIssueOrigin(e);const app:any={workspace:{getActiveFile:()=>({path:active}),getActiveViewOfType:()=>({editor:e})}};active="Regression.md";
   const navigator=new CitationIssueNavigator(app,e,issues,1,origin);assert.equal(e.posToOffset(e.getCursor("from")),rebased[0].from);assert.equal(dom.window.document.querySelectorAll(".zotero-citation-issues-list button").length,2);
   navigator.jump(1);assert.equal(e.posToOffset(e.getCursor("from")),rebased[1].from);navigator.jump(2);assert.equal(e.posToOffset(e.getCursor("from")),rebased[0].from);navigator.jump(-1);assert.equal(e.posToOffset(e.getCursor("from")),rebased[1].from);
   navigator.returnToOrigin();assert.deepEqual(e.getCursor("from"),origin.from);assert.deepEqual(e.getScrollInfo(),origin.scroll);
   const before=e.getCursor();active="Other.md";navigator.jump(0);assert.deepEqual(e.getCursor(),before);navigator.dispose();assert.equal(dom.window.document.querySelector(".zotero-citation-issues-panel"),null);assert.equal(dom.window.document.getElementById("other-plugin").textContent,"untouched");
  }finally{(globalThis as any).document=oldDocument;dom.window.close();}
 }
 console.log("0.3.0 grouped conversions, missing/corrupt item isolation, issue highlighting/navigation, code masking, legacy replacement, concurrent edits, tab changes and removed fallback tests passed.");
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
