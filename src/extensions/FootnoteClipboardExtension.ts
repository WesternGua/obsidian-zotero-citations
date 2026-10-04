import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { editorInfoField, type Editor } from "obsidian";
import {
  FOOTNOTE_CLIPBOARD_MIME, clipboardPlainText, prepareFootnoteCopy,
  readFootnoteClipboard, planFootnotePaste,
} from "../FootnoteClipboard";

/** Scope copying to Markdown editors, including editors in secondary windows. */
export function createFootnoteClipboardExtension() {
  return Prec.high(EditorView.domEventHandlers({
    copy(event, view) {
      if (event.defaultPrevented || !event.clipboardData || !view.state.field(editorInfoField, false)) return false;
      const ranges = view.state.selection.ranges;
      // Keep CodeMirror's native multiple-selection semantics.
      if (ranges.length !== 1 || ranges[0].empty) return false;
      const payload = prepareFootnoteCopy(view.state.doc.toString(), ranges[0].from, ranges[0].to);
      if (!payload) return false;
      try {
        event.clipboardData.setData("text/plain", clipboardPlainText(payload));
        // Some clipboard implementations reject custom types; Markdown remains self-contained.
        try { event.clipboardData.setData(FOOTNOTE_CLIPBOARD_MIME, JSON.stringify(payload)); } catch { /* plain-text fallback */ }
      } catch { return false; }
      event.preventDefault();
      return true;
    },
  }));
}

export function handleFootnotePaste(event: ClipboardEvent, editor: Editor): boolean {
  if (event.defaultPrevented || !event.clipboardData || event.clipboardData.files.length) return false;
  const selections = editor.listSelections();
  if (selections.length !== 1) return false;
  const data = event.clipboardData;
  const plain = data.getData("text/plain");
  const json = data.getData(FOOTNOTE_CLIPBOARD_MIME);
  // Ordinary rich HTML paste continues through Obsidian's normal converter.
  if (!json && data.getData("text/html")) return false;
  const payload = readFootnoteClipboard(json, plain);
  if (!payload) return false;
  const anchor = editor.posToOffset(selections[0].anchor);
  const head = editor.posToOffset(selections[0].head);
  const plan = planFootnotePaste(editor.getValue(), Math.min(anchor, head), Math.max(anchor, head), payload);
  if (!plan) return false;
  const changes = plan.edits.map((edit) => ({
    from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text,
  }));
  // A single transaction makes body insertion and definition insertion one undo step.
  editor.transaction({ changes }, "input.paste");
  editor.setCursor(editor.offsetToPos(plan.cursor));
  event.preventDefault();
  return true;
}
