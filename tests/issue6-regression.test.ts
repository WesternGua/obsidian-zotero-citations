import assert from "node:assert/strict";
import path from "node:path";
import { CitationManager, EditorPosition, MinimalEditor } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import { ZoteroItem } from "../src/ZoteroAPI";

class MemoryEditor implements MinimalEditor {
  constructor(private value: string, private cursor: number) {}

  getValue(): string {
    return this.value;
  }

  setValue(content: string): void {
    this.value = content;
  }

  replaceSelection(text: string): void {
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
  }

  replaceRange(text: string, from: EditorPosition, to: EditorPosition = from): void {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    if (start <= this.cursor) this.cursor += text.length - (end - start);
  }

  offsetToPos(offset: number): EditorPosition {
    const lines = this.value.slice(0, offset).split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  }

  getCursor(): EditorPosition {
    return this.offsetToPos(this.cursor);
  }

  posToOffset(pos: EditorPosition): number {
    return this.value
      .split("\n")
      .slice(0, pos.line)
      .reduce((total, line) => total + line.length + 1, 0) + pos.ch;
  }
}

const fixtureStyles = path.join(
  process.env.ZOTERO_CITATIONS_TEST_ROOT ?? "",
  "tests",
  "fixtures",
  "styles",
);
CslEngine.refreshConfiguration(fixtureStyles, "en-US", false);

const itemA: ZoteroItem = {
  key: "ITEM_A",
  itemType: "book",
  title: "Book A",
  creators: [],
  csl: { id: "ITEM_A", type: "book", title: "Book A" },
};
const itemB: ZoteroItem = {
  key: "ITEM_B",
  itemType: "book",
  title: "Book B",
  creators: [],
  csl: { id: "ITEM_B", type: "book", title: "Book B" },
};

const base = "Alpha[^1] omega\n\n[^1]: <!-- zotero:ITEM_A:10 --> old citation";
const refStart = base.indexOf("[^1]");
const refEnd = refStart + "[^1]".length;

// A cursor immediately before or after the marker inserts a new reference;
// only a cursor strictly inside the marker edits the existing definition.
assert.equal(CitationManager.isInsideEndnoteRef(base, refStart), null);
assert.equal(CitationManager.isInsideEndnoteRef(base, refEnd), null);
assert.equal(CitationManager.isInsideEndnoteRef(base, refStart + 1)?.label, "1");

// Identical item and locator reuse the existing definition.
const sameCitation = new MemoryEditor(base, refEnd);
CitationManager.insertEndnoteGroup(sameCitation, [{ item: itemA, page: "10" }], "ieee");
assert.match(sameCitation.getValue(), /^Alpha\[\^1\]\[\^1\] omega/m);
assert.equal((sameCitation.getValue().match(/^\[\^1\]:/gm) ?? []).length, 1);
assert.doesNotMatch(sameCitation.getValue(), /\[\^2\]/);

// A different item creates a new definition without overwriting the old one.
const differentItem = new MemoryEditor(base, refEnd);
CitationManager.insertEndnoteGroup(differentItem, [{ item: itemB, page: "10" }], "ieee");
assert.match(differentItem.getValue(), /^Alpha\[\^1\]\[\^2\] omega/m);
assert.match(differentItem.getValue(), /^\[\^1\]: <!-- zotero:ITEM_A:10 --> old citation$/m);
assert.match(differentItem.getValue(), /^\[\^2\]: <!-- zotero:ITEM_B:10 -->/m);

// The same item with a different locator remains a distinct citation.
const differentLocator = new MemoryEditor(base, refEnd);
CitationManager.insertEndnoteGroup(differentLocator, [{ item: itemA, page: "11" }], "ieee");
assert.match(differentLocator.getValue(), /^Alpha\[\^1\]\[\^2\] omega/m);
assert.match(differentLocator.getValue(), /^\[\^2\]: <!-- zotero:ITEM_A:11 -->/m);

// Grouped citations are reused only when every item and locator matches in order.
const groupedBase =
  "Alpha[^7] omega\n\n[^7]: <!-- zotero:ITEM_A:10 --> A; <!-- zotero:ITEM_B:20 --> B";
const grouped = new MemoryEditor(groupedBase, groupedBase.indexOf("[^7]") + "[^7]".length);
CitationManager.insertEndnoteGroup(
  grouped,
  [{ item: itemA, page: "10" }, { item: itemB, page: "20" }],
  "ieee",
);
assert.match(grouped.getValue(), /^Alpha\[\^7\]\[\^7\] omega/m);
assert.doesNotMatch(grouped.getValue(), /\[\^8\]/);

// A formatting failure must not leave a dangling endnote marker behind.
const failedInsertion = new MemoryEditor("Alpha", "Alpha".length);
assert.throws(() =>
  CitationManager.insertEndnoteGroup(failedInsertion, [{ item: itemA }], "missing-style")
);
assert.equal(failedInsertion.getValue(), "Alpha");

console.log("Issue #6 endnote regression tests passed.");
