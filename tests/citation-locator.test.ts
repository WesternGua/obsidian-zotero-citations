import assert from "node:assert/strict";
import path from "node:path";
import { CitationManager } from "../src/CitationManager";
import { CslEngine } from "../src/CslEngine";
import { buildLocatorReplacement } from "../src/CitationLocator";
// Private app integration is exposed only in the test bundle.
// @ts-ignore test-only esbuild module
import { applyLocatorEdit } from "test-footnote-extension";

async function run() {
  CslEngine.refreshConfiguration(path.join(process.env.ZOTERO_CITATIONS_TEST_ROOT ?? "", "tests/fixtures/styles"), "en-US", false);
  const items = new Map(["BOOKONE", "BOOKTWO"].map((key, index) => [key, {
    key, itemType: "book", title: "Book " + (index + 1), creators: [],
    csl: { id: key, type: "book", title: "Book " + (index + 1) },
  }]));
  const entries = ["BOOKONE", "BOOKTWO"].map(key => ({ key, page: "", formattedText: "" }));
  for (const kind of ["inline", "endnote", "intext"] as const) {
    for (const locators of [["p. 5", "para. 7"], ["", "p. 12"], ["p. 6", ""], ["", ""]]) {
      const result = buildLocatorReplacement(kind, "17", entries, locators, items, "apa");
      const parsed = CitationManager.parseZoteroEntries(result, kind === "intext" ? "zotero-intext" : "zotero");
      assert.deepEqual(parsed.map(e => [e.key, e.page]), entries.map((e, i) => [e.key, locators[i]]));
      if (kind !== "intext") {
        assert.match(result, /Book 1/);
        assert.match(result, /Book 2/);
        for (const locator of locators.filter(Boolean)) assert.match(result, new RegExp(locator.match(/\d+/)![0]));
      }
    }
  }
  const duplicates = [entries[0], entries[0]];
  assert.deepEqual(CitationManager.parseZoteroEntries(buildLocatorReplacement("endnote", "17", duplicates, ["p. 5", "p. 9"], items, "apa")).map(e => e.page), ["p. 5", "p. 9"]);
  assert.throws(() => buildLocatorReplacement("endnote", "17", entries, ["p. 5"], items, "apa"));
  assert.throws(() => buildLocatorReplacement("endnote", "17", entries, ["", ""], new Map(), "apa"));

  const original = buildLocatorReplacement("endnote", "17", entries, ["p. 5", "para. 7"], items, "apa");
  const prefix = "Reading here.\n".repeat(100);
  function setup() {
    let text = prefix + original;
    const transactions: any[] = [];
    const requests: string[] = [];
    const view: any = {
      state: { get doc() { return { length: text.length, sliceString: (a: number, b: number) => text.slice(a, b) }; } },
      scrollDOM: { scrollTop: 800, scrollLeft: 12 },
      focus() { throw new Error("Editing must not focus or scroll the document"); },
      dispatch(transaction: any) {
        transactions.push(transaction);
        const { from, to, insert } = transaction.changes;
        text = text.slice(0, from) + insert + text.slice(to);
      },
    };
    const plugin: any = {
      settings: { language: "en", cslStyle: "apa" },
      api: { ping: async () => true },
      fetchAndCacheRemote: async (key: string) => { requests.push(key); return items.get(key); },
      ensureInstalledStyle: () => true,
    };
    const spec: any = {
      app: { plugins: { plugins: { "zotero-citations": plugin } } },
      sourceView: view,
      edit: { kind: "endnote", label: "17", key: entries[0].key, locator: "p. 5", entries,
        original, from: prefix.length, to: prefix.length + original.length },
      getSourcePath: () => "test.md",
    };
    return { spec, plugin, view, transactions, requests, value: () => text, change: (value: string) => { text = value; } };
  }
  let test = setup();
  assert.equal(await applyLocatorEdit(test.spec, ["p. 20", "para. 30"]), true);
  assert.deepEqual(test.requests, ["BOOKONE", "BOOKTWO"]);
  assert.deepEqual(CitationManager.parseZoteroEntries(test.value()).map(e => [e.key, e.page]), [["BOOKONE", "p. 20"], ["BOOKTWO", "para. 30"]]);
  assert.equal(test.transactions.length, 1);
  assert.deepEqual(Object.keys(test.transactions[0]), ["changes"]);
  assert.equal(test.view.scrollDOM.scrollTop, 800);
  assert.equal(test.view.scrollDOM.scrollLeft, 12);
  assert.equal(test.value().slice(0, prefix.length), prefix);

  for (const failure of ["offline", "missing", "fetch-error", "style", "stale"]) {
    test = setup();
    if (failure === "offline") test.plugin.api.ping = async () => false;
    if (failure === "missing") test.plugin.fetchAndCacheRemote = async (key: string) => key === "BOOKONE" ? items.get(key) : null;
    if (failure === "fetch-error") test.plugin.fetchAndCacheRemote = async () => { throw new Error("network"); };
    if (failure === "style") test.plugin.ensureInstalledStyle = () => false;
    if (failure === "stale") test.plugin.fetchAndCacheRemote = async (key: string) => { test.change(prefix + original.replace("Book 1", "User edit")); return items.get(key); };
    assert.equal(await applyLocatorEdit(test.spec, ["p. 20", "para. 30"]), false, failure);
    assert.equal(test.transactions.length, 0, failure);
  }
  console.log("All citation locator cluster and safe editor integration tests passed.");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
