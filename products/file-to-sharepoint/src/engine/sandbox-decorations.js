// Reuse the SDK's own shape bounds checker and rasterizer. Text never enters
// this export path: only exact model ids whose shape content is absent/null.
window.ftsExportDecorations = function(documentApi,model,budget={maxTotal:512,pageForId:null,perPage:512}) {
  const candidates = new Map(), stack = [model], decorations = Object.create(null), warnings = [];
  let visited = 0, totalBytes = 0;
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (++visited > 500000) throw new Error('Office model exceeds the processing limit.');
    if (value.type === 'shape' && value.content == null && typeof value.id === 'string') candidates.set(value.id,value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
  const warn = (sourceId,resolution=false) => warnings.push({code:'DECORATION_UNAVAILABLE',sourceId,message:resolution?'A PDF drawing could not be exported at the required resolution. Review is required before sending.':'A nontext drawing could not be exported. Review is required before sending.'});
  function verifiedVector(source,drawing){
    // PDF page ownership alone does not establish raster density. Only known
    // SDK vector fill profiles can use this export; original bitmap images
    // retain their separate byte/view path.
    const fill=value=>value&&['solid','noFill','gradFill','pattFill'].includes(value.fill?.type);
    if(!source.spPr||!fill(source.spPr.fill)||source.spPr.ln&&!fill(source.spPr.ln.fill)||
       drawing.blipFill||drawing.brush?.fill?.RasterImageId||drawing.pen?.Fill?.fill?.RasterImageId)return false;
    const pending=[source];let nodes=0;
    while(pending.length){
      const value=pending.pop();if(!value||typeof value!=='object')continue;
      if(++nodes>500000)return false;
      if(value.type==='image'||value.type==='blipFill')return false;
      for(const [key,child]of Object.entries(value)){
        if(key.toLowerCase()==='rasterimageid'&&child)return false;
        if(child&&typeof child==='object')pending.push(child);
      }
    }
    return true;
  }
  let count = 0;const perPage=new Map();
  for (const wrapped of window.ftsDocumentDrawingObjects?.(documentApi)??documentApi.GetAllDrawingObjects()) {
    const drawing = wrapped.Drawing, id = drawing?.Get_Id?.(), source = candidates.get(id);
    if (!source) continue;
    candidates.delete(id);
    // Check the live object too; a content-bearing shape must remain editable.
    if (drawing.textBoxContent || drawing.txBody || ++count > budget.maxTotal) {warn(id);continue;}
    if(budget.pageForId){const page=budget.pageForId.get(id),onPage=(perPage.get(page)||0)+1;if(page===undefined||onPage>budget.perPage){warn(id);continue;}perPage.set(page,onPage);}
    const pdf=!!budget.pageForId;
    if(pdf&&!verifiedVector(source,drawing)){warn(id,true);continue;}
    const oldFlag = AscCommon.IsShapeToImageConverter;
    let canvas;
    try {
      drawing.recalculate();
      AscCommon.IsShapeToImageConverter = true;
      // Ask the same SDK drawing implementation for bounds before allocating
      // its canvas; no DrawingML/path interpretation or drawing is added here.
      const checker = new AscFormat.CSlideBoundsChecker(), scale = AscCommon.g_dKoef_mm_to_pix*(pdf?2:1);
      const frameWidth=Math.floor(210*scale),frameHeight=Math.floor(297*scale);
      checker.init(frameWidth,frameHeight,210,297);
      checker.transform(1,0,0,1,0,0);
      checker.AutoCheckLineWidth = true;
      checker.CheckLineWidth(drawing);
      drawing.draw(checker,0);
      checker.CorrectBounds2();
      const width = checker.Bounds.max_x-checker.Bounds.min_x+1, height = checker.Bounds.max_y-checker.Bounds.min_y+1;
      if (![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=4096) || width*height > 8*1024*1024) throw new Error();
      let image;
      if(pdf){
        // The pinned ShapeToImageConverter has no scale parameter. Reuse its
        // exact bounds/CGraphics rendering body with a 2x frame; preserve the
        // fractional pixel origin and its inclusive bounds before allocating.
        canvas=document.createElement('canvas');canvas.width=Math.floor(width);canvas.height=Math.floor(height);
        const graphics=new AscCommon.CGraphics();graphics.init(canvas.getContext('2d'),frameWidth,frameHeight,210,297);
        graphics.m_oFontManager=AscCommon.g_fontManager;
        graphics.m_oCoordTransform.tx=-checker.Bounds.min_x;graphics.m_oCoordTransform.ty=-checker.Bounds.min_y;
        graphics.transform(1,0,0,1,0,0);drawing.draw(graphics,0);
        if(AscCommon.g_fontManager)AscCommon.g_fontManager.m_pFont=null;
        if(AscCommon.g_fontManager2)AscCommon.g_fontManager2.m_pFont=null;
        image={ImageNative:canvas,ImageUrl:canvas.toDataURL('image/png')};
      }else{
        image = AscCommon.ShapeToImageConverter(drawing,drawing.pageIndex,'image/png');
        canvas = image?.ImageNative;
      }
      const prefix = 'data:image/png;base64,';
      if (!canvas || !image.ImageUrl.startsWith(prefix) || image.ImageUrl.length > 8*1024*1024) throw new Error();
      const bytes = Uint8Array.from(atob(image.ImageUrl.slice(prefix.length)),c=>c.charCodeAt(0));
      totalBytes += bytes.byteLength;
      if (totalBytes > 32*1024*1024) throw new Error();
      decorations[id] = {bytes,mime:'image/png',width:canvas.width,height:canvas.height};
    } catch(error) {if(error?.name==='AbortError')throw error;warn(id,pdf);}
    finally {
      if (canvas) {canvas.width=0;canvas.height=0;}
      AscCommon.IsShapeToImageConverter = oldFlag;
    }
  }
  for (const id of candidates.keys()) warn(id);
  return {decorations,warnings};
};
