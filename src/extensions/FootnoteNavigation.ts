import { EditorView, ViewPlugin } from "@codemirror/view";
import { footnoteKey, parseFootnoteDocument } from "../FootnoteClipboard";

export interface FootnoteJump {label:string;from:number;to:number;direction:"definition"|"reference"}
export function resolveFootnoteJump(text: string, position: number, origins = new Map<string,number>()): FootnoteJump | null {
  const doc = parseFootnoteDocument(text);
  const definition = doc.definitions.find(def => position >= def.labelFrom-2 && position <= def.labelTo+1);
  if (definition) {
    const key = footnoteKey(definition.label);
    const refs = doc.references.filter(ref => footnoteKey(ref.label)===key && !doc.definitions.some(def=>ref.from>=def.from&&ref.to<=def.to));
    const ref = refs.find(ref=>ref.from===origins.get(key)) || refs[0];
    return ref ? {label:key,from:position,to:ref.from,direction:"reference"} : null;
  }
  const ref = doc.references.find(ref=>position>=ref.from&&position<=ref.to);
  if (!ref) return null;
  const def = doc.definitions.find(def=>footnoteKey(def.label)===footnoteKey(ref.label));
  return def ? {label:footnoteKey(ref.label),from:ref.from,to:def.labelFrom-2,direction:"definition"} : null;
}

const returnPositions = new WeakMap<EditorView,Map<string,number>>();
export function navigateFootnote(view: EditorView, position: number): boolean {
  let origins = returnPositions.get(view);
  if (!origins) { origins = new Map(); returnPositions.set(view,origins); }
  const jump = resolveFootnoteJump(view.state.doc.toString(),position,origins);
  if (!jump) return false;
  if (jump.direction === "definition") origins.set(jump.label,jump.from);
  view.dispatch({selection:{anchor:jump.to},effects:EditorView.scrollIntoView(jump.to,{y:"center"})});
  view.contentDOM.focus({preventScroll:true});
  return true;
}

export function createFootnoteNavigationExtension() {
  return [
    ViewPlugin.fromClass(class {
      constructor(public view: EditorView) {}
      update(update: any) {
        if (!update.docChanged) return;
        const origins = returnPositions.get(update.view);
        if (origins) for (const [label,pos] of origins) origins.set(label,update.changes.mapPos(pos));
      }
      destroy() {returnPositions.delete(this.view);}
    }),
    EditorView.domEventHandlers({dblclick(event,view) {
      if ((event.target as HTMLElement)?.closest(".zotero-footnote-marker")) return false;
      const pos = view.posAtCoords({x:event.clientX,y:event.clientY});
      if (pos===null || !navigateFootnote(view,pos)) return false;
      event.preventDefault(); return true;
    }}),
  ];
}

/** Reading mode stays inside the clicked preview pane; no active-file changes. */
export function readingFootnoteDoubleClick(event: MouseEvent): void {
  const clicked = event.target as HTMLElement;
  const pane = clicked.closest<HTMLElement>(".markdown-reading-view");
  if (!pane) return;
  const ref = clicked.closest<HTMLAnchorElement>("a.footnote-ref, a[data-footnote-ref]");
  const number = clicked.closest<HTMLElement>(".zotero-footnote-definition-number");
  if (ref) {
    const href = ref.getAttribute("href");
    if (!href?.startsWith("#")) return;
    const id = decodeURIComponent(href.slice(1));
    const target = Array.from(pane.querySelectorAll<HTMLElement>("[id]")).find(el=>el.id===id);
    if (!target) return;
    readingOrigins.set(target,ref);
    target.scrollIntoView({block:"center"});
    target.classList.add("zotero-footnote-jump-target");
    setTimeout(()=>target.classList.remove("zotero-footnote-jump-target"),1500);
    event.preventDefault(); event.stopPropagation();
  } else if (number) {
    const target = number.closest<HTMLElement>("li[id]");
    if (!target) return;
    const remembered = readingOrigins.get(target);
    const origin = remembered?.isConnected ? remembered : Array.from(pane.querySelectorAll<HTMLAnchorElement>("a.footnote-ref, a[data-footnote-ref]")).find(ref=>ref.getAttribute("href")==="#"+target.id);
    if (!origin) return;
    origin.scrollIntoView({block:"center"});
    origin.classList.add("zotero-footnote-jump-target");
    setTimeout(()=>origin.classList.remove("zotero-footnote-jump-target"),1500);
    event.preventDefault(); event.stopPropagation();
  }
}
const readingOrigins = new WeakMap<HTMLElement,HTMLElement>();
export function readingFootnoteClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest(".markdown-reading-view") && target.closest("a.footnote-ref, a[data-footnote-ref], .zotero-footnote-definition-number")) event.preventDefault();
}
