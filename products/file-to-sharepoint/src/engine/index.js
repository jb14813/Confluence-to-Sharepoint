export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const extensions = new Set(['docx', 'doc', 'odt', 'rtf', 'txt', 'pdf']);

function failure(message, code) {
  return Object.assign(new Error(message), {code});
}

/** Convert local source bytes; each call disposes its worker and opaque SDK frame.
 * pdfForms preserves ONLYOFFICE's raw Fields/Parents plus original page geometry.
 * officeDocument is the existing Word SDK's ToJSON model; media contains exact
 * document ZIP entries keyed by word/media/<filename> for its image references.
 * decorations optionally maps nontext graphic ids to SDK-rendered PNG bytes.
 * warnings are {code,message}; consumers must present PDF reconstruction review.
 */
export async function convertDocument({name, bytes} = {}, {signal, timeoutMs = 90000} = {}) {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\x00-\x1f/\\]/.test(name))
    throw failure('A plain source filename is required.', 'INVALID_NAME');
  const extension = name.split('.').pop().toLowerCase();
  if (!extensions.has(extension)) throw failure('This document format is not supported.', 'UNSUPPORTED_FORMAT');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
    throw failure('The document is empty or has no byte data.', 'INVALID_INPUT');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw failure('The document exceeds the 50 MiB limit.', 'DOCUMENT_TOO_LARGE');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw failure('Conversion timeout must be between 1 and 120000 milliseconds.', 'INVALID_TIMEOUT');
  if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    let settled = false, frame = null, receiveModel = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (receiveModel) window.removeEventListener('message',receiveModel);
      frame?.remove();
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException('Conversion cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(failure('Document conversion timed out.', 'ENGINE_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, {once:true});
    worker.onerror = event => {
      event.preventDefault();
      finish(failure('The local document engine could not run.', 'ENGINE_LOAD_FAILED'));
    };
    worker.onmessage = ({data}) => {
      if (data?.error) finish(failure(data.error.message, data.error.code || 'CONVERSION_FAILED'));
      else if (data?.result?.docxBytes instanceof Uint8Array && data.result.officeBin instanceof Uint8Array) {
        if (frame) return finish(failure('The engine returned duplicate document data.', 'INVALID_ENGINE_RESULT'));
        const {officeBin,...result} = data.result;
        const nonce = crypto.randomUUID(), channel = 'fts-office-model';
        frame = document.createElement('iframe');
        frame.title = 'Local document processing';
        frame.setAttribute('aria-hidden','true');
        frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1024px;height:768px;border:0;pointer-events:none';
        frame.src = new URL('./sandbox.html',import.meta.url).href + '#' + nonce;
        let sent = false;
        receiveModel = event => {
          const response = event.data;
          if (event.source !== frame.contentWindow || response?.channel !== channel || response.nonce !== nonce) return;
          if (response.type === 'ready' && !sent) {
            sent = true;
            frame.contentWindow.postMessage({channel,nonce,type:'open',officeBin},'*',[officeBin.buffer]);
          } else if (response.type === 'error') finish(failure(response.message || 'The Office model could not be read.', 'OFFICE_MODEL_FAILED'));
          else if (response.type === 'result' && sent) {
            try {
              if (typeof response.json !== 'string' || response.json.length > 50 * 1024 * 1024) throw new Error();
              const officeDocument = JSON.parse(response.json);
              if (!officeDocument || officeDocument.type !== 'document' || !Array.isArray(officeDocument.content) || officeDocument.content.length > 100000) throw new Error();
              const decorations = Object.create(null), eligibleIds = new Set(), stack = [officeDocument];
              let visited = 0, decorationBytes = 0;
              while (stack.length) {
                const value = stack.pop();
                if (!value || typeof value !== 'object') continue;
                if (++visited > 500000) throw new Error();
                if (value.type === 'shape' && value.content == null && typeof value.id === 'string') eligibleIds.add(value.id);
                for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
              }
              if (!response.decorations || typeof response.decorations !== 'object' || Array.isArray(response.decorations) || Object.keys(response.decorations).length > 512) throw new Error();
              for (const [id,value] of Object.entries(response.decorations)) {
                if (!eligibleIds.has(id) || !(value?.bytes instanceof Uint8Array) || value.mime !== 'image/png' || ![value.width,value.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096) || value.width*value.height > 8*1024*1024) throw new Error();
                decorationBytes += value.bytes.byteLength;
                if (decorationBytes > 32*1024*1024 || value.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte,index)=>value.bytes[index]===byte)) throw new Error();
                decorations[id] = value;
              }
              if (!Array.isArray(response.warnings) || response.warnings.length > 10000 || response.warnings.some(w=>w?.code!=='DECORATION_UNAVAILABLE'||typeof w.sourceId!=='string'||w.sourceId.length>128||typeof w.message!=='string'||w.message.length>1000)) throw new Error();
              finish(null,{...result,officeDocument,decorations,warnings:[...result.warnings,...response.warnings]});
            } catch {finish(failure('The Office model returned invalid or oversized data.', 'INVALID_OFFICE_MODEL'));}
          }
        };
        window.addEventListener('message',receiveModel);
        (document.body || document.documentElement).append(frame);
      }
      else finish(failure('The local engine returned an invalid result.', 'INVALID_ENGINE_RESULT'));
    };
    // Copy so transfer never detaches the caller's source or unrelated views.
    const input = bytes.slice();
    worker.postMessage({extension, bytes:input}, [input.buffer]);
    if (signal?.aborted) abort();
  });
}
