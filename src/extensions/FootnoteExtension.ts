import { alignLocatorPreview } from "../LocatorPreviewAlignment";
/**
 * FootnoteExtension.ts – CodeMirror extension for Word-style footnote rendering
 */
import { App, Component, MarkdownRenderer, MarkdownView, Notice, editorInfoField } from "obsidian";
import { ViewPlugin, WidgetType, Decoration, EditorView, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { appT } from "../i18n";
import { CitationManager, type CitationEntry } from "../CitationManager";
import { buildLocatorReplacement } from "../CitationLocator";
import { ZoteroItem } from "../ZoteroAPI";
import { CslEngine } from "../CslEngine";
import { mountCompactLocatorEditor } from "./CompactLocatorEditor";
import { citationBody, resolveCitationContent, displayCitationBody, CitationBoundaryError } from "../CitationContent";
import { createFootnoteNavigationExtension, navigateFootnote } from "./FootnoteNavigation";

export interface FootnoteExtensionOptions {
  isEnabled: () => boolean;
  app: App;
  getSourcePath: () => string;
}

interface PreviewInfo {
  markdown: string;
  text: string;
  display: "footnote" | "intext";
  edit?: EditInfo | null;
}

interface InlineEditInfo {
  kind: "inline";
  key: string;
  locator: string;
  entries: CitationEntry[];
  original: string;
  from: number;
  to: number;
}

interface InTextEditInfo {
  kind: "intext";
  key: string;
  locator: string;
  entries: CitationEntry[];
  original: string;
  from: number;
  to: number;
}

interface EndnoteEditInfo {
  kind: "endnote";
  key: string;
  locator: string;
  entries: CitationEntry[];
  original: string;
  label: string;
  from: number;
  to: number;
}

type EditInfo = InlineEditInfo | InTextEditInfo | EndnoteEditInfo;

// ── Widget ─────────────────────────────────────────────────────────────────
class FnWidget extends WidgetType {
  constructor(
    public num: number,
    public preview: PreviewInfo,
    public app: App,
    public getSourcePath: () => string,
    public sourceView: EditorView,
    public identifier: string,
    public domId: string,
    public isHighlighted: boolean = false,
    public referenceFrom: number = 0,
  ) {
    super();
  }

  eq(other: FnWidget): boolean {
    return (
      this.num === other.num &&
      this.preview.markdown === other.preview.markdown &&
      this.preview.text === other.preview.text &&
      this.identifier === other.identifier &&
      this.referenceFrom === other.referenceFrom &&
      this.domId === other.domId &&
      this.isHighlighted === other.isHighlighted &&
      this.preview.edit?.from === other.preview.edit?.from
    );
  }

  toDOM(): HTMLElement {
    const wrapper = createSpanEl({ cls: this.preview.display === "intext" ? "zotero-intext-widget" : "zotero-fn-widget" });

    if (this.isHighlighted) {
      wrapper.classList.add("zotero-fn-highlighted", "cm-highlight");
    }

    const text = this.preview.text || appT(this.app, "footnote.fallback", { value: this.num });
    const marker = createSpanEl();

    if (this.preview.display === "intext") {
      marker.className = "zotero-intext-marker";
      marker.setAttribute("tabindex", "0");
      marker.textContent = this.preview.markdown || text;
      wrapper.appendChild(marker);
    } else {
      const sup = wrapper.createEl("sup", { cls: "zotero-fn-num footnote-ref" });
      sup.setAttribute("data-footnote-id", `fnref-${this.domId}`);

      marker.className = "footnote-link zotero-footnote-marker";
      marker.setAttribute("data-footref", this.identifier);
      marker.setAttribute("tabindex", "0");
      marker.textContent = `[${this.domId}]`;
      sup.appendChild(marker);
    }

    marker.addEventListener("mousedown", (event) => event.preventDefault());
    marker.addEventListener("click", (event) => event.preventDefault());
    marker.addEventListener("dblclick", event => {
      event.preventDefault(); event.stopPropagation();
      destroyActivePopover();
      navigateFootnote(this.sourceView,this.referenceFrom);
    });

    attachRenderedPopover(marker, {
      app: this.app,
      getSourcePath: this.getSourcePath,
      sourceView: this.sourceView,
      markdown: this.preview.markdown,
      fallbackText: text,
      edit: this.preview.edit || undefined,
    });

    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.type === "mouseenter" || event.type === "mouseleave" ||
      event.type === "mousemove" || event.type === "mouseover" ||
      event.type === "mouseout" || event.type === "pointerenter" ||
      event.type === "pointerleave" || event.type === "pointermove" ||
      event.type === "pointerover" || event.type === "pointerout" ||
      event.type === "mousedown" || event.type === "mouseup" ||
      event.type === "click" || event.type === "dblclick"
    );
  }
}

// ── Extension factory ──────────────────────────────────────────────────────
export function createFootnoteExtension(options: FootnoteExtensionOptions) {
  return [createFootnoteNavigationExtension(), ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof buildDeco>;
      constructor(view: EditorView) {
        this.decorations = buildDeco(view, options);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDeco(update.view, options);
        }
      }
    },
    { decorations: (v) => v.decorations },
  )];
}

function buildDeco(view: EditorView, options: FootnoteExtensionOptions) {
  const doc = view.state.doc.toString();
  const renderFootnoteMarkers = options.isEnabled();
  const inTextCitations = CitationManager.parseInTextCitations(doc);
  if (!renderFootnoteMarkers && !inTextCitations.length) return Decoration.none;

  const sel = view.state.selection.main;
  const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? options.getSourcePath();
  const endnotePreviews = buildEndnotePreviewMap(doc, options.app);

  const hits: Array<{
    start: number; end: number; num: number;
    markdown: string; text: string; identifier: string;
    domId: string; display: "footnote" | "intext"; edit?: EditInfo | null;
  }> = [];

  const tokenRe = /\^\[(?:[^\]\\]|\\.)*\]|\[\^([^\]\n]+)\](?!:)/g;
  let sequence = 0;
  let inlineSerial = 0;
  const refOrder = new Map<string, number>();
  const refUses = new Map<string, number>();
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(doc)) !== null) {
    const raw = m[0];
    if (raw.startsWith("^[")) {
      const preview = extractInlinePreview(raw, sequence, options.app);
      if (preview.display !== "intext" && !renderFootnoteMarkers) continue;
      if (preview.edit) {
        preview.edit.from = m.index;
        preview.edit.to = m.index + raw.length;
      }
      if (preview.display !== "intext") sequence++;
      hits.push({
        start: m.index, end: m.index + raw.length,
        num: sequence, identifier: `[inline${inlineSerial}]`,
        domId: String(sequence), ...preview,
      });
      inlineSerial++;
      continue;
    }

    const lineStart = doc.lastIndexOf("\n", m.index - 1) + 1;
    const before = doc.slice(lineStart, m.index);
    if (/^\s*$/.test(before)) continue;
    if (!renderFootnoteMarkers) continue;

    const label = m[1].trim().toLowerCase();
    let ordinal = refOrder.get(label);
    if (ordinal == null) {
      sequence++;
      ordinal = sequence;
      refOrder.set(label, ordinal);
      refUses.set(label, 0);
    }
    const repeatCount = refUses.get(label) ?? 0;
    refUses.set(label, repeatCount + 1);

    const endnotePreview = endnotePreviews.get(label);
    hits.push({
      start: m.index, end: m.index + raw.length,
      num: ordinal, identifier: label,
      domId: repeatCount > 0 ? `${ordinal}-${repeatCount}` : `${ordinal}`,
      ...(endnotePreview ?? {
        markdown: "",
        text: appT(options.app, "footnote.fallback", { value: ordinal }),
        display: "footnote" as const,
      }),
    });
  }

  for (const legacy of inTextCitations) {
    if (!legacy.fullMatch.startsWith("<!-- zotero-inline:")) continue;
    hits.push({
      start: legacy.index,
      end: legacy.index + legacy.fullMatch.length,
      num: 0,
      markdown: legacy.formattedText,
      text: normalizeTooltipText(legacy.formattedText),
      identifier: `[intext-legacy-${legacy.index}]`,
      domId: `intext-${legacy.index}`,
      display: "intext",
      edit: {
        kind: "intext",
        key: legacy.key,
        locator: legacy.page,
        entries: legacy.entries,
        original: legacy.fullMatch,
        from: legacy.index,
        to: legacy.index + legacy.fullMatch.length,
      },
    });
  }

  hits.sort((a, b) => a.start - b.start);
  const ranges: Range<Decoration>[] = [];
  let lastEnd = -1;

  for (const { start, end, num, markdown, text, identifier, domId, display, edit } of hits) {
    if (start < lastEnd) continue;
    if (sel.from <= end && sel.to >= start) continue;
    if (!inViewport(view, start, end)) continue;

    ranges.push(
      Decoration.replace({
        widget: new FnWidget(
          num, { markdown, text, display, edit }, options.app,
          () => sourcePath, view, identifier, domId,
          isInsideHighlight(doc, start, end),
          start,
        ),
      }).range(start, end),
    );
    lastEnd = end;
  }

  return Decoration.set(ranges);
}

function inViewport(view: EditorView, from: number, to: number): boolean {
  for (const vr of view.visibleRanges) {
    if (from <= vr.to && to >= vr.from) return true;
  }
  return false;
}

function isInsideHighlight(doc: string, from: number, to: number): boolean {
  const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  let lineEnd = doc.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = doc.length;
  const line = doc.slice(lineStart, lineEnd);
  const relFrom = from - lineStart;
  const relTo = to - lineStart;

  const before = line.slice(0, relFrom);
  const after = line.slice(relTo);
  const beforeCount = countHighlightDelimiters(before);
  const afterCount = countHighlightDelimiters(after);

  // Standard closed highlight: odd before + odd after.
  // Tolerate unmatched opening == in Live Preview as well (odd before + no closing in the remainder).
  const hasOpenBefore = beforeCount % 2 === 1;
  const hasCloseAfter = afterCount % 2 === 1;
  const noDelimiterAfter = afterCount === 0;

  return hasOpenBefore && (hasCloseAfter || noDelimiterAfter);
}

function countHighlightDelimiters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "=" && text[i + 1] === "=") { count++; i++; }
  }
  return count;
}

function extractInlinePreview(rawMarker: string, num: number, app: App): { markdown: string; text: string; display: "footnote" | "intext"; edit?: EditInfo | null } {
  const body = rawMarker.slice(2, -1);
  const metadata = parseZoteroMetadata(body);
  const markdown = metadata.markdown.trim();
  const text = normalizeTooltipText(markdown);
  if (metadata.kind === "intext") {
    return {
      markdown,
      text: text || appT(app, "footnote.fallback", { value: num }),
      display: "intext",
      edit: metadata.key ? { kind: "intext", key: metadata.key, locator: metadata.locator, entries: metadata.entries, original: rawMarker, from: -1, to: -1 } : null,
    };
  }
  return {
    markdown,
    text: text || appT(app, "footnote.fallback", { value: num }),
    display: "footnote",
    edit: metadata.key ? { kind: "inline", key: metadata.key, locator: metadata.locator, entries: metadata.entries, original: rawMarker, from: -1, to: -1 } : null,
  };
}

function buildEndnotePreviewMap(doc: string, app: App): Map<string, { markdown: string; text: string; display: "footnote" | "intext"; edit?: EditInfo | null }> {
  const map = new Map<string, { markdown: string; text: string; display: "footnote" | "intext"; edit?: EditInfo | null }>();
  const lines = doc.split("\n");
  const lineOffsets: number[] = [];
  let docOffset = 0;
  for (const line of lines) {
    lineOffsets.push(docOffset);
    docOffset += line.length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\[\^([^\]\n]+)\]:\s*(.*)$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    const body = [match[2]];
    let next = i + 1;
    while (next < lines.length) {
      const line = lines[next];
      if (/^( {4}|\t)/.test(line)) {
        body.push(line.replace(/^( {4}|\t)/, ""));
        next++;
        continue;
      }
      if (line.trim() === "" && next + 1 < lines.length && /^( {4}|\t)/.test(lines[next + 1])) {
        body.push("");
        next++;
        continue;
      }
      break;
    }
    const metadata = parseZoteroMetadata(body.join("\n"));
    const markdown = metadata.markdown.trim();
    const endLine = next - 1;
    map.set(label, {
      markdown,
      text: normalizeTooltipText(markdown) || appT(app, "footnote.fallback", { value: label }),
      display: "footnote",
      edit: metadata.key ? {
        kind: "endnote", key: metadata.key, locator: metadata.locator,
        entries: metadata.entries, original: doc.slice(lineOffsets[i], lineOffsets[endLine] + lines[endLine].length),
        label: match[1], from: lineOffsets[i], to: lineOffsets[endLine] + lines[endLine].length,
      } : null,
    });
    i = next - 1;
  }
  return map;
}

function parseZoteroMetadata(text: string): { kind: "inline" | "intext" | "none"; key: string; locator: string; markdown: string; entries: CitationEntry[] } {
  const inlineMatch = text.match(/^<!--\s*zotero:([^:>]+):([^ ]*)\s*-->\s*/);
  if (inlineMatch) {
    return {
      kind: "inline",
      key: inlineMatch[1],
      locator: decodeURIComponent(inlineMatch[2] || ""),
      entries: CitationManager.parseZoteroEntries(text, "zotero"),
      markdown: stripZoteroMetadataComments(text.slice(inlineMatch[0].length)),
    };
  }

  const inTextMatch = text.match(/^<!--\s*zotero-intext:([^:>]+):([^ ]*)\s*-->\s*/);
  if (inTextMatch) {
    return {
      kind: "intext",
      key: inTextMatch[1],
      locator: decodeURIComponent(inTextMatch[2] || ""),
      entries: CitationManager.parseZoteroEntries(text, "zotero-intext"),
      markdown: stripZoteroMetadataComments(text.slice(inTextMatch[0].length)),
    };
  }

  return { kind: "none", key: "", locator: "", markdown: text, entries: [] };
}

function stripZoteroMetadataComments(text: string): string {
  return text.replace(/<!--\s*zotero(?:-intext)?:[^>]*-->[ \t]*/g, "").replace(/<!--\s*\/zotero-citation\s*-->/g, "");
}

function normalizeTooltipText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ── Popover system ─────────────────────────────────────────────────────────
let activePopover: {
  target: HTMLElement; popover: HTMLElement; component: Component;
  hideTimer: number | null; reposition: () => void;
  onPopoverEnter: () => void; onPopoverLeave: () => void;
} | null = null;

interface PopoverSpec {
  app: App;
  getSourcePath: () => string;
  sourceView?: EditorView;
  markdown: string;
  fallbackText: string;
  edit?: EditInfo;
}

interface ZoteroPluginLike {
  api?: { ping: () => Promise<boolean> };
  settings: { cslStyle: string };
  getCached: (key: string) => ZoteroItem | undefined;
  fetchAndCache: (key: string) => Promise<ZoteroItem | null>;
  fetchAndCacheRemote?: (key: string) => Promise<ZoteroItem | null>;
  ensureInstalledStyle?: () => boolean;
}

type AppWithPlugins = App & {
  plugins?: {
    plugins?: Record<string, ZoteroPluginLike | undefined>;
  };
};

function getActiveWindow(): Window {
  const maybeWin = window as Window & { activeWindow?: Window };
  return maybeWin.activeWindow ?? window;
}

function getActiveDocument(): Document {
  const maybeWin = window as Window & { activeDocument?: Document };
  return maybeWin.activeDocument ?? getActiveWindow().document;
}

function createDivEl(options?: { cls?: string }): HTMLDivElement {
  const el = getActiveDocument().createElement("div");
  if (options?.cls) el.className = options.cls;
  return el;
}

function createSpanEl(options?: { cls?: string }): HTMLSpanElement {
  const el = getActiveDocument().createElement("span");
  if (options?.cls) el.className = options.cls;
  return el;
}

function attachRenderedPopover(target: HTMLElement, spec: PopoverSpec): void {
  const show = () => showRenderedPopover(target, spec);
  const scheduleHide = () => schedulePopoverHide(target);
  target.addEventListener("mouseenter", show);
  target.addEventListener("mouseleave", scheduleHide);
  target.addEventListener("mousemove", show);
  target.addEventListener("pointerenter", show);
  target.addEventListener("pointerleave", scheduleHide);
  target.addEventListener("pointermove", show);
  target.addEventListener("focus", show);
  target.addEventListener("blur", scheduleHide);
}

function showRenderedPopover(target: HTMLElement, spec: PopoverSpec): void {
  if (!spec.markdown && !spec.fallbackText) return;
  if (activePopover?.target === target) {
    cancelPopoverHide();
    activePopover.reposition();
    return;
  }
  destroyActivePopover();

  const popover = createDivEl({ cls: "popover hover-popover zotero-footnote-popover" });

  const embed = popover.createDiv({ cls: "markdown-embed", attr: { "data-type": "footnote" } });
  const embedContent = embed.createDiv({ cls: "markdown-embed-content" });
  const preview = embedContent.createDiv({ cls: "markdown-preview-view markdown-rendered" });
  preview.setText(spec.fallbackText);

  if (!spec.markdown.trim()) embed.addClass("mod-empty");

  getActiveDocument().body.appendChild(popover);
  const component = new Component();
  const reposition = () => positionPopover(target, popover);
  const onPopoverEnter = () => cancelPopoverHide();
  const onPopoverLeave = () => schedulePopoverHide(target);
  popover.addEventListener("mouseenter", onPopoverEnter);
  popover.addEventListener("mouseleave", onPopoverLeave);
  getActiveWindow().addEventListener("scroll", reposition, true);
  getActiveWindow().addEventListener("resize", reposition);

  activePopover = { target, popover, component, hideTimer: null, reposition, onPopoverEnter, onPopoverLeave };
  reposition();
  getActiveWindow().requestAnimationFrame(reposition);

  if (spec.markdown.trim()) {
    void renderPopoverMarkdown(preview, spec, component, target, reposition);
  }
}

async function renderPopoverMarkdown(preview: HTMLElement, spec: PopoverSpec, component: Component, target: HTMLElement, reposition: () => void): Promise<void> {
  try {
    const placeholder=preview.firstChild;
    await MarkdownRenderer.render(spec.app, spec.markdown, preview, spec.getSourcePath(), component);
    if (activePopover?.target !== target) return;
    if(placeholder?.parentNode===preview)placeholder.remove();
    // Paint the existing footnote before formatting locator controls.
    if (spec.edit) {
      await new Promise<void>(resolve=>getActiveWindow().setTimeout(resolve,0));
      if (activePopover?.target !== target) return;
      await mountLocatorEditor(preview, spec, target, component, reposition);
    }
    reposition();
    getActiveWindow().requestAnimationFrame(reposition);
  } catch {
    if (!preview.textContent?.trim()) preview.setText(spec.fallbackText);
  }
}

async function mountLocatorEditor(preview: HTMLElement, spec: PopoverSpec, target: HTMLElement, component: Component, reposition: () => void): Promise<void> {
  const edit = spec.edit!;
  const plugin = (spec.app as AppWithPlugins).plugins?.plugins?.["zotero-citations"];
  const items = edit.entries.map(entry => plugin?.getCached(entry.key));
  if(plugin && items.some(item=>!item)){
    const missing=[...new Set(edit.entries.filter((_,index)=>!items[index]).map(entry=>entry.key))];
    const fetched=await Promise.all(missing.map(async key=>{
      try{return [key,await plugin.fetchAndCache?.(key)] as const;}catch{return [key,null] as const;}
    }));
    if(!preview.isConnected)return;
    const found=new Map(fetched);
    edit.entries.forEach((entry,index)=>{if(!items[index])items[index]=found.get(entry.key)||undefined;});
  }
  const itemMap=new Map<string,ZoteroItem>();
  items.forEach(item=>{if(item)itemMap.set(item.key,item);});
  const parts=resolveCitationContent(citationBody(edit.original,edit.kind),edit.entries,itemMap,plugin?.settings.cslStyle||"",edit.kind==="intext",false);
  const selected = edit.entries.map((entry, index) => ({ item: items[index]!, page: entry.page }));
  const annotated = plugin && items.every(Boolean) ? CslEngine.formatLocatorPreview(selected, parts.style || plugin.settings.cslStyle, edit.kind === "intext") : null;
  let marked = parts.safe && annotated ? alignLocatorPreview(annotated.markdown,parts.citation) : null;
  // Hover never scans unrelated installed styles. Stored text remains authoritative.
  if(parts.safe){
    marked=marked||parts.citation;
    edit.entries.forEach((_,index)=>{
      if(marked!.includes(`\uE000zl:${index}\uE001`))return;
      const anchor=`\uE000ze:${index}\uE001`;
      // A single manually edited citation may omit its locator entirely.
      // Put its control at the confirmed citation boundary, before commentary.
      if(edit.entries.length===1)marked=marked!.replace(anchor,"")+" "+anchor+" ";
      else if(!marked!.includes(anchor))marked+=" "+anchor+" ";
    });
  }
  // Keep the stored citation text and formatting when cache or style has changed.
  if (marked) {
    const previousNodes=Array.from(preview.childNodes);
    await MarkdownRenderer.render(spec.app, marked + displayCitationBodyTail(parts.suffix), preview, spec.getSourcePath(), component);
    for(const node of previousNodes)if(node.parentNode===preview)node.remove();
  }
  mountCompactLocatorEditor(preview, {
    app: spec.app,
    entries: edit.entries,
    titles: items.map(item => item?.title || ""),
    ping: async () => !!(await plugin?.api?.ping?.()),
    reposition: () => {
      if (activePopover?.target !== target) return;
      cancelPopoverHide();
      reposition();
      if (!activePopover.popover.querySelector(".is-editing") && !target.matches(":hover") && !activePopover.popover.matches(":hover")) schedulePopoverHide(target);
    },
    save: async (values) => {
      const ok = await applyLocatorEdit(spec, values);
      if (ok && activePopover?.target === target) {
        destroyActivePopover();
        const view = spec.sourceView;
        if (view) view.contentDOM.focus({ preventScroll: true });
      }
      return ok;
    },
  });
}

async function applyLocatorEdit(spec: PopoverSpec, locators: string[]): Promise<boolean> {
  const edit = spec.edit;
  if (!edit) {
    new Notice(appT(spec.app, "footnote.noEditor"));
    return false;
  }

  const plugin = (spec.app as AppWithPlugins).plugins?.plugins?.["zotero-citations"];
  if (!plugin) {
    new Notice(appT(spec.app, "footnote.noEditor"));
    return false;
  }
  const originalItems = new Map(edit.entries.map(entry=>[entry.key,plugin.getCached?.(entry.key)]).filter((pair): pair is [string,ZoteroItem] => !!pair[1]));

  const isConnected = await plugin.api?.ping?.();
  if (!isConnected) {
    new Notice(appT(spec.app, "footnote.zoteroOffline"), 7000);
    return false;
  }

  // Saving a locator regenerates the whole citation string. Do not use the
  // local item cache here, or a locator-only edit could overwrite the citation
  // with stale metadata while Zotero is closed or requestUrl is stale.
  const items = new Map<string, ZoteroItem>();
  try {
    for (const entry of edit.entries) {
      if (items.has(entry.key)) continue;
      const item = plugin.fetchAndCacheRemote
        ? await plugin.fetchAndCacheRemote(entry.key)
        : await plugin.fetchAndCache(entry.key);
      if (!item) {
        new Notice(appT(spec.app, "footnote.noItem"));
        return false;
      }
      items.set(entry.key, item);
    }
  } catch {
    new Notice(appT(spec.app, "footnote.noItem"));
    return false;
  }

  const style = plugin.settings.cslStyle;
  if (plugin.ensureInstalledStyle && !plugin.ensureInstalledStyle()) return false;
  let replacement: string;
  try {
    replacement = buildLocatorReplacement(edit.kind, edit.kind === "endnote" ? edit.label : undefined, edit.entries, locators, items, style);
    replacement = CitationManager.rebuildPreservingCommentary(edit.original,edit.entries,replacement,originalItems.size ? originalItems : items,style,edit.kind);
  } catch (error) {
    if (error instanceof CitationBoundaryError) { new Notice(appT(spec.app,"footnote.annotationBoundary"),7000); return false; }
    new Notice(appT(spec.app, "notice.styleFormatFailed", { error: String(error) }), 7000);
    return false;
  }

  if (spec.sourceView) {
    if (!replaceInSourceView(spec.sourceView, edit, replacement)) {
      new Notice(appT(spec.app, "footnote.changed"));
      return false;
    }
    new Notice(appT(spec.app, "footnote.updated"));
    return true;
  }

  const view = findMarkdownViewForEdit(spec);
  const editor = view?.editor;
  if (!editor) {
    new Notice(appT(spec.app, "footnote.noEditor"));
    return false;
  }

  const current = editor.getValue().slice(edit.from, edit.to);
  if (current !== edit.original) {
    new Notice(appT(spec.app, "footnote.changed"));
    return false;
  }
  const scroll = editor.getScrollInfo();
  editor.transaction({ changes: [{ text: replacement, from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to) }] }, "input.zotero-locator");
  editor.scrollTo(scroll.left, scroll.top);
  new Notice(appT(spec.app, "footnote.updated"));
  return true;
}

function displayCitationBodyTail(tail: string): string {
  return tail.replace(/\n(?: {4}|\t)/g,"\n");
}

function replaceInSourceView(view: EditorView | undefined, edit: EditInfo, replacement: string): boolean {
  if (!view) return false;
  const doc = view.state.doc;
  if (edit.from < 0 || edit.to < edit.from || edit.to > doc.length) return false;

  const current = doc.sliceString(edit.from, edit.to);
  // Never overwrite text changed while the popover was open or Zotero was loading.
  if (current !== edit.original) return false;

  try {
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: replacement },
    });
    return true;
  } catch {
    return false;
  }
}

function findMarkdownViewForEdit(spec: PopoverSpec): MarkdownView | null {
  const active = spec.app.workspace.getActiveViewOfType(MarkdownView);
  const sourcePath = spec.getSourcePath();
  if (!sourcePath) return active ?? null;

  if (active?.file?.path === sourcePath) return active;

  let found: MarkdownView | null = null;
  spec.app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    if (leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath) {
      found = leaf.view;
    }
  });
  return found;
}

function positionPopover(target: HTMLElement, popover: HTMLElement): void {
  const margin = 8, gap = 10;
  const rect = target.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  let top = rect.top - popoverRect.height - gap;
  if (top < margin) top = rect.bottom + gap;
  top = Math.max(margin, Math.min(getActiveWindow().innerHeight - popoverRect.height - margin, top));
  const left = Math.min(
    getActiveWindow().innerWidth - popoverRect.width - margin,
    Math.max(margin, rect.left + rect.width / 2 - popoverRect.width / 2),
  );
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function schedulePopoverHide(target: HTMLElement): void {
  if (!activePopover || activePopover.target !== target) return;
  if (activePopover.popover.querySelector(".zotero-locator-chip.is-editing")) return;
  cancelPopoverHide();
  activePopover.hideTimer = getActiveWindow().setTimeout(() => {
    if (activePopover?.target === target && !activePopover.popover.querySelector(".zotero-locator-chip.is-editing")) destroyActivePopover();
  }, 80);
}

function cancelPopoverHide(): void {
  if (!activePopover?.hideTimer) return;
  getActiveWindow().clearTimeout(activePopover.hideTimer);
  activePopover.hideTimer = null;
}

function destroyActivePopover(): void {
  if (!activePopover) return;
  const { popover, component, reposition, onPopoverEnter, onPopoverLeave, hideTimer } = activePopover;
  if (hideTimer) getActiveWindow().clearTimeout(hideTimer);
  popover.removeEventListener("mouseenter", onPopoverEnter);
  popover.removeEventListener("mouseleave", onPopoverLeave);
  getActiveWindow().removeEventListener("scroll", reposition, true);
  getActiveWindow().removeEventListener("resize", reposition);
  component.unload();
  popover.remove();
  activePopover = null;
}
