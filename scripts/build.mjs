import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {BUILD_FILES,readReleaseMetadata} from './extension-files.mjs';
await readReleaseMetadata();
// C2S_BUILD_DIR names another folder for the build, in place of dist/.
const out = path.resolve(process.env.C2S_BUILD_DIR ?? 'dist', 'sharepoint-helper');
await mkdir(out, { recursive: true });
await build({ entryPoints: { popup: 'src/popup/popup.js', content: 'src/transfer/content.js', memory: 'src/sharepoint/memory.js', background: 'src/background.js' }, outdir: out, bundle: true, format: 'iife', platform: 'browser', target: 'chrome127', minify: false, legalComments: 'eof' });
await copyFile('extension/manifest.json', path.join(out, 'manifest.json'));
await copyFile('extension/popup.html', path.join(out, 'popup.html'));
// A developer page, copied where it exists.
if (existsSync('extension/operator.html')) await copyFile('extension/operator.html', path.join(out, 'operator.html'));
await copyFile('src/panel/panel.css', path.join(out, 'panel.css'));
await copyFile('src/popup/popup.css', path.join(out, 'popup.css'));
await mkdir(path.join(out, 'icons'), { recursive: true });
for (const size of [16,32,48,128]) await copyFile(`extension/icons/icon${size}.png`, path.join(out, 'icons', `icon${size}.png`));
await copyFile('extension/icons/logo.svg', path.join(out, 'icons', 'logo.svg'));
// The bundles hold no third-party code. The emoji names capture matches custom emoji against
// (src/confluence/emoji-names.js) come from emojibase-data, whose names and keywords come from the Unicode CLDR.
const notices = ['Third-party notices.'];
const emojibase = JSON.parse(await readFile('node_modules/emojibase-data/package.json', 'utf8'));
notices.push(`emojibase-data ${emojibase.version} (emoji names and keywords)\n${await readFile('node_modules/emojibase-data/LICENSE', 'utf8')}`);
notices.push(`Unicode CLDR emoji names and keywords, through emojibase-data\n${await readFile('assets/licenses/UNICODE-LICENSE-V3.txt', 'utf8')}`);
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'), 'utf8');
// Files an earlier layout left behind would fail the package allowlist. They are
// removed one by one instead of emptying the folder, which a browser may be loading.
for (const entry of await readdir(out)) if (!BUILD_FILES.includes(entry)) await rm(path.join(out, entry), { recursive: true, force: true });
console.log(`Load unpacked: ${out}`);
