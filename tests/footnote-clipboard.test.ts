import assert from "node:assert/strict";
import {
  clipboardPlainText, footnoteKey, parseFootnoteDocument, planFootnotePaste,
  prepareFootnoteCopy, readFootnoteClipboard, type FootnoteClipboardPayload, type TextEdit,
} from "../src/FootnoteClipboard";
import { CitationManager } from "../src/CitationManager";

function apply(text: string, edits: TextEdit[]): string {
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return text;
}
function copy(source: string, selection: string): FootnoteClipboardPayload {
  const from = source.indexOf(selection);
  assert.ok(from >= 0);
  const payload = prepareFootnoteCopy(source, from, from + selection.length);
  assert.ok(payload);
  return payload;
}
function paste(target: string, payload: FootnoteClipboardPayload, from = target.length, to = from): string {
  const plan = planFootnotePaste(target, from, to, payload);
  assert.ok(plan);
  const result = apply(target, plan.edits);
  assert.ok(plan.cursor <= result.length);
  return result;
}

const metadata = "<!-- zotero:ITEM_A:10 --> A; <!-- zotero:ITEM_B:20 --> B";
const source = `Alpha[^1] and again[^1], other[^named].\n\n[^1]: ${metadata}\n    continuation **bold** [link](https://example.com)\n\n    second paragraph\n\n[^named]: Ordinary note.\n\n[^unused]: Do not copy this.`;
const payload = copy(source, "Alpha[^1] and again[^1], other[^named].");
assert.equal(payload.definitions.length, 2);
assert.ok(payload.definitions[0].raw.includes("second paragraph"));
assert.ok(payload.definitions[0].raw.includes(metadata));
assert.ok(!clipboardPlainText(payload).includes("Do not copy this"));
assert.deepEqual(readFootnoteClipboard(JSON.stringify(payload), clipboardPlainText(payload)), payload);
assert.equal(readFootnoteClipboard("{broken", clipboardPlainText(payload)), null);
assert.equal(readFootnoteClipboard(JSON.stringify(payload), "unrelated clipboard"), null);

// Numeric collisions reserve both existing definitions and unresolved references.
const target = "Existing[^1], dangling[^7].\n\n[^1]: Different content.";
const result = paste(target, payload, "Existing".length);
assert.ok(result.startsWith("ExistingAlpha[^8] and again[^8], other[^named].[^1]"));
assert.match(result, /^\[\^1\]: Different content\.$/m);
assert.match(result, /^\[\^8\]: <!-- zotero:ITEM_A:10 -->/m);
assert.equal(parseFootnoteDocument(result).definitions.length, 3);
// Both Zotero entries survive transfer and remain visible to existing citation/export parsers.
assert.deepEqual(CitationManager.parseEndnoteDefs(result).find((def) => def.label === "8")?.entries.map((entry) => entry.key), ["ITEM_A", "ITEM_B"]);
assert.deepEqual(CitationManager.parseAllCitations(result).map((entry) => entry.page), ["10", "20"]);

// Repeated pastes and same-note copies reuse an exact definition, never duplicate it.
const once = paste("", payload);
const twice = paste(once, payload, 0);
assert.equal(parseFootnoteDocument(twice).definitions.length, 2);
const collidedOnce = paste(target, payload, 0);
const collidedTwice = paste(collidedOnce, payload, 0);
assert.equal(parseFootnoteDocument(collidedTwice).definitions.length, 3);
assert.ok(collidedTwice.startsWith("Alpha[^8] and again[^8]"));
const sameNote = paste(source, payload, 0);
assert.equal(parseFootnoteDocument(sameNote).definitions.length, 3);
assert.ok(sameNote.startsWith(payload.text));

// Named labels are matched without case ambiguity and renamed without touching code examples.
const named = copy("A[^Name].\n\n[^name]: New.", "A[^Name].");
const nameResult = paste("Old[^NAME].\n\n[^NAME]: Old.\n\n[^name-2]: Occupied.", named, 0);
assert.ok(nameResult.startsWith("A[^name-3]."));
assert.match(nameResult, /^\[\^name-3\]: New\.$/m);
const sameCase = paste("Old[^NAME].\n\n[^NAME]: New.", named, 0);
assert.ok(sameCase.startsWith("A[^NAME]."));
assert.equal(parseFootnoteDocument(sameCase).definitions.length, 1);

// Definitions explicitly selected are moved once, including unreferenced selected definitions.
const all = prepareFootnoteCopy(source, 0, source.length)!;
assert.ok(all);
assert.equal(all.definitions.length, 3);
assert.doesNotMatch(all.text, /^\[\^1\]:/m);
const allResult = paste("", all);
assert.equal(parseFootnoteDocument(allResult).definitions.length, 3);
assert.equal((allResult.match(/second paragraph/g) ?? []).length, 1);
const allFallback = readFootnoteClipboard("", clipboardPlainText(all))!;
assert.ok(allFallback);
assert.equal(parseFootnoteDocument(paste("", allFallback)).definitions.length, 3);

// Plain Markdown remains usable when a clipboard manager discards the custom MIME type.
const fallback = readFootnoteClipboard("", clipboardPlainText(payload));
assert.ok(fallback);
assert.equal(parseFootnoteDocument(paste(target, fallback, 0)).definitions.length, 3);
assert.equal(readFootnoteClipboard("", "Ordinary text."), null);
assert.equal(prepareFootnoteCopy("A[^missing].", 0, 12), null);
assert.equal(prepareFootnoteCopy(source, source.indexOf("[^1]:"), source.indexOf("[^1]:") + 10), null);
assert.equal(prepareFootnoteCopy(source, 0, 8), null); // incomplete [^1] marker

const examples = "---\nexample: '[^fake]'\n---\n`[^fake]` \\[^fake] <!-- [^fake] -->\n\n```md\nText[^fake].\n[^fake]: code\n```\n\n~~~\nText[^fake].\n~~~\n\n    Text[^fake].\n\nReal[^real].\n\n[^real]: actual\n\n`[^example]: inline code`";
const parsedExamples = parseFootnoteDocument(examples);
assert.deepEqual(parsedExamples.references.map((ref) => ref.label), ["real"]);
assert.deepEqual(parsedExamples.definitions.map((def) => def.label), ["real"]);
assert.equal(prepareFootnoteCopy(examples, 0, examples.indexOf("Real")), null);
assert.equal(prepareFootnoteCopy("A^[inline note].", 0, 16), null);
assert.equal(prepareFootnoteCopy("A^[<!-- zotero:ITEM_A:10 --> Citation].", 0, 39), null);

// References inside definitions are copied transitively, including circular references.
const nested = copy("Body[^a].\n\n[^a]: See[^b].\n[^b]: See[^a].", "Body[^a].");
assert.equal(nested.definitions.length, 2);
const nestedResult = paste("Old[^a].\n\n[^a]: Old.\n[^b]: Old too.", nested, 0);
assert.ok(nestedResult.startsWith("Body[^a-2]."));
assert.match(nestedResult, /^\[\^a-2\]: See\[\^b-2\]\.$/m);
assert.match(nestedResult, /^\[\^b-2\]: See\[\^a-2\]\.$/m);

// Bibliography stays after definitions and the insertion cursor stays after the body.
const bib = "Paragraph.\n\n<!-- zotero-bibliography-start -->\nReferences\n<!-- zotero-bibliography-end -->";
const bibPlan = planFootnotePaste(bib, 2, 2, payload)!;
const bibResult = apply(bib, bibPlan.edits);
assert.ok(bibResult.indexOf("[^1]:") < bibResult.indexOf("<!-- zotero-bibliography-start -->"));
assert.equal(bibPlan.cursor, 2 + payload.text.length);
const afterBibPlan = planFootnotePaste(bib, bib.length, bib.length, payload)!;
const afterBib = apply(bib, afterBibPlan.edits);
assert.equal(afterBib.slice(afterBibPlan.cursor - payload.text.length, afterBibPlan.cursor), payload.text);

// Selection replacement and EOF insertion are non-overlapping transactions.
const replacement = planFootnotePaste("before SELECT after", 7, 13, payload)!;
assert.ok(apply("before SELECT after", replacement.edits).startsWith("before " + payload.text + " after"));
const eof = planFootnotePaste("SELECT", 0, 6, payload)!;
assert.equal(eof.edits.length, 1);
assert.ok(apply("SELECT", eof.edits).startsWith(payload.text));
assert.equal(eof.cursor, payload.text.length);
assert.equal(planFootnotePaste(source, source.indexOf("second paragraph"), source.indexOf("second paragraph"), payload), null);
assert.equal(planFootnotePaste("```md\nexample\n```", 7, 7, payload), null);
assert.equal(planFootnotePaste("Inline `example`", 10, 10, payload), null);
assert.equal(planFootnotePaste("Body\n\n```md\nunclosed", 0, 0, payload), null);

// CRLF, indentation, links and metadata are retained as raw source text.
const crlf = "Line[^n].\r\n\r\n  [^n]: one\r\n\tcontinued\r\n\r\nEnd";
const crlfPayload = copy(crlf, "Line[^n].");
assert.equal(crlfPayload.definitions[0].raw, "  [^n]: one\r\n\tcontinued\r");
assert.ok(readFootnoteClipboard(JSON.stringify(crlfPayload), clipboardPlainText(crlfPayload).replace(/\r\n/g, "\n")));
assert.equal(footnoteKey(" Mixed  Label "), "mixed label");

console.log("Footnote clipboard parsing, metadata preservation, label conflicts, fallback and paste-plan tests passed.");
