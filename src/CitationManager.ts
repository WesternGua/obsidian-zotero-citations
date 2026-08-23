/**
 * CitationManager.ts – Static-methods-only class for parsing, building,
 * inserting, refreshing, and formatting Zotero citations in Obsidian.
 */
import { ZoteroItem } from "./ZoteroAPI";
import { CslEngine } from "./CslEngine";

// ── Editor interface (subset of Obsidian's Editor) ────────────────────────
export interface EditorPosition {
  line: number;
  ch: number;
}

export interface MinimalEditor {
  getValue(): string;
  setValue(content: string): void;
  replaceSelection(text: string): void;
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void;
  offsetToPos(offset: number): EditorPosition;
  getCursor(): EditorPosition;
  posToOffset(pos: EditorPosition): number;
}

// ── Parsed citation types ─────────────────────────────────────────────────
export interface InlineCitation {
  fullMatch: string;
  key: string;
  page: string;
  formattedText: string;
  entries: CitationEntry[];
  index: number;
}

export interface EndnoteDef {
  label: string;
  key: string;
  page: string;
  formattedText: string;
  entries: CitationEntry[];
  fullMatch: string;
  defIndex: number;
}

export interface EndnoteRef {
  label: string;
  key: string;
  page: string;
  formattedText: string;
  entries: CitationEntry[];
  fullMatch: string;
  index: number;
}

export interface InTextCitation {
  key: string;
  page: string;
  formattedText: string;
  entries: CitationEntry[];
  fullMatch: string;
  index: number;
}

export interface CitationRef {
  key: string;
  page: string;
}

export interface CitationEntry {
  key: string;
  page: string;
  formattedText: string;
}

export interface CitationInsertEntry {
  item: ZoteroItem;
  page?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────
const KEY_PAT = "[A-Za-z0-9_:.-]+";
const INLINE_RE_SRC = `\\^\\[<!-- zotero:(${KEY_PAT}):([^ ]*) --> ([\\s\\S]*?)\\]`;
const ENDNOTE_DEF_RE_SRC = `^\\[\\^([^\\]\\n]+)\\]:\\s*(<!-- zotero:${KEY_PAT}:[^ ]*\\s*--> .+)$`;
const IN_TEXT_LEGACY_RE_SRC = `<!-- zotero-inline:(${KEY_PAT}):([^ ]*) -->\\s*([\\s\\S]*?)\\s*<!-- \\/zotero-inline -->`;
const BIBLIOGRAPHY_START = "<!-- zotero-bibliography-start -->";
const BIBLIOGRAPHY_END = "<!-- zotero-bibliography-end -->";

export class EngineUnavailableError extends Error {
  constructor(public readonly styleId: string) {
    super(`The CSL engine could not format style: ${styleId}`);
    this.name = "EngineUnavailableError";
  }
}

// ── Main class ────────────────────────────────────────────────────────────
export class CitationManager {
  // ════════════════════════════════════════════════════════════════════════
  // PARSING
  // ════════════════════════════════════════════════════════════════════════

  static parseInlineCitations(content: string): InlineCitation[] {
    const results: InlineCitation[] = [];
    const startRe = new RegExp(`\\^\\[<!-- zotero:(${KEY_PAT}):([^ ]*) --> `, "g");
    let m: RegExpExecArray | null;
    while ((m = startRe.exec(content)) !== null) {
      const index = m.index;
      const key = m[1];
      const page = decodeURIComponent(m[2]);
      const bodyStart = index + m[0].length;
      let pos = bodyStart;
      let depth = 0;
      while (pos < content.length) {
        const ch = content[pos];
        if (ch === "\\") {
          pos += 2;
          continue;
        }
        if (ch === "[") {
          depth++;
          pos++;
          continue;
        }
        if (ch === "]") {
          if (depth === 0) break;
          depth--;
          pos++;
          continue;
        }
        pos++;
      }
      if (pos >= content.length) break;
      const bodyWithMetadata = `<!-- zotero:${key}:${m[2]} --> ${content.slice(bodyStart, pos)}`;
      const entries = CitationManager.parseZoteroEntries(bodyWithMetadata, "zotero");
      const formattedText = CitationManager.stripCitationMetadata(content.slice(bodyStart, pos));
      results.push({
        fullMatch: content.slice(index, pos + 1),
        key,
        page,
        formattedText,
        entries: entries.length ? entries : [{ key, page, formattedText }],
        index,
      });
      startRe.lastIndex = pos + 1;
    }
    return results;
  }

  static parseEndnoteDefs(content: string): EndnoteDef[] {
    const results: EndnoteDef[] = [];
    const re = new RegExp(ENDNOTE_DEF_RE_SRC, "gm");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const entries = CitationManager.parseZoteroEntries(m[2], "zotero");
      if (!entries.length) continue;
      results.push({
        label: m[1],
        key: entries[0].key,
        page: entries[0].page,
        formattedText: CitationManager.stripCitationMetadata(m[2]),
        entries,
        fullMatch: m[0],
        defIndex: m.index,
      });
    }
    return results;
  }

  static parseAllCitations(content: string): CitationRef[] {
    const seen = new Set<string>();
    const out: CitationRef[] = [];
    for (const c of CitationManager.parseInlineCitations(content)) {
      for (const entry of c.entries.length ? c.entries : [{ key: c.key, page: c.page, formattedText: c.formattedText }]) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          out.push({ key: entry.key, page: entry.page });
        }
      }
    }
    for (const c of CitationManager.parseEndnoteRefs(content)) {
      for (const entry of c.entries.length ? c.entries : [{ key: c.key, page: c.page, formattedText: c.formattedText }]) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          out.push({ key: entry.key, page: entry.page });
        }
      }
    }
    for (const c of CitationManager.parseInTextCitations(content)) {
      for (const entry of c.entries.length ? c.entries : [{ key: c.key, page: c.page, formattedText: c.formattedText }]) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          out.push({ key: entry.key, page: entry.page });
        }
      }
    }
    return out;
  }

  static parseDocumentCitations(content: string): (InlineCitation | EndnoteRef | InTextCitation)[] {
    return [
      ...CitationManager.parseInlineCitations(content),
      ...CitationManager.parseEndnoteRefs(content),
      ...CitationManager.parseInTextCitations(content),
    ];
  }

  static parseInTextCitations(content: string): InTextCitation[] {
    const results: InTextCitation[] = [];
    const startRe = new RegExp(`\\^\\[<!-- zotero-intext:(${KEY_PAT}):([^ ]*) --> `, "g");
    let m: RegExpExecArray | null;
    while ((m = startRe.exec(content)) !== null) {
      const index = m.index;
      const key = m[1];
      const page = decodeURIComponent(m[2]);
      const bodyStart = index + m[0].length;
      let pos = bodyStart;
      let depth = 0;
      while (pos < content.length) {
        const ch = content[pos];
        if (ch === "\\") {
          pos += 2;
          continue;
        }
        if (ch === "[") {
          depth++;
          pos++;
          continue;
        }
        if (ch === "]") {
          if (depth === 0) break;
          depth--;
          pos++;
          continue;
        }
        pos++;
      }
      if (pos >= content.length) break;
      const bodyWithMetadata = `<!-- zotero-intext:${key}:${m[2]} --> ${content.slice(bodyStart, pos)}`;
      const entries = CitationManager.parseZoteroEntries(bodyWithMetadata, "zotero-intext");
      const formattedText = CitationManager.stripCitationMetadata(content.slice(bodyStart, pos));
      results.push({
        key,
        page,
        formattedText,
        entries: entries.length ? entries : [{ key, page, formattedText }],
        fullMatch: content.slice(index, pos + 1),
        index,
      });
      startRe.lastIndex = pos + 1;
    }

    const legacyRe = new RegExp(IN_TEXT_LEGACY_RE_SRC, "g");
    while ((m = legacyRe.exec(content)) !== null) {
      results.push({
        key: m[1],
        page: decodeURIComponent(m[2]),
        formattedText: m[3],
        entries: [{ key: m[1], page: decodeURIComponent(m[2]), formattedText: m[3] }],
        fullMatch: m[0],
        index: m.index,
      });
    }

    results.sort((a, b) => a.index - b.index);
    return results;
  }

  static parseEndnoteRefs(content: string): EndnoteRef[] {
    const defs = new Map<string, EndnoteDef>(
      CitationManager.parseEndnoteDefs(content).map((d) => [d.label, d])
    );
    const refs: EndnoteRef[] = [];
    const re = /\[\^([^\]\n]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (content[m.index + m[0].length] === ":") continue;
      const def = defs.get(m[1]);
      if (!def) continue;
      refs.push({
        label: m[1],
        key: def.key,
        page: def.page,
        formattedText: def.formattedText,
        entries: def.entries,
        fullMatch: m[0],
        index: m.index,
      });
    }
    return refs;
  }

  static isInsideInline(content: string, pos: number): InlineCitation | null {
    for (const c of CitationManager.parseInlineCitations(content)) {
      if (pos > c.index && pos < c.index + c.fullMatch.length) return c;
    }
    return null;
  }

  static isInsideEndnoteRef(content: string, pos: number): EndnoteDef | null {
    const defs = new Map<string, EndnoteDef>(
      CitationManager.parseEndnoteDefs(content).map((d) => [d.label, d])
    );
    const re = /\[\^(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (content[m.index + m[0].length] === ":") continue;
      if (pos > m.index && pos < m.index + m[0].length) return defs.get(m[1]) ?? null;
    }
    return null;
  }

  static isInsideInText(content: string, pos: number): InTextCitation | null {
    for (const c of CitationManager.parseInTextCitations(content)) {
      if (pos > c.index && pos < c.index + c.fullMatch.length) return c;
    }
    return null;
  }

  static parseZoteroEntries(text: string, marker: "zotero" | "zotero-intext" = "zotero"): CitationEntry[] {
    const results: CitationEntry[] = [];
    const re = new RegExp(`<!--\\s*${marker}:(${KEY_PAT}):([^ ]*)\\s*-->\\s*`, "g");
    const matches: { index: number; end: number; key: string; page: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        index: m.index,
        end: re.lastIndex,
        key: m[1],
        page: decodeURIComponent(m[2] || ""),
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      let formattedText = text.slice(cur.end, next ? next.index : text.length).trim();
      // The plugin joins grouped citations with "; ". Keep the delimiter out of
      // the managed citation body so refresh/reformat can rebuild a clean group.
      if (next && formattedText.endsWith(";")) formattedText = formattedText.slice(0, -1).trimEnd();
      results.push({ key: cur.key, page: cur.page, formattedText });
    }
    return results;
  }

  private static buildCitationGroup(entries: CitationInsertEntry[], style: string, marker: "zotero" | "zotero-intext"): string {
    const metadata = entries
      .map((entry) => `<!-- ${marker}:${entry.item.key}:${encodeURIComponent(entry.page ?? "")} -->`)
      .join(" ");
    const text = marker === "zotero-intext"
      ? CslEngine.formatCitationCluster(entries, style)
      : CslEngine.formatNoteCluster(entries, style);
    if (text == null) throw new EngineUnavailableError(style);
    return `${metadata} ${text}`;
  }

  private static refreshCitationEntries(
    entries: CitationEntry[],
    itemMap: Map<string, ZoteroItem>,
    style: string,
    marker: "zotero" | "zotero-intext",
  ): { text: string; count: number } {
    const resolved = entries.map((entry) => ({ entry, item: itemMap.get(entry.key) }));
    const available = resolved.filter((value): value is { entry: CitationEntry; item: ZoteroItem } => !!value.item);
    if (available.length !== entries.length) {
      const metadata = entries
        .map((entry) => `<!-- ${marker}:${entry.key}:${encodeURIComponent(entry.page ?? "")} -->`)
        .join(" ");
      const oldText = entries.map((entry) => entry.formattedText).filter(Boolean).join("; ");
      return { text: `${metadata} ${oldText}`.trim(), count: 0 };
    }
    const text = CitationManager.buildCitationGroup(
      available.map(({ entry, item }) => ({ item, page: entry.page || undefined })),
      style,
      marker,
    );
    return { text, count: available.length };
  }

  private static stripCitationMetadata(text: string): string {
    return text
      .replace(new RegExp(`<!--\\s*(?:zotero|zotero-intext):${KEY_PAT}:[^ ]*\\s*-->\\s*`, "g"), "")
      .trim();
  }

  private static nextNumericEndnoteLabel(content: string): string {
    let max = 0;
    const re = /\[\^(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) max = Math.max(max, parseInt(m[1]));
    return String(max + 1);
  }

  private static appendEndnoteDef(editor: MinimalEditor, contentAfterRefInsert: string, def: string): void {
    const bibStart = contentAfterRefInsert.indexOf(BIBLIOGRAPHY_START);
    if (bibStart !== -1) {
      let ins = bibStart;
      while (ins > 0 && contentAfterRefInsert[ins - 1] === "\n") ins--;
      editor.replaceRange("\n\n" + def, editor.offsetToPos(ins), editor.offsetToPos(ins));
    } else {
      editor.replaceRange("\n\n" + def, editor.offsetToPos(contentAfterRefInsert.length));
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BUILDING
  // ════════════════════════════════════════════════════════════════════════

  static buildInlineFootnote(item: ZoteroItem, style: string, page?: string): string {
    return CitationManager.buildInlineFootnoteGroup([{ item, page }], style);
  }

  static buildInlineFootnoteGroup(entries: CitationInsertEntry[], style: string): string {
    return `^[${CitationManager.buildCitationGroup(entries, style, "zotero")}]`;
  }

  static buildEndnoteDef(label: string, item: ZoteroItem, style: string, page?: string): string {
    return CitationManager.buildEndnoteDefGroup(label, [{ item, page }], style);
  }

  static buildEndnoteDefGroup(label: string, entries: CitationInsertEntry[], style: string): string {
    return `[^${label}]: ${CitationManager.buildCitationGroup(entries, style, "zotero")}`;
  }

  static buildInTextCitation(item: ZoteroItem, style: string, page?: string): string {
    return CitationManager.buildInTextCitationGroup([{ item, page }], style);
  }

  static buildInTextCitationGroup(entries: CitationInsertEntry[], style: string): string {
    return `^[${CitationManager.buildCitationGroup(entries, style, "zotero-intext")}]`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // INSERTION
  // ════════════════════════════════════════════════════════════════════════

  static insertInline(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceSelection(CitationManager.buildInlineFootnote(item, style, page));
  }

  static insertInlineGroup(editor: MinimalEditor, entries: CitationInsertEntry[], style: string): void {
    editor.replaceSelection(CitationManager.buildInlineFootnoteGroup(entries, style));
  }

  static insertEndnote(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.insertEndnoteGroup(editor, [{ item, page }], style);
  }

  static insertEndnoteGroup(editor: MinimalEditor, entries: CitationInsertEntry[], style: string): void {
    const content = editor.getValue();
    const existing = CitationManager.parseEndnoteDefs(content).find((def) =>
      def.entries.length === entries.length && def.entries.every((entry, index) =>
        entry.key === entries[index].item.key && entry.page === (entries[index].page ?? "")
      )
    );
    if (existing) {
      editor.replaceSelection(`[^${existing.label}]`);
      return;
    }
    const label = CitationManager.nextNumericEndnoteLabel(content);
    const def = CitationManager.buildEndnoteDefGroup(label, entries, style);
    editor.replaceSelection(`[^${label}]`);
    const updated = editor.getValue();
    CitationManager.appendEndnoteDef(editor, updated, def);
  }

  static insertInText(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceSelection(CitationManager.buildInTextCitation(item, style, page));
  }

  static insertInTextGroup(editor: MinimalEditor, entries: CitationInsertEntry[], style: string): void {
    editor.replaceSelection(CitationManager.buildInTextCitationGroup(entries, style));
  }

  static replaceInline(editor: MinimalEditor, existing: InlineCitation, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.replaceInlineGroup(editor, existing, [{ item, page }], style);
  }

  static replaceInlineGroup(editor: MinimalEditor, existing: InlineCitation, entries: CitationInsertEntry[], style: string): void {
    editor.replaceRange(
      CitationManager.buildInlineFootnoteGroup(entries, style),
      editor.offsetToPos(existing.index),
      editor.offsetToPos(existing.index + existing.fullMatch.length)
    );
  }

  static replaceEndnoteDef(editor: MinimalEditor, existing: EndnoteDef, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.replaceEndnoteDefGroup(editor, existing, [{ item, page }], style);
  }

  static replaceEndnoteDefGroup(editor: MinimalEditor, existing: EndnoteDef, entries: CitationInsertEntry[], style: string): void {
    editor.replaceRange(
      CitationManager.buildEndnoteDefGroup(existing.label, entries, style),
      editor.offsetToPos(existing.defIndex),
      editor.offsetToPos(existing.defIndex + existing.fullMatch.length)
    );
  }

  static replaceInText(editor: MinimalEditor, existing: InTextCitation, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.replaceInTextGroup(editor, existing, [{ item, page }], style);
  }

  static replaceInTextGroup(editor: MinimalEditor, existing: InTextCitation, entries: CitationInsertEntry[], style: string): void {
    editor.replaceRange(
      CitationManager.buildInTextCitationGroup(entries, style),
      editor.offsetToPos(existing.index),
      editor.offsetToPos(existing.index + existing.fullMatch.length)
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // REFRESH
  // ════════════════════════════════════════════════════════════════════════

  static refreshInline(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const citations = CitationManager.parseInlineCitations(content);
    let count = 0;
    for (let i = citations.length - 1; i >= 0; i--) {
      const c = citations[i];
      const refreshed = CitationManager.refreshCitationEntries(c.entries, itemMap, style, "zotero");
      if (!refreshed.count) continue;
      content = content.slice(0, c.index) + `^[${refreshed.text}]` + content.slice(c.index + c.fullMatch.length);
      count += refreshed.count;
    }
    editor.setValue(content);
    return count;
  }

  static refreshEndnotes(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const defs = CitationManager.parseEndnoteDefs(content);
    let count = 0;
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      const refreshed = CitationManager.refreshCitationEntries(d.entries, itemMap, style, "zotero");
      if (!refreshed.count) continue;
      content = content.slice(0, d.defIndex) + `[^${d.label}]: ${refreshed.text}` + content.slice(d.defIndex + d.fullMatch.length);
      count += refreshed.count;
    }
    editor.setValue(content);
    return count;
  }

  static refreshInText(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const citations = CitationManager.parseInTextCitations(content);
    let count = 0;
    for (let i = citations.length - 1; i >= 0; i--) {
      const c = citations[i];
      const refreshed = CitationManager.refreshCitationEntries(c.entries, itemMap, style, "zotero-intext");
      if (!refreshed.count) continue;
      content = content.slice(0, c.index) + `^[${refreshed.text}]` + content.slice(c.index + c.fullMatch.length);
      count += refreshed.count;
    }
    editor.setValue(content);
    return count;
  }

  static removeUnreferencedEndnotes(editor: MinimalEditor): number {
    let content = editor.getValue();
    const referencedLabels = new Set(CitationManager.parseEndnoteRefs(content).map((r) => r.label));
    const defs = CitationManager.parseEndnoteDefs(content);
    let count = 0;
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      if (referencedLabels.has(d.label)) continue;
      let start = d.defIndex;
      while (start >= 2 && content[start - 1] === "\n" && content[start - 2] === "\n") start--;
      const end = d.defIndex + d.fullMatch.length;
      content = content.slice(0, start) + content.slice(end);
      count++;
    }
    if (count) editor.setValue(content);
    return count;
  }

  static removeManagedBibliography(editor: MinimalEditor): boolean {
    const content = editor.getValue();
    const startIdx = content.indexOf(BIBLIOGRAPHY_START);
    const endIdx = content.indexOf(BIBLIOGRAPHY_END);
    if (startIdx === -1 || endIdx === -1) return false;
    let start = startIdx;
    while (start >= 2 && content[start - 1] === "\n" && content[start - 2] === "\n") start--;
    let end = endIdx + BIBLIOGRAPHY_END.length;
    while (end < content.length && content[end] === "\n") end++;
    editor.replaceRange("", editor.offsetToPos(start), editor.offsetToPos(end));
    return true;
  }

  static convertEndnotesToInline(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const refs = CitationManager.parseEndnoteRefs(content);
    let count = 0;
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      const item = itemMap.get(ref.key);
      if (!item) continue;
      content = content.slice(0, ref.index) + CitationManager.buildInlineFootnote(item, style, ref.page || undefined) + content.slice(ref.index + ref.fullMatch.length);
      count++;
    }
    const defs = CitationManager.parseEndnoteDefs(content);
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      let end = d.defIndex + d.fullMatch.length;
      while (end < content.length && content[end] === "\n") end++;
      content = content.slice(0, d.defIndex) + content.slice(end);
    }
    editor.setValue(content);
    return count;
  }

  static convertEndnotesToInText(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const refs = CitationManager.parseEndnoteRefs(content);
    let count = 0;
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      const item = itemMap.get(ref.key);
      if (!item) continue;
      content = content.slice(0, ref.index) + CitationManager.buildInTextCitation(item, style, ref.page || undefined) + content.slice(ref.index + ref.fullMatch.length);
      count++;
    }
    const defs = CitationManager.parseEndnoteDefs(content);
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      let end = d.defIndex + d.fullMatch.length;
      while (end < content.length && content[end] === "\n") end++;
      content = content.slice(0, d.defIndex) + content.slice(end);
    }
    editor.setValue(content);
    return count;
  }

  static convertInlineToEndnotes(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const inlines = CitationManager.parseInlineCitations(content);
    if (!inlines.length) return 0;
    let max = 0;
    const re = /\[\^(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) max = Math.max(max, parseInt(m[1]));
    const labels = inlines.map((_, idx) => String(max + idx + 1));
    for (let i = inlines.length - 1; i >= 0; i--) {
      const c = inlines[i];
      content = content.slice(0, c.index) + `[^${labels[i]}]` + content.slice(c.index + c.fullMatch.length);
    }
    const defs: string[] = [];
    for (let i = 0; i < inlines.length; i++) {
      const c = inlines[i];
      const item = itemMap.get(c.key);
      if (!item) continue;
      defs.push(CitationManager.buildEndnoteDef(labels[i], item, style, c.page || undefined));
    }
    if (defs.length) {
      const bibStart = content.indexOf(BIBLIOGRAPHY_START);
      if (bibStart !== -1) {
        let ins = bibStart;
        while (ins > 0 && content[ins - 1] === "\n") ins--;
        content = content.slice(0, ins) + "\n\n" + defs.join("\n\n") + content.slice(ins);
      } else {
        content += "\n\n" + defs.join("\n\n");
      }
    }
    editor.setValue(content);
    return defs.length;
  }

  static convertInlineToInText(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const inlines = CitationManager.parseInlineCitations(content);
    let count = 0;
    for (let i = inlines.length - 1; i >= 0; i--) {
      const c = inlines[i];
      const item = itemMap.get(c.key);
      if (!item) continue;
      content = content.slice(0, c.index) + CitationManager.buildInTextCitation(item, style, c.page || undefined) + content.slice(c.index + c.fullMatch.length);
      count++;
    }
    editor.setValue(content);
    return count;
  }

  static convertInTextToInline(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const inText = CitationManager.parseInTextCitations(content);
    let count = 0;
    for (let i = inText.length - 1; i >= 0; i--) {
      const c = inText[i];
      const item = itemMap.get(c.key);
      if (!item) continue;
      content = content.slice(0, c.index) + CitationManager.buildInlineFootnote(item, style, c.page || undefined) + content.slice(c.index + c.fullMatch.length);
      count++;
    }
    editor.setValue(content);
    return count;
  }

  static convertInTextToEndnotes(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string): number {
    let content = editor.getValue();
    const inText = CitationManager.parseInTextCitations(content);
    if (!inText.length) return 0;
    let max = 0;
    const re = /\[\^(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) max = Math.max(max, parseInt(m[1]));
    const labels = inText.map((_, idx) => String(max + idx + 1));
    for (let i = inText.length - 1; i >= 0; i--) {
      const c = inText[i];
      content = content.slice(0, c.index) + `[^${labels[i]}]` + content.slice(c.index + c.fullMatch.length);
    }
    const defs: string[] = [];
    for (let i = 0; i < inText.length; i++) {
      const c = inText[i];
      const item = itemMap.get(c.key);
      if (!item) continue;
      defs.push(CitationManager.buildEndnoteDef(labels[i], item, style, c.page || undefined));
    }
    if (defs.length) {
      const bibStart = content.indexOf(BIBLIOGRAPHY_START);
      if (bibStart !== -1) {
        let ins = bibStart;
        while (ins > 0 && content[ins - 1] === "\n") ins--;
        content = content.slice(0, ins) + "\n\n" + defs.join("\n\n") + content.slice(ins);
      } else {
        content += "\n\n" + defs.join("\n\n");
      }
    }
    editor.setValue(content);
    return defs.length;
  }

  static refreshDocument(editor: MinimalEditor, itemMap: Map<string, ZoteroItem>, style: string, mode: string = "endnote"): number {
    let count = 0;
    if (mode === "inline") {
      count += CitationManager.convertInTextToInline(editor, itemMap, style);
      count += CitationManager.convertEndnotesToInline(editor, itemMap, style);
      count += CitationManager.refreshInline(editor, itemMap, style);
    } else if (mode === "intext") {
      count += CitationManager.convertInlineToInText(editor, itemMap, style);
      count += CitationManager.convertEndnotesToInText(editor, itemMap, style);
      count += CitationManager.refreshInText(editor, itemMap, style);
    } else {
      count += CitationManager.convertInTextToEndnotes(editor, itemMap, style);
      count += CitationManager.convertInlineToEndnotes(editor, itemMap, style);
      count += CitationManager.refreshEndnotes(editor, itemMap, style);
    }
    const newContent = editor.getValue();
    if (newContent.includes(BIBLIOGRAPHY_START)) {
      const bib = CitationManager.generateBibliography(newContent, itemMap, style);
      if (bib) CitationManager.insertOrReplaceBibliography(editor, bib);
    }
    return count;
  }

  // ════════════════════════════════════════════════════════════════════════
  // BIBLIOGRAPHY
  // ════════════════════════════════════════════════════════════════════════

  static generateBibliography(content: string, itemMap: Map<string, ZoteroItem>, style: string, heading?: string): string {
    const all = CitationManager.parseAllCitations(content);
    const seen = new Set<string>();
    const items: ZoteroItem[] = [];
    let missingItem = false;
    for (const c of all) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        const it = itemMap.get(c.key);
        if (it) items.push(it);
        else missingItem = true;
      }
    }
    if (!items.length || missingItem) return "";
    const formatted = CslEngine.formatBibliographyOrdered(items, style);
    if (!formatted || formatted.length !== items.length) throw new EngineUnavailableError(style);
    const entries = formatted.map((entry) => entry.text);
    const title = heading || "References";
    const quotedEntries = entries.map((e) => "> " + e).join("\n>\n");
    return BIBLIOGRAPHY_START + "\n\n# " + title + "\n\n" + quotedEntries + "\n\n" + BIBLIOGRAPHY_END;
  }

  static insertOrReplaceBibliography(editor: MinimalEditor, bib: string): void {
    const content = editor.getValue();
    const startIdx = content.indexOf(BIBLIOGRAPHY_START);
    const endIdx = content.indexOf(BIBLIOGRAPHY_END);
    if (startIdx !== -1 && endIdx !== -1) {
      editor.replaceRange(bib, editor.offsetToPos(startIdx), editor.offsetToPos(endIdx + BIBLIOGRAPHY_END.length));
    } else {
      editor.replaceSelection("\n\n" + bib + "\n");
    }
  }

  static extractBibHeading(content: string): string | null {
    const startIdx = content.indexOf(BIBLIOGRAPHY_START);
    const endIdx = content.indexOf(BIBLIOGRAPHY_END);
    if (startIdx === -1 || endIdx === -1) return null;
    const block = content.slice(startIdx + BIBLIOGRAPHY_START.length, endIdx);
    const m = block.match(/^#{1,2}\s+(.+)$/m);
    return m ? m[1].trim() : null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // UNLINK
  // ════════════════════════════════════════════════════════════════════════

  static unlinkAll(editor: MinimalEditor): number {
    let content = editor.getValue();
    let count = 0;
    const inlines = CitationManager.parseInlineCitations(content);
    for (let i = inlines.length - 1; i >= 0; i--) {
      const c = inlines[i];
      content = content.slice(0, c.index) + `^[${c.formattedText}]` + content.slice(c.index + c.fullMatch.length);
      count++;
    }
    const defs = CitationManager.parseEndnoteDefs(content);
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      content = content.slice(0, d.defIndex) + `[^${d.label}]: ${d.formattedText}` + content.slice(d.defIndex + d.fullMatch.length);
      count++;
    }
    const inText = CitationManager.parseInTextCitations(content);
    for (let i = inText.length - 1; i >= 0; i--) {
      const c = inText[i];
      content = content.slice(0, c.index) + c.formattedText + content.slice(c.index + c.fullMatch.length);
      count++;
    }
    editor.setValue(content);
    return count;
  }

  // ════════════════════════════════════════════════════════════════════════
  // FORMATTERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Format one footnote/endnote citation using the real CSL engine.
   * Numeric styles use a bibliography entry without its numeric label because
   * Obsidian already renders the footnote/endnote number.
   * Throws EngineUnavailableError when the selected style cannot be driven by
   * citeproc, so callers can surface a clear message and abort without writing
   * anything into the document. There is no hand-written fallback by design.
   */
  static formatCitation(item: ZoteroItem, style: string, page?: string): string {
    const engineText = CslEngine.formatNoteText(item, style, page);
    if (engineText != null) return engineText;
    throw new EngineUnavailableError(style);
  }

  /** Format a citation that remains in the document's running text. */
  static formatInTextCitation(item: ZoteroItem, style: string, page?: string): string {
    const engineText = CslEngine.formatCitationText(item, style, page);
    if (engineText != null) return engineText;
    throw new EngineUnavailableError(style);
  }

  static getYear(item: ZoteroItem): string {
    if (!item.date) return "n.d.";
    return item.date.match(/\b(\d{4})\b/)?.[1] ?? item.date;
  }
}
