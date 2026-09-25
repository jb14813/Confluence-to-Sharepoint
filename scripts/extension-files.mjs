// What an extension build and the Store package consist of, and the version
// check they share.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const ICON_FILES=['icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png','icons/logo.svg'];
// operator.html, a developer page, is built where it exists.
export const BUILD_FILES=['THIRD-PARTY-NOTICES.txt','background.js','content.js','icons','manifest.json','memory.js','operator.html','panel.css','popup.css','popup.html','popup.js'];
export const RELEASE_FILES=['THIRD-PARTY-NOTICES.txt','background.js','content.js',...ICON_FILES,'manifest.json','memory.js','panel.css','popup.css','popup.html','popup.js'];

export async function readReleaseMetadata(root=path.resolve('.')){
  const packageMetadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const manifest=JSON.parse(await readFile(path.join(root,'extension','manifest.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+$/.test(packageMetadata.version??'')||manifest.version!==packageMetadata.version){
    throw new Error('package.json and extension/manifest.json must contain the same semantic version.');
  }
  return {version:packageMetadata.version,packageMetadata,manifest};
}
