/** Map CSL locator markers onto stored Markdown without changing citation text.
 * Only an exact shared prefix/suffix is eligible. Changed or ambiguous middle
 * portions keep the existing compact fallback, rather than guessing at numbers.
 */
export function alignLocatorPreview(marked: string, stored: string): string | null {
  const tokens: Array<{text:string;at:number;end?:number;close?:string}>=[];
  const pattern=/\uE000zl:(\d+)\uE001([\s\S]*?)\uE000\/zl\uE001|\uE000ze:(\d+)\uE001/g;
  let plain="",last=0,match:RegExpExecArray|null;
  while((match=pattern.exec(marked))){
    plain+=marked.slice(last,match.index);
    if(match[1]!==undefined){
      const at=plain.length;plain+=match[2];
      tokens.push({text:`\uE000zl:${match[1]}\uE001`,at,end:plain.length,close:"\uE000/zl\uE001"});
    }else tokens.push({text:match[0],at:plain.length});
    last=match.index+match[0].length;
  }
  plain+=marked.slice(last);
  if(plain===stored)return marked;
  let prefix=0,suffix=0;
  while(prefix<Math.min(plain.length,stored.length)&&plain[prefix]===stored[prefix])prefix++;
  while(suffix<Math.min(plain.length,stored.length)-prefix&&plain[plain.length-1-suffix]===stored[stored.length-1-suffix])suffix++;
  const mapped:Array<{at:number;text:string;order:number}>=[];
  const map=(from:number,to:number):number|null=>{
    if(to<=prefix)return from;
    if(suffix>0&&from>=plain.length-suffix)return from+stored.length-plain.length;
    return null;
  };
  for(const token of tokens){
    const at=map(token.at,token.end??token.at);if(at===null)continue;
    mapped.push({at,text:token.text,order:1});
    if(token.end!==undefined)mapped.push({at:at+token.end-token.at,text:token.close!,order:0});
  }
  if(!mapped.length)return null;
  let result=stored;
  for(const token of mapped.sort((a,b)=>b.at-a.at||b.order-a.order))result=result.slice(0,token.at)+token.text+result.slice(token.at);
  return result;
}
