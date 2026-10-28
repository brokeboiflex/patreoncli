import { test, expect } from "bun:test";
import { postId, postURL, documentText, scheduleTime } from "../src/web-actions.ts";

test("Patreon canonical and legacy post URLs resolve the same ID",()=>{
  for(const url of ["143425481","https://www.patreon.com/posts/network-faqs-143425481","https://www.patreon.com/PatreonforCreators/posts/network-faqs-143425481?l=en-GB","https://www.patreon.com/ExampleCreator/posts/2468/edit"]){
    expect(postId(url)).toBe(url.includes("2468")?"2468":"143425481");
  }
  expect(()=>postURL("https://www.patreon.com/settings")).toThrow();
  expect(()=>postURL("https://www.patreon.com.evil.invalid/posts/123")).toThrow();
});
test("post verification reads Remirror text with marks and paragraph boundaries",()=>{
  const doc={type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Hello ",marks:[{type:"bold"}]},{type:"text",text:"world"}]},{type:"paragraph",content:[{type:"text",text:"Next"}]}]};
  expect(documentText(JSON.stringify(doc))).toBe("Hello world\nNext");
  expect(documentText('{"type":"doc","content":[]}')).toBe("");
});
test("scheduling requires a timezone and future minute precision",()=>{
  expect(()=>scheduleTime("2035-01-10T14:00")).toThrow();
  expect(()=>scheduleTime("2020-01-10T14:00Z")).toThrow();
  expect(()=>scheduleTime("2035-01-10T14:00:45Z")).toThrow();
  expect(scheduleTime("2035-01-10T14:00:00+01:00")).toBe(Date.parse("2035-01-10T13:00:00Z"));
});
test("publishing needs confirmation before browser or account access",()=>{
  const result=Bun.spawnSync([process.execPath,"patreoncli.ts","publish","123","--browser-path","/missing"],{cwd:import.meta.dir+"/.."});
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stderr.toString()).error.code).toBe("CONFIRMATION_REQUIRED");
});
test("invalid draft arguments fail before creating an empty draft",()=>{
  const result=Bun.spawnSync([process.execPath,"patreoncli.ts","draft","text","--dry-run"],{cwd:import.meta.dir+"/.."});
  expect(result.exitCode).toBe(2);
});

test("a media record is not a completed file transfer",async()=>{
  const {mediaUploadComplete}=await import("../src/web-actions.ts");
  // States from Patreon's observed media schema and upload-state mapping.
  for(const state of ["pending_upload","expired","failed","deleted",null,undefined])expect(mediaUploadComplete(state)).toBe(false);
  expect(mediaUploadComplete("uploaded")).toBe(true);
  expect(mediaUploadComplete("ready")).toBe(true);
});
test("reading a draft ID uses the API without requiring a public draft page",async()=>{
  const {read}=await import("../src/web-actions.ts");
  const resource={id:"123",type:"post",attributes:{published_at:null,title:"Private draft"}};
  const browser={
    goto:async(path:string)=>{expect(path).toBe("/");},
    page:{url:()=>"https://www.patreon.com/",evaluate:async(_callback:unknown,url:string)=>{
      expect(new URL(url).pathname).toBe("/api/posts/123");return{status:200,data:{data:resource}};
    }},
  } as unknown as import("../src/browser.ts").Browser;
  expect(await read(browser,"123")).toEqual(resource);
});
