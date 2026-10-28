import {isDeepStrictEqual} from "node:util";
import type { Browser } from './browser.ts';
import { ClientError, UiChanged, WriteUncertain } from './errors.ts';
import { numericId, postId } from './web-actions.ts';
import { request, listResources, type ListOptions } from './site-api.ts';
const start=async(b:Browser)=>b.goto('/messages?mode=campaign');
const fields='title,content,content_json_string,post_type,published_at,scheduled_for';
const query=new URLSearchParams({'fields[post]':fields,include:'poll.choices,access_rules,collections,campaign','fields[campaign]':'name','json-api-use-default-includes':'false'});
async function state(b:Browser,id:string){return request(b,`/api/posts/${numericId(id)}?${query}`);}
async function update(b:Browser,id:string,attributes:Record<string,unknown>,relationships:Record<string,unknown>={},included?:unknown[]){
  await request(b,`/api/posts/${numericId(id)}`,'PATCH',{data:{type:'post',id,attributes:{...attributes,tags:{publish:false}},...(Object.keys(relationships).length?{relationships}:{})},meta:{auto_save:false,send_notifications:false},...(included?{included}:{})});
  return state(b,id);
}
export async function postDetails(b:Browser,target:string){const id=postId(target);await start(b);return state(b,id);}
export async function tiers(b:Browser,campaignId:string){
  numericId(campaignId);await start(b);
  const q=new URLSearchParams({include:'access_rules,access_rules.tier,rewards','fields[campaign]':'name','fields[access-rule]':'access_rule_type','fields[reward]':'title,amount_cents','json-api-use-default-includes':'false'});
  return request(b,`/api/campaigns/${campaignId}?${q}`);
}
export function selectAccessRules(doc:any,audience:'free'|'paid'|'tiers',tierIds:string[]=[]):Array<{type:string;id:string}>{
  if(!['free','paid','tiers'].includes(audience))throw new ClientError('Audience must be free, paid or tiers.','INVALID_ARGUMENT');
  tierIds.forEach(numericId);
  if(audience==='tiers'?!tierIds.length:!!tierIds.length)throw new ClientError('Provide tier IDs only for the tiers audience.','INVALID_ARGUMENT');
  const rules=(doc.included??[]).filter((r:any)=>r.type==='access-rule');
  const selected=audience==='tiers'? [...new Set(tierIds)].map(id=>rules.find((r:any)=>r.attributes?.access_rule_type==='tier'&&String(r.relationships?.tier?.data?.id)===id)) : [rules.find((r:any)=>r.attributes?.access_rule_type===(audience==='free'?'public':'patrons'))];
  if(selected.some(r=>!r))throw new ClientError('No matching campaign access rule. Read tiers and use IDs from that campaign.','NOT_FOUND');
  return selected.map(r=>({type:r.type,id:r.id}));
}
export async function setAudience(b:Browser,target:string,campaignId:string,audience:'free'|'paid'|'tiers',tierIds:string[]=[]){
  const id=postId(target),doc=await tiers(b,campaignId),rules=selectAccessRules(doc,audience,tierIds),before=await state(b,id);
  if(String(before.data.relationships?.campaign?.data?.id)!==campaignId)throw new ClientError('Post does not belong to this campaign.','INVALID_ARGUMENT');
  const saved=await update(b,id,{}, {access_rules:{data:rules}},rules);
  const expected=rules.map(r=>r.id).sort().join(),actual=(saved.data.relationships?.access_rules?.data??[]).map((r:any)=>r.id).sort().join();
  if(expected!==actual)throw new WriteUncertain('Post audience readback did not match. Inspect post-details before retrying.');
  return {status:'saved',id,audience,accessRules:rules};
}
export interface PollOptions { choices?:string[]; multiple?:boolean; closesAt?:string|null; }
export function validatePoll(options:PollOptions){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['choices','multiple','closesAt'].includes(key)))throw new ClientError('Poll file must contain choices, multiple, or closesAt.', 'INVALID_ARGUMENT');
  if(options.choices!==undefined&&!Array.isArray(options.choices))throw new ClientError('choices must be an array.', 'INVALID_ARGUMENT');

  if(!Object.values(options).some(v=>v!==undefined))throw new ClientError('Provide poll choices, multiple, or closesAt.','INVALID_ARGUMENT');
  if(options.choices&&(options.choices.length<2||options.choices.length>20||options.choices.some(c=>typeof c!=='string'||!c.trim())||new Set(options.choices).size!==options.choices.length))throw new ClientError('Polls require 2–20 distinct nonempty choices.','INVALID_ARGUMENT');
  if(options.multiple!==undefined&&typeof options.multiple!=='boolean')throw new ClientError('multiple must be boolean.','INVALID_ARGUMENT');
  if(options.closesAt!==undefined&&options.closesAt!==null&&(!/(Z|[+-]\d{2}:\d{2})$/.test(options.closesAt)||!Number.isFinite(Date.parse(options.closesAt))||Date.parse(options.closesAt)<=Date.now()))throw new ClientError('closesAt must be a future ISO time with timezone, or null.','INVALID_ARGUMENT');
}
export function pollPayload(options:PollOptions,poll?:any){
  validatePoll(options);
  if(poll?.attributes?.closes_at&&Date.parse(poll.attributes.closes_at)<Date.now())throw new ClientError('Closed polls cannot be edited.','INVALID_ARGUMENT');
  if(Number(poll?.attributes?.num_responses)>0&&(options.choices!==undefined||options.multiple!==undefined))throw new ClientError('A poll with responses permits only an end-time change.','INVALID_ARGUMENT');
  if(!poll&&!options.choices)throw new ClientError('New polls require choices.','INVALID_ARGUMENT');
  const id=poll?.id??'1';
  const changeMode=!poll||options.multiple!==undefined||options.choices!==undefined;
  const mode=options.multiple!==undefined?(options.multiple?'multiple_choice':'single_choice'):poll?poll.attributes?.question_type:'single_choice';
  if(changeMode&&!['single_choice','multiple_choice'].includes(mode))throw new UiChanged('The existing poll has an unknown response mode.');
  const attributes={...(changeMode?{question_type:mode}:{}),...(options.closesAt!==undefined?{closes_at:options.closesAt===null?null:new Date(Math.floor(Date.parse(options.closesAt)/1000)*1000).toISOString()}:!poll?{closes_at:null}:{})};
  return {relationships:{poll:{data:{type:'poll',id}}},included:[{type:'poll',id,attributes},...(options.choices??[]).map((text,index)=>({type:'poll_choice',id:String(index),attributes:{choice_type:'toggle',position:index+1,text_content:text}}))]};
}
export async function editPoll(b:Browser,target:string,options:PollOptions){
  validatePoll(options);const id=postId(target);await start(b);const before=await state(b,id),poll=(before.included??[]).find((r:any)=>r.type==='poll');
  const payload=pollPayload(options,poll),saved=await update(b,id,{post_type:'poll'},payload.relationships,payload.included);
  const result=(saved.included??[]).find((r:any)=>r.type==='poll');
  if(!result||saved.data.attributes?.post_type!=='poll')throw new WriteUncertain('Poll was submitted but not confirmed by readback.');
  if(options.choices){const choices=(saved.included??[]).filter((r:any)=>r.type==='poll_choice').sort((a:any,b:any)=>a.attributes.position-b.attributes.position).map((r:any)=>r.attributes.text_content);if(JSON.stringify(choices)!==JSON.stringify(options.choices))throw new WriteUncertain('Poll choices did not match readback.');}
  if(options.multiple!==undefined&&result.attributes?.question_type!==(options.multiple?'multiple_choice':'single_choice'))throw new WriteUncertain('Poll response mode did not match readback.');
  if(options.closesAt!==undefined&&(options.closesAt===null?result.attributes?.closes_at!=null:Date.parse(result.attributes?.closes_at)!==Math.floor(Date.parse(options.closesAt)/1000)*1000))throw new WriteUncertain('Poll end time did not match readback.');
  return {status:'saved',post:saved.data,poll:result,choices:(saved.included??[]).filter((r:any)=>r.type==='poll_choice')};
}
export interface RichNode {type:string;text?:string;attrs?:Record<string,unknown>;content?:RichNode[];marks?:{type:string;attrs?:Record<string,unknown>}[];}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** The common Remirror nodes/marks used by the website editor. Reject unsupported nodes instead of silently stripping them. */
export function richHTML(doc:RichNode):string {
  let count=0;
  const invalid=():never=>{throw new ClientError('Invalid or unsupported rich document. See README for the supported Remirror nodes.','INVALID_ARGUMENT');};
  function render(n:RichNode,depth=0,parent=''):string {
    if(!n||typeof n!=='object'||depth>30||++count>10000)return invalid();
    if(n.content!==undefined&&!Array.isArray(n.content)||n.marks!==undefined&&!Array.isArray(n.marks))return invalid();
    if(n.attrs!==undefined&&(!n.attrs||typeof n.attrs!=='object'||Array.isArray(n.attrs)))return invalid();
    const allowedAttrs=n.type==='heading'?['level']:n.type==='orderedList'?['order']:[];
    if(Object.keys(n.attrs??{}).some(key=>!allowedAttrs.includes(key)))return invalid();
    if(n.type==='doc'&&(depth!==0||!Array.isArray(n.content)||!n.content.length))return invalid();
    if(n.type==='text'){
      if(!['paragraph','heading'].includes(parent)||typeof n.text!=='string'||!n.text.length||n.content)return invalid();
      let html=escape(n.text);
      for(const m of n.marks??[]){
        if(!m||typeof m!=='object'||m.attrs!==undefined&&(!m.attrs||typeof m.attrs!=='object'||Array.isArray(m.attrs)))return invalid();
        if(Object.keys(m.attrs??{}).some(key=>m.type!=='link'||key!=='href'))return invalid();
        const tag=({bold:'strong',italic:'em',strike:'s',underline:'u',code:'code'} as Record<string,string>)[m.type];
        if(tag)html=`<${tag}>${html}</${tag}>`;
        else if(m.type==='link'&&typeof m.attrs?.href==='string'){let url:URL;try{url=new URL(m.attrs.href);}catch{return invalid();}if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password)return invalid();html=`<a href="${escape(url.href)}">${html}</a>`;}
        else return invalid();
      }return html;
    }
    if(n.marks?.length||n.text!==undefined)return invalid();
    if(n.type==='hardBreak'){if(!['paragraph','heading'].includes(parent)||n.content?.length)return invalid();return '<br>';}
    const tags:Record<string,string>={paragraph:'p',bulletList:'ul',orderedList:'ol',listItem:'li',blockquote:'blockquote'};
    let tag=tags[n.type];
    if(n.type==='heading'){const level=n.attrs?.level??1;if(!Number.isInteger(level)||Number(level)<1||Number(level)>6)return invalid();tag=`h${level}`;}
    if(n.type!=='doc'&&!tag)return invalid();
    const children=n.content??[];
    if(['paragraph','heading'].includes(n.type)&&children.some(c=>!['text','hardBreak'].includes(c.type)))return invalid();
    if(['bulletList','orderedList'].includes(n.type)&&(!children.length||children.some(c=>c.type!=='listItem')))return invalid();
    if(n.type==='listItem'&&(children[0]?.type!=='paragraph'||!['bulletList','orderedList'].includes(parent)))return invalid();
    if(['doc','blockquote','listItem'].includes(n.type)&&children.some(c=>!['paragraph','heading','bulletList','orderedList','blockquote'].includes(c.type)))return invalid();
    if(n.type==='blockquote'&&!children.length)return invalid();
    let attrs='';
    if(n.type==='orderedList'&&n.attrs?.order!==undefined){const order=n.attrs.order;if(!Number.isSafeInteger(order)||Number(order)<1)return invalid();if(order!==1)attrs=` start="${order}"`;}
    const content=children.map(c=>render(c,depth+1,n.type)).join('');
    return n.type==='doc'?content:`<${tag}${attrs}>${content}</${tag}>`;
  }
  if(doc?.type!=='doc')return invalid();return render(doc);
}
export async function editRich(b:Browser,target:string,document:RichNode){
  const html=richHTML(document),id=postId(target);await start(b);
  const saved=await update(b,id,{content:html,content_json_string:JSON.stringify(document)});
  if(!isDeepStrictEqual(JSON.parse(saved.data.attributes?.content_json_string??'null'),document))throw new WriteUncertain('Rich document readback did not match.');
  return {status:'saved',post:saved.data};
}
export async function editEmbed(b:Browser,target:string,url:string,type:'link'|'video_embed'|'audio_embed'|'image_embed'='link'){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!['link','video_embed','audio_embed','image_embed'].includes(type))throw new ClientError('Use an HTTPS media URL and a supported embed type.','INVALID_ARGUMENT');
  const id=postId(target);await start(b);await update(b,id,{post_type:type,embed:{url:parsed.href}});
  const saved=await request(b,`/api/posts/${id}?fields[post]=post_type,embed&json-api-use-default-includes=false`);
  if(saved.data.attributes?.post_type!==type||saved.data.attributes?.embed?.url!==parsed.href)throw new WriteUncertain('Embed was submitted but URL readback did not match.');
  return {status:'saved',post:saved.data,embed:saved.data.attributes?.embed};
}
const collectionFields='title,description,post_ids,post_sort_type,num_posts,num_draft_posts';
const collectionQuery=new URLSearchParams({'fields[collection]':collectionFields,'json-api-use-default-includes':'false'});
export interface CollectionOptions {title?:string;description?:string;postIds?:string[];order?:'new_to_old'|'old_to_new'|'custom';}
export function collectionAttributes(options:CollectionOptions,create=false){
  if(create&&!options.title?.trim()||options.title!==undefined&&!options.title.trim())throw new ClientError('Collection title is required.','INVALID_ARGUMENT');
  if(options.description!==undefined&&options.description.length>400)throw new ClientError('Description must be at most 400 characters.','INVALID_ARGUMENT');
  if(options.order&&!['new_to_old','old_to_new','custom'].includes(options.order))throw new ClientError('Invalid collection order.','INVALID_ARGUMENT');
  if(options.postIds){options.postIds.forEach(id=>{numericId(id);if(!Number.isSafeInteger(Number(id)))throw new ClientError('Post ID exceeds the supported integer range.','INVALID_ARGUMENT');});if(options.postIds.length>500||new Set(options.postIds).size!==options.postIds.length)throw new ClientError('Use at most 500 unique post IDs.','INVALID_ARGUMENT');}
  const attrs={...(options.title!==undefined?{title:options.title}:{}),...(options.description!==undefined?{description:options.description}:{}),...(options.postIds?{post_ids:options.postIds.map(Number)}:{}),...(options.order||create?{post_sort_type:options.order??'new_to_old'}:{})};
  if(!Object.keys(attrs).length)throw new ClientError('Provide collection fields to edit.','INVALID_ARGUMENT');return attrs;
}
export async function collections(b:Browser,campaignId:string,limit=20,options:ListOptions={}){numericId(campaignId);await start(b);return listResources(b,`/api/collection?${collectionQuery}&filter[campaign_id]=${campaignId}&filter[must_contain_at_least_one_published_post]=false&sort=-edited_at&page[size]=50`,limit,options);}
export async function collection(b:Browser,id:string){numericId(id);await start(b);return request(b,`/api/collection/${id}?${collectionQuery}`);}
async function verifyCollection(b:Browser,id:string,expected:Record<string,unknown>){
  const doc=await request(b,`/api/collection/${numericId(id)}?${collectionQuery}`);
  for(const [key,value] of Object.entries(expected))if(JSON.stringify(doc.data.attributes?.[key])!==JSON.stringify(value))throw new WriteUncertain(`Collection ${id}: ${key} did not match readback. Inspect this collection before retrying.`);
  return {status:'saved',collection:doc.data};
}
async function validateCollectionPosts(b:Browser,ids?:string[]){
  for(const id of ids??[]){const doc=await request(b,`/api/posts/${id}?fields[post]=published_at&json-api-use-default-includes=false`);if(!doc.data.attributes?.published_at)throw new ClientError(`Post ${id} is a draft. The collection picker accepts published posts.`, 'INVALID_ARGUMENT');}
}
export async function createCollection(b:Browser,campaignId:string,options:CollectionOptions){
  numericId(campaignId);const attributes=collectionAttributes(options,true);await start(b);await validateCollectionPosts(b,options.postIds);
  const doc=await request(b,'/api/collection','POST',{data:{type:'collection',attributes,relationships:{campaign:{data:{type:'campaign',id:campaignId}}}}});
  return verifyCollection(b,doc.data.id,attributes);
}
export async function editCollection(b:Browser,id:string,options:CollectionOptions){
  numericId(id);const attributes=collectionAttributes(options);await start(b);await validateCollectionPosts(b,options.postIds);await request(b,`/api/collection/${id}`,'PATCH',{data:{type:'collection',id,attributes}});return verifyCollection(b,id,attributes);
}
export async function deleteCollection(b:Browser,id:string){numericId(id);await start(b);await request(b,`/api/collection/${id}`,'DELETE');return {status:'deleted',id,postsPreserved:true};}
