import {readFileSync} from 'node:fs';
import {type Command,str,opt,field,flag,limit} from './command.ts';
import {numericId,postURL} from './web-actions.ts';
import * as c from './content.ts';
const target={dest:'target'}, id={dest:'id'}, campaign={dest:'campaignId'}, file={dest:'file'};
export const pagination=[field('cursor','resume token returned by this list'),flag('all','follow all available pages')];
export const listOptions=(a:Parameters<typeof str>[0])=>({cursor:opt(a,'cursor'),all:!!a.all});
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const collectionOptions=[field('title','collection title'),field('description','description (up to 400 characters)'),field('posts','comma-separated post IDs; empty string clears the collection'),field('order','post order',['new_to_old','old_to_new','custom'])];
const collectionInput=(a:Parameters<typeof str>[0]):c.CollectionOptions=>({title:opt(a,'title'),description:a.description===undefined?undefined:str(a,'description'),postIds:a.posts===undefined?undefined:str(a,'posts').split(',').filter(Boolean),order:opt(a,'order') as c.CollectionOptions['order']});
export const contentCommands:Command[]=[
 {name:'post-details',help:'read post access rules, poll choices and collections',positionals:[target],validate:a=>{postURL(str(a,'target'));},execute:(b,a)=>c.postDetails(b,str(a,'target'))},
 {name:'tiers',help:'read campaign tiers and audience access rules',positionals:[campaign],validate:a=>{numericId(str(a,'campaignId'));},execute:(b,a)=>c.tiers(b,str(a,'campaignId'))},
 {name:'set-audience',help:'set a post audience, including selected campaign tiers',mutates:true,positionals:[target,campaign,{dest:'audience'}],options:[field('tiers','comma-separated tier IDs')],validate:a=>{postURL(str(a,'target'));numericId(str(a,'campaignId'));const audience=str(a,'audience');if(!['free','paid','tiers'].includes(audience))throw Error('Audience must be free, paid or tiers.');opt(a,'tiers')?.split(',').forEach(numericId);if(audience==='tiers'?!a.tiers:!!a.tiers)throw Error('Provide --tiers only for the tiers audience.');},execute:(b,a)=>c.setAudience(b,str(a,'target'),str(a,'campaignId'),str(a,'audience') as 'free'|'paid'|'tiers',opt(a,'tiers')?.split(','))},
 {name:'edit-poll',help:'create or edit a post poll using choices/multiple/closesAt JSON',mutates:true,positionals:[target,file],validate:a=>{postURL(str(a,'target'));c.validatePoll(json(str(a,'file')));},execute:(b,a)=>c.editPoll(b,str(a,'target'),json(str(a,'file')))},
 {name:'edit-rich',help:'replace the post body with a Remirror document JSON file',mutates:true,positionals:[target,file],validate:a=>{postURL(str(a,'target'));c.richHTML(json(str(a,'file')));},execute:(b,a)=>c.editRich(b,str(a,'target'),json(str(a,'file')))},
 {name:'edit-embed',help:'set an external link, image, audio or video embed',mutates:true,positionals:[target,{dest:'url'}],options:[{...field('type','embed kind',['link','image_embed','audio_embed','video_embed']),default:'link'}],validate:a=>{postURL(str(a,'target'));if(new URL(str(a,'url')).protocol!=='https:')throw Error('Use an HTTPS media URL.');},execute:(b,a)=>c.editEmbed(b,str(a,'target'),str(a,'url'),str(a,'type') as Parameters<typeof c.editEmbed>[3])},
 {name:'collections',help:'list campaign collections, including empty ones',positionals:[campaign],options:[limit,...pagination],validate:a=>{numericId(str(a,'campaignId'));},execute:(b,a)=>c.collections(b,str(a,'campaignId'),Number(a.limit),listOptions(a))},
 {name:'collection',help:'read collection metadata and ordered post IDs',positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>c.collection(b,str(a,'id'))},
 {name:'create-collection',help:'create a collection with optional posts',mutates:true,positionals:[campaign],options:collectionOptions,validate:a=>{numericId(str(a,'campaignId'));c.collectionAttributes(collectionInput(a),true);},execute:(b,a)=>c.createCollection(b,str(a,'campaignId'),collectionInput(a))},
 {name:'edit-collection',help:'edit metadata or replace/reorder collection posts',mutates:true,positionals:[id],options:collectionOptions,validate:a=>{numericId(str(a,'id'));c.collectionAttributes(collectionInput(a));},execute:(b,a)=>c.editCollection(b,str(a,'id'),collectionInput(a))},
 {name:'delete-collection',help:'delete a collection while preserving its posts',mutates:true,positionals:[id],validate:a=>{numericId(str(a,'id'));},execute:(b,a)=>c.deleteCollection(b,str(a,'id'))},
];
