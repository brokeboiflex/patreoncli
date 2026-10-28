import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {paginate,decodeCursor} from '../src/site-api.ts';
import {selectAccessRules,pollPayload,richHTML,collectionAttributes,createCollection,editCollection,editRich} from '../src/content.ts';
import {attachmentFile,uploadMessage} from '../src/community.ts';
import type {Browser} from '../src/browser.ts';
const resource=(id:string)=>({id,type:'post'});
function client(responses:any[]){const calls:any[]=[];return {calls,b:{goto:async()=>{},page:{evaluate:async(_fn:unknown,args:any)=>{calls.push(args);return{status:200,data:responses.shift()};}}} as unknown as Browser};}
test('cursor preserves unused rows and follows Patreon meta cursors',async()=>{
 const get=async(url:string)=>new URL(url,'https://www.patreon.com').searchParams.has('page[cursor]')?{data:[resource('c')]}:{data:[resource('a'),resource('b')],meta:{pagination:{cursors:{next:'page-2'}}}};
 const one=await paginate('/api/posts',1,{},get);expect(one.items.map(r=>r.id)).toEqual(['a']);
 const two=await paginate('/api/posts',1,{cursor:one.cursor!},get);expect(two.items.map(r=>r.id)).toEqual(['b']);
 const three=await paginate('/api/posts',1,{cursor:two.cursor!},get);expect(three.items.map(r=>r.id)).toEqual(['c']);expect(three.cursor).toBeNull();
 expect((await paginate('/api/posts',1,{all:true},get)).items.map(r=>r.id)).toEqual(['a','b','c']);
});
test('pagination handles links, refuses cycles, and confines cursors to the endpoint',async()=>{
 const result=await paginate('/api/blocks',10,{all:true},async url=>url.includes('?')?{data:[resource('b')]}:{data:[resource('a')],links:{next:{href:'/api/blocks?page=2'}}});expect(result.items).toHaveLength(2);
 await expect(paginate('/api/posts',20,{all:true},async()=>({data:[],links:{next:'/api/posts'}}))).rejects.toMatchObject({code:'UI_CHANGED'});
 expect(()=>decodeCursor(Buffer.from(JSON.stringify({url:'https://evil.invalid/api/posts',offset:0})).toString('base64url'),'/api/posts')).toThrow();
 expect(()=>decodeCursor(Buffer.from(JSON.stringify({url:'/api/blocks',offset:0})).toString('base64url'),'/api/posts')).toThrow();
});
test('audiences resolve campaign rules instead of fabricating tier rule IDs',()=>{
 const doc={included:[{type:'access-rule',id:'10',attributes:{access_rule_type:'public'}},{type:'access-rule',id:'11',attributes:{access_rule_type:'tier'},relationships:{tier:{data:{id:'22'}}}}]};
 expect(selectAccessRules(doc,'tiers',['22'])).toEqual([{type:'access-rule',id:'11'}]);expect(()=>selectAccessRules(doc,'tiers',['23'])).toThrow();expect(()=>selectAccessRules(doc,'paid')).toThrow();
});
test('poll payload matches editor choice ordering and protects polls with responses',()=>{
 const p=pollPayload({choices:['One','Two'],multiple:true});expect(p.included).toEqual([{type:'poll',id:'1',attributes:{question_type:'multiple_choice',closes_at:null}},{type:'poll_choice',id:'0',attributes:{choice_type:'toggle',position:1,text_content:'One'}},{type:'poll_choice',id:'1',attributes:{choice_type:'toggle',position:2,text_content:'Two'}}]);
 expect(pollPayload({choices:['One','Two']},{id:'7',attributes:{question_type:'multiple_choice'}}).included[0]?.attributes).toEqual({question_type:'multiple_choice'});
 expect(()=>pollPayload({choices:['One']})).toThrow();expect(()=>pollPayload({choices:['One','One']})).toThrow();
 expect(()=>pollPayload({multiple:false},{id:'7',attributes:{num_responses:2}})).toThrow();
 const deadline=new Date(Math.floor((Date.now()+86400000)/1000)*1000).toISOString();expect(pollPayload({closesAt:deadline},{id:'7',attributes:{num_responses:2}}).included).toEqual([{type:'poll',id:'7',attributes:{closes_at:deadline}}]);
 expect(()=>pollPayload({closesAt:'2027-01-01T12:00:00'})).toThrow();expect(()=>pollPayload({choices:'bad'} as any)).toThrow();
});
test('rich document produces escaped HTML and rejects unsupported nodes and script links',()=>{
 expect(richHTML({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'<hello>',marks:[{type:'bold'}]}]}]})).toBe('<p><strong>&lt;hello&gt;</strong></p>');
 expect(()=>richHTML({type:'doc',content:[{type:'script'}]})).toThrow();
 expect(()=>richHTML({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'link',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]})).toThrow();
});
test('rich edits accept server key reordering and do not publish or clear other relationships',async()=>{
 const document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hello',marks:[{type:'bold'}]}]}]};
 const {b,calls}=client([{data:{}},{data:{id:'8',attributes:{content_json_string:'{"content":[{"content":[{"marks":[{"type":"bold"}],"text":"hello","type":"text"}],"type":"paragraph"}],"type":"doc"}'}}}]);
 expect((await editRich(b,'8',document)).status).toBe('saved');expect(calls[0].body.data.attributes.tags.publish).toBe(false);expect(calls[0].body.data.relationships).toBeUndefined();expect(calls[0].body.meta.send_notifications).toBe(false);
});
test('collection edits preserve unspecified metadata and validate draft IDs before a write',async()=>{
 expect(collectionAttributes({postIds:['8','9'],order:'custom'})).toEqual({post_ids:[8,9],post_sort_type:'custom'});
 expect(()=>collectionAttributes({postIds:['8','8']})).toThrow();expect(()=>collectionAttributes({description:'x'.repeat(401)})).toThrow();
 const {b,calls}=client([{data:{attributes:{published_at:null}}}]);await expect(createCollection(b,'12',{title:'Example',postIds:['8']})).rejects.toMatchObject({code:'INVALID_ARGUMENT'});expect(calls.every(c=>c.method==='GET')).toBe(true);
 const changed=client([{data:{}},{data:{id:'5',attributes:{title:'Updated'}}}]);await editCollection(changed.b,'5',{title:'Updated'});expect(changed.calls[0].body.data.attributes).toEqual({title:'Updated'});
});
test('chat attachment waits for transferred bytes, sends once, and reports uncertain delivery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-file-')),path=join(dir,'hello.txt');writeFileSync(path,'attachment fixture');
 try{const calls:any[]=[];const channel={sendFile:async(stream:AsyncIterable<Buffer>,name:string,mime:string)=>{let content='';for await(const chunk of stream)content+=chunk.toString();calls.push({content,name,mime});return {file:'https://cdn.example.test/file'};},sendImage:async()=>{throw Error('wrong upload kind');},sendMessage:async(message:any)=>{calls.push(message);return {message:{id:'sent'}};}};
 const file=attachmentFile(path);await uploadMessage(channel as any,path,'file',file,{text:'File',replyTo:'parent'});expect(calls[0].content).toBe('attachment fixture');expect(calls[1]).toMatchObject({text:'File',parent_id:'parent',attachments:[{type:'file',asset_url:'https://cdn.example.test/file',file_size:18}]});
 channel.sendMessage=async()=>{throw Error('disconnected');};await expect(uploadMessage(channel as any,path,'file',file,{})).rejects.toMatchObject({code:'WRITE_UNCERTAIN'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('new content writes require confirmation and invalid inputs fail during dry run',()=>{
 const cwd=import.meta.dir+'/..';const result=Bun.spawnSync([process.execPath,'patreoncli.ts','create-collection','12','--title','Test','--browser-path','/missing'],{cwd});expect(JSON.parse(result.stderr.toString()).error.code).toBe('CONFIRMATION_REQUIRED');
 const invalid=Bun.spawnSync([process.execPath,'patreoncli.ts','create-collection','12','--title','Test','--posts','8,8','--dry-run'],{cwd});expect(invalid.exitCode).toBe(2);
});

test('rich lists preserve start numbers and reject unsupported attributes or malformed trees',()=>{
 const doc={type:'doc',content:[{type:'orderedList',attrs:{order:3},content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Third'}]}]}]}]};
 expect(richHTML(doc)).toBe('<ol start="3"><li><p>Third</p></li></ol>');
 expect(()=>richHTML({type:'doc',content:[{type:'paragraph',attrs:{style:'unsupported'}}]})).toThrow();
 expect(()=>richHTML({type:'doc',content:[{type:'paragraph',content:'bad' as any}]})).toThrow();
});
