// The Confluence page's author and date as a SharePoint title area shows them: the byline names the author's
// account on the site when exactly one matches (by e-mail, else by name), else the signed-in user, and the topic
// header is the date the Confluence page was last updated. A lookup SharePoint refuses, or answers with nothing
// usable, leaves the byline as it is (`user: null`, `refused`), with the date; one that did not reach SharePoint, or
// a tab that left the site, still stops the send.
import { fail } from './session.js';

const refused=error=>error?.code==='sharepoint-http'||['invalid-users','invalid-user','invalid-response'].includes(error?.code);

export function sourceMetadata(model) {
  const value=model.sourceMetadata;
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['author','lastUpdatedAt','version'].includes(key))||
     !value.author||typeof value.author!=='object'||Array.isArray(value.author)||Object.keys(value.author).some(key=>!['displayName','email'].includes(key))) {
    throw fail('invalid-model','Confluence source metadata is invalid.');
  }
  const name=value.author.displayName,email=value.author.email,updated=value.lastUpdatedAt;
  if(typeof name!=='string'||!name.trim()||name.length>255||/[\u0000-\u001f\u007f]/.test(name)||
     email!==null&&(typeof email!=='string'||email.length>254||/[\u0000- \u007f]/.test(email)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))||
     typeof updated!=='string'||updated.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updated)||!Number.isFinite(Date.parse(updated))||
     !Number.isSafeInteger(value.version)||value.version<1) throw fail('invalid-model','Confluence source metadata is invalid.');
  return {author:{displayName:name.trim(),email},lastUpdatedAt:updated,version:value.version};
}

export async function resolveAttribution(request, model) {
  const source=sourceMetadata(model);
  if(!source)return null;
  const topicHeader=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(source.lastUpdatedAt));
  try{return {topicHeader,user:await author(request,source)};}
  catch(error){if(!refused(error))throw error;return {topicHeader,user:null,refused:true};}
}

// The account the byline names.
async function author(request, source) {
  const filter=`Title eq '${source.author.displayName.replace(/'/g,"''")}'${source.author.email?` or Email eq '${source.author.email.replace(/'/g,"''")}' or UserPrincipalName eq '${source.author.email.replace(/'/g,"''")}'`:''}`;
  const collection=await request(`web/siteusers?$select=Id,Title,Email,LoginName,UserPrincipalName,IsHiddenInUI&$filter=${encodeURIComponent(filter)}`);
  const users=collection?.value??collection?.results;
  if(!Array.isArray(users)||collection?.['odata.nextLink']||collection?.['@odata.nextLink']||collection?.__next)throw fail('invalid-users','SharePoint returned incomplete site-user metadata.');
  const validUser=user=>Number.isSafeInteger(user?.Id)&&typeof user.Title==='string'&&user.Title.trim()&&typeof user.LoginName==='string'&&user.LoginName&&
    typeof user.UserPrincipalName==='string'&&user.UserPrincipalName&&[user.Email,user.UserPrincipalName].every(value=>value===null||typeof value==='string')&&user.IsHiddenInUI!==true?user:null;
  const valid=users.map(validUser).filter(Boolean);
  const email=source.author.email?.toLowerCase();
  const emailMatches=email?valid.filter(user=>[user.Email,user.UserPrincipalName].some(value=>typeof value==='string'&&value.toLowerCase()===email)):[];
  const nameMatches=valid.filter(user=>user.Title.trim().toLowerCase()===source.author.displayName.toLowerCase());
  let match=emailMatches.length===1?emailMatches[0]:emailMatches.length===0&&nameMatches.length===1?nameMatches[0]:null;
  if(!match) {
    match=validUser(await request('web/currentuser?$select=Id,Title,Email,LoginName,UserPrincipalName,IsHiddenInUI'));
    if(!match)throw fail('invalid-user','SharePoint did not return a valid signed-in user for the page byline.');
  }
  return {title:match.Title.trim(),loginName:match.LoginName,upn:match.UserPrincipalName};
}
