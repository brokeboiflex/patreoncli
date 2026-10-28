import {test,expect} from 'bun:test';
import type {Browser} from '../src/browser.ts';
import {chatPayload,channelParts,resourceId,addModerator,removeModerator,block,unblock,resolveReport,createChat,editChat,deleteChat,sendDM} from '../src/community.ts';

// JSON:API request fixtures transcribed from Patreon's current website bundles:
// moderator panel, blocking hooks, report panel, lounge editor and DM composer.
function client(responses:any[]=[]){
 const calls:any[]=[];
 const b={goto:async()=>{},page:{evaluate:async(_fn:unknown,args:any)=>{calls.push(args);return responses.shift()??{status:200,data:{data:{id:'77',type:'fixture'}}};},waitForTimeout:async()=>{}}} as unknown as Browser;
 return {b,calls};
}
test('chat audience relationships and publication are explicit',()=>{
 expect(chatPayload('12',{name:'Members',audience:'selected_tiers',tiers:['34']},true)).toEqual({data:{type:'stream-channel',relationships:{campaign:{data:{type:'campaign',id:'12'}},rewards:{data:[{type:'reward',id:'34'}]}},attributes:{channel_type:'community_chat_lounge',has_live_audio:false,published:false,name:'Members',audience_type:'selected_tiers'}}});
 expect(()=>chatPayload('12',{audience:'selected_tiers'},true)).toThrow();
 expect(()=>chatPayload('12',{name:'x'.repeat(49),audience:'paid_members'},true)).toThrow();
 expect(channelParts('community_chat_lounge:abc-def')).toEqual(['community_chat_lounge','abc-def']);
 expect(()=>channelParts('https://evil.invalid/x')).toThrow();expect(()=>resourceId('../users')).toThrow();
});
test('moderator invitation uses a user relationship; removal uses assignment ID',async()=>{
 const {b,calls}=client();await addModerator(b,'123');await removeModerator(b,'456');
 expect(calls[0]).toMatchObject({path:'/api/community_moderator',method:'POST',body:{data:{type:'community_moderator',relationships:{user:{data:{type:'user',id:'123'}}}}}});
 expect(calls[1]).toMatchObject({path:'/api/community_moderator/456',method:'DELETE'});
});
test('blocking does not silently delete comments; unblock uses block ID',async()=>{
 const {b,calls}=client();await block(b,'123');await unblock(b,'456');
 expect(calls[0].body).toEqual({data:{type:'block',attributes:{},relationships:{blocked:{data:{type:'user',id:'123'}}}}});
 expect(calls[1]).toMatchObject({path:'/api/blocks/456',method:'DELETE'});
});
test('report keep and removal wait for matching persisted status',async()=>{
 const {b,calls}=client([{status:200,data:{data:null}},{status:200,data:{data:{attributes:{status:'removed'}}}}]);
 expect(await resolveReport(b,'report-1','remove')).toEqual({status:'removed',id:'report-1'});
 expect(calls[0].body).toEqual({data:{type:'stream-message-report',attributes:{status:'removed'}}});
});
test('lounge lifecycle uses the website routes and preserves unspecified settings',async()=>{
 const {b,calls}=client();await createChat(b,'12',{name:'Example',audience:'all_members'});await editChat(b,'abc','12',{name:'Renamed'});await deleteChat(b,'abc');
 expect(calls.map(c=>[c.path,c.method])).toEqual([['/api/chat/lounge','POST'],['/api/chat/lounge/abc','PATCH'],['/api/chat/lounge/abc','DELETE']]);
 expect(calls[1].body.data.attributes).toEqual({name:'Renamed'});
});
test('DM creates one explicit recipient conversation then submits its content',async()=>{
 const {b,calls}=client();await sendDM(b,'12','34','Good work!');
 expect(calls[0].body.data.relationships.participants.data).toEqual([{type:'user',id:'34'}]);
 expect(calls[1].body).toEqual({data:{type:'message_v2',attributes:{content:'Good work!'},relationships:{conversation:{data:{type:'conversation',id:'77'}}}}});
 expect(calls.some(c=>c.path.includes('/members'))).toBe(false);
});
test('permission failures and interrupted writes are not success',async()=>{
 const {b}=client([{status:403,data:{errors:[{title:'Forbidden'}]}}]);await expect(block(b,'123')).rejects.toMatchObject({code:'WRITE_REJECTED'});
 const uncertain=client([{status:-1,data:null}]);await expect(addModerator(uncertain.b,'123')).rejects.toMatchObject({code:'WRITE_UNCERTAIN'});
});
test('community writes require confirmation before opening a browser',()=>{
 const result=Bun.spawnSync([process.execPath,'patreoncli.ts','block','123','--browser-path','/missing'],{cwd:import.meta.dir+'/..'});
 expect(JSON.parse(result.stderr.toString()).error.code).toBe('CONFIRMATION_REQUIRED');
});
