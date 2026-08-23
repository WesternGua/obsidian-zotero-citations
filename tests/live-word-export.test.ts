import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDynamicBibliographyBlock,
  buildPandocCitation,
  buildZoteroDocumentPreferences,
  collectManagedItemKeys,
  ExportManager,
  transformManagedCitationsForPandoc,
} from "../src/ExportManager";
import { DEFAULT_SETTINGS } from "../src/settings";

const input = [
  "Inline ^[<!-- zotero:ITEM_A:p.%2010 --> Alpha; <!-- zotero:ITEM_B:para.%2032 --> Beta].",
  "In text ^[<!-- zotero-intext:ITEM_B: --> (Beta, 2024)].",
  "Endnote[^7].",
  "",
  "[^7]: <!-- zotero:ITEM_A:pp.%2020-22 --> Alpha endnote",
  "",
  "<!-- zotero-bibliography-start -->",
  "",
  "# References",
  "",
  "> Alpha",
  "",
  "<!-- zotero-bibliography-end -->",
].join("\n");

const keys = new Map([
  ["ITEM_A", "alpha2020"],
  ["ITEM_B", "beta2024"],
]);

assert.deepEqual(collectManagedItemKeys(input), ["ITEM_A", "ITEM_B"]);
assert.equal(
  buildPandocCitation([
    { key: "ITEM_A", page: "p. 10", formattedText: "Alpha" },
    { key: "ITEM_B", page: "para. 32", formattedText: "Beta" },
  ], keys),
  "[@alpha2020, p. 10; @beta2024, para. 32]",
);

const transformed = transformManagedCitationsForPandoc(input, keys);
assert.equal(transformed.citationCount, 4);
assert.equal(transformed.hasDynamicBibliography, true);
assert.match(transformed.content, /Inline \^\[\[@alpha2020, p\. 10; @beta2024, para\. 32\]\]\./);
assert.match(transformed.content, /In text \[@beta2024\]\./);
assert.match(transformed.content, /^\[\^7\]: \[@alpha2020, pp\. 20-22\]$/m);
assert.match(transformed.content, /ADDIN ZOTERO_BIBL/);
assert.doesNotMatch(transformed.content, /<!-- zotero:/);
assert.doesNotMatch(transformed.content, /^> Alpha$/m);

assert.throws(
  () => buildPandocCitation([{ key: "ITEM_A", page: "", formattedText: "" }], new Map()),
  /Missing Better BibTeX citation key/,
);
assert.throws(
  () => buildPandocCitation([{ key: "ITEM_A", page: "", formattedText: "" }], new Map([["ITEM_A", "bad key"]])),
  /Unsupported Better BibTeX citation key/,
);
assert.match(buildDynamicBibliographyBlock("Reference List"), /^# Reference List/m);
const docPrefs = buildZoteroDocumentPreferences({
  uri: "https://example.test/styles/note-style",
  isNoteStyle: true,
  hasBibliography: true,
}, "zh-CN", "SESSION1");
assert.ok(docPrefs.pref1.length <= 255);
assert.match(docPrefs.pref1 + docPrefs.pref2, /style id="https:\/\/example\.test\/styles\/note-style"/);
assert.match(docPrefs.pref1 + docPrefs.pref2, /locale="zh-CN"/);
assert.match(docPrefs.pref1 + docPrefs.pref2, /name="noteType" value="1"/);

async function runAsyncTests(): Promise<void> {
  // preparePandocInput must only write a transformed temporary copy and a local
  // filter. The source note must remain byte-for-byte unchanged.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-live-export-test-"));
  const sourcePath = path.join(tempDir, "source.md");
  await fs.writeFile(sourcePath, input, "utf8");
  const prepared = await ExportManager.preparePandocInput(
    sourcePath,
    {
      pingBBT: async () => true,
      getCitationKeys: async () => keys,
    },
    { ...DEFAULT_SETTINGS, cslStyle: "apa" },
  );
  assert.notEqual(prepared.path, sourcePath);
  assert.ok(prepared.filterPath);
  assert.equal(prepared.citationCount, 4);
  assert.ok(prepared.documentPreferences);
  assert.equal(await fs.readFile(sourcePath, "utf8"), input);
  assert.match(await fs.readFile(prepared.path, "utf8"), /@alpha2020/);
  assert.match(await fs.readFile(prepared.filterPath!, "utf8"), /ADDIN ZOTERO_ITEM CSL_CITATION/);
  await prepared.cleanup();
  await fs.rm(tempDir, { recursive: true, force: true });

  // Documents without managed citations retain the previous plain Pandoc path
  // and do not require Better BibTeX.
  const plainDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-plain-export-test-"));
  const plainPath = path.join(plainDir, "plain.md");
  await fs.writeFile(plainPath, "Plain Markdown", "utf8");
  const plain = await ExportManager.preparePandocInput(
    plainPath,
    {
      pingBBT: async () => false,
      getCitationKeys: async () => new Map(),
    },
    DEFAULT_SETTINGS,
  );
  assert.equal(plain.path, plainPath);
  assert.equal(plain.filterPath, null);
  assert.equal(plain.documentPreferences, null);
  await fs.rm(plainDir, { recursive: true, force: true });

  console.log("Live Zotero Word export tests passed.");
}

void runAsyncTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
