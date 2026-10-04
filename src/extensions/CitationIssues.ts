import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { MarkdownView, Notice, type App } from "obsidian";
import { CitationManager, type CitationIssue, type MinimalEditor } from "../CitationManager";
import { appT } from "../i18n";

export const setCitationIssues = StateEffect.define<CitationIssue[]>();
export const citationIssueField = StateField.define<{issues:CitationIssue[];decorations:DecorationSet}>({
  create:()=>({issues:[],decorations:Decoration.none}),
  update(value,tr){
    let issues=value.issues.map(issue=>({...issue,from:tr.changes.mapPos(issue.from,1),to:tr.changes.mapPos(issue.to,-1)}));
    for(const effect of tr.effects)if(effect.is(setCitationIssues))issues=effect.value;
    const marks=issues.filter(issue=>issue.from<issue.to&&issue.to<=tr.newDoc.length).map(issue=>Decoration.mark({class:"zotero-citation-issue-highlight"}).range(issue.from,issue.to));
    return {issues,decorations:Decoration.set(marks,true)};
  },
  provide:field=>EditorView.decorations.from(field,value=>value.decorations),
});
export function createCitationIssueExtension(){return citationIssueField;}

/** Successful edits can change offsets. Match only actual parsed citations, never code examples. */
export function rebaseCitationIssues(text:string,issues:CitationIssue[]):CitationIssue[]{
  const used=new Set<number>();
  return [...issues].sort((a,b)=>a.from-b.from).map(issue=>{
    const candidates=issue.kind==="endnote"?CitationManager.parseEndnoteDefs(text).map(c=>({from:c.defIndex,original:c.fullMatch,label:c.label})): (issue.kind==="inline"?CitationManager.parseInlineCitations(text):CitationManager.parseInTextCitations(text)).map(c=>({from:c.index,original:c.fullMatch,label:undefined}));
    const found=candidates.filter(c=>!used.has(c.from)&&c.original===issue.original&&(issue.label===undefined||c.label===issue.label)).sort((a,b)=>Math.abs(a.from-issue.from)-Math.abs(b.from-issue.from))[0];
    if(!found)return {...issue,from:Math.min(issue.from,text.length),to:Math.min(issue.to,text.length)};
    used.add(found.from);return {...issue,from:found.from,to:found.from+found.original.length};
  });
}

export type CitationIssueOrigin={from:any;to:any;scroll?:{left:number;top:number}};
export function captureCitationIssueOrigin(editor:MinimalEditor):CitationIssueOrigin{
  const actual=editor as any;
  return {from:actual.getCursor?.("from"),to:actual.getCursor?.("to"),scroll:actual.getScrollInfo?.()};
}

/** A non-modal report attached only to the editor where the operation began. */
export class CitationIssueNavigator {
  private panel:HTMLElement;
  private issues:CitationIssue[];
  private index=0;
  private view?:EditorView;
  private path:string;
  private origin:CitationIssueOrigin;
  private current:HTMLElement;
  constructor(private app:App,private editor:MinimalEditor,issues:CitationIssue[],updated:number,origin?:CitationIssueOrigin){
    this.issues=rebaseCitationIssues(editor.getValue(),issues);
    this.path=app.workspace.getActiveFile()?.path || "";
    this.view=(editor as unknown as {cm?:EditorView}).cm;
    this.origin=origin||captureCitationIssueOrigin(editor);
    const doc=this.view?.dom?.ownerDocument||document;
    this.panel=doc.createElement("section");this.panel.className="zotero-citation-issues-panel";this.panel.setAttribute("aria-label",appT(app,"issues.title"));
    const summary=doc.createElement("strong");summary.textContent=appT(app,"issues.summary",{updated,count:this.issues.length});this.panel.append(summary);
    this.current=doc.createElement("p");this.panel.append(this.current);
    const controls=doc.createElement("div");controls.className="zotero-citation-issues-controls";this.panel.append(controls);
    const button=(label:string,action:()=>void)=>{const el=doc.createElement("button");el.textContent=appT(app,label);el.onclick=action;controls.append(el);};
    button("issues.previous",()=>this.jump(this.index-1));button("issues.next",()=>this.jump(this.index+1));
    button("issues.return",()=>this.returnToOrigin());button("issues.close",()=>this.dispose());
    const list=doc.createElement("div");list.className="zotero-citation-issues-list";
    this.issues.forEach((issue,index)=>{const el=doc.createElement("button");el.textContent=(issue.label?`[^${issue.label}]`:issue.key)+" — "+appT(app,"issues."+issue.reason);el.onclick=()=>this.jump(index);list.append(el);});this.panel.append(list);doc.body.append(this.panel);
    if(this.view?.state.field(citationIssueField,false))this.view.dispatch({effects:setCitationIssues.of(this.issues)});
    new Notice(appT(app,"issues.summary",{updated,count:this.issues.length}),10000);
    this.jump(0);
  }
  private canNavigate():boolean{
    const active=this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if((this.app.workspace.getActiveFile()?.path || "")!==this.path || active && active!==this.editor){new Notice(appT(this.app,"issues.returnDocument"));return false;}
    return true;
  }
  jump(index:number):void{
    if(!this.canNavigate())return;
    this.index=(index+this.issues.length)%this.issues.length;
    const mapped=this.view?.state.field(citationIssueField,false)?.issues[this.index];
    const issue=mapped||rebaseCitationIssues(this.editor.getValue(),this.issues)[this.index];
    this.current.textContent=appT(this.app,"issues.current",{index:this.index+1,count:this.issues.length})+" · "+appT(this.app,"issues."+issue.reason);
    if(this.view){this.view.dispatch({selection:{anchor:issue.from,head:issue.to},effects:EditorView.scrollIntoView(issue.from,{y:"center"})});}
    else{const actual=this.editor as any;actual.setSelection?.(this.editor.offsetToPos(issue.from),this.editor.offsetToPos(issue.to));actual.scrollIntoView?.({from:this.editor.offsetToPos(issue.from),to:this.editor.offsetToPos(issue.to)},true);}
  }
  returnToOrigin():void{
    if(!this.canNavigate())return;
    const actual=this.editor as any;
    if(this.origin.from&&this.origin.to)actual.setSelection?.(this.origin.from,this.origin.to);
    if(this.origin.scroll)actual.scrollTo?.(this.origin.scroll.left,this.origin.scroll.top);
  }
  dispose():void{
    this.panel?.remove();
    if(this.view?.state.field(citationIssueField,false))this.view.dispatch({effects:setCitationIssues.of([])});
  }
}
