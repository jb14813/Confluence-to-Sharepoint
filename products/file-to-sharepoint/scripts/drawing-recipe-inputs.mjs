// Shared source closure for both reader rebuild and release verification.
export const DRAWING_RECIPE_INPUTS=Object.freeze([
  'scripts/build-drawing-runtime.mjs',
  'scripts/drawing-recipe-inputs.mjs',
  'scripts/source-archive.mjs',
  ...[
    '.gitattributes','patch-drawing.py','patch-graphics-blend.py',
    'patch-pdf-font-metrics.py','patch-pdf-text.py','pdf-actual-text-run.h',
    'pdf-capture-raster-density.h','pdf-font-metrics.json','pdf-font-metrics.patch',
    'pdf-text-capabilities.h','pdf-text-order.h','rebuild.sh','straight-blend-adaptor.h',
  ].map(file=>'scripts/drawing-runtime-inputs/'+file),
]);

export function drawingRecipeInputsComplete(inputs){
  if(!Array.isArray(inputs))return false;
  const names=inputs.map(input=>input?.file),unique=new Set(names);
  return unique.size===names.length&&DRAWING_RECIPE_INPUTS.every(file=>unique.has(file));
}
