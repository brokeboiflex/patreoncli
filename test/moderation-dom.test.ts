import {afterAll,beforeAll,test,expect} from 'bun:test';
import {chromium,type Browser as Engine,type Page} from 'playwright-core';
import type {Browser} from '../src/browser.ts';
import {autoModeration} from '../src/web-actions.ts';

// The live website keeps the old aria-checked value until PATCH completes.
// No account session is loaded; every request is fulfilled or aborted locally.
const browserTest=process.env.PATREONCLI_BROWSER?test:test.skip;
let engine:Engine,page:Page,enabled=true,patches=0;
beforeAll(async()=>{
 if(!process.env.PATREONCLI_BROWSER)return;
 engine=await chromium.launch({executablePath:process.env.PATREONCLI_BROWSER});page=await engine.newPage();
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='https://www.patreon.com')return route.abort();
  if(url.pathname==='/moderation-hub'&&request.method()==='GET')return route.fulfill({contentType:'text/html',body:`<main><button role="switch" aria-label="Toggle comment auto-moderation" aria-checked="${enabled}">Moderate</button></main><script>
  const button=document.querySelector('button');button.onclick=async()=>{const next=button.getAttribute('aria-checked')!=='true';await fetch('/api/campaigns/123',{method:'PATCH',body:JSON.stringify({enabled:next})});button.setAttribute('aria-checked',String(next));};
  </script>`});
  if(url.pathname==='/api/campaigns/123'&&request.method()==='PATCH'){
   await new Promise(resolve=>setTimeout(resolve,150));enabled=request.postDataJSON().enabled;patches++;
   return route.fulfill({json:{data:{id:'123',type:'campaign'}}});
  }
  return route.abort();
 });
},30000);
afterAll(async()=>{await engine?.close();});
browserTest('auto-moderation waits for asynchronous PATCH, reloads, and restores without duplicate writes',async()=>{
 const b={page,goto:async(url:string)=>{await page.goto(new URL(url,'https://www.patreon.com').href);},guard:async()=>{}} as unknown as Browser;
 expect(await autoModeration(b,false)).toEqual({status:'saved',enabled:false});expect(enabled).toBe(false);expect(patches).toBe(1);
 expect(await autoModeration(b,false)).toEqual({status:'unchanged',enabled:false});expect(patches).toBe(1);
 expect(await autoModeration(b,true)).toEqual({status:'saved',enabled:true});expect(enabled).toBe(true);expect(patches).toBe(2);
});
