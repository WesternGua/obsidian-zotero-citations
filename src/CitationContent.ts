import { CslEngine } from "./CslEngine";
import type { CitationEntry } from "./CitationManager";
import type { ZoteroItem } from "./ZoteroAPI";

export const CITATION_END = "<!-- /zotero-citation -->";
export interface CitationContent { citation: string; suffix: string; safe: boolean; style?: string }

export function citationBody(original: string, kind: string): string {
  if (kind === "endnote") return original.replace(/^ {0,3}\[\^[^\]\n]+\]:[ \t]*/, "");
  if (original.startsWith("^[")) return original.slice(2, -1);
  return original;
}
export function visibleCitation(body: string): string {
  return body.replace(/<!--\s*zotero(?:-intext)?:[^>]*-->[ \t]*/g, "").replace(/<!--\s*\/zotero-citation\s*-->/g, "").trim();
}
export function displayCitationBody(body: string): string {
  return visibleCitation(body).replace(/\n(?: {4}|\t)/g, "\n");
}

/** A legacy citation is migrated only when an installed style reproduces its exact prefix. */
export function resolveCitationContent(
  body: string, entries: CitationEntry[], items: Map<string, ZoteroItem>, style: string, inText = false, searchInstalledStyles = true,
): CitationContent {
  const boundary = body.indexOf(CITATION_END);
  if (boundary >= 0) return {citation: visibleCitation(body.slice(0,boundary)),suffix:body.slice(boundary+CITATION_END.length),safe:true};
  const stripped = body.replace(/^(?:<!--\s*zotero(?:-intext)?:[^>]*-->[ \t]*)+/, "");
  if (entries.some(entry => !items.has(entry.key))) return {citation:visibleCitation(body),suffix:"",safe:false};
  const selected = entries.map(entry => ({item:items.get(entry.key)!,page:entry.page || undefined}));
  const styles = searchInstalledStyles ? [style, ...CslEngine.installedStyleIds().filter(id => id !== style)] : [style];
  let best: CitationContent | null = null;
  for (const candidate of styles) {
    const generated = inText ? CslEngine.formatCitationCluster(selected,candidate) : CslEngine.formatNoteCluster(selected,candidate);
    if (!generated || !stripped.startsWith(generated)) continue;
    const suffix = stripped.slice(generated.length);
    if (suffix && !/^\s/.test(suffix)) continue;
    if (!best || generated.length > best.citation.length) best = {citation:generated,suffix,safe:true,style:candidate};
    if (!suffix) break;
  }
  return best || {citation:visibleCitation(body),suffix:"",safe:false};
}

export class CitationBoundaryError extends Error {
  constructor() { super("Could not safely identify the generated citation. The original footnote was preserved."); }
}
