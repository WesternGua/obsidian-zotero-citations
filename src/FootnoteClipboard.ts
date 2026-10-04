/** Lossless Markdown footnote transfer. This module has no app/clipboard side effects. */
export const FOOTNOTE_CLIPBOARD_MIME = "application/x-zotero-citations-footnotes+json";

export interface FootnoteReference {
  label: string;
  from: number;
  to: number;
}

export interface FootnoteDefinition {
  label: string;
  raw: string;
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
}

export interface FootnoteDocument {
  definitions: FootnoteDefinition[];
  references: FootnoteReference[];
}

export interface FootnoteClipboardPayload {
  version: 1;
  text: string;
  references: FootnoteReference[];
  definitions: Array<{ label: string; raw: string }>;
}

export interface TextEdit {
  from: number;
  to: number;
  text: string;
}

export interface FootnotePastePlan {
  edits: TextEdit[];
  cursor: number;
}

export function footnoteKey(label: string): string {
  return label.trim().replace(/[ \t]+/g, " ").toLowerCase();
}

function linesOf(text: string): Array<{ text: string; from: number; to: number }> {
  let from = 0;
  return text.split("\n").map((line) => {
    const result = { text: line.replace(/\r$/, ""), from, to: from + line.length };
    from += line.length + 1;
    return result;
  });
}

/** Keep offsets while masking fences, frontmatter, comments, escapes and inline code. */
function markdownMask(text: string, preserveCitationMetadata = false): string {
  const chars = text.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  };
  const lines = linesOf(text);
  let fence: { char: string; length: number } | null = null;
  let frontmatter = lines[0]?.text === "---" && lines.slice(1).some((line) => /^(---|\.\.\.)\s*$/.test(line.text));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) {
      blank(line.from, line.to);
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line.text)) frontmatter = false;
      continue;
    }
    const match = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      blank(line.from, line.to);
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) fence = null;
    } else if (match && (match[1][0] !== "`" || !match[2].includes("`"))) {
      fence = { char: match[1][0], length: match[1].length };
      blank(line.from, line.to);
    }
  }
  let mask = chars.join("");
  for (let i = 0; i < mask.length;) {
    if (mask[i] === "\\") { blank(i, Math.min(i + 2, mask.length)); i += 2; continue; }
    if (mask.startsWith("<!--", i)) {
      const end = mask.indexOf("-->", i + 4);
      const to = end < 0 ? mask.length : end + 3;
      if (!preserveCitationMetadata || !/^<!--\s*zotero(?:-intext|-inline)?:[^>]*-->/.test(mask.slice(i,to))) blank(i, to);
      i = to; continue;
    }
    if (mask[i] === "`") {
      let to = i + 1;
      while (mask[to] === "`") to++;
      const delimiter = mask.slice(i, to);
      let end = mask.indexOf(delimiter, to);
      while (end >= 0 && (mask[end - 1] === "`" || mask[end + delimiter.length] === "`")) end = mask.indexOf(delimiter, end + delimiter.length);
      if (end >= 0) { blank(i, end + delimiter.length); i = end + delimiter.length; continue; }
      i = to; continue;
    }
    i++;
  }
  mask = chars.join("");
  return mask;
}

/** Citation metadata stays visible; code and ordinary HTML comments stay masked. */
export function markdownCitationMask(text: string): string { return markdownMask(text,true); }

export function parseFootnoteDocument(text: string): FootnoteDocument {
  const mask = markdownMask(text);
  const lines = linesOf(text);
  const maskedLines = linesOf(mask);
  const definitions: FootnoteDefinition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = maskedLines[i].text.match(/^ {0,3}\[\^([^\]\n]+)\]:/);
    if (!match) continue;
    const original = lines[i].text.match(/^ {0,3}\[\^([^\]\n]+)\]:/)!;
    let next = i + 1;
    while (next < lines.length) {
      if (/^( {4}|\t)/.test(lines[next].text)) { next++; continue; }
      if (!lines[next].text.trim() && next + 1 < lines.length && /^( {4}|\t)/.test(lines[next + 1].text)) { next++; continue; }
      break;
    }
    const from = lines[i].from;
    const to = lines[next - 1].to;
    const labelFrom = from + lines[i].text.indexOf("[^") + 2;
    definitions.push({ label: original[1], raw: text.slice(from, to), from, to, labelFrom, labelTo: labelFrom + original[1].length });
    i = next - 1;
  }
  const references: FootnoteReference[] = [];
  const re = /\[\^([^\]\r\n]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(mask)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (mask[to] === ":") continue;
    // Four-space indentation outside a definition is a Markdown code block.
    const lineStart = mask.lastIndexOf("\n", from - 1) + 1;
    if (/^( {4}|\t)/.test(text.slice(lineStart, from)) && !definitions.some((def) => from >= def.from && to <= def.to)) continue;
    references.push({ label: text.slice(from + 2, to - 1), from, to });
  }
  return { definitions, references };
}

function applyEdits(text: string, edits: TextEdit[]): string {
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return text;
}

export function prepareFootnoteCopy(source: string, from: number, to: number): FootnoteClipboardPayload | null {
  if (from >= to) return null;
  const doc = parseFootnoteDocument(source);
  // Partial definitions cannot safely be moved or completed without changing the selection.
  if (doc.definitions.some((def) => def.from < to && def.to > from && !(def.from >= from && def.to <= to))) return null;
  const selectedDefs = doc.definitions.filter((def) => def.from >= from && def.to <= to);
  const refs = doc.references.filter((ref) => ref.from >= from && ref.to <= to && !doc.definitions.some((def) => ref.from >= def.from && ref.to <= def.to));
  if (!refs.length) return null;
  const definitions = new Map<string, FootnoteDefinition>();
  for (const def of doc.definitions) if (!definitions.has(footnoteKey(def.label))) definitions.set(footnoteKey(def.label), def);
  const gathered = new Map<string, FootnoteDefinition>();
  const pending = [...refs.map((ref) => ref.label), ...selectedDefs.map((def) => def.label)];
  for (let i = 0; i < pending.length; i++) {
    const key = footnoteKey(pending[i]);
    if (gathered.has(key)) continue;
    const def = definitions.get(key);
    if (!def) continue;
    gathered.set(key, def);
    for (const ref of doc.references) if (ref.from >= def.from && ref.to <= def.to) pending.push(ref.label);
  }
  if (!gathered.size) return null;
  const removals = selectedDefs.map((def) => ({ from: def.from - from, to: def.to - from, text: "" }));
  const text = applyEdits(source.slice(from, to), removals);
  const references = refs.map((ref) => {
    const removed = selectedDefs.filter((def) => def.to <= ref.from).reduce((sum, def) => sum + def.to - def.from, 0);
    return { label: ref.label, from: ref.from - from - removed, to: ref.to - from - removed };
  });
  return { version: 1, text, references, definitions: [...gathered.values()].map(({ label, raw }) => ({ label, raw })) };
}

export function clipboardPlainText(payload: FootnoteClipboardPayload): string {
  const separator = payload.text.endsWith("\n\n") ? "" : payload.text.endsWith("\n") ? "\n" : "\n\n";
  return payload.text + separator + payload.definitions.map((def) => def.raw).join("\n\n");
}

export function readFootnoteClipboard(json: string, plain: string): FootnoteClipboardPayload | null {
  if (json) {
    try {
      const payload = JSON.parse(json) as FootnoteClipboardPayload;
      if (payload.version !== 1 || typeof payload.text !== "string" || !Array.isArray(payload.definitions) || !Array.isArray(payload.references)) return null;
      const seen = new Set<string>();
      for (const def of payload.definitions) {
        if (typeof def?.label !== "string" || typeof def.raw !== "string") return null;
        const parsed = parseFootnoteDocument(def.raw).definitions;
        const key = footnoteKey(def.label);
        if (seen.has(key) || parsed.length !== 1 || parsed[0].from !== 0 || parsed[0].to !== def.raw.length || footnoteKey(parsed[0].label) !== key) return null;
        seen.add(key);
      }
      let end = 0;
      for (const ref of payload.references) {
        if (typeof ref?.label !== "string" || !Number.isInteger(ref.from) || !Number.isInteger(ref.to) || ref.from < end || payload.text.slice(ref.from, ref.to) !== `[^${ref.label}]`) return null;
        end = ref.to;
      }
      if (!payload.definitions.length || clipboardPlainText(payload).replace(/\r\n/g, "\n") !== plain.replace(/\r\n/g, "\n")) return null;
      return payload;
    } catch { return null; }
  }
  // Clipboard managers can strip custom formats. Self-contained Markdown still works.
  return prepareFootnoteCopy(plain, 0, plain.length);
}

function definitionBody(raw: string): string {
  return raw.replace(/^ {0,3}\[\^[^\]\n]+\]:/, "").replace(/\r\n/g, "\n");
}

export function planFootnotePaste(target: string, from: number, to: number, payload: FootnoteClipboardPayload): FootnotePastePlan | null {
  if (from < 0 || to < from || to > target.length) return null;
  const probe = "[^zotero-clipboard-position-probe]";
  const probeDoc = parseFootnoteDocument(target.slice(0, from) + probe + target.slice(to));
  if (!probeDoc.references.some((ref) => ref.from === from && ref.to === from + probe.length)) return null;
  const doc = parseFootnoteDocument(target);
  // Appending definitions inside a replaced definition could destroy its continuation.
  if (doc.definitions.some((def) => from < def.to && to > def.from || from === to && from >= def.from && from <= def.to)) return null;
  const existing = new Map<string, FootnoteDefinition[]>();
  const reserved = new Set<string>();
  for (const def of doc.definitions) {
    const key = footnoteKey(def.label);
    existing.set(key, [...(existing.get(key) ?? []), def]); reserved.add(key);
  }
  for (const ref of doc.references) reserved.add(footnoteKey(ref.label));
  for (const def of payload.definitions) reserved.add(footnoteKey(def.label));
  for (const ref of payload.references) reserved.add(footnoteKey(ref.label));
  let nextNumeric = 1;
  for (const key of reserved) if (/^\d+$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key) < Number.MAX_SAFE_INTEGER) nextNumeric = Math.max(nextNumeric, Number(key) + 1);
  const labels = new Map<string, string>();
  const append: Array<{ label: string; raw: string }> = [];
  for (const incoming of payload.definitions) {
    const key = footnoteKey(incoming.label);
    const usedInTarget = doc.definitions.some((def) => footnoteKey(def.label) === key) || doc.references.some((ref) => footnoteKey(ref.label) === key);
    // Only a complete, identical, unambiguous definition can share a label.
    // Definitions with nested references are remapped as a group instead.
    const nested = parseFootnoteDocument(incoming.raw).references.length > 0;
    const reusable = !nested && usedInTarget ? doc.definitions.find((def) =>
      (existing.get(footnoteKey(def.label))?.length ?? 0) === 1 && definitionBody(def.raw) === definitionBody(incoming.raw)
    ) : null;
    if (reusable) {
      labels.set(key, reusable.label); continue;
    }
    let label = incoming.label;
    if (usedInTarget) {
      if (/^\d+$/.test(incoming.label)) {
        do { label = String(nextNumeric++); } while (reserved.has(footnoteKey(label)));
      } else {
        let suffix = 2;
        do { label = `${incoming.label}-${suffix++}`; } while (reserved.has(footnoteKey(label)));
      }
    }
    labels.set(key, label); reserved.add(footnoteKey(label)); append.push({ label, raw: incoming.raw });
  }
  const body = applyEdits(payload.text, payload.references.map((ref) => ({ from: ref.from, to: ref.to, text: `[^${labels.get(footnoteKey(ref.label)) ?? ref.label}]` })));
  const definitions = append.map((incoming) => {
    const parsed = parseFootnoteDocument(incoming.raw);
    const def = parsed.definitions[0];
    return applyEdits(incoming.raw, [
      { from: def.labelFrom, to: def.labelTo, text: incoming.label },
      ...parsed.references.map((ref) => ({ from: ref.from, to: ref.to, text: `[^${labels.get(footnoteKey(ref.label)) ?? ref.label}]` })),
    ]);
  }).join("\n\n");
  if (!definitions) return { edits: [{ from, to, text: body }], cursor: from + body.length };
  let insertAt = target.length;
  const bibliography = target.indexOf("<!-- zotero-bibliography-start -->");
  if (bibliography >= 0 && !(bibliography >= from && bibliography < to)) {
    insertAt = bibliography;
    while (insertAt > 0 && /[\r\n]/.test(target[insertAt - 1])) insertAt--;
  }
  const left = insertAt === to ? target.slice(0, from) + body : target.slice(0, insertAt);
  const before = !left || left.endsWith("\n\n") ? "" : left.endsWith("\n") ? "\n" : "\n\n";
  const suffix = insertAt < target.length ? "\n\n" : "";
  const addition = before + definitions + suffix;
  const checked = (plan: FootnotePastePlan): FootnotePastePlan | null => {
    const final = parseFootnoteDocument(applyEdits(target, plan.edits));
    // Never silently append definitions into an unclosed fence or frontmatter block.
    return append.every((def) => final.definitions.some((found) => footnoteKey(found.label) === footnoteKey(def.label))) ? plan : null;
  };
  // Co-located insertion at EOF is a single change, keeping cursor before definitions.
  if (insertAt >= from && insertAt <= to) {
    if (insertAt !== to) return null;
    return checked({ edits: [{ from, to, text: body + addition }], cursor: from + body.length });
  }
  return checked({
    edits: [{ from, to, text: body }, { from: insertAt, to: insertAt, text: addition }].sort((a, b) => a.from - b.from),
    cursor: from + body.length + (insertAt < from ? addition.length : 0),
  });
}
