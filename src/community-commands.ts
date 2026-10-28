import {type Command, str, opt, body, field, textFile, limit} from './command.ts';
import {ClientError} from './errors.ts';
import {numericId} from './web-actions.ts';
import * as community from './community.ts';
const id={dest:'id'},cid={dest:'cid'},text={dest:'text',optional:true};
const role={...field('as','chat identity',['creator','member']),default:'creator'};
const asRole=(a:Parameters<typeof body>[0])=>str(a,'as') as community.ChatRole;
const chatOptions=[field('name','chat name'),field('audience','audience',['all_members','paid_members','selected_tiers']),field('tiers','comma-separated tier IDs'),field('emoji','chat emoji'),field('published','publish or unpublish the chat',['on','off'])];
function options(a:Parameters<typeof body>[0]):Partial<community.ChatOptions>{return {name:opt(a,'name'),audience:opt(a,'audience') as community.ChatAudience|undefined,tiers:opt(a,'tiers')?.split(','),emoji:opt(a,'emoji'),published:a.published===undefined?undefined:a.published==='on'};}
const validId=(a:Parameters<typeof body>[0])=>{community.resourceId(str(a,'id'));};
export const communityCommands:Command[]=[
 {name:'moderators',help:'list moderator assignments and invitations',execute:community.moderators},
 {name:'add-moderator',help:'invite a user to moderate your community',mutates:true,positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>community.addModerator(b,str(a,'id'))},
 {name:'remove-moderator',help:'remove a moderator assignment or invitation by assignment ID',mutates:true,positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>community.removeModerator(b,str(a,'id'))},
 {name:'blocks',help:'list blocked users and block IDs',execute:community.blocks},
 {name:'block',help:'block a user without deleting their comments',mutates:true,positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>community.block(b,str(a,'id'))},
 {name:'unblock',help:'remove a block by block ID',mutates:true,positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>community.unblock(b,str(a,'id'))},
 {name:'reports',help:'list reported community chat content',execute:community.reports},
 {name:'resolve-report',help:'keep or remove reported chat content',mutates:true,positionals:[id,{dest:'action'}],validate:a=>{validId(a);if(!['keep','remove'].includes(str(a,'action')))throw new ClientError('Action must be keep or remove.','INVALID_ARGUMENT');},execute:(b,a)=>community.resolveReport(b,str(a,'id'),str(a,'action') as 'keep'|'remove')},
 {name:'chat-list',help:'list channels available to the selected identity (up to 30)',options:[role,limit],execute:(b,a)=>community.chatList(b,asRole(a),Number(a.limit))},
 {name:'chat-settings',help:'read a chat audience and tier settings',positionals:[id],validate:validId,execute:(b,a)=>community.chatSettings(b,str(a,'id'))},
 {name:'create-chat',help:'create a chat (unpublished unless --published on)',mutates:true,positionals:[{dest:'campaignId'}],options:chatOptions,validate:a=>{community.chatPayload(str(a,'campaignId'),options(a),true);},execute:(b,a)=>community.createChat(b,str(a,'campaignId'),options(a) as community.ChatOptions)},
 {name:'edit-chat',help:'edit chat name, audience, tiers, emoji or publication',mutates:true,positionals:[id,{dest:'campaignId'}],options:chatOptions,validate:a=>{validId(a);const p=community.chatPayload(str(a,'campaignId'),options(a));if(!Object.keys(p.data.attributes).length&&!a.tiers)throw new ClientError('Provide a setting to edit.','INVALID_ARGUMENT');},execute:(b,a)=>community.editChat(b,str(a,'id'),str(a,'campaignId'),options(a))},
 {name:'delete-chat',help:'delete a community chat',mutates:true,positionals:[id],validate:validId,execute:(b,a)=>community.deleteChat(b,str(a,'id'))},
 {name:'chat-messages',help:'read channel messages; --before paginates older messages',positionals:[cid],options:[role,limit,field('before','oldest message ID from previous page')],validate:a=>{community.channelParts(str(a,'cid'));if(a.before)community.resourceId(str(a,'before'));},execute:(b,a)=>community.chatMessages(b,str(a,'cid'),asRole(a),Number(a.limit),opt(a,'before'))},
 {name:'send',help:'send a chat message or reply',mutates:true,positionals:[cid,text],options:[role,textFile,field('reply-to','parent message ID')],validate:a=>{community.channelParts(str(a,'cid'));body(a);if(a.replyTo)community.resourceId(str(a,'replyTo'));},execute:(b,a)=>community.sendMessage(b,str(a,'cid'),body(a),asRole(a),opt(a,'replyTo'))},
 {name:'dm',help:'send one direct message to one user from your campaign',mutates:true,positionals:[{dest:'campaignId'},{dest:'userId'},text],options:[textFile],validate:a=>{numericId(str(a,'campaignId'));numericId(str(a,'userId'));body(a);},execute:(b,a)=>community.sendDM(b,str(a,'campaignId'),str(a,'userId'),body(a))},
 {name:'edit-message',help:'edit your chat message',mutates:true,positionals:[id,text],options:[role,textFile],validate:a=>{validId(a);body(a);},execute:(b,a)=>community.editMessage(b,str(a,'id'),body(a),asRole(a))},
 {name:'delete-message',help:'delete a chat message you may moderate',mutates:true,positionals:[id],options:[role],validate:validId,execute:(b,a)=>community.deleteMessage(b,str(a,'id'),asRole(a))},
 ...(['pin-message','unpin-message','mute-user','unmute-user'] as const).map(name=>({name,help:name.replaceAll('-',' '),mutates:true,positionals:[id],options:[role],validate:validId,execute:(b:Parameters<typeof community.pinMessage>[0],a:Parameters<typeof body>[0])=>name.endsWith('message')?community.pinMessage(b,str(a,'id'),name==='pin-message',asRole(a)):community.muteUser(b,str(a,'id'),name==='mute-user',asRole(a))})),
 {name:'chat-replies',help:'read a message thread',positionals:[cid,id],options:[role,limit,field('before','older reply cursor')],validate:a=>{community.channelParts(str(a,'cid'));validId(a);if(a.before)community.resourceId(str(a,'before'));},execute:(b,a)=>community.chatReplies(b,str(a,'cid'),str(a,'id'),asRole(a),Number(a.limit),opt(a,'before'))},
 {name:'chat-members',help:'list chat members',positionals:[cid],options:[role,limit,{flags:['--offset'],dest:'offset',valueType:'int',default:0}],validate:a=>{community.channelParts(str(a,'cid'));if(!Number.isSafeInteger(a.offset)||Number(a.offset)<0)throw new ClientError('Offset must be nonnegative.','INVALID_ARGUMENT');},execute:(b,a)=>community.chatMembers(b,str(a,'cid'),asRole(a),Number(a.limit),Number(a.offset))},
 {name:'react',help:'add or remove your emoji reaction on a chat message',mutates:true,positionals:[cid,id,{dest:'reaction'}],options:[role,{flags:['--remove'],dest:'remove',action:'storeTrue'}],validate:a=>{community.channelParts(str(a,'cid'));validId(a);if(!/^emoji-[a-f0-9]+(?:-[a-f0-9]+)*$/i.test(str(a,'reaction')))throw new ClientError('Use a Patreon emoji reaction ID.','INVALID_ARGUMENT');},execute:(b,a)=>community.react(b,str(a,'cid'),str(a,'id'),str(a,'reaction'),!!a.remove,asRole(a))},

];
