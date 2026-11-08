// Reuse the SDK's own shape bounds checker and rasterizer. Text never enters
// this export path: only exact model ids whose shape content is absent/null.
window.ftsExportDecorations = function(documentApi,model) {
  const candidates = new Map(), stack = [model], decorations = Object.create(null), warnings = [];
  let visited = 0, totalBytes = 0;
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (++visited > 500000) throw new Error('Office model exceeds the processing limit.');
    if (value.type === 'shape' && value.content == null && typeof value.id === 'string') candidates.set(value.id,value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
  const warn = sourceId => warnings.push({code:'DECORATION_UNAVAILABLE',sourceId,message:'A nontext drawing could not be exported. Review is required before sending.'});
  let count = 0;
  for (const wrapped of documentApi.GetAllDrawingObjects()) {
    const drawing = wrapped.Drawing, id = drawing?.Get_Id?.(), source = candidates.get(id);
    if (!source) continue;
    candidates.delete(id);
    // Check the live object too; a content-bearing shape must remain editable.
    if (drawing.textBoxContent || drawing.txBody || ++count > 512) {warn(id);continue;}
    const oldFlag = AscCommon.IsShapeToImageConverter;
    let canvas;
    try {
      drawing.recalculate();
      AscCommon.IsShapeToImageConverter = true;
      // Ask the same SDK drawing implementation for bounds before allocating
      // its canvas; no DrawingML/path interpretation or drawing is added here.
      const checker = new AscFormat.CSlideBoundsChecker(), scale = AscCommon.g_dKoef_mm_to_pix;
      checker.init((210*scale)>>0,(297*scale)>>0,210,297);
      checker.transform(1,0,0,1,0,0);
      checker.AutoCheckLineWidth = true;
      checker.CheckLineWidth(drawing);
      drawing.draw(checker,0);
      checker.CorrectBounds2();
      const width = checker.Bounds.max_x-checker.Bounds.min_x+1, height = checker.Bounds.max_y-checker.Bounds.min_y+1;
      if (![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=4096) || width*height > 8*1024*1024) throw new Error();
      const image = AscCommon.ShapeToImageConverter(drawing,drawing.pageIndex,'image/png');
      canvas = image?.ImageNative;
      const prefix = 'data:image/png;base64,';
      if (!canvas || !image.ImageUrl.startsWith(prefix) || image.ImageUrl.length > 8*1024*1024) throw new Error();
      const bytes = Uint8Array.from(atob(image.ImageUrl.slice(prefix.length)),c=>c.charCodeAt(0));
      totalBytes += bytes.byteLength;
      if (totalBytes > 32*1024*1024) throw new Error();
      decorations[id] = {bytes,mime:'image/png',width:canvas.width,height:canvas.height};
    } catch {warn(id);}
    finally {
      if (canvas) {canvas.width=0;canvas.height=0;}
      AscCommon.IsShapeToImageConverter = oldFlag;
    }
  }
  for (const id of candidates.keys()) warn(id);
  return {decorations,warnings};
};
