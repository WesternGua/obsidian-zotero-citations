import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CitationManager as CM } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import { CITATION_END, citationBody, resolveCitationContent, visibleCitation } from "../src/CitationContent";
import { transformManagedCitationsForPandoc } from "../src/ExportManager";

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"zotero-commentary-"));
try {
  for (const id of ["old-note","new-note"]) fs.writeFileSync(path.join(temp,id+".csl"),`<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note"><info><title>${id}</title><id>http://www.zotero.org/styles/${id}</id><updated>2026-10-03T00:00:00Z</updated></info><citation><layout delimiter="; " suffix="."><group delimiter=", "><text value="${id}"/><text variable="title" font-style="italic"/><text variable="locator"/></group></layout></citation></style>`);
  CslEngine.refreshConfiguration(temp,"en-US",false);
  const oldItems=new Map(["ITEMONE1","ITEMTWO2"].map((key,i)=>[key,{key,itemType:"book",title:"Original "+i,creators:[]} ]));
  const newItems=new Map([...oldItems].map(([key,item])=>[key,{...item,title:item.title+" updated"}]));
  const entries=[...oldItems.values()].map((item,i)=>({item,page:i?"para. 90":"p. 159–174, 191–195, 341–344"}));
  const annotation=' 自写注释 **保留格式**，年份 2025，页码 10。\n\n    第二段注释与 [链接](https://example.org)。';
  const original=CM.buildEndnoteDefGroup("2",entries,"old-note");
  assert.ok(original.includes(CITATION_END));
  assert.equal(visibleCitation(citationBody(original+annotation,"endnote")),visibleCitation(citationBody(original,"endnote"))+annotation);
  function editor(value:string) {return {getValue:()=>value,setValue:(next:string)=>{value=next;}} as any;}
  const ed=editor("正文[^2]。\n\n"+original+annotation+"\n\n结尾正文。");
  assert.equal(CM.refreshEndnotes(ed,newItems,"new-note",oldItems),2);
  assert.ok(ed.getValue().includes("updated"));
  assert.ok(ed.getValue().includes(CITATION_END+annotation));
  assert.ok(ed.getValue().endsWith("结尾正文。"));
  const once=ed.getValue(); CM.refreshEndnotes(ed,newItems,"new-note"); assert.equal(ed.getValue(),once);
  const legacy=original.replace(CITATION_END,"")+annotation;
  const parsed=CM.parseEndnoteDefs(legacy)[0];
  const parts=resolveCitationContent(citationBody(parsed.fullMatch,"endnote"),parsed.entries,oldItems,"new-note");
  assert.equal(parts.safe,true);assert.equal(parts.style,"old-note");assert.equal(parts.suffix,annotation);
  const legacyEditor=editor("正文[^2]。\n\n"+legacy);
  assert.equal(CM.refreshEndnotes(legacyEditor,newItems,"new-note",oldItems),2);
  assert.ok(legacyEditor.getValue().includes(CITATION_END+annotation));
  const replacement=CM.buildEndnoteDefGroup("2",entries.map(e=>({...e,page:"p. 5-21"})),"new-note");
  const edited=CM.rebuildPreservingCommentary(original+annotation,parsed.entries,replacement,oldItems,"new-note","endnote");
  assert.ok(edited.endsWith(annotation));assert.deepEqual(CM.parseEndnoteDefs(edited)[0].entries.map(e=>e.page),["p. 5-21","p. 5-21"]);
  const unsafe=editor('[^7]: <!-- zotero:ITEMONE1:p.%2010 --> Unrecognizable edited citation. 自写内容。');
  const before=unsafe.getValue();let skipped=0;
  assert.equal(CM.refreshEndnotes(unsafe,newItems,"new-note",oldItems,()=>skipped++),0);assert.equal(skipped,1);assert.equal(unsafe.getValue(),before);
  const orphan=editor(original+annotation);assert.equal(CM.removeUnreferencedEndnotes(orphan),0);assert.equal(orphan.getValue(),original+annotation);
  for (const kind of ["inline","intext"] as const) {
    const built=kind==="inline"?CM.buildInlineFootnoteGroup(entries,"old-note"):CM.buildInTextCitationGroup(entries,"old-note");
    const annotated=built.slice(0,-1)+" 自写注释"+"]";
    const e=editor(annotated);
    assert.equal(kind==="inline"?CM.refreshInline(e,newItems,"new-note",oldItems):CM.refreshInText(e,newItems,"new-note",oldItems),2);
    assert.ok(e.getValue().endsWith(CITATION_END+" 自写注释]"));
  }
  const exported=transformManagedCitationsForPandoc("正文[^2]。\n\n"+original+annotation,new Map([["ITEMONE1","key-one"],["ITEMTWO2","key-two"]]));
  assert.ok(exported.content.includes(annotation));assert.ok(exported.content.includes("@key-one"));assert.ok(exported.content.includes("@key-two"));assert.ok(!exported.content.includes(CITATION_END));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
console.log("Commentary migration, refresh, group locator edits, multiline preservation and Word export tests passed.");
