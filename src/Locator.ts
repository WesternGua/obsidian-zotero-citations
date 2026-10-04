import { readZoteroUILocale } from "./ZoteroEnvironment";

/** Zotero.Cite.labels; menu order is by localized display label, as in Zotero. */
export const LOCATOR_TYPES = [
  ["act", "Act"], ["appendix", "Appendix"], ["article-locator", "Article"],
  ["book", "Book"], ["canon", "Canon"], ["chapter", "Chapter"], ["column", "Column"],
  ["elocation", "Location"], ["equation", "Equation"], ["figure", "Figure"],
  ["folio", "Folio"], ["issue", "Issue"], ["line", "Line"], ["note", "Note"],
  ["opus", "Opus"], ["page", "Page"], ["paragraph", "Paragraph"], ["part", "Part"],
  ["rule", "Rule"], ["scene", "Scene"], ["section", "Section"], ["sub-verbo", "Sub verbo"],
  ["table", "Table"], ["timestamp", "Timestamp"], ["title-locator", "Title"],
  ["verse", "Verse"], ["volume", "Volume"],
] as const;

export interface Locator { label: string; value: string }
const PREFIX: Record<string, string> = {
  page: "p.", paragraph: "para.", section: "sec.", chapter: "ch.", figure: "fig.",
  table: "table", verse: "v.", line: "l.", note: "n.", column: "col.", issue: "no.", volume: "vol.",
};
const ALIASES: Array<[RegExp, string]> = [
  [/^p(?:p)?\.\s*/i, "page"], [/^paras?\.\s*/i, "paragraph"], [/^secs?\.\s*/i, "section"],
  [/^(?:ch|chap|chaps)\.\s*/i, "chapter"], [/^figs?\.\s*/i, "figure"], [/^v\.\s*/i, "verse"],
  [/^l\.\s*/i, "line"], [/^n\.\s*/i, "note"], [/^cols?\.\s*/i, "column"],
  [/^no\.\s*/i, "issue"], [/^vols?\.\s*/i, "volume"],
];
export function parseLocator(raw?: string): Locator {
  const text = raw?.trim() || "";
  for (const [label] of LOCATOR_TYPES) {
    const prefix = label + " ";
    if (text.toLowerCase().startsWith(prefix)) return { label, value: text.slice(prefix.length).trim() };
  }
  for (const [pattern, label] of ALIASES) {
    if (pattern.test(text)) return { label, value: text.replace(pattern, "").trim() };
  }
  return { label: "page", value: text };
}
/** Typed values serialize with an unambiguous prefix, compatible with existing metadata. */
export function serializeLocator(locator: Locator): string {
  const value = locator.value.trim();
  if (!value) return "";
  if (!LOCATOR_TYPES.some(([label]) => label === locator.label)) throw new Error("Unknown locator type");
  return (PREFIX[locator.label] || locator.label) + " " + value;
}

export function locatorOptions(locale = readZoteroUILocale()): Array<{ value: string; label: string }> {
  const currentLabels = require("./locator-labels.json");
  const locales = require("@manuscripts/csl-locales");
  const name = Object.keys(locales).find(key => key.toLowerCase() === locale.toLowerCase())
    || Object.keys(locales).find(key => key.toLowerCase().startsWith(locale.split("-")[0].toLowerCase()))
    || "en-US";
  const terms = locales[name]?.children?.find((node: any) => node.name === "terms")?.children || [];
  const textOf = (node: any): string => typeof node === "string" ? node : (node.children || []).map(textOf).join("");
  return LOCATOR_TYPES.map(([value, fallback]) => {
    const term = terms.find((node: any) => node.attrs?.name === value && !node.attrs?.form);
    const single = term?.children?.find((node: any) => node?.name === "single");
    const text = currentLabels[name]?.[value] || (term ? textOf(single || term) : fallback);
    return { value, label: text.charAt(0).toUpperCase() + text.slice(1) };
  }).sort((a, b) => a.label.localeCompare(b.label, name));
}
