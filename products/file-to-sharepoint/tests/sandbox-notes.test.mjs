import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {adaptDocument} from '../src/content/index.js';

// Exercise the pinned, shipped serializer, rather than a reimplementation of
// its buffering/complex-field behavior. Only unrelated style/drawing services
// are replaced; run serialization and note reference serialization are real.
const vendor=await readFile(new URL('../vendor/office/sdkjs/word/sdk-all.js',import.meta.url),'utf8');
const constants=Object.fromEntries([...new Set(vendor.match(/\b(?:para_\w+|reviewtype_\w+)\b/g))].map((name,index)=>[name,index+1]));
const method=name=>{
  const start=vendor.indexOf(`.prototype.${name}=function`),body=vendor.indexOf('function',start),end=vendor.indexOf(';r.prototype.',body);
  assert.ok(start>=0&&end>body,`The pinned SDK method ${name} must remain recognizable`);
  return vendor.slice(body,end);
};
const context=vm.createContext({window:{},b:undefined,...constants});
const SerParaRun=vm.runInContext(`(${method('SerParaRun')})`,context),SerParaFootEndNoteRef=vm.runInContext(`(${method('SerParaFootEndNoteRef')})`,context);
const constructors={CRunFootnoteReference:'para_FootnoteReference',CRunFootnoteRef:'para_FootnoteRef',CRunEndnoteReference:'para_EndnoteReference',CRunEndnoteRef:'para_EndnoteRef',ParaFieldChar:'para_FieldChar',ParaInstrText:'para_InstrText'};
const AscWord=Object.fromEntries(Object.entries(constructors).map(([name,type])=>{const ctor=function(properties){Object.assign(this,properties);};ctor.prototype.Type=constants[type];return[name,ctor];}));
AscWord.ParaFieldChar.prototype.IsFieldChar=()=>true;AscWord.ParaInstrText.prototype.IsInstrText=()=>true;AscWord.ParaInstrText.prototype.GetCodePoint=function(){return this.Value;};
class CRunText{constructor(point){this.Type=constants.para_Text;this.Value=point;}GetCodePoint(){return this.Value;}}
AscWord.CRunText=CRunText;context.AscWord=AscWord;
vm.runInContext(await readFile(new URL('../src/engine/sandbox-html.js',import.meta.url),'utf8'),context);
const helper=await readFile(new URL('../src/engine/sandbox-notes.js',import.meta.url),'utf8').catch(()=> '');
vm.runInContext(helper,context);
const plain=value=>JSON.parse(JSON.stringify(value));
const text=value=>Array.from(value,c=>new CRunText(c.codePointAt(0)));
const instruction=value=>Array.from(value,c=>new AscWord.ParaInstrText({Value:c.codePointAt(0)}));
const run=Content=>({Content,Pr:{bold:true},GetParagraph:()=>({bFromDocument:true}),GetReviewType:()=>constants.reviewtype_Common,IsMathRun:()=>false});
function writer(services={}){
  const prototype={SerParaRun,SerParaFootEndNoteRef,SerTextPr:value=>value,SerTextPrDrawing:value=>value,SerReviewInfo:()=>undefined,
    SerFootEndnote:note=>({id:note.Id,content:note.Content,type:'endnote',number:note.Number}),GetComplexFieldToSave:()=>[],
    SerParaDrawing:drawing=>({type:'paraDrawing',graphic:{type:'image',id:drawing.id}}),SerHeader:part=>part&&({type:'hdr',content:{type:'docContent',content:part.Content}}),SerFooter:part=>part&&({type:'ftr',content:{type:'docContent',content:part.Content}}),...services};
  const result=Object.create(prototype);
  context.window.ftsPreserveNativeUnicode(result);
  context.window.ftsCaptureNativeNotes?.(result);
  return result;
}
const note=(Id,word)=>({Id,Number:3,Content:[{type:'paragraph',content:[word]}]});
const reference=(name,note,properties={})=>new AscWord[name]({Footnote:note,Number:note.Number,NumFormat:0,...properties});

test('native run note references retain exact source order, identities and Unicode without mutating source',()=>{
  const foot=note('f-17','foot text'),end=note('e-29','end text'),source=run([...text('Before😀'),reference('CRunFootnoteReference',foot,{CustomMark:'*'}),...text('Middle'),{Type:constants.para_Drawing,id:'picture'},reference('CRunEndnoteReference',end),...text('After')]);
  const content=source.Content,items=[...content],prototype=Object.getPrototypeOf(source);Object.freeze(content);Object.freeze(source);
  const capture=writer(),result=capture.SerParaRun(source);
  assert.deepEqual(plain(result.content),['Before😀',{type:'footnoteRef',footnote:'f-17',customMark:'*',numFormat:0,number:3},'Middle',{type:'paraDrawing',graphic:{type:'image',id:'picture'}},{type:'endnoteRef',footnote:'e-29',numFormat:0,number:3},'After']);
  assert.deepEqual(plain(result.footnotes),[{id:'f-17',content:foot.Content,type:'footnote',number:3}]);
  assert.deepEqual(plain(result.endnotes),[{id:'e-29',content:end.Content,type:'endnote',number:3}]);
  assert.equal(source.Content,content);assert.deepEqual(source.Content,items);assert.equal(Object.getPrototypeOf(source),prototype);
  assert.equal(Object.getPrototypeOf(capture).SerParaRun,SerParaRun,'The shared vendor writer prototype must remain unchanged');
});

test('header and footer capture retains SDK identity and does not invent identity for absent parts',()=>{
  const capture=writer(),header={Content:[{type:'paragraph',content:['Header']}],Get_Id:()=> 'hdr-7'},footer={Content:[{type:'paragraph',content:['Footer']}],Get_Id:()=> 'ftr-9'};
  assert.equal(capture.SerHeader(header).ftsSourceId,'hdr-7');assert.equal(capture.SerFooter(footer).ftsSourceId,'ftr-9');assert.equal(capture.SerHeader(undefined),undefined);
  assert.throws(()=>capture.SerHeader({Content:[]}),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});

test('notes within complex-field runs retain exact original controls and instruction text in source order',()=>{
  const field={InstructionLine:'QUOTE "visible"'},foot=note('f-field','retained note'),fieldChar=kind=>new AscWord.ParaFieldChar({GetComplexField:()=>field,IsBegin:()=>kind==='begin',IsSeparate:()=>kind==='separate',IsEnd:()=>kind==='end'});
  const source=run([...text('Lead'),fieldChar('begin'),...instruction('QUOTE "visible"'),fieldChar('separate'),...text('visible😀'),reference('CRunFootnoteReference',foot),...text('tail'),fieldChar('end'),...text('Final')]),capture=writer();
  capture.GetComplexFieldToSave=value=>{assert.equal(value,source,'Selection must use the original positional identity');return[field];};
  assert.deepEqual(plain(capture.SerParaRun(source).content),['Lead',{type:'fldChar',fldCharType:'begin'},{type:'instrText',instr:'QUOTE "visible"'},{type:'fldChar',fldCharType:'separate'},'visible😀',{type:'footnoteRef',footnote:'f-field',numFormat:0,number:3},'tail',{type:'fldChar',fldCharType:'end'},'Final']);
  assert.equal(capture.SerParaRun(source).footnotes.length,1);
});

test('all four reference kinds keep their verified type and malformed note associations fail closed',()=>{
  for(const[name,type]of[['CRunFootnoteReference','footnoteRef'],['CRunFootnoteRef','footnoteNum'],['CRunEndnoteReference','endnoteRef'],['CRunEndnoteRef','endnoteNum']]){
    const source=run([...text('A'),reference(name,note('exact-id','note')),...text('B')]);
    assert.deepEqual(plain(writer().SerParaRun(source).content).map(value=>typeof value==='string'?value:value.type),['A',type,'B']);
  }
  for(const Footnote of[null,{Id:'',Content:[]},{Id:'bad',Content:null}])assert.throws(()=>writer().SerParaRun(run([new AscWord.CRunFootnoteReference({Footnote})])),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});

test('native note capture is bounded and leaves unrelated runs on the original serialization path',()=>{
  const capture=writer(),source=run(text('ordinary'));
  assert.deepEqual(plain(capture.SerParaRun(source)),plain(SerParaRun.call(capture,source)));
  const oversized=run(Array(500001).fill(reference('CRunFootnoteRef',note('bounded','note'))));
  assert.throws(()=>capture.SerParaRun(oversized),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
  const repeated=run(Array(4097).fill(reference('CRunFootnoteReference',note('repeated','note'))));
  assert.throws(()=>writer().SerParaRun(repeated),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
  const field={InstructionLine:'bounded'},marker=new AscWord.ParaFieldChar({GetComplexField:()=>field,IsBegin:()=>true,IsSeparate:()=>false,IsEnd:()=>false});
  const manyParts=run([...Array(16385).fill(marker),reference('CRunFootnoteReference',note('parts','note'))]);
  assert.throws(()=>writer().SerParaRun(manyParts),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
  const cyclic=note('cyclic','note'),cycleRun=run([reference('CRunFootnoteReference',cyclic)]);
  const cycleWriter=writer({SerFootEndnote:function(value){return{id:value.Id,content:[this.SerParaRun(cycleRun)]};}});
  assert.throws(()=>cycleWriter.SerParaRun(cycleRun),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});

test('null native note number targets use only the exact active source note container without changing live markers',()=>{
  const foot=note('owning-note','note'),marker=reference('CRunFootnoteRef',foot);marker.Footnote=null;
  const source=run([...text('Note lead'),marker,...text('Note tail')]);source.GetParagraph=()=>({bFromDocument:true,GetParent:()=>({GetTopDocumentContent:()=>foot})});
  const capture=writer({SerFootEndnote:function(value){return{id:value.Id,content:[this.SerParaRun(source)],type:'endnote'};}});
  Object.freeze(marker);Object.freeze(source.Content);Object.freeze(source);
  const output=capture.SerParaRun(run([reference('CRunFootnoteReference',foot)]));
  assert.deepEqual(plain(output.footnotes[0].content[0].content),['Note lead',{type:'footnoteNum',footnote:'owning-note',numFormat:0,number:3},'Note tail']);
  assert.equal(marker.Footnote,null);
  const wrong=note('unrelated','wrong');
  const unverified=run([reference('CRunFootnoteRef',foot)]);unverified.Content[0].Footnote=null;unverified.GetParagraph=()=>({GetParent:()=>({GetTopDocumentContent:()=>wrong})});
  const rejected=writer({SerFootEndnote:function(value){return{id:value.Id,content:[this.SerParaRun(unverified)]};}});
  assert.throws(()=>rejected.SerParaRun(run([reference('CRunFootnoteReference',foot)])),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});

test('large bounded image runs do not overflow the JavaScript argument stack during capture',()=>{
  const source=run([reference('CRunFootnoteReference',note('large-note','note')),...Array(130000).fill({Type:constants.para_Drawing,id:'image'})]);
  assert.equal(writer().SerParaRun(source).content.length,130001);
});

test('serialized note and reference associations must match the original exact source identity and kind',()=>{
  const source=run([reference('CRunFootnoteReference',note('source-id','note'))]);
  for(const services of[{SerParaFootEndNoteRef:()=>({type:'endnoteRef',footnote:'source-id'})},{SerParaFootEndNoteRef:()=>({type:'footnoteRef',footnote:'wrong-id'})},{SerFootEndnote:()=>({id:'wrong-id',content:[]})}])
    assert.throws(()=>writer(services).SerParaRun(source),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});

test('pinned native no-note field capture keeps every picture and cached text exactly once through the real adapter',async()=>{
  const field={InstructionLine:'QUOTE "ignored"'},fieldChar=kind=>new AscWord.ParaFieldChar({GetComplexField:()=>field,IsBegin:()=>kind==='begin',IsSeparate:()=>kind==='separate',IsEnd:()=>kind==='end'});
  const source=run([...text('Lead'),fieldChar('begin'),...instruction('QUOTE "ignored"'),fieldChar('separate'),...text('visible'),{Type:constants.para_Drawing,id:'field-picture'},...text('tail'),fieldChar('end'),...text('Final')]);
  Object.freeze(source.Content);Object.freeze(source);
  const capture=writer({GetComplexFieldToSave:()=>[field],SerParaDrawing:drawing=>({type:'paraDrawing',drawingType:'inline',extent:{cx:4572000,cy:4572000},graphic:{type:'image',id:drawing.id,spPr:{},blipFill:{rasterImageId:'field.png'}}})});
  const output=plain(capture.SerParaRun(source));
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=','base64'));
  const adapted=await adaptDocument({name:'native-field-picture.docx',bytes:Uint8Array.of(1),result:{officeDocument:{type:'document',content:[{type:'paragraph',content:[output]}]},media:{'word/media/field.png':png},warnings:[]}},{measureImage:async()=>({width:1,height:1})});
  const html=adapted.model.blocks.map(block=>block.html).join('');
  assert.deepEqual(adapted.model.warnings.filter(warning=>warning.blocking),[]);
  assert.equal(html.replace(/<[^>]+>/g,''),'LeadvisibletailFinal');assert.match(html,/Leadvisible[\s\S]*class="c2sPicture"[\s\S]*tailFinal/);
  assert.equal(adapted.model.stats.images,1);assert.equal(adapted.model.blocks.flatMap(block=>block.pictures??[]).length,1);assert.equal(adapted.preview.drawings[0].sourceId,'field-picture');
  assert.ok(adapted.model.warnings.some(warning=>warning.code==='static-field-adapted'));
});

test('exact native field instructions preserve Unicode and reject invalid scalars, flags and type identities',()=>{
  const begin=new AscWord.ParaFieldChar({GetComplexField:()=>null,IsBegin:()=>true,IsSeparate:()=>false,IsEnd:()=>false});
  assert.deepEqual(plain(writer().SerParaRun(run([begin,...instruction('QUOTE "😀"')])).content),[{type:'fldChar',fldCharType:'begin'},{type:'instrText',instr:'QUOTE "😀"'}]);
  for(const point of[-1,NaN,0x110000,0xd800,0xdfff])assert.throws(()=>writer().SerParaRun(run([new AscWord.ParaInstrText({Value:point})])),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
  assert.throws(()=>writer().SerParaRun(run([...instruction('x'.repeat(65537))])),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
  for(const invalid of[new AscWord.ParaFieldChar({GetComplexField:()=>null,IsBegin:()=>true,IsSeparate:()=>true,IsEnd:()=>false}),new AscWord.ParaFieldChar({Type:-1,GetComplexField:()=>null,IsBegin:()=>true,IsSeparate:()=>false,IsEnd:()=>false}),new AscWord.ParaInstrText({Type:-1,Value:65})])
    assert.throws(()=>writer().SerParaRun(run([invalid])),error=>error.code==='NATIVE_NOTES_UNVERIFIED');
});
