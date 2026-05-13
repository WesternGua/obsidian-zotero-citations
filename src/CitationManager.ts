/**
 * CitationManager.ts – Static-methods-only class for parsing, building,
 * inserting, refreshing, and formatting Zotero citations in Obsidian.
 */
import { ZoteroItem, ZoteroCreator } from "./ZoteroAPI";

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
  index: number;
}

export interface EndnoteDef {
  label: string;
  key: string;
  page: string;
  formattedText: string;
  fullMatch: string;
  defIndex: number;
}

export interface EndnoteRef {
  label: string;
  key: string;
  page: string;
  formattedText: string;
  fullMatch: string;
  index: number;
}

export interface InTextCitation {
  key: string;
  page: string;
  formattedText: string;
  fullMatch: string;
  index: number;
}

export interface CitationRef {
  key: string;
  page: string;
}

// ── Constants ─────────────────────────────────────────────────────────────
const KEY_PAT = "[A-Za-z0-9_:.-]+";
const INLINE_RE_SRC = `\\^\\[<!-- zotero:(${KEY_PAT}):([^ ]*) --> ([\\s\\S]*?)\\]`;
const ENDNOTE_DEF_RE_SRC = `^\\[\\^(\\d+)\\]: <!-- zotero:(${KEY_PAT}):([^ ]*) --> (.+)$`;
const IN_TEXT_LEGACY_RE_SRC = `<!-- zotero-inline:(${KEY_PAT}):([^ ]*) -->\\s*([\\s\\S]*?)\\s*<!-- \\/zotero-inline -->`;
const BIBLIOGRAPHY_START = "<!-- zotero-bibliography-start -->";
const BIBLIOGRAPHY_END = "<!-- zotero-bibliography-end -->";

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
      results.push({
        fullMatch: content.slice(index, pos + 1),
        key,
        page,
        formattedText: content.slice(bodyStart, pos),
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
      results.push({
        label: m[1],
        key: m[2],
        page: decodeURIComponent(m[3]),
        formattedText: m[4],
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
      if (!seen.has(c.key)) {
        seen.add(c.key);
        out.push({ key: c.key, page: c.page });
      }
    }
    for (const c of CitationManager.parseEndnoteRefs(content)) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        out.push({ key: c.key, page: c.page });
      }
    }
    for (const c of CitationManager.parseInTextCitations(content)) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        out.push({ key: c.key, page: c.page });
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
      results.push({
        key,
        page,
        formattedText: content.slice(bodyStart, pos),
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
      if (pos >= m.index && pos <= m.index + m[0].length) return defs.get(m[1]) ?? null;
    }
    return null;
  }

  static isInsideInText(content: string, pos: number): InTextCitation | null {
    for (const c of CitationManager.parseInTextCitations(content)) {
      if (pos > c.index && pos < c.index + c.fullMatch.length) return c;
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // BUILDING
  // ════════════════════════════════════════════════════════════════════════

  static buildInlineFootnote(item: ZoteroItem, style: string, page?: string): string {
    const text = CitationManager.formatCitation(item, style, page);
    return `^[<!-- zotero:${item.key}:${encodeURIComponent(page ?? "")} --> ${text}]`;
  }

  static buildEndnoteDef(label: string, item: ZoteroItem, style: string, page?: string): string {
    const text = CitationManager.formatCitation(item, style, page);
    return `[^${label}]: <!-- zotero:${item.key}:${encodeURIComponent(page ?? "")} --> ${text}`;
  }

  static buildInTextCitation(item: ZoteroItem, style: string, page?: string): string {
    const text = CitationManager.formatCitation(item, style, page);
    return `^[<!-- zotero-intext:${item.key}:${encodeURIComponent(page ?? "")} --> ${text}]`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // INSERTION
  // ════════════════════════════════════════════════════════════════════════

  static insertInline(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceSelection(CitationManager.buildInlineFootnote(item, style, page));
  }

  static insertEndnote(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    const content = editor.getValue();
    let max = 0;
    const re = /\[\^(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) max = Math.max(max, parseInt(m[1]));
    const label = String(max + 1);
    editor.replaceSelection(`[^${label}]`);
    const updated = editor.getValue();
    const def = CitationManager.buildEndnoteDef(label, item, style, page);
    const bibStart = updated.indexOf(BIBLIOGRAPHY_START);
    if (bibStart !== -1) {
      let ins = bibStart;
      while (ins > 0 && updated[ins - 1] === "\n") ins--;
      editor.replaceRange("\n\n" + def, editor.offsetToPos(ins), editor.offsetToPos(ins));
    } else {
      editor.replaceRange("\n\n" + def, editor.offsetToPos(updated.length));
    }
  }

  static insertInText(editor: MinimalEditor, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceSelection(CitationManager.buildInTextCitation(item, style, page));
  }

  static replaceInline(editor: MinimalEditor, existing: InlineCitation, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceRange(
      CitationManager.buildInlineFootnote(item, style, page),
      editor.offsetToPos(existing.index),
      editor.offsetToPos(existing.index + existing.fullMatch.length)
    );
  }

  static replaceEndnoteDef(editor: MinimalEditor, existing: EndnoteDef, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceRange(
      CitationManager.buildEndnoteDef(existing.label, item, style, page),
      editor.offsetToPos(existing.defIndex),
      editor.offsetToPos(existing.defIndex + existing.fullMatch.length)
    );
  }

  static replaceInText(editor: MinimalEditor, existing: InTextCitation, item: ZoteroItem, style: string, page?: string): void {
    editor.replaceRange(
      CitationManager.buildInTextCitation(item, style, page),
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
      const item = itemMap.get(c.key);
      if (!item) continue;
      content = content.slice(0, c.index) + CitationManager.buildInlineFootnote(item, style, c.page || undefined) + content.slice(c.index + c.fullMatch.length);
      count++;
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
      const item = itemMap.get(d.key);
      if (!item) continue;
      content = content.slice(0, d.defIndex) + CitationManager.buildEndnoteDef(d.label, item, style, d.page || undefined) + content.slice(d.defIndex + d.fullMatch.length);
      count++;
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
      const item = itemMap.get(c.key);
      if (!item) continue;
      content = content.slice(0, c.index) + CitationManager.buildInTextCitation(item, style, c.page || undefined) + content.slice(c.index + c.fullMatch.length);
      count++;
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
      CitationManager.insertOrReplaceBibliography(editor, bib);
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
    for (const c of all) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        const it = itemMap.get(c.key);
        if (it) items.push(it);
      }
    }
    if (!items.length) return "";
    const entries = items.map((it, i) => CitationManager.formatBibEntry(it, style, i + 1));
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

  static formatCitation(item: ZoteroItem, style: string, page?: string): string {
    switch (style) {
      case "chicago-note-bibliography":
        return CitationManager.fmtChicagoNote(item, page);
      case "chicago-author-date":
        return CitationManager.fmtChicagoAD(item, page);
      case "apa":
        return CitationManager.fmtAPA(item, page);
      case "modern-language-association":
        return CitationManager.fmtMLA(item, page);
      case "vancouver":
        return CitationManager.fmtVancouver(item, page);
      case "gb-t-7714-2015-numeric":
      case "gb-t-7714-2015-author-date":
        return CitationManager.fmtGBT(item, page);
      case "oscola":
        return CitationManager.fmtOSCOLA(item, page);
      case "harvard-cite-them-right":
        return CitationManager.fmtHarvard(item, page);
      case "ieee":
        return CitationManager.fmtIEEE(item, page);
      default:
        return CitationManager.fmtChicagoNote(item, page);
    }
  }

  static formatBibEntry(item: ZoteroItem, style: string, idx: number): string {
    switch (style) {
      case "chicago-note-bibliography":
      case "chicago-author-date":
        return CitationManager.bibChicago(item);
      case "apa":
      case "harvard-cite-them-right":
        return CitationManager.bibAPA(item);
      case "modern-language-association":
        return CitationManager.bibMLA(item);
      case "vancouver":
        return `${idx}. ${CitationManager.bibVancouver(item)}`;
      case "gb-t-7714-2015-numeric":
        return `[${idx}] ${CitationManager.bibGBT(item)}`;
      case "gb-t-7714-2015-author-date":
        return CitationManager.bibGBT(item);
      case "oscola":
        return CitationManager.bibOSCOLA(item);
      case "ieee":
        return `[${idx}] ${CitationManager.bibIEEE(item)}`;
      default:
        return CitationManager.bibChicago(item);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static getYear(item: ZoteroItem): string {
    if (!item.date) return "n.d.";
    return item.date.match(/\b(\d{4})\b/)?.[1] ?? item.date;
  }

  static getAuthors(item: ZoteroItem, type: string = "author"): ZoteroCreator[] {
    return item.creators.filter((c) => c.creatorType === type);
  }

  static nameNormal(c: ZoteroCreator): string {
    if (c.name) return c.name;
    return [c.firstName, c.lastName].filter(Boolean).join(" ");
  }

  static nameInverted(c: ZoteroCreator): string {
    if (c.name) return c.name;
    const f = c.firstName ?? "";
    const l = c.lastName ?? "";
    return l ? `${l}${f ? ", " + f : ""}` : f;
  }

  static authorStr(item: ZoteroItem, max: number = 3, inverted: boolean = false): string {
    const a = CitationManager.getAuthors(item);
    if (!a.length) return "Anonymous";
    const names = a.map((x, i) => i === 0 && inverted ? CitationManager.nameInverted(x) : CitationManager.nameNormal(x));
    if (names.length > max) return names[0] + " et al.";
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  static initials(item: ZoteroItem, max: number = 6): string {
    const a = CitationManager.getAuthors(item);
    if (!a.length) return "Anon";
    const names = a.map((x) => {
      if (x.name) return x.name;
      const inits = (x.firstName ?? "").split(/\s+/).filter(Boolean).map((n) => n[0] + ".").join(" ");
      return (x.lastName ?? "") + (inits ? " " + inits : "");
    });
    return names.length > max ? names.slice(0, max).join(", ") + " et al." : names.join(", ");
  }

  static it(s: string): string {
    return `*${s}*`;
  }

  // ── Chicago Notes-Bibliography ─────────────────────────────────────────────

  static fmtChicagoNote(item: ZoteroItem, page?: string): string {
    const a = CitationManager.authorStr(item);
    const y = CitationManager.getYear(item);
    const p = page ? `, ${page}` : "";
    switch (item.itemType) {
      case "legal_case": {
        const court = item.court ?? item.authority;
        return `${CitationManager.it(item.title)} [${y}]${court ? " " + court : ""}${item.docketNumber ? " " + item.docketNumber : ""}${p}.`;
      }
      case "book":
        return `${a}, ${CitationManager.it(item.title)} (${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y})${p}.`;
      case "bookSection": {
        const eds = CitationManager.getAuthors(item, "editor").map((e) => CitationManager.nameNormal(e)).join(", ");
        return `${a}, "${item.title}," in ${CitationManager.it(item.bookTitle ?? "Unknown")}${eds ? ", ed. " + eds : ""} (${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y})${p}.`;
      }
      case "journalArticle":
        return `${a}, "${item.title}," ${CitationManager.it(item.publicationTitle ?? "Journal")}${item.volume ? " " + item.volume : ""}${item.issue ? ", no. " + item.issue : ""} (${y})${item.pages ? ": " + item.pages : ""}${p}.`;
      case "thesis":
        return `${a}, "${item.title}" (${item.thesisType ?? "PhD diss."}, ${item.university ?? "n.p."}, ${y})${p}.`;
      default:
        return `${a}, "${item.title}" (${y})${p}.`;
    }
  }

  static bibChicago(item: ZoteroItem): string {
    const a = CitationManager.authorStr(item, 3, true);
    const y = CitationManager.getYear(item);
    switch (item.itemType) {
      case "legal_case": {
        const court = item.court ?? item.authority;
        return `${CitationManager.it(item.title)}. ${court ? court + ". " : ""}${item.docketNumber ? item.docketNumber + ". " : ""}${y}.`;
      }
      case "book":
        return `${a}. ${CitationManager.it(item.title)}. ${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y}.`;
      case "bookSection": {
        const eds = CitationManager.getAuthors(item, "editor").map((e) => CitationManager.nameNormal(e)).join(", ");
        return `${a}. "${item.title}." In ${CitationManager.it(item.bookTitle ?? "Unknown")}${eds ? ", edited by " + eds : ""}. ${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y}.`;
      }
      case "journalArticle":
        return `${a}. "${item.title}." ${CitationManager.it(item.publicationTitle ?? "Journal")}${item.volume ? " " + item.volume : ""}${item.issue ? ", no. " + item.issue : ""} (${y})${item.pages ? ": " + item.pages : ""}.${item.DOI ? " https://doi.org/" + item.DOI : ""}`;
      case "thesis":
        return `${a}. "${item.title}." ${item.thesisType ?? "PhD diss."}, ${item.university ?? "n.p."}, ${y}.`;
      default:
        return `${a}. "${item.title}." ${y}.`;
    }
  }

  static fmtChicagoAD(item: ZoteroItem, page?: string): string {
    const l = CitationManager.getAuthors(item)[0]?.lastName ?? "Anonymous";
    return `(${l} ${CitationManager.getYear(item)}${page ? ", " + page : ""})`;
  }

  static fmtAPA(item: ZoteroItem, page?: string): string {
    const a = CitationManager.getAuthors(item);
    const str = a.length <= 2
      ? a.map((x) => x.lastName ?? "").filter(Boolean).join(" & ")
      : (a[0]?.lastName ?? "") + " et al.";
    return `(${str || "Anonymous"}, ${CitationManager.getYear(item)}${page ? ", p. " + page : ""})`;
  }

  static bibAPA(item: ZoteroItem): string {
    const a = CitationManager.getAuthors(item).map((x) => {
      if (x.name) return x.name;
      const ini = (x.firstName ?? "").split(/\s+/).filter(Boolean).map((n) => n[0] + ".").join(" ");
      return `${x.lastName ?? ""}${ini ? ", " + ini : ""}`;
    }).join(", ") || "Anonymous";
    const y = CitationManager.getYear(item);
    switch (item.itemType) {
      case "book":
        return `${a}. (${y}). ${CitationManager.it(item.title)}${item.edition ? ` (${item.edition} ed.)` : ""}. ${item.publisher ?? "n.p."}.`;
      case "journalArticle":
        return `${a}. (${y}). ${item.title}. ${CitationManager.it(item.publicationTitle ?? "Journal")}${item.volume ? `, ${CitationManager.it(item.volume)}` : ""}${item.issue ? `(${item.issue})` : ""}${item.pages ? `, ${item.pages}` : ""}.${item.DOI ? ` https://doi.org/${item.DOI}` : ""}`;
      default:
        return `${a}. (${y}). ${item.title}.`;
    }
  }

  static fmtMLA(item: ZoteroItem, page?: string): string {
    return `(${CitationManager.getAuthors(item)[0]?.lastName ?? "Anonymous"}${page ? " " + page : ""})`;
  }

  static bibMLA(item: ZoteroItem): string {
    const a = CitationManager.getAuthors(item);
    const as = !a.length
      ? "Anonymous."
      : a.length === 1
        ? CitationManager.nameInverted(a[0]) + "."
        : a.length === 2
          ? `${CitationManager.nameInverted(a[0])}, and ${CitationManager.nameNormal(a[1])}.`
          : CitationManager.nameInverted(a[0]) + ", et al.";
    const y = CitationManager.getYear(item);
    switch (item.itemType) {
      case "book":
        return `${as} ${CitationManager.it(item.title)}. ${item.publisher ?? "n.p."}, ${y}.`;
      case "journalArticle":
        return `${as} "${item.title}." ${CitationManager.it(item.publicationTitle ?? "Journal")}${item.volume ? `, vol. ${item.volume}` : ""}${item.issue ? `, no. ${item.issue}` : ""}, ${y}${item.pages ? `, pp. ${item.pages}` : ""}.`;
      default:
        return `${as} ${CitationManager.it(item.title)}. ${y}.`;
    }
  }

  static fmtVancouver(item: ZoteroItem, page?: string): string {
    return `${CitationManager.getAuthors(item)[0]?.lastName ?? "Anon"} ${CitationManager.getYear(item)}${page ? ":" + page : ""}`;
  }

  static bibVancouver(item: ZoteroItem): string {
    const a = CitationManager.initials(item);
    const y = CitationManager.getYear(item);
    switch (item.itemType) {
      case "journalArticle":
        return `${a}. ${item.title}. ${item.publicationTitle ?? "Journal"}. ${y};${item.volume ?? ""}${item.issue ? `(${item.issue})` : ""}${item.pages ? `:${item.pages}` : ""}.`;
      case "book":
        return `${a}. ${item.title}. ${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}; ${y}.`;
      default:
        return `${a}. ${item.title}. ${y}.`;
    }
  }

  static fmtGBT(item: ZoteroItem, page?: string): string {
    return `${CitationManager.getAuthors(item)[0]?.lastName ?? ""}${CitationManager.getYear(item)}${page ? ": " + page : ""}`;
  }

  static bibGBT(item: ZoteroItem): string {
    const a = CitationManager.getAuthors(item).slice(0, 3).map((x) => {
      return (x.lastName ?? "") + (x.firstName ? " " + x.firstName : "");
    }).join(", ") + (CitationManager.getAuthors(item).length > 3 ? ", \u7B49" : "") || "\u4F5A\u540D";
    const y = CitationManager.getYear(item);
    const dt: Record<string, string> = { book: "M", journalArticle: "J", bookSection: "M", conferencePaper: "C", thesis: "D", report: "R", webpage: "EB/OL" };
    const d = dt[item.itemType] ?? "Z";
    switch (item.itemType) {
      case "book":
        return `${a}. ${item.title}[${d}]. ${[item.place, item.publisher].filter(Boolean).join(": ") || "\u51FA\u7248\u5730\u4E0D\u8BE6: \u51FA\u7248\u8005\u4E0D\u8BE6"}, ${y}.`;
      case "journalArticle":
        return `${a}. ${item.title}[${d}]. ${item.publicationTitle ?? "\u671F\u520A"}${item.volume ? `, ${item.volume}` : ""}${item.issue ? `(${item.issue})` : ""}, ${y}${item.pages ? `: ${item.pages}` : ""}.`;
      case "thesis":
        return `${a}. ${item.title}[${d}]. ${item.university ?? "\u5B66\u6821\u4E0D\u8BE6"}, ${y}.`;
      default:
        return `${a}. ${item.title}[${d}]. ${y}.`;
    }
  }

  static fmtOSCOLA(item: ZoteroItem, page?: string): string {
    const a = CitationManager.authorStr(item);
    const y = CitationManager.getYear(item);
    const p = page ? " " + page : "";
    switch (item.itemType) {
      case "book":
        return `${a}, ${CitationManager.it(item.title)} (${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y})${p}`;
      case "journalArticle":
        return `${a}, '${item.title}' (${y}) ${item.volume ?? ""} ${item.publicationTitle ?? ""}${item.pages ? " " + item.pages : ""}${p}`;
      default:
        return `${a}, ${CitationManager.it(item.title)} (${y})${p}`;
    }
  }

  static bibOSCOLA(item: ZoteroItem): string {
    return CitationManager.fmtOSCOLA(item);
  }

  static fmtHarvard(item: ZoteroItem, page?: string): string {
    return `(${CitationManager.getAuthors(item)[0]?.lastName ?? "Anonymous"}, ${CitationManager.getYear(item)}${page ? ", p. " + page : ""})`;
  }

  static fmtIEEE(item: ZoteroItem, _page?: string): string {
    return CitationManager.getAuthors(item)[0]?.lastName ?? "Anon";
  }

  static bibIEEE(item: ZoteroItem): string {
    const a = CitationManager.initials(item);
    const y = CitationManager.getYear(item);
    switch (item.itemType) {
      case "journalArticle":
        return `${a}, "${item.title}," ${CitationManager.it(item.publicationTitle ?? "Journal")}${item.volume ? `, vol. ${item.volume}` : ""}${item.issue ? `, no. ${item.issue}` : ""}${item.pages ? `, pp. ${item.pages}` : ""}, ${y}.`;
      case "book":
        return `${a}, ${CitationManager.it(item.title)}. ${[item.place, item.publisher].filter(Boolean).join(": ") || "n.p."}, ${y}.`;
      default:
        return `${a}, "${item.title}," ${y}.`;
    }
  }
}
