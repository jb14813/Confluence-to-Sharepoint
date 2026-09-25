// Confluence emoji as SharePoint text. SharePoint text holds pictures only as
// separate aligned images, never inside a line, so every emoji becomes a Unicode
// character: the exact one when Confluence gives it, otherwise the nearest one.
// Confluence has three kinds, as its editor's emoji picker lists them:
// - standard emoji, whose id is their Unicode code points;
// - Atlassian's own emoji ("atlassian-…" ids), which are pictures: each has a
//   chosen equivalent below, and numbers and stars keep their color;
// - a site's custom emoji, a picture and a name only: the standard emoji whose
//   short name matches, then Atlassian's emoji of that name, then the standard
//   emoji whose name and keywords match best (emoji-names.js).
import {EMOJI_NAMES} from './emoji-names.js';

// Pictures, flag letters, skin tones and the keycap mark are what make text an emoji.
const PICTOGRAPHIC=/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}⃣]/u;
const SELECTOR=String.fromCharCode(0xFE0F);
// A single character drawn as plain text by default, such as 🗒 (1f5d2) or 🏛,
// is marked to be drawn as an emoji, as Confluence shows it; one drawn as an
// emoji anyway needs no mark. A keycap is marked before its keycap sign.
function presented(value){
  const base=value.replaceAll(SELECTOR,'');
  if([...base].length===1)return /\p{Emoji_Presentation}/u.test(base)?base:/\p{Extended_Pictographic}/u.test(base)?base+SELECTOR:base;
  return /^[0-9#*]⃣$/u.test(base)?base[0]+SELECTOR+'⃣':value;
}

/** An emoji label as text: Confluence may give the character or its escaped UTF-16 form. */
export const emojiLabel=value=>{
  const label=String(value??'').normalize('NFC').replace(/[​﻿]/gu,'').replace(/\s+/gu,' ').trim();
  const match=/^((?:\\u[0-9a-fA-F]{4}){1,16})([\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}‍]*)$/u.exec(label);
  if(!match)return label;
  try {
    const decoded=JSON.parse(`"${match[1]}"`)+match[2];
    return !/[\uD800-\uDFFF]/u.test(decoded)&&/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Symbol}]/u.test(decoded)?decoded:label;
  }catch{return label;}
};

// The colors of Atlassian's colored emoji, measured from its pictures.
const COLORS={purple:'#AC58E0',orange:'#E06C00',green:'#20A068',yellow:'#B08400',red:'#E0483C',lime:'#689820',teal:'#2898BC',gray:'#7C8088',blue:'#347CE8',magenta:'#CC509C'};
// Atlassian's emoji other than its numbers and stars, each with the nearest
// Unicode emoji, chosen beside Atlassian's pictures; its product logos get the
// emoji nearest their picture or purpose. A second value is a text color.
const ATLASSIAN={
  check_mark:'✅',cross_mark:'❌',info:'ℹ️',warning:'⚠️',warning2:'⚠️',question_mark:'❓',plus:'➕',minus:'➖',
  flag_on:'🚩',flag_off:['⚑','#6C6C74'],light_bulb_on:'💡',light_bulb_off:'💡',note:'📄',
  kiss:'😗',sunglasses:'😎',neutral:'😐',smiling_hearts:'🥰',wink:'😉',sweat_smile:'😅',laugh:'😂',party:'🥳',tears:'🥹',woozy:'🥴',
  big_grin:'😄',sweat:'😓',hug:'🤗',sick:'🤒',explode:'🤯',fear:'😱',grin_squint:'😆',thinking:'🤔',unamused:'😒',sob:'😭',angel:'😇',
  anger:'😠',rolling_eyes_frown:'🙄',smile:'☺️',plead:'🥺',confused:'😕',blowing_kiss:'😘',big_smile:'😊','crossed-out_eyes':'😵',
  star_struck:'🤩',melting:'🫠',vomit:'🤮',smile_with_tear:'🥲',worried:'😟',upside_down_smile:'🙃',surprise:'😮',slight_frown:'🙁',
  crying:'😢',monocle:'🧐',squint_with_tongue:'😝',anxious:'😰',slight_smile:'🙂',pensive:'😔',grin:'😀',tired:'😫',heart_eyes:'😍',
  steam:'😤',grimace:'😬',
  poop:'💩',beer:'🍺',sydney_picture:'🖼️',search:'🔍',beach:'🏖️',bulb:'💡',race_helmet:'🪖',primary_race_helmet:'🪖',megaphone:'📣',
  picture:'🖼️',compass:'🧭',construction:'🚧',skull:'💀',world_map:'🗺️',pencil:'✏️',race_wheel:'🛞',star:'⭐',bomb:'💣',house:'🏠',
  pushpin:'📌',police_car_light:'🚨',tools:'🛠️',gem:'💎',triangular_flag:'🚩',direct_hit:'🎯',beers:'🍻',
  love_you:'🤟',left_fist:'🤛',middle_finger:'🖕',victory:'✌️',point_right:'👉',write:'✍️',raising_hands:'🙌',metal:'🤘',pray:'🙏',
  muscle:'💪',point_left:'👈',fist:'👊',call:'🤙',clap:'👏',point_down:'👇',crossed_fingers:'🤞',heart_hands:'🫶',wave:'👋',
  thumbs_down:'👎',ok_hand:'👌',point_up_2:'👆',handshake:'🤝',right_fist:'🤜',thumbs_up:'👍',
  brown_eyes:'👀',blue_eyes:'👀',green_eyes:'👀',purple_heart:'💜',blue_heart:'💙',pink_heart:'🩷',red_heart:'❤️','+1':'👍',spicy:'🌶️',
  100:'💯',rocket:'🚀',fire:'🔥',lightning:'⚡',celebrate:'🎉',boom:'💥',crossbones:'☠️',
  logo_home:'🏠',logo_admin:'⚙️',logo_studio:'🎨',logo_jira_product_discovery:'💡',logo_goals:'🎯',logo_rovodev:'🤖',logo_trello:'📋',
  logo_statuspage:'📶',logo_feedback:'💬',logo_hub:'🏢',logo_align:'📐',logo_compass:'🧭',logo_opsgenie:'🚨',logo_rovo:'🤖',logo_focus:'🎯',
  logo_bitbucket:'🪣',logo_talent:'🧑‍💼',logo_customer_service_management:'🛟',logo_jira_service_management:'⚡',logo_atlassian:['▲','#1868D8'],
  logo_loom:'🎥',logo_sourcetree:'🌳',logo_teams:'👥',logo_guard:'🛡️',logo_jira:'🎫',logo_search:'🔍',logo_assets:'🗃️',logo_projects:'🚀',
  logo_chat:'💬',logo_analytics:'📊',logo_pipelines:'♾️',logo_confluence:'📘'
};
// Atlassian's numbers are white on a colored circle or square: the Unicode
// numbers in a filled circle (0 to 20), in the number's color. Larger numbers,
// which Atlassian does not draw today, use circled or plain numbers.
const numberCharacter=value=>value===0?'⓿':value<=10?String.fromCodePoint(0x2775+value):value<=20?String.fromCodePoint(0x24EA+value-10):
  value<=35?String.fromCodePoint(0x3250+value-20):value<=50?String.fromCodePoint(0x32B0+value-35):String(value);
function atlassianParts(name){
  const key=Object.hasOwn(ATLASSIAN,name)?name:Object.keys(ATLASSIAN).find(entry=>entry.replace(/-/g,'_')===name.replace(/-/g,'_'));
  if(key){const value=ATLASSIAN[key];return Array.isArray(value)?{character:value[0],color:value[1]}:{character:value};}
  const number=/^(\d{1,3})_[a-z]+_(?:circle|square)_([a-z]+)$/.exec(name);
  if(number)return {character:numberCharacter(Number(number[1])),...(COLORS[number[2]]?{color:COLORS[number[2]]}:{})};
  const star=/^([a-z]+)_star$/.exec(name);
  if(star)return star[1]==='yellow'?{character:'⭐'}:star[1]==='glowing'?{character:'🌟'}:{character:'★',...(COLORS[star[1]]?{color:COLORS[star[1]]}:{})};
  return null;
}

// Words for matching names: lower case, without accents, singular.
const STOP=new Set(['a','an','and','at','for','in','is','it','my','of','off','on','or','our','the','this','that','to','with','your']);
const singular=word=>word.length>3&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
const wordsOf=value=>String(value).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean).map(singular);
const plainName=value=>String(value??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^:+|:+$/g,'').trim();
let standard=null;
function standardEmoji(){
  if(standard)return standard;
  standard=EMOJI_NAMES.split('\n').map((line,order)=>{
    const [character,codes,label,tags]=line.split('\t'),names=codes?codes.split('|'):[];
    const labelWords=wordsOf(label);
    return {character,order,names:new Set(names),labelWords,nameWords:new Set([...labelWords,...names.flatMap(wordsOf)]),tagWords:new Set(tags?tags.split('|').flatMap(wordsOf):[])};
  });
  return standard;
}
const standardNamed=name=>standardEmoji().find(entry=>entry.names.has(name)||entry.names.has(name.replace(/-/g,'_')))?.character??null;
// Scores compare in order; the first difference decides.
const better=(score,than)=>{for(let index=0;index<score.length;index++)if(score[index]!==than[index])return score[index]>than[index];return false;};
/** The standard emoji nearest a custom emoji's name, or null when no name or keyword matches. */
export function nearestEmoji(shortName){
  const name=plainName(shortName);
  if(!name)return null;
  const exact=standardNamed(name);
  if(exact)return exact;
  const entries=standardEmoji(),tokens=[...new Set(wordsOf(name).filter(word=>!STOP.has(word)))];
  if(!tokens.length)return null;
  // More of the name's words matched, then more in the emoji's own name than in
  // its keywords, then the emoji with the fewest other words, then the earliest.
  let best=null,bestScore=null;
  const consider=(entry,score)=>{if(!bestScore||better(score,bestScore)){best=entry;bestScore=score;}};
  for(const entry of entries){
    let named=0,keyword=0;
    for(const token of tokens){if(entry.nameWords.has(token))named++;else if(entry.tagWords.has(token))keyword++;}
    if(named+keyword)consider(entry,[named+keyword,named,-entry.labelWords.length]);
  }
  // A name joined into one word, such as "rocketship", still finds the longest word it begins with.
  if(!best)for(const entry of entries){
    let joined=0,longest=0;
    for(const token of tokens){
      const lengths=entry.labelWords.filter(word=>token.length>=4&&word.length>=4&&(token.startsWith(word)||word.startsWith(token))).map(word=>Math.min(word.length,token.length));
      if(lengths.length){joined++;longest=Math.max(longest,...lengths);}
    }
    if(joined)consider(entry,[joined,longest,-entry.labelWords.length]);
  }
  return best?best.character:null;
}

/** A custom emoji's name for a note, such as ":team-logo:", or null when it has none worth showing. */
export function emojiName({shortName,text}={}){
  const name=plainName(shortName||text).replace(/[^\p{L}\p{N}_+\-]/gu,'').slice(0,60);
  return name?`:${name}:`:null;
}
/** The note for custom emoji left out because no standard emoji is similar; `names` from emojiName. */
export function omittedEmojiNote(names){
  const unique=[...new Set(names.filter(Boolean))],count=Math.max(unique.length,names.length);
  const listed=unique.length<2?unique.join(''):`${unique.slice(0,-1).join(', ')} and ${unique.at(-1)}`;
  return count===1
    ?`A custom Confluence emoji${listed?` (${listed})`:''} has no similar standard emoji, so it was left out. Add a similar emoji in SharePoint if it is needed.`
    :`${count} custom Confluence emoji${listed?` (${listed})`:''} have no similar standard emoji, so they were left out. Add similar emoji in SharePoint if they are needed.`;
}

/**
 * An emoji as {character, color?}: `text` is the character or escaped form
 * Confluence stores, `id` its code points or Atlassian or custom id, and
 * `shortName` its name, such as ":sunglasses:". Null when nothing is similar.
 */
export function emojiParts({text,id,shortName}={}){
  const label=emojiLabel(text);
  if(PICTOGRAPHIC.test(label))return {character:presented(label)};
  const points=/^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,15}$/i.test(id??'')?id.split('-').map(part=>parseInt(part,16)):[];
  if(points.length&&points.every(point=>point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff))){
    const value=String.fromCodePoint(...points);
    if(PICTOGRAPHIC.test(value))return {character:presented(value)};
  }
  const own=typeof id==='string'&&id.startsWith('atlassian-')?atlassianParts(id.slice('atlassian-'.length)):null;
  if(own)return own;
  const name=plainName(shortName||label);
  if(!name)return null;
  const standardName=standardNamed(name);
  if(standardName)return {character:presented(standardName)};
  const atlassian=atlassianParts(name);
  if(atlassian)return atlassian;
  const nearest=nearestEmoji(name);
  return nearest?{character:presented(nearest)}:null;
}
