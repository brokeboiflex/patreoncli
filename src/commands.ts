import {contentCommands, pagination, listOptions} from "./content-commands.ts";
import { type Command, str, opt, body, limit, textFile, field, localFile } from "./command.ts";
import { ClientError } from "./errors.ts";
import * as web from "./web-actions.ts";

const target = { dest:"target",help:"Patreon post URL or numeric ID" };
const text = { dest:"text",optional:true };
const options = [field("title","post title"),textFile,field("audience","post audience",["free","paid"]),field("comments","who may comment",["everyone","members","paid","none"]),field("notify","notify members when published",["on","off"])];
function postOptions(a: Parameters<typeof body>[0]):web.PostOptions {
  return { title:opt(a,"title"),text:a.text||a.bodyFile?body(a):undefined,audience:opt(a,"audience") as web.PostOptions["audience"],comments:opt(a,"comments") as web.PostOptions["comments"],notify:a.notify==null?undefined:a.notify==="on" };
}
const validTarget = (a:Parameters<typeof body>[0]) => { web.postURL(str(a,"target")); };
const validComment = (a:Parameters<typeof body>[0]) => { validTarget(a); body(a); if(a.replyTo) web.numericId(str(a,"replyTo")); };

import {communityCommands} from "./community-commands.ts";

export const commands:Command[] = [
  ...communityCommands,
  ...contentCommands,
  { name:"whoami",help:"show the signed-in creator",execute:b=>web.whoami(b) },
  { name:"posts",help:"list your published posts or drafts",options:[limit,...pagination,{...field("status","library tab",["published","drafts"]),default:"published"}],execute:(b,a)=>web.posts(b,str(a,"status") as "published"|"drafts",Number(a.limit),listOptions(a)) },
  { name:"members",help:"list your creator's members",options:[limit,...pagination],execute:(b,a)=>web.members(b,Number(a.limit),listOptions(a)) },
  { name:"read",help:"read an accessible post",positionals:[target],validate:validTarget,execute:(b,a)=>web.read(b,str(a,"target")) },
  ...(["draft","post"] as const).map(name=>({ name,help:name==="draft"?"create and save a draft":"create and publish a post",mutates:true,positionals:[text],options,validate:(a:Parameters<typeof body>[0])=>{ body(a); if(!str(a,"title").trim()) throw new ClientError("--title is required.","INVALID_ARGUMENT"); },execute:(b:Parameters<typeof web.draft>[0],a:Parameters<typeof body>[0])=>web[name](b,postOptions(a)) })),
  { name:"edit",help:"edit post content or audience/comment settings",mutates:true,positionals:[target,text],options,validate:a=>{ validTarget(a); const fields=postOptions(a); if(Object.values(fields).every(v=>v===undefined)) throw new ClientError("Provide text, --title, or a post setting to edit.","INVALID_ARGUMENT"); },execute:(b,a)=>web.edit(b,str(a,"target"),postOptions(a)) },
  { name:"publish",help:"publish an existing draft",mutates:true,positionals:[target],validate:validTarget,execute:(b,a)=>web.publish(b,str(a,"target")) },
  { name:"schedule",help:"schedule a draft at an ISO time including its timezone",mutates:true,positionals:[target,{dest:"when"}],validate:a=>{validTarget(a);web.scheduleTime(str(a,"when"));},execute:(b,a)=>web.schedule(b,str(a,"target"),str(a,"when")) },
  { name:"attach",help:"attach a local media file to a draft",mutates:true,positionals:[target,{dest:"file"}],options:[{...field("type","media kind",["image","video","audio","attachment"]),default:"attachment"}],validate:a=>{validTarget(a);localFile(str(a,"file"));},execute:(b,a)=>web.attach(b,str(a,"target"),str(a,"file"),str(a,"type") as Parameters<typeof web.attach>[3]) },
  { name:"delete-post",help:"delete a draft or published post",mutates:true,positionals:[target],validate:validTarget,execute:(b,a)=>web.deletePost(b,str(a,"target")) },
  { name:"comments",help:"read a post's comments and loaded replies",positionals:[target],options:[limit,...pagination],validate:validTarget,execute:(b,a)=>web.comments(b,str(a,"target"),Number(a.limit),listOptions(a)) },
  { name:"comment",help:"comment on a post or reply to a comment",mutates:true,positionals:[target,text],options:[textFile,field("reply-to","parent comment ID")],validate:validComment,execute:(b,a)=>web.comment(b,str(a,"target"),body(a),opt(a,"replyTo")) },
  { name:"edit-comment",help:"edit your comment",mutates:true,positionals:[target,{dest:"commentId"},text],options:[textFile],validate:a=>{validComment(a);web.numericId(str(a,"commentId"));},execute:(b,a)=>web.editComment(b,str(a,"target"),str(a,"commentId"),body(a)) },
  { name:"delete-comment",help:"delete a comment you can moderate",mutates:true,positionals:[target,{dest:"commentId"}],validate:a=>{validTarget(a);web.numericId(str(a,"commentId"));},execute:(b,a)=>web.deleteComment(b,str(a,"target"),str(a,"commentId")) },
  { name:"moderation",help:"inspect reports, moderators, or automatic moderation",options:[{...field("tab","moderation tab",["reported-content","moderators","auto-moderation"]),default:"reported-content"}],execute:(b,a)=>web.moderation(b,str(a,"tab") as Parameters<typeof web.moderation>[1]) },
  { name:"auto-moderation",help:"enable or disable automatic comment moderation",mutates:true,positionals:[{dest:"state"}],validate:a=>{if(!["on","off"].includes(str(a,"state")))throw new ClientError("State must be on or off.","INVALID_ARGUMENT");},execute:(b,a)=>web.autoModeration(b,a.state==="on") },
  { name:"chats",help:"inspect your chat inbox",execute:b=>web.chats(b) },
];
