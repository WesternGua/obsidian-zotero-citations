/**
 * FootnoteExtension.ts – CodeMirror extension for Word-style footnote rendering
 */
import { App, Component, MarkdownRenderer, MarkdownView, Notice } from "obsidian";
import { ViewPlugin, WidgetType, Decoration, EditorView, ViewUpdate } from "@codemirror/view";
import { appT } from "../i18n";
import { CitationManager } from "../CitationManager";
import { ZoteroItem } from "../ZoteroAPI";

export interface FootnoteExtensionOptions {
  isEnabled: () => boolean;
  app: App;
  getSourcePath: () => string;
}

interface PreviewInfo {
  markdown: string;
  text: string;
  edit?: EditInfo | null;
}

interface InlineEditInfo {
  kind: "inline" | "endnote";
  key: string;
  locator: string;
  from: number;
  to: number;
}

interface EndnoteEditInfo {
  kind: "endnote";
  key: string;
  locator: string;
  label: string;
  from: number;
  to: number;
}

type EditInfo = Omit<InlineEditInfo, "kind"> & { kind: "inline" } | EndnoteEditInfo;

// ── Widget ─────────────────────────────────────────────────────────────────
class FnWidget extends WidgetType {
  constructor(
    public num: number,
    public preview: PreviewInfo,
    public app: App,
    public getSourcePath: () => string,
    public identifier: string,
    public domId: string,
    public isHighlighted: boolean = false,
  ) {
    super();
  }

  eq(other: FnWidget): boolean {
    return (
      this.num === other.num &&
      this.preview.markdown === other.preview.markdown &&
      this.preview.text === other.preview.text &&
      this.identifier === other.identifier &&
      this.domId === other.domId &&
      this.isHighlighted === other.isHighlighted &&
      this.preview.edit?.from === other.preview.edit?.from
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "zotero-fn-widget";

    const sup = document.createElement("sup");
    sup.className = "zotero-fn-num footnote-ref";
    sup.setAttribute("data-footnote-id", `fnref-${this.domId}`);

    const marker = document.createElement("span");
    marker.className = "footnote-link zotero-footnote-marker";
    marker.setAttribute("data-footref", this.identifier);
    marker.setAttribute("tabindex", "0");
    marker.textContent = `[${this.domId}]`;

    if (this.isHighlighted) {
      wrapper.classList.add("zotero-fn-highlighted", "cm-highlight");
    }

    const text = this.preview.text || appT(this.app, "footnote.fallback", { value: this.num });
    marker.addEventListener("mousedown", (event) => event.preventDefault());
    marker.addEventListener("click", (event) => event.preventDefault());

    attachRenderedPopover(marker, {
      app: this.app,
      getSourcePath: this.getSourcePath,
      markdown: this.preview.markdown,
      fallbackText: text,
      edit: this.preview.edit || undefined,
    });

    sup.appendChild(marker);
    wrapper.appendChild(sup);
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
      event.type === "click"
    );
  }
}

// ── Extension factory ──────────────────────────────────────────────────────
export function createFootnoteExtension(options: FootnoteExtensionOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: any;
      constructor(view: EditorView) {
        this.decorations = buildDeco(view, options);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDeco(update.view, options);
        }
      }
    },
    { decorations: (v: any) => v.decorations },
  );
}

function buildDeco(view: EditorView, options: FootnoteExtensionOptions) {
  if (!options.isEnabled()) return Decoration.none;

  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  const endnotePreviews = buildEndnotePreviewMap(doc, options.app);

  const hits: Array<{
    start: number; end: number; num: number;
    markdown: string; text: string; identifier: string;
    domId: string; edit?: EditInfo | null;
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
      if (preview.edit) {
        preview.edit.from = m.index;
        preview.edit.to = m.index + raw.length;
      }
      sequence++;
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
      ...(endnotePreview ?? { markdown: "", text: appT(options.app, "footnote.fallback", { value: ordinal }) }),
    });
  }

  hits.sort((a, b) => a.start - b.start);
  const ranges: any[] = [];
  let lastEnd = -1;

  for (const { start, end, num, markdown, text, identifier, domId, edit } of hits) {
    if (start < lastEnd) continue;
    if (sel.from <= end && sel.to >= start) continue;
    if (!inViewport(view, start, end)) continue;

    ranges.push(
      Decoration.replace({
        widget: new FnWidget(
          num, { markdown, text, edit }, options.app,
          options.getSourcePath, identifier, domId,
          isInsideHighlight(doc, start, end),
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

function extractInlinePreview(rawMarker: string, num: number, app: App): { markdown: string; text: string; edit?: EditInfo | null } {
  const body = rawMarker.slice(2, -1);
  const metadata = parseZoteroMetadata(body);
  const markdown = metadata.markdown.trim();
  const text = normalizeTooltipText(markdown);
  return {
    markdown,
    text: text || appT(app, "footnote.fallback", { value: num }),
    edit: metadata.key ? { kind: "inline", key: metadata.key, locator: metadata.locator, from: -1, to: -1 } : null,
  };
}

function buildEndnotePreviewMap(doc: string, app: App): Map<string, { markdown: string; text: string; edit?: EditInfo | null }> {
  const map = new Map<string, { markdown: string; text: string; edit?: EditInfo | null }>();
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
      edit: metadata.key ? {
        kind: "endnote", key: metadata.key, locator: metadata.locator,
        label: match[1], from: lineOffsets[i], to: lineOffsets[endLine] + lines[endLine].length,
      } : null,
    });
    i = next - 1;
  }
  return map;
}

function parseZoteroMetadata(text: string): { key: string; locator: string; markdown: string } {
  const match = text.match(/^<!--\s*zotero:([^:>]+):([^ ]*)\s*-->\s*/);
  if (!match) return { key: "", locator: "", markdown: text };
  return { key: match[1], locator: decodeURIComponent(match[2] || ""), markdown: text.slice(match[0].length) };
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
  markdown: string;
  fallbackText: string;
  edit?: EditInfo;
}

interface ZoteroPluginLike {
  settings: { cslStyle: string };
  getCached: (key: string) => ZoteroItem | undefined;
  fetchAndCache: (key: string) => Promise<ZoteroItem | null>;
}

type AppWithPlugins = App & {
  plugins?: {
    plugins?: Record<string, ZoteroPluginLike | undefined>;
  };
};

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

  const popover = document.createElement("div");
  popover.className = "popover hover-popover zotero-footnote-popover";

  const embed = popover.createDiv({ cls: "markdown-embed", attr: { "data-type": "footnote" } });
  const embedContent = embed.createDiv({ cls: "markdown-embed-content" });
  const preview = embedContent.createDiv({ cls: "markdown-preview-view markdown-rendered" });
  preview.setText(spec.fallbackText);

  if (spec.edit) {
    mountLocatorEditor(embedContent, spec, target);
  }
  if (!spec.markdown.trim()) embed.addClass("mod-empty");

  document.body.appendChild(popover);
  const component = new Component();
  const reposition = () => positionPopover(target, popover);
  const onPopoverEnter = () => cancelPopoverHide();
  const onPopoverLeave = () => schedulePopoverHide(target);
  popover.addEventListener("mouseenter", onPopoverEnter);
  popover.addEventListener("mouseleave", onPopoverLeave);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  activePopover = { target, popover, component, hideTimer: null, reposition, onPopoverEnter, onPopoverLeave };
  reposition();
  requestAnimationFrame(reposition);

  if (spec.markdown.trim()) {
    void renderPopoverMarkdown(preview, spec, component, target, reposition);
  }
}

async function renderPopoverMarkdown(preview: HTMLElement, spec: PopoverSpec, component: Component, target: HTMLElement, reposition: () => void): Promise<void> {
  try {
    preview.empty();
    await MarkdownRenderer.render(spec.app, spec.markdown, preview, spec.getSourcePath(), component);
    if (activePopover?.target !== target) return;
    reposition();
    requestAnimationFrame(reposition);
  } catch (e) {
    if (!preview.textContent?.trim()) preview.setText(spec.fallbackText);
  }
}

function mountLocatorEditor(container: HTMLElement, spec: PopoverSpec, target: HTMLElement): void {
  const wrap = container.createDiv({ cls: "zotero-footnote-locator-editor" });
  const input = wrap.createEl("input", { type: "text" });
  input.value = spec.edit!.locator || "";
  input.placeholder = appT(spec.app, "footnote.locatorPlaceholder");
  const btnRow = wrap.createDiv();
  const saveBtn = btnRow.createEl("button", { text: appT(spec.app, "footnote.saveLocator"), cls: "mod-cta" });

  const save = async () => {
    saveBtn.disabled = true;
    const ok = await applyLocatorEdit(spec, input.value.trim());
    saveBtn.disabled = false;
    if (ok && activePopover?.target === target) destroyActivePopover();
  };
  saveBtn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void save(); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } });
}

async function applyLocatorEdit(spec: PopoverSpec, locator: string): Promise<boolean> {
  const edit = spec.edit;
  if (!edit) {
    new Notice(appT(spec.app, "footnote.noEditor"));
    return false;
  }
  const plugin = (spec.app as AppWithPlugins).plugins?.plugins?.["zotero-citations"];
  const view = spec.app.workspace.getActiveViewOfType(MarkdownView);
  const editor = view?.editor;
  if (!plugin || !editor) {
    new Notice(appT(spec.app, "footnote.noEditor"));
    return false;
  }
  const item = plugin.getCached(edit.key) || await plugin.fetchAndCache(edit.key);
  if (!item) {
    new Notice(appT(spec.app, "footnote.noItem"));
    return false;
  }
  const page = locator || undefined;
  const style = plugin.settings.cslStyle;
  if (edit.kind === "inline") {
    const replacement = CitationManager.buildInlineFootnote(item, style, page);
    editor.replaceRange(replacement, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
  } else {
    const replacement = CitationManager.buildEndnoteDef(edit.label, item, style, page);
    editor.replaceRange(replacement, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
  }
  new Notice(appT(spec.app, "footnote.updated"));
  return true;
}

function positionPopover(target: HTMLElement, popover: HTMLElement): void {
  const margin = 8, gap = 10;
  const rect = target.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  let top = rect.top - popoverRect.height - gap;
  if (top < margin) top = rect.bottom + gap;
  top = Math.max(margin, Math.min(window.innerHeight - popoverRect.height - margin, top));
  const left = Math.min(
    window.innerWidth - popoverRect.width - margin,
    Math.max(margin, rect.left + rect.width / 2 - popoverRect.width / 2),
  );
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function schedulePopoverHide(target: HTMLElement): void {
  if (!activePopover || activePopover.target !== target) return;
  cancelPopoverHide();
  activePopover.hideTimer = window.setTimeout(() => {
    if (activePopover?.target === target) destroyActivePopover();
  }, 80);
}

function cancelPopoverHide(): void {
  if (!activePopover?.hideTimer) return;
  window.clearTimeout(activePopover.hideTimer);
  activePopover.hideTimer = null;
}

function destroyActivePopover(): void {
  if (!activePopover) return;
  const { popover, component, reposition, onPopoverEnter, onPopoverLeave, hideTimer } = activePopover;
  if (hideTimer) window.clearTimeout(hideTimer);
  popover.removeEventListener("mouseenter", onPopoverEnter);
  popover.removeEventListener("mouseleave", onPopoverLeave);
  window.removeEventListener("scroll", reposition, true);
  window.removeEventListener("resize", reposition);
  component.unload();
  popover.remove();
  activePopover = null;
}
