import { CitationManager, type CitationEntry } from "./CitationManager";
import type { ZoteroItem } from "./ZoteroAPI";

export type LocatorCitationKind = "inline" | "endnote" | "intext";

/** Rebuild the complete cluster, preserving entry order, duplicates and independent locators. */
export function buildLocatorReplacement(
  kind: LocatorCitationKind,
  label: string | undefined,
  entries: CitationEntry[],
  locators: string[],
  items: Map<string, ZoteroItem>,
  style: string,
): string {
  if (!entries.length || locators.length !== entries.length) throw new Error("Citation locator count changed");
  const selected = entries.map((entry, index) => {
    const item = items.get(entry.key);
    if (!item) throw new Error(`Could not resolve Zotero item ${entry.key}`);
    return { item, page: locators[index].trim() || undefined };
  });
  if (kind === "inline") return CitationManager.buildInlineFootnoteGroup(selected, style);
  if (kind === "intext") return CitationManager.buildInTextCitationGroup(selected, style);
  if (!label) throw new Error("Footnote label missing");
  return CitationManager.buildEndnoteDefGroup(label, selected, style);
}
