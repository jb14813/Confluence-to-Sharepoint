import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const window={};vm.runInNewContext(await readFile(new URL('../src/engine/sandbox-html.js',import.meta.url),'utf8'),{window});

test('resolved native cell alignment retains numeric TOP zero and overrides inherited properties locally',()=>{
 assert.equal(typeof window.ftsRetainResolvedCellAlignment,'function');
 const serialize=function(cell,...args){return {type:'tblCell',tcPr:{vAlign:'center'},marker:this.marker,args};},prototype={SerTableCell:serialize},writer=Object.assign(Object.create(prototype),{marker:7});
 window.ftsRetainResolvedCellAlignment(writer);
 for(const[value,expected]of[[0,'top'],[1,'center'],[2,'bottom']]){
  const output=writer.SerTableCell({Get_VAlign:()=>value},'source-argument');assert.equal(output.ftsVerticalAlign,expected);assert.equal(output.tcPr.vAlign,'center');assert.equal(output.marker,7);assert.deepEqual(output.args,['source-argument']);
 }
 assert.equal(prototype.SerTableCell,serialize,'The vendor prototype is unchanged');
});

test('resolved alignment composes with retained vertical merge anchors without losing spans',()=>{
 assert.equal(typeof window.ftsRetainResolvedCellAlignment,'function');
 const row={Content:[],GetCellInfo:()=>({StartGridCol:0})},table={Content:[row],Internal_GetVertMergeCount:()=>3},cell={GetVMerge:()=>1,GetRow:()=>row,GetTable:()=>table,GetGridSpan:()=>2,Get_VAlign:()=>0};row.Content.push(cell);
 const writer={SerTableCell:()=>({type:'tblCell',tcPr:{gridSpan:2}})};window.ftsRetainVerticalMergeAnchors(writer);window.ftsRetainResolvedCellAlignment(writer);
 const output=writer.SerTableCell(cell);assert.equal(output.tcPr.vMerge,'restart');assert.equal(output.tcPr.gridSpan,2);assert.equal(output.ftsVerticalAlign,'top');
});

test('omitted cells stay omitted and unverified alignment values cannot silently become top',()=>{
 assert.equal(typeof window.ftsRetainResolvedCellAlignment,'function');
 const skipped={SerTableCell:()=>undefined};window.ftsRetainResolvedCellAlignment(skipped);assert.equal(skipped.SerTableCell({Get_VAlign(){throw Error('Skipped cell getter must not run');}}),undefined);
 for(const value of[undefined,null,'0',-1,3,NaN,Infinity]){
  const writer={SerTableCell:()=>({type:'tblCell'})};window.ftsRetainResolvedCellAlignment(writer);assert.throws(()=>writer.SerTableCell({Get_VAlign:()=>value}),error=>error.code==='CELL_ALIGNMENT_UNVERIFIED');
 }
});
