import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LOCATOR_TYPES, locatorOptions, parseLocator, serializeLocator } from "../src/Locator";
import { formatLocator } from "../src/ZoteroAPI";
import { CslEngine } from "../src/CslEngine";

const expected = ["Act", "Appendix", "Article", "Book", "Canon", "Chapter", "Column", "Equation", "Figure", "Folio", "Issue", "Line", "Location", "Note", "Opus", "Page", "Paragraph", "Part", "Rule", "Scene", "Section", "Sub verbo", "Table", "Timestamp", "Title", "Verse", "Volume"];
assert.deepEqual(locatorOptions("en-US").map(option => option.label), expected);
for (const [label] of LOCATOR_TYPES) {
  for (const value of ["5", "5-21", "iv", "01:23:45"]) {
    assert.deepEqual(parseLocator(serializeLocator({label, value})), {label, value});
    assert.deepEqual(parseLocator(formatLocator(value, label)), {label, value});
  }
}
assert.deepEqual(parseLocator("p.5"), {label:"page", value:"5"});
assert.deepEqual(parseLocator("para. 90"), {label:"paragraph", value:"90"});
assert.deepEqual(parseLocator("5-21"), {label:"page", value:"5-21"});
assert.equal(serializeLocator({label:"page", value:""}), "");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-compact-locator-"));
try {
  fs.writeFileSync(path.join(temp, "test-note.csl"), `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note">
    <info><title>Test locator mapping</title><id>http://www.zotero.org/styles/test-note</id><updated>2026-10-03T00:00:00Z</updated></info>
    <citation><layout delimiter="; " suffix="."><group delimiter=", "><text variable="title" font-style="italic"/><text variable="volume"/><text variable="page"/><date variable="issued"><date-part name="year"/></date><group delimiter=" "><label variable="locator" form="short"/><text variable="locator"/></group></group></layout></citation>
  </style>`);
  CslEngine.refreshConfiguration(temp,"en-US",false);
  const entries = ["A", "B"].map((key,index) => ({
    item: {key,itemType:"journalArticle",title:"Title "+(index ? "90" : "7"),creators:[],volume:"7",pages:"90",date:"2025"},
    page: index ? "para. 90" : "p. 7",
  }));
  const preview = CslEngine.formatLocatorPreview(entries,"test-note")!;
  assert.ok(preview);
  assert.equal(preview.plain,CslEngine.formatNoteCluster(entries,"test-note"));
  assert.match(preview.markdown,/\uE000zl:0\uE0017\uE000\/zl\uE001/);
  assert.match(preview.markdown,/\uE000zl:1\uE00190\uE000\/zl\uE001/);
  assert.equal((preview.markdown.match(/\uE000zl:/g)||[]).length,2);
  assert.match(preview.markdown,/7, 90, 2025/); // Volume/page/year remain ordinary text.
  const missing = CslEngine.formatLocatorPreview(entries.map(entry => ({...entry,page:undefined})),"test-note")!;
  assert.equal((missing.markdown.match(/\uE000zl:/g)||[]).length,0);
  assert.match(missing.markdown,/\uE000ze:0\uE001/);
  assert.match(missing.markdown,/\uE000ze:1\uE001/);
  for (const [label] of LOCATOR_TYPES) {
    assert.ok(CslEngine.formatNoteCluster([{...entries[0],page:serializeLocator({label,value:"5-21"})}],"test-note"), label);
  }
  const vendor = fs.readFileSync(path.join(process.env.ZOTERO_CITATIONS_TEST_ROOT || "", "src/vendor/zotero-live-citations.lua"), "utf8");
  const begin = vendor.indexOf('package.preload[ "locator" ]');
  const end = vendor.indexOf("return module\nend", begin) + "return module\nend".length;
  const cases = LOCATOR_TYPES.map(([label]) => {
    const value = label === "timestamp" ? "01:23:45" : "5-21";
    return [serializeLocator({label,value}),label,value];
  });
  const assertions = cases.map(([raw,label,value]) => `do local label, value, suffix = parse("${raw}"); assert(label == "${label}", "${label} type"); assert(value == "${value}", "${label} value: "..tostring(value)); assert(suffix == "", "${label} suffix") end`).join("\n");
  const filter = path.join(temp,"locator-test.lua");
  fs.writeFileSync(filter, `local lpeg = require("lpeg")
    package.preload["utils"] = function() return {trim=function(s) return (s or ""):match("^%s*(.-)%s*$") end} end
    ${vendor.slice(begin,end)}
    local parse = require("locator").parse
    ${assertions}
    return {}
  `);
  const lua = spawnSync("pandoc", ["--lua-filter",filter,"-t","plain"], {input:"Locator test",encoding:"utf8"});
  if ((lua.error as NodeJS.ErrnoException)?.code !== "ENOENT") assert.equal(lua.status,0,lua.stderr);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log("Compact locator menu, typed values, precise CSL markers and fallback tests passed.");
