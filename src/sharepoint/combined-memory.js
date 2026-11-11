import './memory.js';
import {installSharePointFileShortcut} from './file-shortcut.js';

if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.sendMessage)installSharePointFileShortcut();
