import test from 'node:test';import assert from 'node:assert/strict';
import {planTableGeometry} from '../src/content/table-geometry.js';

test('SDK grid proportions retain their exact 100-percent rounding budget',()=>{
 assert.deepEqual(planTableGeometry({tblGrid:[{w:1440},{w:4320}]}).columnPercentages,[25,75]);
 assert.deepEqual(planTableGeometry({tblGrid:[{w:1},{w:1},{w:1}]}).columnPercentages,[33.3333,33.3333,33.3334]);
 for(const grid of [[],[{w:0}],[{w:-1}],[{w:NaN}],[{w:'1440'}]])assert.equal(planTableGeometry({tblGrid:grid}),null);
});

test('verified PDF axes supply column ratios and retain row minima without inventing missing cuts',()=>{
 const native={rows:2,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:2,leftPt:10,topPt:10,rightPt:110,bottomPt:30},{row:1,column:0,rowSpan:1,columnSpan:1,leftPt:10,topPt:30,rightPt:35,bottomPt:80},{row:1,column:1,rowSpan:1,columnSpan:1,leftPt:35,topPt:30,rightPt:110,bottomPt:80}]};
 assert.deepEqual(planTableGeometry({},native),{source:'native-pdf-cells',columnPercentages:[25,75],rowMinimumPt:[20,50]});
 assert.equal(planTableGeometry({},{...native,cells:[native.cells[0]]}),null);
 assert.equal(planTableGeometry({},{...native,cells:[...native.cells,{...native.cells[2],leftPt:36}]}),null);
});


test('SDK row minimum twips convert to points without treating automatic heights as a constraint',()=>{
 const node={tblGrid:[{w:1440},{w:4320}],content:[{trPr:{}},{trPr:{trHeight:{val:800,hRule:'atLeast'}}},{trPr:{trHeight:{val:400,hRule:'exact'}}},{trPr:{trHeight:{val:500,hRule:'auto'}}}]};
 assert.deepEqual(planTableGeometry(node).rowMinimumPt,[null,40,20,null]);
});
