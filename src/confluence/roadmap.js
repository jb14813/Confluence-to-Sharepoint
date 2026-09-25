// Confluence's roadmap macro (the Roadmap Planner) draws a timeline: months
// across, labelled with the year on the first month and each January, a row of
// lanes, each lane's bars across the months they last, and markers at dates.
// Its labels and bars are drawn in a picture (SVG) that SharePoint text cannot
// hold. The nearest SharePoint has is a table drawn from the roadmap's stored
// data: the months as columns, a row for each lane in its colors, each bar in
// the months its dates cover, and each marker below its month.
import {HEADER_BACKGROUND,escape} from './html.js';
import {NBSP} from './whitespace.js';

const DATE=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COLOR=/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
// Five years of months, beyond which a table's columns are too narrow to read; later months are left out.
const MAX_MONTHS=60;
// The share of the table the lane names take; Confluence writes them upright in a narrow strip.
const LANE_WIDTH=16;
const MAX_TEXT=1000;

/** A roadmap's stored data ({timeline, lanes, markers}) from its macro's parameters, or null. */
export function roadmapSource(macroParams) {
  const raw=macroParams?.source?.value??macroParams?.source;
  if(raw&&typeof raw==='object')return raw;
  if(typeof raw!=='string'||raw.length>500_000)return null;
  for(const text of [raw,(()=>{try{return decodeURIComponent(raw);}catch{return null;}})()]) {
    try{const value=JSON.parse(text);if(value&&typeof value==='object')return value;}catch{/* Try the next form. */}
  }
  return null;
}

const dateParts=value=>{
  const match=DATE.exec(String(value??''));if(!match)return null;
  const [y,mo,d,h,mi,s]=match.slice(1).map(part=>Number(part??0));
  return mo>=1&&mo<=12&&d>=1&&d<=31?{y,mo,d,h,mi,s}:null;
};
const daysIn=(y,mo)=>new Date(Date.UTC(y,mo,0)).getUTCDate();
// A date's place on the timeline, in months from the start of its first month, as Confluence draws it.
const position=(date,start)=>(date.y-start.y)*12+(date.mo-start.mo)+(date.d-1+(date.h*3600+date.mi*60+date.s)/86400)/daysIn(date.y,date.mo);
const text=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,MAX_TEXT);
const color=value=>COLOR.test(value??'')?value:null;

/**
 * The roadmap laid out as months: {labels, lanes:[{title, lane, bar, text, rows:[[{title, first, last}]]}], markers:[{column, titles}]},
 * or null when it has no months.
 */
export function roadmapLayout(source) {
  const start=dateParts(source?.timeline?.startDate),end=dateParts(source?.timeline?.endDate);
  if(!start||!end)return null;
  const months=(end.y-start.y)*12+(end.mo-start.mo)+1;
  if(months<1)return null;
  const count=Math.min(months,MAX_MONTHS);
  const labels=Array.from({length:count},(unused,index)=>{
    const month=(start.mo-1+index)%12,year=start.y+Math.floor((start.mo-1+index)/12);
    return index===0||month===0?`${MONTHS[month]} ${year}`:MONTHS[month];
  });
  const lanes=(Array.isArray(source.lanes)?source.lanes:[]).filter(lane=>lane&&typeof lane==='object').map(lane=>{
    const bars=(Array.isArray(lane.bars)?lane.bars:[]).map(bar=>{
      const at=dateParts(bar?.startDate),duration=Number(bar?.duration);
      if(!at||!Number.isFinite(duration)||duration<=0)return null;
      const from=position(at,start),to=from+duration;
      if(to<=0||from>=count)return null;
      const first=Math.max(0,Math.floor(from));
      return {title:text(bar.title),row:Number.isInteger(bar.rowIndex)&&bar.rowIndex>=0?bar.rowIndex:0,first,last:Math.min(count-1,Math.max(first,Math.ceil(to)-1))};
    }).filter(Boolean).sort((a,b)=>a.row-b.row||a.first-b.first);
    // Each bar on its row, as Confluence places it; one that would meet another in whole months goes on the next row with room.
    const order=[...new Set(bars.map(bar=>bar.row))],rows=[];
    for(const bar of bars) {
      let row=order.indexOf(bar.row);
      while(rows[row]?.some(other=>other.first<=bar.last&&bar.first<=other.last))row++;
      (rows[row]??=[]).push(bar);
    }
    const filled=rows.filter(Boolean);
    return {title:text(lane.title),lane:color(lane.color?.lane),bar:color(lane.color?.bar),text:color(lane.color?.text),rows:filled.length?filled:[[]]};
  });
  const columns=new Map();
  for(const marker of Array.isArray(source.markers)?source.markers:[]) {
    const at=dateParts(marker?.markerDate);if(!at)continue;
    const column=Math.floor(position(at,start));
    if(column<0||column>=count)continue;
    if(!columns.has(column))columns.set(column,[]);
    columns.get(column).push(text(marker.title));
  }
  return {labels,lanes,markers:[...columns].sort((a,b)=>a[0]-b[0]).map(([column,titles])=>({column,titles}))};
}

/** The roadmap as a SharePoint table, {html, text}, or null when it has no months. */
export function roadmapHtml(source) {
  const layout=roadmapLayout(source);
  if(!layout)return null;
  const {labels,lanes,markers}=layout,count=labels.length;
  const monthWidth=Math.round((100-LANE_WIDTH)/count*10_000)/10_000;
  const style=values=>` style="${values.filter(Boolean).join(';')}"`;
  const colors=(background,foreground)=>[background&&`background-color:${background}`,foreground&&`color:${foreground}`];
  let html=`<tr><th scope="col"${style([`background-color:${HEADER_BACKGROUND}`,`width:${LANE_WIDTH}%`,'text-align:left','vertical-align:top'])}></th>`+
    labels.map(label=>`<th scope="col"${style([`background-color:${HEADER_BACKGROUND}`,`width:${monthWidth}%`,'text-align:left','vertical-align:top'])}>${escape(label)}</th>`).join('')+'</tr>';
  const words=[...labels];
  for(const lane of lanes) {
    words.push(lane.title);
    lane.rows.forEach((row,index)=>{
      html+='<tr>';
      if(!index)html+=`<th scope="row"${lane.rows.length>1?` rowspan="${lane.rows.length}"`:''}${style([...colors(lane.lane,lane.text),'text-align:left','vertical-align:top'])}>${escape(lane.title)}</th>`;
      for(let column=0;column<count;) {
        const bar=row.find(item=>item.first===column);
        if(!bar){html+='<td style="vertical-align:top"></td>';column++;continue;}
        const span=bar.last-bar.first+1;
        html+=`<td${span>1?` colspan="${span}"`:''}${style([...colors(lane.bar,lane.text),'vertical-align:top'])}>${escape(bar.title||NBSP)}</td>`;
        words.push(bar.title);column+=span;
      }
      html+='</tr>';
    });
  }
  if(markers.length) {
    html+='<tr><td style="vertical-align:top"></td>';
    for(let column=0;column<count;column++) {
      const titles=markers.find(marker=>marker.column===column)?.titles??[];
      html+=`<td style="vertical-align:top">${titles.map(escape).join('<br>')}</td>`;words.push(...titles);
    }
    html+='</tr>';
  }
  return {html:`<table style="width:100%;table-layout:fixed"><tbody>${html}</tbody></table>`,text:words.filter(Boolean).join(' ')};
}
