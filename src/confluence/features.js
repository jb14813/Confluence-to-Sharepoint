export const ADF_NODE_STRATEGIES=Object.freeze({
  doc:'native',blockquote:'native',bulletList:'native',codeBlock:'native',hardBreak:'native',heading:'native',listItem:'native',orderedList:'native',panel:'native',paragraph:'native',table:'native',tableCell:'native',tableHeader:'native',tableRow:'native',text:'native',
  caption:'media',media:'media',mediaGroup:'media',mediaInline:'media',mediaSingle:'media',
  blockCard:'card',embedCard:'card',inlineCard:'card',
  date:'inline',emoji:'inline',mention:'inline',status:'inline',
  blockTaskItem:'task',decisionItem:'task',decisionList:'task',taskItem:'task',taskList:'task',
  expand:'structure',layoutColumn:'structure',layoutSection:'structure',nestedExpand:'structure',rule:'structure',
  bodiedExtension:'extension',extension:'extension',extensionFrame:'extension',inlineExtension:'extension',multiBodiedExtension:'extension',placeholder:'extension',
  bodiedSyncBlock:'sync',syncBlock:'sync'
});

export const ADF_MARK_STRATEGIES=Object.freeze({
  alignment:'native',annotation:'metadata',backgroundColor:'native',border:'native',breakout:'layout',code:'native',dataConsumer:'metadata',em:'native',fragment:'metadata',indentation:'native',link:'native',strike:'native',strong:'native',subsup:'native',textColor:'native',underline:'native'
});

// Confluence's editor nests far less deeply; the limit keeps every recursive walk of the document safe.
const MAX_DEPTH=200;

export function inventoryAdf(adf,{limit=100000}={}) {
  if(!adf||typeof adf!=='object'||Array.isArray(adf)||adf.type!=='doc'||!Array.isArray(adf.content))throw new Error('Invalid ADF document.');
  const nodeTypes={},markTypes={},unknownNodeTypes=new Set(),unknownMarkTypes=new Set();let nodeCount=0,expectedMediaCount=0,datasourceTableCount=0;
  const visit=(node,depth=0)=>{
    if(!node||typeof node!=='object'||Array.isArray(node)||typeof node.type!=='string'||!node.type||++nodeCount>limit)throw new Error('Invalid ADF node.');
    if(depth>MAX_DEPTH)throw Object.assign(new Error('This Confluence page nests content too deeply to capture safely.'),{code:'capture-limit'});
    nodeTypes[node.type]=(nodeTypes[node.type]||0)+1;
    if(!Object.hasOwn(ADF_NODE_STRATEGIES,node.type))unknownNodeTypes.add(node.type);
    if(node.type==='mediaSingle')expectedMediaCount++;
    if(node.type==='blockCard'&&node.attrs?.datasource&&Array.isArray(node.attrs.datasource.views)&&node.attrs.datasource.views.some(view=>view?.type==='table'))datasourceTableCount++;
    if(node.marks!==undefined&&!Array.isArray(node.marks))throw new Error('Invalid ADF marks.');
    for(const mark of node.marks||[]){
      if(!mark||typeof mark!=='object'||Array.isArray(mark)||typeof mark.type!=='string'||!mark.type)throw new Error('Invalid ADF mark.');
      markTypes[mark.type]=(markTypes[mark.type]||0)+1;
      if(!Object.hasOwn(ADF_MARK_STRATEGIES,mark.type))unknownMarkTypes.add(mark.type);
    }
    if(node.content!==undefined){if(!Array.isArray(node.content))throw new Error('Invalid ADF content.');for(const child of node.content)visit(child,depth+1)}
  };
  visit(adf);
  return {nodeCount,expectedMediaCount,datasourceTableCount,nodeTypes,markTypes,unknownNodeTypes:[...unknownNodeTypes].sort(),unknownMarkTypes:[...unknownMarkTypes].sort()};
}
