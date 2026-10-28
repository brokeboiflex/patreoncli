import { StreamChat } from "stream-chat";
import type { Browser } from "./browser.ts";
import { ClientError, UiChanged, WriteUncertain } from "./errors.ts";
import { numericId } from "./web-actions.ts";
import { countLimit } from "./ui.ts";

/** Website JSON:API contracts inspected in Patreon's moderation and messaging bundles.
 * This uses the signed-in website session, not the public OAuth API. */
async function request(b: Browser, path: string, method = "GET", body?: unknown): Promise<any> {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw new ClientError("Invalid API path.","INVALID_TARGET");
  const result = await b.page.evaluate(async ({path,method,body}) => {
    const headers:Record<string,string> = {Accept:"application/vnd.api+json"};
    if(method!=="GET") {
      const csrf=document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
      if(!csrf)return {status:0,data:null};
      headers["X-CSRF-Signature"]=csrf;
      headers["Content-Type"]="application/vnd.api+json";
    }
    try {
      const r=await fetch(path,{method,headers,credentials:"same-origin",...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:r.status,data:r.status===204?null:await r.json().catch(()=>null)};
    } catch {return {status:-1,data:null};}
  },{path,method,body});
  if(result.status===0)throw new UiChanged("Patreon did not provide a CSRF token. Renew the session.");
  if(result.status===-1)throw new WriteUncertain("Patreon request was interrupted. Inspect the resource before retrying.");
  if(result.status>=400 || result.data?.errors?.length)throw new ClientError(`Patreon rejected the request (HTTP ${result.status}). Check account access and resource IDs.`,method==="GET"?"HTTP_ERROR":"WRITE_REJECTED");
  if(result.status===204 || result.status===202)return result.data ?? {data:null};
  if(!result.data || !Object.hasOwn(result.data,"data"))throw new UiChanged("Unexpected Patreon API response.");
  return result.data;
}
async function start(b:Browser) { await b.goto("/messages?mode=campaign"); }
const ref=(type:string,id:string)=>({data:{type,id}});
const nonempty=(text:string,max=20000)=>{if(!text.trim()||text.length>max)throw new ClientError(`Text must contain 1–${max} characters.`,"INVALID_ARGUMENT");return text;};
export function resourceId(value:string):string {
  if(!/^[\w-]+$/.test(value))throw new ClientError("Invalid resource ID.","INVALID_ARGUMENT");return value;
}
export type ChatAudience="all_members"|"paid_members"|"selected_tiers";
export interface ChatOptions {name:string;audience:ChatAudience;tiers?:string[];emoji?:string;published?:boolean;}
export function chatPayload(campaignId:string,options:Partial<ChatOptions>,create=false) {
  numericId(campaignId);
  if(options.name!==undefined)nonempty(options.name,48);
  if(options.audience!==undefined&&!['all_members','paid_members','selected_tiers'].includes(options.audience))throw new ClientError("Invalid chat audience.","INVALID_ARGUMENT");
  if(options.audience==='selected_tiers'&&!options.tiers?.length)throw new ClientError("Selected-tier chats require tier IDs.","INVALID_ARGUMENT");
  options.tiers?.forEach(numericId);
  if(create && (!options.name || !options.audience))throw new ClientError("Name and audience are required.","INVALID_ARGUMENT");
  return {data:{type:"stream-channel",relationships:{campaign:ref("campaign",campaignId),...(options.tiers?{rewards:{data:options.tiers.map(id=>({type:"reward",id}))}}:{})},attributes:{...(create?{channel_type:"community_chat_lounge",has_live_audio:false,published:options.published??false}:{}),...(options.name!==undefined?{name:options.name}:{}),...(options.audience?{audience_type:options.audience}:{}),...(options.emoji!==undefined?{emoji:options.emoji}:{}),...(options.published!==undefined?{published:options.published}:{})}}};
}
export async function moderators(b:Browser) {await start(b);return request(b,"/api/community_moderator?include=campaign,user");}
export async function addModerator(b:Browser,userId:string) {numericId(userId);await start(b);return request(b,"/api/community_moderator","POST",{data:{type:"community_moderator",relationships:{user:ref("user",userId)}}});}
export async function removeModerator(b:Browser,moderatorId:string) {numericId(moderatorId);await start(b);await request(b,`/api/community_moderator/${moderatorId}`,"DELETE");return {status:"removed",id:moderatorId};}
export async function blocks(b:Browser) {await start(b);return request(b,"/api/blocks?include=blocked&fields[block]=block_reason&fields[user]=full_name,vanity");}
export async function block(b:Browser,userId:string) {numericId(userId);await start(b);return request(b,"/api/blocks","POST",{data:{type:"block",attributes:{},relationships:{blocked:ref("user",userId)}}});}
export async function unblock(b:Browser,blockId:string) {numericId(blockId);await start(b);await request(b,`/api/blocks/${blockId}`,"DELETE");return {status:"removed",id:blockId};}
export async function reports(b:Browser) {await start(b);return request(b,"/api/chat/report-meta?include=first_report.reporter,first_report.infractor,first_report.channel,first_report.reason,first_report.media&fields[streamReportMeta]=message_text");}
export async function resolveReport(b:Browser,reportId:string,action:"keep"|"remove") {
  resourceId(reportId);if(!["keep","remove"].includes(action))throw new ClientError("Action must be keep or remove.","INVALID_ARGUMENT");await start(b);
  const status=action==="keep"?"kept":"removed";
  await request(b,`/api/stream-chat/message-report/${reportId}`,"PATCH",{data:{type:"stream-message-report",attributes:{status}}});
  for(let i=0;i<15;i++){const doc=await request(b,`/api/stream-chat/message-report/${reportId}`);if(doc.data?.attributes?.status===status)return {status,id:reportId};await b.page.waitForTimeout(500);}
  throw new WriteUncertain("Report resolution was accepted but readback did not finish. Inspect reports before retrying.");
}
export async function createChat(b:Browser,campaignId:string,options:ChatOptions) {const body=chatPayload(campaignId,options,true);await start(b);return request(b,"/api/chat/lounge","POST",body);}
export async function editChat(b:Browser,channelId:string,campaignId:string,options:Partial<ChatOptions>) {resourceId(channelId);const body=chatPayload(campaignId,options);if(!Object.keys(body.data.attributes).length&&!options.tiers)throw new ClientError("Provide a chat setting to edit.","INVALID_ARGUMENT");await start(b);return request(b,`/api/chat/lounge/${channelId}`,"PATCH",body);}
export async function deleteChat(b:Browser,channelId:string) {resourceId(channelId);await start(b);await request(b,`/api/chat/lounge/${channelId}`,"DELETE");return {status:"deleted",id:channelId};}
export async function chatSettings(b:Browser,channelId:string) {resourceId(channelId);await start(b);return request(b,`/api/chat/lounge/${channelId}?include=rewards`);}
export async function sendDM(b:Browser,campaignId:string,userId:string,text:string) {
  numericId(campaignId);numericId(userId);nonempty(text);await start(b);
  const doc=await request(b,"/api/conversations","POST",{data:{type:"conversation",relationships:{campaign:ref("campaign",campaignId),participants:{data:[{type:"user",id:userId}]}}}});
  const conversationId=numericId(String(doc.data?.id));
  try{return await request(b,"/api/messages","POST",{data:{type:"message_v2",attributes:{content:text},relationships:{conversation:ref("conversation",conversationId)}}});}
  catch(error){throw new WriteUncertain(`Conversation ${conversationId} exists, but message submission was not confirmed. Inspect it before retrying.`);}
}

// Public application key from Patreon's production Stream client bundle, not a secret.
const STREAM_APPLICATION_KEY="ezwwjrd7jqah";
export type ChatRole="creator"|"member";
export function channelParts(cid:string):[string,string] {
  const m=/^(community_chat_lounge|dm_creator_to_fan|public_readable_chat|drops):([\w!-]+)$/.exec(cid);
  if(!m)throw new ClientError("Use a channel cid returned by chat-list (type:id).","INVALID_ARGUMENT");return [m[1]!,m[2]!];
}
async function withChat<T>(b:Browser,role:ChatRole,action:(client:StreamChat)=>Promise<T>):Promise<T> {
  if(!["creator","member"].includes(role))throw new ClientError("Role must be creator or member.","INVALID_ARGUMENT");
  await b.goto(`/messages?mode=${role==="creator"?"campaign":"user"}`);
  const doc=await request(b,`/api/stream-chat/${role==="creator"?"campaign":"user"}-token`,"POST",{});
  const token=doc.data?.attributes?.token;
  if(typeof token!=="string")throw new UiChanged("Patreon did not return a chat session.");
  let userId:string;
  try{userId=JSON.parse(Buffer.from(token.split('.')[1]!,"base64url").toString()).user_id;if(typeof userId!=="string"||!userId)throw Error();}catch{throw new UiChanged("Invalid chat session.");}
  const client=new StreamChat(STREAM_APPLICATION_KEY,{allowServerSideConnect:true,timeout:20000,logger:()=>{}});
  try{await client.connectUser({id:userId,invisible:true},token);return await action(client);}
  catch(error){if(error instanceof ClientError)throw error;throw new ClientError("Chat request failed. Check the channel, permissions, and whether your creator page is launched. Writes may need inspection before retrying.","CHAT_REQUEST_FAILED");}
  finally{await client.disconnectUser().catch(()=>{});}
}
export async function chatList(b:Browser,role:ChatRole="creator",limit=20) {
  countLimit(limit);
  return withChat(b,role,async c=>{const channels=await c.queryChannels({members:{$in:[c.userID!]}},[{last_message_at:-1}],{limit:Math.min(limit,30),watch:false,state:true});return {identity:c.userID,items:channels.map(ch=>({cid:ch.cid,name:(ch.data as Record<string,unknown>)?.name,memberCount:ch.data?.member_count,messages:ch.state.messages.slice(-1)})),limit:Math.min(limit,30)};});
}
export async function chatMessages(b:Browser,cid:string,role:ChatRole="creator",limit=20,before?:string) {
  const [type,id]=channelParts(cid);countLimit(limit);if(before)resourceId(before);
  return withChat(b,role,async c=>{const result=await c.channel(type,id).query({watch:false,state:true,messages:{limit:Math.min(limit,100),...(before?{id_lt:before}:{})}});return {cid,messages:result.messages,oldestId:result.messages[0]?.id};});
}
export async function sendMessage(b:Browser,cid:string,text:string,role:ChatRole="creator",replyTo?:string) {
  const [type,id]=channelParts(cid);nonempty(text);if(replyTo)resourceId(replyTo);
  return withChat(b,role,c=>c.channel(type,id).sendMessage({text,...(replyTo?{parent_id:replyTo}:{})}));
}
export async function editMessage(b:Browser,messageId:string,text:string,role:ChatRole="creator") {resourceId(messageId);nonempty(text);return withChat(b,role,c=>c.updateMessage({id:messageId,text}));}
export async function deleteMessage(b:Browser,messageId:string,role:ChatRole="creator") {resourceId(messageId);return withChat(b,role,c=>c.deleteMessage(messageId));}
export async function pinMessage(b:Browser,messageId:string,pinned=true,role:ChatRole="creator") {resourceId(messageId);return withChat(b,role,c=>pinned?c.pinMessage(messageId):c.unpinMessage(messageId));}
export async function muteUser(b:Browser,userId:string,muted=true,role:ChatRole="creator") {resourceId(userId);return withChat(b,role,c=>muted?c.muteUser(userId):c.unmuteUser(userId));}
export async function chatReplies(b:Browser,cid:string,messageId:string,role:ChatRole="creator",limit=20,before?:string) {
  const [type,id]=channelParts(cid);resourceId(messageId);countLimit(limit);if(before)resourceId(before);
  return withChat(b,role,c=>c.channel(type,id).getReplies(messageId,{limit:Math.min(limit,100),...(before?{id_lt:before}:{})}));
}
export async function chatMembers(b:Browser,cid:string,role:ChatRole="creator",limit=20,offset=0) {
  const [type,id]=channelParts(cid);countLimit(limit);if(!Number.isSafeInteger(offset)||offset<0)throw new ClientError("Offset must be nonnegative.","INVALID_ARGUMENT");
  return withChat(b,role,c=>c.channel(type,id).queryMembers({},[],{limit:Math.min(limit,100),offset}));
}
export async function react(b:Browser,cid:string,messageId:string,reaction:string,remove=false,role:ChatRole="creator") {
  const [type,id]=channelParts(cid);resourceId(messageId);if(!/^emoji-[a-f0-9]+(?:-[a-f0-9]+)*$/i.test(reaction))throw new ClientError("Use a Patreon emoji reaction ID, for example emoji-1f44d.","INVALID_ARGUMENT");
  return withChat(b,role,c=>remove?c.channel(type,id).deleteReaction(messageId,reaction):c.channel(type,id).sendReaction(messageId,{type:reaction}));
}
