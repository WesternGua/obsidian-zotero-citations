import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CitationManager, EngineUnavailableError } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import { ZoteroAPI, ZoteroItem } from "../src/ZoteroAPI";

const fixtureStyles = path.join(process.env.ZOTERO_CITATIONS_TEST_ROOT ?? "", "tests", "fixtures", "styles");
const title = "StereoWise: L.Speaker - Cessaro / StereoWise: Loudspeaker - C / Loudspeakers | StereoWise";
const url = "https://www.stereohifi.nl/loudspeakers/stereowise-loudspeaker-c/stereowise-l-speaker-cessaro";
const webpage: ZoteroItem = {
  key: "StereoWiseLSpeakerCessaro",
  itemType: "webpage",
  title,
  creators: [],
  accessed: "2026-7-20",
  URL: url,
  csl: {
    id: "StereoWiseLSpeakerCessaro",
    type: "webpage",
    "citation-key": "StereoWiseLSpeakerCessaro",
    language: "nl",
    title,
    "title-short": "StereoWise",
    URL: url,
    accessed: { "date-parts": [["2026", 7, 20]] },
  },
};

const article: ZoteroItem = {
  key: "ARTICLE1",
  itemType: "journalArticle",
  title: "A Test Article",
  creators: [{ firstName: "Jane", lastName: "Smith", creatorType: "author" }],
  date: "2024",
  publicationTitle: "Journal of Tests",
  volume: "12",
  issue: "3",
  pages: "45-67",
  csl: {
    id: "ARTICLE1",
    type: "article-journal",
    title: "A Test Article",
    author: [{ given: "Jane", family: "Smith" }],
    issued: { "date-parts": [[2024]] },
    "container-title": "Journal of Tests",
    volume: "12",
    issue: "3",
    page: "45-67",
  },
};

const book: ZoteroItem = {
  key: "BOOK1",
  itemType: "book",
  title: "Testing Citations",
  creators: [{ firstName: "Alice", lastName: "Brown", creatorType: "author" }],
  date: "2022",
  publisher: "Example Press",
  place: "London",
  csl: {
    id: "BOOK1",
    type: "book",
    title: "Testing Citations",
    author: [{ given: "Alice", family: "Brown" }],
    issued: { "date-parts": [[2022]] },
    publisher: "Example Press",
    "publisher-place": "London",
  },
};

// Issue #5: en-GB must match Zotero's quotation and punctuation rules exactly.
CslEngine.refreshConfiguration(fixtureStyles, "en-GB", false);
const expectedIssueEntry = `[1] ‘${title}’. Accessed: Jul. 20, 2026. [Online]. Available: ${url}`;
assert.equal(CslEngine.formatBibliography([webpage], "ieee")?.get(webpage.key), expectedIssueEntry);
assert.equal(CslEngine.formatNoteText(webpage, "ieee"), expectedIssueEntry.replace(/^\[1\]\s*/, ""));

const paperWithUrl: ZoteroItem = {
  ...article,
  URL: "https://example.com/article",
  csl: { ...(article.csl ?? {}), URL: "https://example.com/article" },
};
assert.equal("URL" in CslEngine.toCsl(paperWithUrl), false);
CslEngine.refreshConfiguration(fixtureStyles, "en-GB", true);
assert.equal(CslEngine.toCsl(paperWithUrl).URL, "https://example.com/article");
CslEngine.refreshConfiguration(fixtureStyles, "en-GB", false);

// A dependent style must use its installed parent and its own locale override.
assert.equal(CslEngine.canFormat("test-dependent-ieee"), true);
assert.equal(CslEngine.formatBibliography([webpage], "test-dependent-ieee")?.get(webpage.key), expectedIssueEntry);

// Zotero's bibliography order and numeric numbering must be preserved.
const apa = CslEngine.formatBibliographyOrdered([article, book], "apa");
assert.deepEqual(apa?.map((entry) => entry.key), ["BOOK1", "ARTICLE1"]);
const ieee = CslEngine.formatBibliographyOrdered([article, book], "ieee");
assert.match(ieee?.[0]?.text ?? "", /^\[1\]/);
assert.match(ieee?.[1]?.text ?? "", /^\[2\]/);

// A real citation cluster must number both items, instead of formatting each as [1].
const cluster = CslEngine.formatCitationCluster([{ item: article }, { item: book }], "ieee") ?? "";
assert.match(cluster, /\[1\]/);
assert.match(cluster, /\[2\]/);
const locatedNote = CslEngine.formatNoteText(article, "ieee", "p. 55") ?? "";
assert.match(locatedNote, /p\. 55/);
assert.doesNotMatch(locatedNote, /p\.\s*p\./);

// Group metadata must remain editable, while unlinking removes every hidden marker.
const grouped = CitationManager.buildInlineFootnoteGroup([{ item: article }, { item: book }], "ieee");
const parsed = CitationManager.parseInlineCitations(grouped);
assert.equal(parsed.length, 1);
assert.deepEqual(parsed[0].entries.map((entry) => entry.key), ["ARTICLE1", "BOOK1"]);
const editor = {
  value: grouped,
  getValue() { return this.value; },
  setValue(value: string) { this.value = value; },
} as any;
assert.equal(CitationManager.unlinkAll(editor), 1);
assert.doesNotMatch(editor.value, /<!--\s*zotero/);

// Zotero's installed directory is the only style list; no fallback names are added.
const api = new ZoteroAPI();
api.locateZoteroStylesDir = () => fixtureStyles;
const installed = api.getInstalledStyles();
assert.deepEqual(installed.map((style) => style.id).sort(), ["apa", "ieee", "test-dependent-ieee"]);
assert.equal(installed.some((style) => style.id === "vancouver"), false);
assert.equal(api.getInstalledStyle("apa")?.uri, "http://www.zotero.org/styles/apa");
assert.equal(api.getInstalledStyle("apa")?.isNoteStyle, false);
assert.equal(api.getInstalledStyle("apa")?.hasBibliography, true);
// Dependent styles inherit note/bibliography capabilities from the installed
// independent parent while keeping their own URI for Word document prefs.
assert.equal(api.getInstalledStyle("test-dependent-ieee")?.uri, "http://www.zotero.org/styles/test-dependent-ieee");
assert.equal(api.getInstalledStyle("test-dependent-ieee")?.hasBibliography, true);

// Installing and deleting a style must be visible without restarting Obsidian.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-csl-sync-"));
try {
  const temporaryIeee = path.join(temporary, "ieee.csl");
  fs.copyFileSync(path.join(fixtureStyles, "ieee.csl"), temporaryIeee);
  CslEngine.refreshConfiguration(temporary, "en-US", false);
  assert.equal(CslEngine.canFormat("ieee"), true);
  fs.unlinkSync(temporaryIeee);
  assert.equal(CslEngine.canFormat("ieee"), false);
  assert.throws(() => CitationManager.formatCitation(webpage, "ieee"), EngineUnavailableError);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("All CSL synchronization and formatting tests passed.");
