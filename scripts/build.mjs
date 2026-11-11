import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {BUILD_FILES,readReleaseMetadata} from './extension-files.mjs';
import {buildCombinedFileImport} from './build-file-import.mjs';
await readReleaseMetadata();
// C2S_BUILD_DIR names another folder for the build, in place of dist/.
const out = path.resolve(process.env.C2S_BUILD_DIR ?? 'dist', 'sharepoint-helper');
await mkdir(out, { recursive: true });
await build({ entryPoints: { popup: 'src/popup/popup.js', dashboard:'src/dashboard/dashboard.js', content: 'src/transfer/content.js', memory: 'src/sharepoint/combined-memory.js', background: 'src/background.js' }, outdir: out, bundle: true, format: 'iife', platform: 'browser', target: 'chrome127', minify: false, legalComments: 'eof' });
await buildCombinedFileImport(out);
await build({entryPoints:['src/licenses.js'],outfile:path.join(out,'licenses.js'),bundle:true,format:'iife',platform:'browser',target:'chrome127'});
await copyFile('extension/licenses.html',path.join(out,'licenses.html'));
await copyFile('LICENSE',path.join(out,'LICENSE'));
await copyFile('SOURCE-MANIFEST.json',path.join(out,'SOURCE-MANIFEST.json'));
await copyFile('SOURCE-INPUTS.json',path.join(out,'SOURCE-INPUTS.json'));
await mkdir(path.join(out,'legal'),{recursive:true});
for(const name of ['MIT-CORE-LICENSE.txt','ONLYOFFICE-logo.svg','ONLYOFFICE-LOGO-NOTICE.txt','ONLYOFFICE-ADDITIONAL-NOTICES.txt'])await copyFile(path.join('assets/licenses',name),path.join(out,'legal',name));
await copyFile('extension/manifest.json', path.join(out, 'manifest.json'));
await copyFile('extension/popup.html', path.join(out, 'popup.html'));
await copyFile('extension/dashboard.html', path.join(out, 'dashboard.html'));
await copyFile('src/dashboard/dashboard.css', path.join(out, 'dashboard.css'));
// A developer page, copied where it exists.
if (existsSync('extension/operator.html')) await copyFile('extension/operator.html', path.join(out, 'operator.html'));
await copyFile('src/popup/popup.css', path.join(out, 'popup.css'));
await mkdir(path.join(out, 'icons'), { recursive: true });
for (const size of [16,32,48,128]) await copyFile(`extension/icons/icon${size}.png`, path.join(out, 'icons', `icon${size}.png`));
await copyFile('extension/icons/logo.svg', path.join(out, 'icons', 'logo.svg'));
// Preserve notices for both source workflows. The emoji names capture matches custom emoji against
// (src/confluence/emoji-names.js) come from emojibase-data, whose names and keywords come from the Unicode CLDR.
const notices = ['Third-party notices.'];
const emojibase = JSON.parse(await readFile('node_modules/emojibase-data/package.json', 'utf8'));
notices.push(`emojibase-data ${emojibase.version} (emoji names and keywords)\n${await readFile('node_modules/emojibase-data/LICENSE', 'utf8')}`);
notices.push(`Unicode CLDR emoji names and keywords, through emojibase-data\n${await readFile('assets/licenses/UNICODE-LICENSE-V3.txt', 'utf8')}`);
notices.push(await readFile('products/file-to-sharepoint/vendor/NOTICE.md','utf8'));
notices.push(await readFile('products/file-to-sharepoint/vendor/provenance/THIRD-PARTY-RUNTIME-NOTICES.txt','utf8'));
notices.push(await readFile('products/file-to-sharepoint/vendor/provenance/NATIVE-RUNTIME-NOTICES.txt','utf8'));
notices.push(await readFile('products/file-to-sharepoint/sharepoint-form/dist/portable-form.js.LEGAL.txt','utf8'));
notices.push(await readFile('assets/licenses/MIT-CORE-LICENSE.txt','utf8'));
notices.push(await readFile('assets/licenses/ONLYOFFICE-LOGO-NOTICE.txt','utf8'));
notices.push(await readFile('assets/licenses/ONLYOFFICE-ADDITIONAL-NOTICES.txt','utf8'));
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'), 'utf8');
// Files an earlier layout left behind would fail the package allowlist. They are
// removed one by one instead of emptying the folder, which a browser may be loading.
for (const entry of await readdir(out)) if (!BUILD_FILES.includes(entry)) await rm(path.join(out, entry), { recursive: true, force: true });
console.log(`Load unpacked: ${out}`);
