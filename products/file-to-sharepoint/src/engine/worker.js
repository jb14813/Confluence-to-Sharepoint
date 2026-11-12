/* Classic worker: only fixed packaged vendor paths; no input controls a URL or FS path. */
const vendor = new URL('../../vendor/', self.location.href);
const fail = (message, code = 'CONVERSION_FAILED') => {throw Object.assign(new Error(message), {code});};
const MAX_EXPANDED_BYTES = 150 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', {fatal:true});
const assetNames = ['jszip.min.js','xmldom.js','x2t.js','x2t.wasm','drawingfile.js','drawingfile.wasm'];
const assetUrls = new Set(assetNames.map(name => new URL(name,vendor).href));
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, options) => {
  if (!assetUrls.has(new URL(input?.url || input,self.location.href).href))
    fail('The local engine attempted an unapproved resource request.', 'ENGINE_RESOURCE_BLOCKED');
  return nativeFetch(input,options);
};
const NativeXHR = self.XMLHttpRequest;
self.XMLHttpRequest = class extends NativeXHR {
  open(method,url,...args) {
    if (!assetUrls.has(new URL(url,self.location.href).href)) fail('The local engine attempted an unapproved resource request.', 'ENGINE_RESOURCE_BLOCKED');
    return super.open(method,url,...args);
  }
};

async function readZip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > 10000 || files.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0) > MAX_EXPANDED_BYTES)
    fail('The expanded document exceeds the local processing limit.', 'DOCUMENT_TOO_LARGE');
  // JSZip performs existing container/CRC validation, not a new Office parser.
  await JSZip.loadAsync(bytes, {checkCRC32:true});
  return zip;
}

async function validateDocx(bytes) {
  const zip = await readZip(bytes);
  const main = zip.file('word/document.xml');
  if (!main || !zip.file('[Content_Types].xml') || !zip.file('_rels/.rels'))
    fail('The file is not a valid Word document.', 'INVALID_DOCUMENT');
  let document;
  try {
    const {parseOfficeXml}=await import('./office-xml.js');
    document = parseOfficeXml(await main.async('uint8array'),EngineXml.DOMParser);
  } catch {fail('The Word document XML is invalid.', 'INVALID_DOCUMENT');}
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if (document.doctype || document.documentElement?.namespaceURI !== ns || document.documentElement.localName !== 'document' || document.getElementsByTagNameNS(ns,'body').length !== 1)
    fail('The Word document body is invalid.', 'INVALID_DOCUMENT');
  return zip;
}

async function validateInput(extension, bytes) {
  if (extension === 'docx') return validateDocx(bytes);
  if (extension === 'odt') {
    const zip = await readZip(bytes);
    if (await zip.file('mimetype')?.async('string') !== 'application/vnd.oasis.opendocument.text' || !zip.file('content.xml'))
      fail('The file is not a valid OpenDocument text document.', 'INVALID_DOCUMENT');
  } else if (extension === 'pdf') {
    if (!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-')) fail('The PDF header is invalid.', 'INVALID_DOCUMENT');
  } else if (extension === 'doc') {
    const magic = [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
    if (!magic.every((v,i) => bytes[i] === v)) fail('The legacy Word container is invalid.', 'INVALID_DOCUMENT');
  } else if (extension === 'rtf') {
    if (!new TextDecoder().decode(bytes.subarray(0,16)).startsWith('{\\rtf')) fail('The RTF header is invalid.', 'INVALID_DOCUMENT');
  } else if (extension === 'txt') {
    try { if (utf8.decode(bytes).includes('\0')) throw new Error(); }
    catch { fail('Text input must contain valid UTF-8 text.', 'INVALID_DOCUMENT'); }
  }
}

async function loadConverter() {
  // Emscripten resolves worker-side assets relative to worker.js, not the
  // imported script. Supply the fixed packaged bytes explicitly.
  const response = await fetch(new URL('x2t.wasm', vendor));
  if (!response.ok) fail('The packaged converter is missing.', 'ENGINE_LOAD_FAILED');
  const wasmBinary = await response.arrayBuffer();
  await new Promise((resolve,reject) => {
    self.Module = {wasmBinary,onRuntimeInitialized:resolve, onAbort:() => reject(new Error('The document engine could not initialize.'))};
    importScripts(new URL('x2t.js', vendor).href);
  });
  for (const dir of ['/working','/working/media','/working/fonts','/working/themes']) Module.FS.mkdir(dir);
  return Module;
}

async function extractPdfForms(bytes) {
  // The existing reader uses a window namespace and currentScript for asset
  // resolution. Its own UTF-8 utilities work without the full viewer/UI.
  self.window = self;
  self.document = {currentScript:{src:new URL('drawingfile.js',vendor).href},baseURI:self.location.href};
  await new Promise((resolve,reject) => {
    self.AscViewer = {baseUrl:vendor.href,onLoadModule:resolve};
    try { importScripts(new URL('drawingfile.js',vendor).href); }
    catch (e) {reject(e);}
  });
  const pdf = new AscViewer.CDrawingFile();
  try {
    const error = pdf.loadFromData(bytes);
    if (error) fail(error === 4 ? 'Password-protected PDFs are not supported.' : 'The PDF could not be opened.', error === 4 ? 'ENCRYPTED_DOCUMENT' : 'INVALID_DOCUMENT');
    const info = pdf.getDocumentInfo();
    if (info?.HasXFA === true)
      fail('XFA forms cannot be recreated as interactive SharePoint controls. Use a standard AcroForm PDF.', 'UNSUPPORTED_PDF_FORM');
    if (info?.HasXFA !== false || !Number.isSafeInteger(info.AcroFormFieldCount) || info.AcroFormFieldCount < 0)
      fail('The PDF form capabilities could not be verified. No content was imported.', 'PDF_FORM_METADATA_UNVERIFIED');
    const raw = pdf.getInteractiveFormsInfo();
    const fields = Array.isArray(raw?.Fields) ? raw.Fields.length : 0;
    if ((info.AcroFormFieldCount > 0) !== (fields > 0))
      fail('The original PDF form fields could not be read completely. No content was imported.', 'PDF_FORM_METADATA_UNVERIFIED');
    const pages = pdf.getPages().map(({W,H,Dpi,Rotate,originIndex}) => ({W,H,Dpi,Rotate,originIndex}));
    if (!pages.length) fail('The PDF contains no readable pages.', 'INVALID_DOCUMENT');
    const {readPdfTextCapabilities}=await import('./pdf-text.js');
    const text=readPdfTextCapabilities(info,pages.length);
    const {readPdfLinkAnnotations}=await import('./pdf-annotations.js');
    const pdfLinks=readPdfLinkAnnotations(index=>pdf.getAnnotationsInfo(index),pages);
    // The upstream reader omits Fields/Parents when their counts are zero.
    // Normalize only its native-confirmed empty no-form result; partial
    // records still fail instead of losing interactive fields.
    return {forms:{...(raw && Object.keys(raw).length === 0 ? {Fields:[],Parents:[]} : raw),pages},text,pdfLinks};
  } finally {pdf.close();}
}

self.onmessage = async ({data}) => {
  try {
    importScripts(new URL('jszip.min.js',vendor).href,new URL('xmldom.js',vendor).href);
    const {extension,bytes} = data;
    if (!(bytes instanceof Uint8Array) || !['docx','doc','odt','rtf','txt','pdf'].includes(extension)) fail('Invalid engine request.', 'INVALID_INPUT');
    let htmlImport=null,htmlMedia=null,inputExtension=extension,inputBytes=bytes;
    if(extension==='doc'){
      const {isMhtmlDocument,parseMhtml}=await import('./mhtml.js');
      if(isMhtmlDocument(bytes)){
        const parsed=parseMhtml(bytes);
        htmlImport={html:parsed.html,rootLocation:parsed.rootLocation,resources:parsed.resources};htmlMedia=parsed.media;
        // The existing SDK reconstructs HTML. Native x2t supplies only its
        // ordinary empty document model; MHTML never enters the crashing path.
        inputExtension='rtf';inputBytes=new TextEncoder().encode('{\\rtf1\\ansi }');
      }
    }
    await validateInput(inputExtension,inputBytes);
    let pdfForms = null,pdfText=null,pdfLinks=null,pdfAssociationType=2;
    if (extension === 'pdf') {const source=await extractPdfForms(bytes);pdfForms=source.forms;pdfText=source.text;pdfLinks=source.pdfLinks;}
    let docxBytes = bytes;
    if (extension !== 'docx') {
      // drawingfile keeps a private Module; remove its compatibility DOM shims
      // before x2t detects its dedicated-worker environment.
      delete self.window; delete self.document;
      const module = await loadConverter();
      const from = `/working/input.${inputExtension}`, to = '/working/output.docx';
      module.FS.writeFile(from,inputBytes);
      const parameters=request=>`<TaskQueueDataConvert><m_sFileFrom>${from}</m_sFileFrom><m_sFileTo>${to}</m_sFileTo><m_sThemeDir>/working/themes</m_sThemeDir><m_sFontDir>/working/fonts</m_sFontDir><m_nCsvTxtEncoding>46</m_nCsvTxtEncoding><m_bIsNoBase64>false</m_bIsNoBase64>${extension==='pdf'?`<m_oTextParams><m_nTextAssociationType>${request}</m_nTextAssociationType></m_oTextParams>`:''}</TaskQueueDataConvert>`;
      module.FS.writeFile('/working/params.xml',parameters(2));
      let code = module.ccall('main1','number',['string'],['/working/params.xml']);
      if(extension==='pdf'&&code!==0&&code!==55){
        // Upstream request3 selects native PlainParagraph enum4. Start a fresh
        // conversion and retain every later source/resource verification.
        if(module.FS.analyzePath(to).exists)module.FS.unlink(to);
        module.FS.writeFile('/working/params.xml',parameters(3));
        code=module.ccall('main1','number',['string'],['/working/params.xml']);
        pdfAssociationType=4;
      }
      if (code !== 0) fail(code === 55 ? 'Password-protected documents are not supported.' : `The local engine could not convert the document (code ${code}).`, code === 55 ? 'ENCRYPTED_DOCUMENT' : 'CONVERSION_FAILED');
      docxBytes = module.FS.readFile(to);
      await validateDocx(docxBytes);
    }
    const warnings = extension === 'pdf' ? [
      {code:'PDF_RECONSTRUCTION_REVIEW',message:'Review the reconstructed PDF layout and colors. PDF viewers can display colors differently. Tables may become positioned shapes. Original form definitions are retained separately.'},
      {code:'PDF_FORM_CAPABILITIES',message:'AcroForm definitions are retained. XFA, digital signatures and PDF scripts are not recreated. Scanned pages require a separate capability review.'},
    ] : [];
    const zip = await validateDocx(docxBytes), media = {};
    const layoutFile=zip.file('word/fts-pdf-layout.xml'),drawingsFile=zip.file('word/fts-pdf-drawings.xml');let nativeTables,nativeDrawings;
    if(extension==='pdf'){
      if(!layoutFile||layoutFile._data?.uncompressedSize>1024*1024)
        fail('The PDF table layout could not be verified. No content was imported.','PDF_LAYOUT_UNVERIFIED');
      const {readPdfNativeLayout}=await import('./pdf-native-layout.js');
      nativeTables=readPdfNativeLayout(await layoutFile.async('uint8array'),pdfForms.pages,EngineXml.DOMParser);
      if((nativeTables.textAssociationType??2)!==pdfAssociationType)fail('The native PDF conversion mode could not be verified.','PDF_ORDER_UNVERIFIED');
      if(!drawingsFile||drawingsFile._data?.uncompressedSize>16*1024*1024)
        fail('The PDF drawing sources could not be verified. No content was imported.','PDF_DRAWINGS_UNVERIFIED');
      const {readPdfDrawings}=await import('./pdf-drawings.js');
      nativeDrawings=readPdfDrawings(await drawingsFile.async('uint8array'),{pages:pdfForms.pages,pdfText,nativeTables},EngineXml.DOMParser);
    }else if(layoutFile||drawingsFile)fail('The Office document contains unexpected PDF conversion metadata.','INVALID_DOCUMENT');
    for (const [name,file] of Object.entries(zip.files)) if (!file.dir && /^word\/media\/[^/]+$/.test(name)) media[name] = await file.async('uint8array');
    if(htmlMedia)for(const [name,value] of Object.entries(htmlMedia)){
      if(Object.hasOwn(media,name))fail('The Word archive conflicts with a reconstructed resource.','INVALID_MHTML');
      media[name]=value;
    }
    // Reuse the same initialized converter for the SDK's documented DOCY model.
    const module = extension === 'docx' ? await loadConverter() : Module;
    module.FS.writeFile('/working/model.docx',docxBytes);
    module.FS.writeFile('/working/params.xml','<TaskQueueDataConvert><m_sFileFrom>/working/model.docx</m_sFileFrom><m_sFileTo>/working/model.bin</m_sFileTo><m_sThemeDir>/working/themes</m_sThemeDir><m_bIsNoBase64>false</m_bIsNoBase64></TaskQueueDataConvert>');
    const code = module.ccall('main1','number',['string'],['/working/params.xml']);
    if (code !== 0) fail('The Office model could not be reconstructed.', 'CONVERSION_FAILED');
    const officeBin = module.FS.readFile('/working/model.bin');
    const {collectNativeMedia}=await import('./native-media.js');
    const nativeMedia=await collectNativeMedia(module.FS,media,docxBytes);
    const transfers = [docxBytes.buffer,officeBin.buffer,...Object.values(media).map(bytes => bytes.buffer),...(nativeMedia?.files.map(file=>file.bytes.buffer)??[])];
    self.postMessage({result:{docxBytes,officeBin,media,pdfForms,warnings,...(nativeMedia?{nativeMedia}:{}),...(pdfText?{pdfText,pdfLinks,pdfLayout:{version:1,textAssociationType:pdfAssociationType,flowGeometry:pdfAssociationType===2?'native-plain-line-v1':'native-plain-paragraph-v1',nativeTables,nativeDrawings}}:{}),...(htmlImport?{htmlImport}:{})}},transfers);
  } catch (error) {
    self.postMessage({error:{message:error?.message || 'The local document could not be read.',code:error?.code || 'INVALID_DOCUMENT'}});
  }
};
