import {readFileSync,existsSync} from 'node:fs';
const vendor=new URL('../products/file-to-sharepoint/vendor/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',vendor),'utf8'));
const valid=name=>typeof name==='string'&&/^[a-z0-9][a-z0-9._/@-]*$/i.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
if(!Array.isArray(manifest.files)||manifest.files.some(entry=>!valid(entry.file)))throw Error('Invalid pinned document-engine asset inventory.');
const provenance=manifest.provenanceFiles??[];
if(!Array.isArray(provenance)||provenance.some(name=>!valid(name)||!name.endsWith('.json')))throw Error('Invalid engine provenance inventory.');
export const ENGINE_FILES=['decoration-budget.js','html-resources.js','image-views.js','index.js','inline-images.js','mhtml.js','native-media.js','office-xml.js','pdf-drawings.js','pdf-drawing-resources.js','pdf-drawing-aliases.js','pdf-native-layout.js','pdf-pages.js','pdf-text.js','pdf-annotations.js','sandbox-decorations.js','sandbox-html.js','sandbox-image-views.js','sandbox-notes.js','sandbox-setup.js','sandbox-svg.js','sandbox-typography.js','sandbox.html','sandbox.js','worker.js'].map(name=>'src/engine/'+name);
export const FORM_FILES=['portable-form.js','portable-form.css','portable-form.js.LEGAL.txt'].map(name=>'form/'+name);
export const FILE_ICON_FILES=['icon16.png','icon32.png','icon48.png','icon128.png','logo.svg'].map(name=>'file-icons/'+name);
export const VENDOR_METADATA_FILES=['vendor/engine-assets.json','vendor/NOTICE.md',...provenance.map(name=>'vendor/'+name)];
// Store validation treats every file named manifest.json as an app manifest.
// The development inventory keeps its name; only its packaged name changes.
export const VENDOR_FILES=[...new Set([...manifest.files.map(entry=>entry.file),'engine-assets.json','NOTICE.md',...provenance,...(existsSync(new URL('provenance.json',vendor))?['provenance.json']:[])])].map(name=>'vendor/'+name).sort();
export const FILE_IMPORT_FILES=['file-workspace.html','workspace.css','src/app/workspace.js','file-destination.js','file-product.json','vendor/provenance.json',...ENGINE_FILES,...FORM_FILES,...FILE_ICON_FILES,...VENDOR_FILES];
