/**
 * CitationManager.ts – Static-methods-only class for parsing, building,
 * inserting, refreshing, and formatting Zotero citations in Obsidian.
 */
import { ZoteroItem } from "./ZoteroAPI";
import { CslEngine } from "./CslEngine";
import { CITATION_END, citationBody, resolveCitationContent, visibleCitation, CitationBoundaryError } from "./CitationContent";
import { parseFootnoteDocument, markdownCitationMask, footnoteKey } from "./FootnoteClipboard";

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
  error?: string;
}

export type CitationKind = "endnote" | "inline" | "intext";
export interface CitationIssue { kind: CitationKind; label?: string; key: string; from: number; to: number; original: string; reason: "encoding" | "missing" | "boundary" | "multiline"; }
export type CitationIssueHandler = (issue: CitationIssue) => void;

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

export class CitationChangedError extends Error { constructor() { super("The citation changed while the operation was pending. Original text was preserved."); } }

function safeDecodeLocator(raw: string): {value:string;error?:string} {
  try { return {value:decodeURIComponent(raw)}; } catch { return {value:raw,error:"Invalid locator encoding"}; }
}

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
    const mask = markdownCitationMask(content);
    let m: RegExpExecArray | null;
    while ((m = startRe.exec(mask)) !== null) {
      const index = m.index;
      const key = m[1];
      const page = safeDecodeLocator(m[2]).value;
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
    for (const definition of parseFootnoteDocument(content).definitions) {
      const body = citationBody(definition.raw,"endnote");
      const entries = CitationManager.parseZoteroEntries(body, "zotero");
      if (!entries.length) continue;
      results.push({
        label: definition.label,
        key: entries[0].key,
        page: entries[0].page,
        formattedText: CitationManager.stripCitationMetadata(body),
        entries,
        fullMatch: definition.raw,
        defIndex: definition.from,
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
    for (const c of CitationManager.parseEndnoteDefs(content)) {
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
    const mask = markdownCitationMask(content);
    let m: RegExpExecArray | null;
    while ((m = startRe.exec(mask)) !== null) {
      const index = m.index;
      const key = m[1];
      const page = safeDecodeLocator(m[2]).value;
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
      if (mask.slice(m.index,m.index+4) !== "<!--") continue;
      results.push({
        key: m[1],
        page: safeDecodeLocator(m[2]).value,
        formattedText: m[3],
        entries: [{ key: m[1], page: safeDecodeLocator(m[2]).value, ...(safeDecodeLocator(m[2]).error ? {error:safeDecodeLocator(m[2]).error}:{}), formattedText: m[3] }],
        fullMatch: m[0],
        index: m.index,
      });
    }

    results.sort((a, b) => a.index - b.index);
    return results;
  }

  static parseEndnoteRefs(content: string): EndnoteRef[] {
    const document = parseFootnoteDocument(content);
    const defs = new Map(CitationManager.parseEndnoteDefs(content).map(d=>[footnoteKey(d.label),d]));
    return document.references.filter(ref=>!document.definitions.some(def=>ref.from>=def.from&&ref.to<=def.to)).flatMap(ref=>{
      const def=defs.get(footnoteKey(ref.label));
      return def ? [{label:def.label,key:def.key,page:def.page,formattedText:def.formattedText,entries:def.entries,fullMatch:content.slice(ref.from,ref.to),index:ref.from}] : [];
    });
  }

  static isInsideInline(content: string, pos: number): InlineCitation | null {
    for (const c of CitationManager.parseInlineCitations(content)) {
      if (pos > c.index && pos < c.index + c.fullMatch.length) return c;
    }
    return null;
  }

  static isInsideEndnoteRef(content: string, pos: number): EndnoteDef | null {
    const ref = CitationManager.parseEndnoteRefs(content).find(ref=>pos>ref.index&&pos<ref.index+ref.fullMatch.length);
    return ref ? CitationManager.parseEndnoteDefs(content).find(def=>footnoteKey(def.label)===footnoteKey(ref.label)) || null : null;
  }

  static isInsideInText(content: string, pos: number): InTextCitation | null {
    for (const c of CitationManager.parseInTextCitations(content)) {
      if (pos > c.index && pos < c.index + c.fullMatch.length) return c;
    }
    return null;
  }

  static parseZoteroEntries(text: string, marker: "zotero" | "zotero-intext" = "zotero"): CitationEntry[] {
    text = text.split(CITATION_END)[0];
    const results: CitationEntry[] = [];
    const re = new RegExp(`<!--\\s*${marker}:(${KEY_PAT}):([^ ]*)\\s*-->\\s*`, "g");
    const matches: { index: number; end: number; key: string; page: string; error?: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        index: m.index,
        end: re.lastIndex,
        key: m[1],
        page: safeDecodeLocator(m[2] || "").value,
        error: safeDecodeLocator(m[2] || "").error,
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      let formattedText = text.slice(cur.end, next ? next.index : text.length).trim();
      // The plugin joins grouped citations with "; ". Keep the delimiter out of
      // the managed citation body so refresh/reformat can rebuild a clean group.
      if (next && formattedText.endsWith(";")) formattedText = formattedText.slice(0, -1).trimEnd();
      results.push({ key: cur.key, page: cur.page, formattedText, ...(cur.error ? {error:cur.error} : {}) });
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
    return `${metadata} ${text}${CITATION_END}`;
  }

  private static refreshCitationEntries(
    entries: CitationEntry[],
    itemMap: Map<string, ZoteroItem>,
    style: string,
    marker: "zotero" | "zotero-intext",
  ): { text: string; count: number } {
    const resolved = entries.map((entry) => ({ entry, item: itemMap.get(entry.key) }));
    const available = resolved.filter((value): value is { entry: CitationEntry; item: ZoteroItem } => !!value.item);
    if (available.length !== entries.length || entries.some(e=>e.error)) {
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
    return visibleCitation(text);
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

  static replaceInlineGroup(editor: MinimalEditor, existing: InlineCitation, entries: CitationInsertEntry[], style: string, oldItems = new Map(entries.map(e=>[e.item.key,e.item]))): void {
    if (editor.getValue().slice(existing.index,existing.index+existing.fullMatch.length)!==existing.fullMatch) throw new CitationChangedError();
    editor.replaceRange(
      CitationManager.rebuildPreservingCommentary(existing.fullMatch,existing.entries,CitationManager.buildInlineFootnoteGroup(entries,style),oldItems,style,"inline"),
      editor.offsetToPos(existing.index),
      editor.offsetToPos(existing.index + existing.fullMatch.length)
    );
  }

  static replaceEndnoteDef(editor: MinimalEditor, existing: EndnoteDef, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.replaceEndnoteDefGroup(editor, existing, [{ item, page }], style);
  }

  static replaceEndnoteDefGroup(editor: MinimalEditor, existing: EndnoteDef, entries: CitationInsertEntry[], style: string, oldItems = new Map(entries.map(e=>[e.item.key,e.item]))): void {
    if (editor.getValue().slice(existing.defIndex,existing.defIndex+existing.fullMatch.length)!==existing.fullMatch) throw new CitationChangedError();
    editor.replaceRange(
      CitationManager.rebuildPreservingCommentary(existing.fullMatch,existing.entries,CitationManager.buildEndnoteDefGroup(existing.label,entries,style),oldItems,style,"endnote"),
      editor.offsetToPos(existing.defIndex),
      editor.offsetToPos(existing.defIndex + existing.fullMatch.length)
    );
  }

  static replaceInText(editor: MinimalEditor, existing: InTextCitation, item: ZoteroItem, style: string, page?: string): void {
    CitationManager.replaceInTextGroup(editor, existing, [{ item, page }], style);
  }

  static replaceInTextGroup(editor: MinimalEditor, existing: InTextCitation, entries: CitationInsertEntry[], style: string, oldItems = new Map(entries.map(e=>[e.item.key,e.item]))): void {
    if (editor.getValue().slice(existing.index,existing.index+existing.fullMatch.length)!==existing.fullMatch) throw new CitationChangedError();
    editor.replaceRange(
      CitationManager.rebuildPreservingCommentary(existing.fullMatch,existing.entries,CitationManager.buildInTextCitationGroup(entries,style),oldItems,style,"intext"),
      editor.offsetToPos(existing.index),
      editor.offsetToPos(existing.index + existing.fullMatch.length)
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // REFRESH
  // ════════════════════════════════════════════════════════════════════════

  static rebuildPreservingCommentary(original: string, entries: CitationEntry[], replacement: string, oldItems: Map<string,ZoteroItem>, style: string, kind: string): string {
    if (entries.some(e=>e.error)) throw new CitationBoundaryError();
    const parts = resolveCitationContent(citationBody(original,kind),entries,oldItems,style,kind==="intext");
    if (!parts.safe) throw new CitationBoundaryError();
    return kind === "endnote" || !replacement.startsWith("^[") ? replacement + parts.suffix : replacement.slice(0,-1) + parts.suffix + "]";
  }

  private static issueFor(citation: InlineCitation | InTextCitation | EndnoteDef, kind: CitationKind, reason: CitationIssue["reason"]): CitationIssue {
    const from = "defIndex" in citation ? citation.defIndex : citation.index;
    return {kind,label:"label" in citation ? citation.label : undefined,key:citation.key,from,to:from+citation.fullMatch.length,original:citation.fullMatch,reason};
  }

  private static refreshKind(editor: MinimalEditor, itemMap: Map<string,ZoteroItem>, style: string, kind: CitationKind, oldItems: Map<string,ZoteroItem>, onUnsafe?:()=>void, onIssue?:CitationIssueHandler): number {
    let content=editor.getValue();
    const citations = kind === "endnote" ? CitationManager.parseEndnoteDefs(content) : kind === "inline" ? CitationManager.parseInlineCitations(content) : CitationManager.parseInTextCitations(content);
    let count=0;
    for (const c of [...citations].reverse()) {
      const reason = c.entries.some(e=>e.error) ? "encoding" : c.entries.some(e=>!itemMap.has(e.key)) ? "missing" : null;
      if (reason) {onIssue?.(CitationManager.issueFor(c,kind,reason));continue;}
      const refreshed = CitationManager.refreshCitationEntries(c.entries,itemMap,style,kind==="intext"?"zotero-intext":"zotero");
      if (!refreshed.count) continue;
      const generated = kind === "endnote" ? `[^${(c as EndnoteDef).label}]: ${refreshed.text}` : `^[${refreshed.text}]`;
      let replacement: string;
      try {replacement=CitationManager.rebuildPreservingCommentary(c.fullMatch,c.entries,generated,oldItems,style,kind);}
      catch(error){if(!(error instanceof CitationBoundaryError))throw error;onUnsafe?.();onIssue?.(CitationManager.issueFor(c,kind,"boundary"));continue;}
      const from="defIndex" in c?c.defIndex:c.index;
      content=content.slice(0,from)+replacement+content.slice(from+c.fullMatch.length);
      count+=refreshed.count;
    }
    if(content!==editor.getValue())editor.setValue(content);
    return count;
  }

  static refreshInline(editor: MinimalEditor, itemMap: Map<string,ZoteroItem>, style: string, oldItems=itemMap,onUnsafe?:()=>void,onIssue?:CitationIssueHandler):number {
    return CitationManager.refreshKind(editor,itemMap,style,"inline",oldItems,onUnsafe,onIssue);
  }
  static refreshEndnotes(editor: MinimalEditor, itemMap: Map<string,ZoteroItem>, style: string, oldItems=itemMap,onUnsafe?:()=>void,onIssue?:CitationIssueHandler):number {
    return CitationManager.refreshKind(editor,itemMap,style,"endnote",oldItems,onUnsafe,onIssue);
  }
  static refreshInText(editor: MinimalEditor, itemMap: Map<string,ZoteroItem>, style: string, oldItems=itemMap,onUnsafe?:()=>void,onIssue?:CitationIssueHandler):number {
    return CitationManager.refreshKind(editor,itemMap,style,"intext",oldItems,onUnsafe,onIssue);
  }

  static removeUnreferencedEndnotes(editor: MinimalEditor): number {
    let content = editor.getValue();
    const referencedLabels = new Set(CitationManager.parseEndnoteRefs(content).map((r) => r.label));
    const defs = CitationManager.parseEndnoteDefs(content);
    let count = 0;
    for (let i = defs.length - 1; i >= 0; i--) {
      const d = defs[i];
      if (referencedLabels.has(d.label) || d.entries.some(e=>e.error)) continue;
      const body = citationBody(d.fullMatch,"endnote");
      // An unreferenced footnote with commentary must not be deleted by refresh.
      const boundary = body.indexOf(CITATION_END);
      if (boundary < 0 || body.slice(boundary+CITATION_END.length).trim()) continue;
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

  /** Generate every replacement before committing, preserving the entire group and suffix. */
  private static convertGroups(editor: MinimalEditor, itemMap: Map<string,ZoteroItem>, style: string, source: CitationKind, target: CitationKind, oldItems=itemMap,onIssue?:CitationIssueHandler): number {
    const content=editor.getValue();
    const citations = source === "endnote" ? CitationManager.parseEndnoteDefs(content) : source === "inline" ? CitationManager.parseInlineCitations(content) : CitationManager.parseInTextCitations(content);
    const refs=source==="endnote"?CitationManager.parseEndnoteRefs(content):[];
    const edits:Array<{from:number;to:number;text:string}>=[];
    const definitions:string[]=[];
    const reserved = new Set([...parseFootnoteDocument(content).definitions,...parseFootnoteDocument(content).references].map(d=>footnoteKey(d.label)));
    let next=1,count=0;
    for(const c of citations){
      const occurrences=source==="endnote"?refs.filter(r=>footnoteKey(r.label)===footnoteKey((c as EndnoteDef).label)):[];
      if(source==="endnote"&&!occurrences.length)continue;
      const reason=c.entries.some(e=>e.error)?"encoding":c.entries.some(e=>!itemMap.has(e.key))?"missing":null;
      if(reason){onIssue?.(CitationManager.issueFor(c,source,reason));continue;}
      const parts=resolveCitationContent(citationBody(c.fullMatch,source),c.entries,oldItems,style,source==="intext");
      if(!parts.safe){onIssue?.(CitationManager.issueFor(c,source,"boundary"));continue;}
      if(target!=="endnote" && /\n[ \t]*\n/.test(parts.suffix)) {onIssue?.(CitationManager.issueFor(c,source,"multiline"));continue;}
      const selected=c.entries.map(e=>({item:itemMap.get(e.key)!,page:e.page||undefined}));
      let generated:string;
      if(target==="endnote"){
        while(reserved.has(String(next)))next++;
        const label=String(next++);reserved.add(label);
        // Definition continuations must be indented even when their source was inline.
        const tail=parts.suffix.replace(/\n(?!\n| {4}|\t)/g,"\n    ");
        definitions.push(CitationManager.buildEndnoteDefGroup(label,selected,style)+tail);
        generated=`[^${label}]`;
      }else{
        const built=target==="inline"?CitationManager.buildInlineFootnoteGroup(selected,style):CitationManager.buildInTextCitationGroup(selected,style);
        generated=built.slice(0,-1)+parts.suffix+"]";
      }
      if(source==="endnote"){
        for(const ref of occurrences)edits.push({from:ref.index,to:ref.index+ref.fullMatch.length,text:generated});
        const def=c as EndnoteDef;edits.push({from:def.defIndex,to:def.defIndex+def.fullMatch.length,text:""});
      }else{const inline=c as InlineCitation;edits.push({from:inline.index,to:inline.index+inline.fullMatch.length,text:generated});}
      count+=c.entries.length;
    }
    let result=content;
    for(const edit of edits.sort((a,b)=>b.from-a.from))result=result.slice(0,edit.from)+edit.text+result.slice(edit.to);
    if(definitions.length){
      const bib=result.indexOf(BIBLIOGRAPHY_START);
      let at=bib>=0?bib:result.length;
      while(bib>=0&&at>0&&result[at-1]==="\n")at--;
      result=result.slice(0,at)+"\n\n"+definitions.join("\n\n")+(at<result.length?"\n\n":"")+result.slice(at);
    }
    if(result!==content)editor.setValue(result);
    return count;
  }

  static convertEndnotesToInline(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"endnote","inline",oldItems,onIssue);}
  static convertEndnotesToInText(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"endnote","intext",oldItems,onIssue);}
  static convertInlineToEndnotes(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"inline","endnote",oldItems,onIssue);}
  static convertInlineToInText(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"inline","intext",oldItems,onIssue);}
  static convertInTextToInline(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"intext","inline",oldItems,onIssue);}
  static convertInTextToEndnotes(editor:MinimalEditor,items:Map<string,ZoteroItem>,style:string,oldItems=items,onIssue?:CitationIssueHandler):number{return CitationManager.convertGroups(editor,items,style,"intext","endnote",oldItems,onIssue);}

  static refreshDocument(editor:MinimalEditor,itemMap:Map<string,ZoteroItem>,style:string,mode:string="endnote",oldItems=itemMap,onIssue?:CitationIssueHandler):number {
    // Stage the whole document, so a later formatter failure cannot leave partial conversion.
    let value=editor.getValue();const staged={getValue:()=>value,setValue:(next:string)=>{value=next;}} as MinimalEditor;
    let count=0;
    if(mode==="inline"){
      count+=CitationManager.refreshInline(staged,itemMap,style,oldItems,undefined,onIssue);
      count+=CitationManager.convertInTextToInline(staged,itemMap,style,oldItems,onIssue);
      count+=CitationManager.convertEndnotesToInline(staged,itemMap,style,oldItems,onIssue);
    }else if(mode==="intext"){
      count+=CitationManager.refreshInText(staged,itemMap,style,oldItems,undefined,onIssue);
      count+=CitationManager.convertInlineToInText(staged,itemMap,style,oldItems,onIssue);
      count+=CitationManager.convertEndnotesToInText(staged,itemMap,style,oldItems,onIssue);
    }else{
      count+=CitationManager.refreshEndnotes(staged,itemMap,style,oldItems,undefined,onIssue);
      count+=CitationManager.convertInTextToEndnotes(staged,itemMap,style,oldItems,onIssue);
      count+=CitationManager.convertInlineToEndnotes(staged,itemMap,style,oldItems,onIssue);
    }
    if(value.includes(BIBLIOGRAPHY_START)){
      const bib=CitationManager.generateBibliography(value,itemMap,style,CitationManager.extractBibHeading(value)||undefined);
      const from=value.indexOf(BIBLIOGRAPHY_START),to=value.indexOf(BIBLIOGRAPHY_END,from);
      if(bib&&to>=0)value=value.slice(0,from)+bib+value.slice(to+BIBLIOGRAPHY_END.length);
    }
    if(value!==editor.getValue())editor.setValue(value);
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
