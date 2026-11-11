// Shared by offline rebuild and release verification. Every maintained recipe
// file must be bound to the build record; a partial list cannot certify a build.
export const CONVERTER_RECIPE_INPUTS=Object.freeze([
  'scripts/build-converter-runtime.mjs',
  'scripts/converter-recipe-inputs.mjs',
  'scripts/source-archive.mjs',
  ...[
    '.gitattributes','build-djpeg.py','capture-pixels.py','capture-reference.mjs',
    'Dockerfile','embuild.sh','freeze-references.py','native-image-codecs.json',
    'native-image-codecs.patch','patch-graphics-blend.py','patch-image-identity.py',
    'patch-images.py','patch-jpeg-decoder.py','patch-pdf-form-body.py',
    'patch-pdf-native-runtime.py','patch-pdf-paragraph-overlap.py',
    'patch-pdf-text-shadow.py','patch-pdf-text.py','pdf-native-drawings-v2.json',
    'pdf-native-drawings-v2.patch','pdf-native-layout.json','pdf-native-layout.patch',
    'pdf-native-runtime.json','pdf-native-runtime.patch','pinned-git.py',
    'pixel-identity-cache.h','prepare-context.py','README.md','rebuild.sh',
    'seed-pinned-ports.py','straight-blend-adaptor.h',
  ].map(file=>'scripts/converter-runtime-inputs/'+file),
]);

export function converterRecipeInputsComplete(inputs){
  if(!Array.isArray(inputs))return false;
  const names=inputs.map(input=>input?.file),unique=new Set(names);
  return unique.size===names.length&&CONVERTER_RECIPE_INPUTS.every(file=>unique.has(file));
}
