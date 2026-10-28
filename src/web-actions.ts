import { paginate, decodeCursor, type ListOptions } from "./site-api.ts";
import type { Locator, Response } from "playwright-core";
import { basename, resolve } from "node:path";
import { statSync } from "node:fs";
import { Browser, siteURL } from "./browser.ts";
import { ClientError, NotLoggedIn, UiChanged, WriteUncertain } from "./errors.ts";
import { one, clickNamed, countLimit } from "./ui.ts";
import { S } from "./selectors.ts";

type Resource = { id: string; type: string; attributes?: Record<string, any>; relationships?: Record<string, any> };
type Document = { data: Resource | Resource[]; included?: Resource[]; links?: { next?: string | null }; meta?: unknown; errors?: unknown[] };
export interface PostOptions {
  title?: string; text?: string; audience?: "free" | "paid";
  comments?: keyof typeof S.commentOptions; notify?: boolean;
}
export function numericId(value: string): string {
  if (!/^\d+$/.test(value)) throw new ClientError("Expected a numeric ID.", "INVALID_ARGUMENT");
  return value;
}
export function postURL(target: string): string {
  if (/^\d+$/.test(target)) return siteURL(`/posts/${target}`);
  const url = siteURL(target);
  if (!/\/posts\/(?:[^/]*-)?\d+(?:\/edit)?\/?$/.test(new URL(url).pathname)) throw new ClientError("Use a post ID or Patreon post URL.", "INVALID_TARGET");
  return url;
}
export function postId(target: string): string {
  const m = new URL(postURL(target)).pathname.match(/\/posts\/(?:[^/]*-)?(\d+)(?:\/edit)?\/?$/);
  return numericId(m![1]!);
}

async function jsonResponse(response: Response): Promise<Document> {
  if (!response.ok()) throw new ClientError(`Patreon returned HTTP ${response.status()}.`, "HTTP_ERROR");
  const value = await response.json().catch(() => null);
  if (!value || value.errors?.length || !Object.hasOwn(value, "data")) throw new UiChanged("The site returned an unexpected data response.");
  return value;
}

/** Only GETs to observed same-site JSON API routes. Writes go through the UI. */
async function getJSON(b: Browser, target: string): Promise<Document> {
  const url = siteURL(target);
  if (new URL(url).origin !== new URL(b.page.url()).origin || !new URL(url).pathname.startsWith("/api/")) throw new ClientError("Expected a same-origin API read.", "INVALID_TARGET");
  const result = await b.page.evaluate(async url => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, url);
  if (result.status >= 400) throw new ClientError(`Patreon returned HTTP ${result.status}.`, "HTTP_ERROR");
  if (!result.data || result.data.errors?.length || !Object.hasOwn(result.data,"data")) throw new UiChanged("Unexpected Patreon API response.");
  return result.data;
}

async function capturedList(b: Browser, pageURL: string, apiPath: string, limit: number, options: ListOptions = {}): Promise<unknown> {
  countLimit(limit);
  if (options.cursor) {
    const resume=decodeCursor(options.cursor,apiPath);
    await b.goto("/messages?mode=campaign");
    return paginate(resume.url,limit,options,url=>getJSON(b,url));
  }
  const pending=b.page.waitForResponse(r=>new URL(r.url()).pathname===apiPath&&r.request().method()==="GET",{timeout:30000}).catch(()=>null);
  await b.goto(pageURL);
  const response=await pending;
  if(!response)throw new UiChanged(`No ${apiPath} data arrived. The account may lack access to this page.`);
  return {...await paginate(response.url(),limit,options,url=>getJSON(b,url),await jsonResponse(response)),url:b.page.url()};
}

export async function whoami(b: Browser): Promise<unknown> {
  await b.goto("/create");
  const own = b.page.locator('nav a[href*="/cw/"]');
  await own.first().waitFor().catch(() => { throw new NotLoggedIn(); });
  const url = siteURL((await own.first().getAttribute("href"))!);
  return { creator: new URL(url).pathname.split("/")[2], url };
}
export async function posts(b: Browser, status: "published" | "drafts" = "published", limit = 20, options: ListOptions = {}): Promise<unknown> {
  return capturedList(b,`/posts/${status}`,"/api/posts",limit,options);
}
export async function members(b: Browser, limit = 20, options: ListOptions = {}): Promise<unknown> {
  return capturedList(b,"/members","/api/members",limit,options);
}

const postFields = "title,content,content_json_string,published_at,scheduled_for,url,post_type,comments_write_access_level,new_post_email_type,min_cents_pledged_to_view,post_metadata";
async function postState(b: Browser, id: string): Promise<Resource> {
  const query = new URLSearchParams({ "fields[post]": postFields, "json-api-version":"1.0", "json-api-use-default-includes":"false" });
  const doc = await getJSON(b,`/api/posts/${numericId(id)}?${query}`);
  if (Array.isArray(doc.data) || doc.data.type !== "post") throw new UiChanged("Expected a post response.");
  return doc.data;
}
export async function read(b: Browser, target: string): Promise<Resource> {
  // Drafts have no public post page. Initialize a same-origin session, then use
  // the observed post read endpoint for both draft and published resource IDs.
  postId(target);
  await b.goto("/");
  return postState(b,postId(target));
}

export async function comments(b: Browser, target: string, limit = 20, options: ListOptions = {}): Promise<unknown> {
  return capturedList(b,postURL(target),`/api/posts/${postId(target)}/conversations`,limit,options);
}

async function editor(b: Browser, target?: string): Promise<string> {
  if (target) {
    const id=postId(target);
    await b.goto("/");
    const state=await postState(b,id);
    if(typeof state.attributes?.url!=="string") throw new UiChanged("The post has no canonical URL.");
    const url=new URL(postURL(state.attributes.url));
    url.pathname=url.pathname.replace(/\/edit\/?$/,"")+"/edit";
    await b.goto(url.href);
  } else {
    await b.goto("/create");
    const button = await one(b.page.getByRole("button", { name: S.create }), "Create post button");
    await button.click();
    await b.page.waitForURL(/\/posts\/\d+\/edit(?:\?|$)/);
    await b.guard();
  }
  await one(b.page.locator(S.title), "post title");
  return postId(b.page.url());
}

const normalized = (s: string) => s.replace(/\s+/g," ").trim();
export function documentText(value: string | null | undefined): string {
  if (!value) return "";
  const visit = (node: any): string => typeof node?.text === "string" ? node.text : Array.isArray(node?.content) ? node.content.map(visit).join(["doc","bulletList","orderedList"].includes(node.type) ? "\n" : "") : "";
  try { return visit(JSON.parse(value)); } catch { return ""; }
}
async function waitPost(b: Browser, id: string, matches: (a: Record<string,any>) => boolean, description: string): Promise<Resource> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await postState(b,id);
    if (state.attributes && matches(state.attributes)) return state;
    await b.page.waitForTimeout(600);
  }
  throw new WriteUncertain(`Could not verify ${description} for post ${id}. Draft/editor URL: ${b.page.url()}.`);
}
async function fillPost(b: Browser, id: string, options: PostOptions): Promise<Resource> {
  const original = await postState(b,id);
  if (options.title !== undefined) { await b.page.locator(S.title).fill(options.title); await b.page.locator(S.title).blur(); }
  if (options.text !== undefined) { const input=await one(b.page.locator(S.body), "post body editor"); await input.fill(options.text); await input.blur(); }
  if (options.audience) {
    const name = options.audience === "free" ? /^(Set to free access|Free access|Ustaw na dostęp bezpłatny)$/i : /^(Paid access|Dostęp płatny)/i;
    await (await one(b.page.getByRole("radio", { name }), "post audience option")).check();
  }
  if (options.comments) {
    await b.page.getByRole("combobox",{ name:S.commentsAccess }).click();
    await b.page.getByRole("option",{ name:S.commentOptions[options.comments] }).click();
  }
  if (options.notify !== undefined) {
    await clickNamed(b.page,/^(Emails and notifications|E-maile i powiadomienia)$/i);
    const toggle = await one(b.page.getByRole("switch",{ name:/^(Allow members to receive notifications|Zezwól członkom na otrzymywanie powiadomień)/i }),"post notification toggle");
    await toggle.setChecked(options.notify);
    await clickNamed(b.page,S.close);
  }
  // Patreon only autosaves drafts. Published/scheduled posts need explicit Save.
  if (original.attributes?.published_at || original.attributes?.scheduled_for) {
    await clickNamed(b.page,/^(Save|Save changes|Save without notifying|Zapisz|Zapisz zmiany|Zapisz bez powiadamiania)$/i);
  }
  // A stale "Saved" label is insufficient: read back the fields after saving.
  const result = await waitPost(b,id,a =>
    (options.title === undefined || a.title === options.title) &&
    (options.text === undefined || normalized(documentText(a.content_json_string)) === normalized(options.text)) &&
    (options.comments === undefined || a.comments_write_access_level === ({ everyone:"all",members:"all_members",paid:"paid_members",none:"none" })[options.comments]) &&
    (options.notify === undefined || !!original.attributes?.published_at || (a.post_metadata?.send_notifications ?? true) === options.notify), "post save");
  if (options.audience) {
    // The current audience is represented by access-rule relationships, not price.
    await b.page.reload({ waitUntil:"domcontentloaded" });
    await b.guard();
    const name = options.audience === "free" ? /^(Set to free access|Free access|Ustaw na dostęp bezpłatny)$/i : /^(Paid access|Dostęp płatny)/i;
    const radio = await one(b.page.getByRole("radio",{ name }),"saved audience");
    if (!await radio.isChecked()) throw new WriteUncertain(`Audience change for post ${id} did not persist.`);
  }
  return result;
}

export async function draft(b: Browser, options: PostOptions): Promise<unknown> {
  if (!options.title?.trim() || !options.text?.trim()) throw new ClientError("Title and text are required.","INVALID_ARGUMENT");
  const id = await editor(b);
  try { return { status:"saved", post:await fillPost(b,id,options), editorUrl:b.page.url() }; }
  catch (error) { throw new WriteUncertain(`Draft ${id} was created at ${b.page.url()}. ${error instanceof Error ? error.message : error}`); }
}
export async function edit(b: Browser, target: string, options: PostOptions): Promise<unknown> {
  const id = await editor(b,target);
  return { status:"saved", post:await fillPost(b,id,options), editorUrl:b.page.url() };
}
export async function publish(b: Browser, target: string): Promise<unknown> {
  const id = await editor(b,target);
  const initial = await postState(b,id);
  if (initial.attributes?.published_at) throw new ClientError("This post is already published.","ALREADY_PUBLISHED");
  const button = await one(b.page.getByRole("button",{ name:S.publish }),"Publish button");
  if (!await button.isEnabled()) throw new ClientError("Patreon has disabled publishing. Complete the draft or creator setup first.","WRITE_REJECTED");
  await button.click();
  // Some accounts present a final publication dialog. Never click page launch.
  const dialog = b.page.getByRole("dialog");
  const confirm = dialog.getByRole("button",{ name:S.publish });
  if (await confirm.isVisible().catch(() => false)) await (await one(confirm,"publication confirmation")).click();
  return { status:"published", post:await waitPost(b,id,a => !!a.published_at,"publication") };
}
export async function post(b: Browser, options: PostOptions): Promise<unknown> {
  const result = await draft(b,options) as { post: Resource; editorUrl:string };
  return publish(b,result.editorUrl);
}

export function scheduleTime(value:string):number {
  const instant=Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(instant) || instant<=Date.now()) throw new ClientError("Use a future ISO time with timezone and minute precision, e.g. 2030-01-10T14:00:00+01:00.","INVALID_ARGUMENT");
  return instant;
}
export async function schedule(b:Browser,target:string,when:string):Promise<unknown> {
  const instant=scheduleTime(when),id=await editor(b,target);
  const original=await postState(b,id);
  if(original.attributes?.published_at) throw new ClientError("A published post cannot be scheduled as a new post.","ALREADY_PUBLISHED");
  const heading=b.page.getByRole("heading",{name:/^(Set publication date|Set publish date|Ustaw datę publikacji)$/i});
  await (await one(heading.locator("..").getByRole("switch"),"schedule toggle")).setChecked(true);
  const local=await b.page.evaluate(ms=>{
    const parts=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
    const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,zone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  },instant);
  await b.page.getByRole("textbox",{name:/^(Schedule date|Zaplanuj datę)$/i}).fill(local.date);
  await b.page.getByRole("textbox",{name:/^(Schedule time|Zaplanuj godzinę)$/i}).fill(local.time);
  await clickNamed(b.page,/^(Schedule|Zaplanuj)$/i);
  return {status:"scheduled",timezone:local.zone,post:await waitPost(b,id,a=>Date.parse(a.scheduled_for)===instant,"scheduled publication")};
}

export async function attach(b:Browser,target:string,path:string,type:"image"|"audio"|"video"|"attachment"="attachment"):Promise<unknown> {
  const file=resolve(path),info=statSync(file);
  if(!info.isFile())throw new ClientError("Expected a local media file.","INVALID_ARGUMENT");
  const id=await editor(b,target),original=await postState(b,id);
  if(original.attributes?.published_at||original.attributes?.scheduled_for)throw new ClientError("Attach media to a draft before publishing or scheduling it.","INVALID_ARGUMENT");
  const query=new URLSearchParams({include:"attachments_media,images,audio,video","fields[media]":"file_name,size_bytes,state,media_type","json-api-version":"1.0","json-api-use-default-includes":"false"});
  const before=await getJSON(b,`/api/posts/${id}?${query}`);
  const previousIds=new Set((before.included??[]).map(m=>m.id));
  const names={image:/^(Image|Obraz)$/i,audio:/^Audio$/i,video:/^(Video|Wideo)$/i,attachment:/^(Attachment|Załącznik)$/i};
  const chooser=b.page.waitForEvent("filechooser").catch(()=>null);
  await clickNamed(b.page,names[type]);
  const picker=await chooser;
  if(!picker)throw new UiChanged("The media button did not open a file picker.");
  await picker.setFiles(file);
  const deadline=Date.now()+Math.max(120000,b.options.timeout??0);
  while(Date.now()<deadline){
    const doc=await getJSON(b,`/api/posts/${id}?${query}`);
    const media=doc.included?.find(m=>m.type==="media"&&!previousIds.has(m.id)&&m.attributes?.file_name===basename(file)&&m.attributes?.size_bytes===info.size);
    if(media){
      if(["failed","expired","deleted"].includes(media.attributes?.state))throw new ClientError("Patreon rejected processing this media.","WRITE_REJECTED");
      // Creating the media record happens before the file transfer. Closing the
      // browser during pending_upload aborts the upload while leaving that row.
      if(mediaUploadComplete(media.attributes?.state)) return {status:"attached",postId:id,media,editorUrl:b.page.url()};
    }
    await b.page.waitForTimeout(1000);
  }
  throw new WriteUncertain(`Could not verify media attachment to draft ${id}.`);
}

export function mediaUploadComplete(state:unknown):boolean {
  return state==="uploaded" || state==="ready";
}

export async function deletePost(b: Browser, target: string): Promise<unknown> {
  const id = await editor(b,target);
  await clickNamed(b.page,S.more);
  await clickNamed(b.page,/^(Delete draft|Delete post|Usuń wersję roboczą|Usuń post)$/i);
  // The dialog's wrapper has zero height; its fixed-position buttons are visible.
  // Scope to the dialog, then check visibility/uniqueness on the actual button.
  const confirmation = b.page.getByRole("dialog");
  const pending = b.page.waitForResponse(r => new URL(r.url()).pathname === `/api/posts/${id}` && r.request().method() === "DELETE").catch(() => null);
  await clickNamed(confirmation,/^(Delete|Delete draft|Delete post|Usuń|Usuń wersję roboczą|Usuń post)$/i);
  const response = await pending;
  if (!response) throw new WriteUncertain(`No deletion response for post ${id}.`);
  if (!response.ok()) throw new ClientError(`Deletion rejected (HTTP ${response.status()}).`,"WRITE_REJECTED");
  return { status:"deleted",id };
}

async function commentRow(b: Browser, commentId: string): Promise<Locator> {
  return one(b.page.locator(`#comment-${numericId(commentId)}`),`comment ${commentId}`);
}
async function commentEditor(b: Browser, target: string, replyTo?: string): Promise<Locator> {
  await b.goto(postURL(target));
  if (replyTo) await (await commentRow(b,replyTo)).getByRole("button",{ name:/^(Reply to this comment|Odpowiedz na ten komentarz)$/i }).click();
  const join = b.page.getByRole("button",{ name:/^(Join for free to comment|Dołącz.*koment)/i });
  if (await join.isVisible().catch(() => false)) throw new ClientError("Your account cannot comment on this post without joining. No membership was created.","ACCESS_DENIED");
  return one(b.page.locator('main [contenteditable="true"][role="textbox"], main textarea').filter({ visible:true }),"comment editor");
}
async function commentWrite(b: Browser, action: () => Promise<void>, commentId?: string): Promise<unknown> {
  const response = b.page.waitForResponse(r => /^\/api\/comments(?:\/\d+)?$/.test(new URL(r.url()).pathname) && ["POST","PATCH","DELETE"].includes(r.request().method()) && (!commentId || new URL(r.url()).pathname.endsWith(`/${commentId}`))).catch(() => null);
  await action();
  const result = await response;
  if (!result) throw new WriteUncertain("No comment write response received.");
  if (!result.ok()) throw new ClientError(`Comment write rejected (HTTP ${result.status()}).`,"WRITE_REJECTED");
  if (result.status() === 204) return { status:"deleted",id:commentId };
  const doc = await jsonResponse(result);
  return { status:"submitted",data:doc.data };
}
export async function comment(b: Browser,target:string,text:string,replyTo?:string):Promise<unknown> {
  if (!text.trim()) throw new ClientError("Comment text is required.","INVALID_ARGUMENT");
  const input = await commentEditor(b,target,replyTo);
  await input.fill(text);
  return commentWrite(b,() => clickNamed(b.page,/^(Post comment|Send|Post|Comment|Wyślij|Dodaj komentarz|Opublikuj komentarz)$/i));
}
export async function editComment(b:Browser,target:string,commentId:string,text:string):Promise<unknown> {
  await b.goto(postURL(target));
  const row=await commentRow(b,commentId);
  await row.locator(S.commentMenu).click();
  await clickNamed(b.page,/^(Edit|Edit comment|Edytuj|Edytuj komentarz)$/i);
  await (await one(row.locator('textarea,[contenteditable="true"]'),"comment editor")).fill(text);
  return commentWrite(b,() => clickNamed(row,/^(Save|Save changes|Zapisz|Zapisz zmiany)$/i),commentId);
}
export async function deleteComment(b:Browser,target:string,commentId:string):Promise<unknown> {
  await b.goto(postURL(target));
  await (await commentRow(b,commentId)).locator(S.commentMenu).click();
  await clickNamed(b.page,/^(Delete|Delete comment|Usuń|Usuń komentarz)$/i);
  const dialog=b.page.getByRole("dialog");
  return commentWrite(b,() => clickNamed(dialog,/^(Delete|Delete comment|Usuń|Usuń komentarz)$/i),commentId);
}

export async function moderation(b:Browser,tab:"reported-content"|"moderators"|"auto-moderation"="reported-content"):Promise<unknown> {
  await b.goto(`/moderation-hub?tab=${tab}&mode=creator`);
  const main=await one(b.page.getByRole("main"),"moderation content");
  await main.getByRole("heading").first().waitFor();
  return { url:b.page.url(),text:await main.innerText(),controls:await main.locator('button,[role="switch"],input,[role="combobox"]').evaluateAll(nodes=>nodes.map(e=>({ role:e.getAttribute("role")||e.tagName.toLowerCase(),label:e.getAttribute("aria-label")||e.textContent?.trim(),checked:e.getAttribute("aria-checked")??(e instanceof HTMLInputElement&&e.type==="checkbox"?e.checked:undefined) }))) };
}
export async function autoModeration(b:Browser,enabled:boolean):Promise<unknown> {
  await b.goto("/moderation-hub?tab=auto-moderation&mode=creator");
  const toggle=await one(b.page.getByRole("switch",{ name:/^(Toggle comment auto-moderation|Przełącz automatyczną moderację komentarzy)$/i }),"comment auto-moderation toggle");
  if(await toggle.isChecked()===enabled)return {status:"unchanged",enabled};
  const pending=b.page.waitForResponse(r=>r.request().method()==="PATCH"&&/^\/api\/(campaigns\/\d+|user-automod-filter-settings(?:\/[^/]+)?)$/.test(new URL(r.url()).pathname)).catch(()=>null);
  // Patreon changes aria-checked only after its asynchronous save.
  // setChecked asserts immediately after clicking and can reject a successful write.
  await toggle.click();
  const response=await pending;
  if(!response)throw new WriteUncertain("No response confirming the auto-moderation update.");
  if(!response.ok())throw new ClientError("Patreon rejected the auto-moderation update.","WRITE_REJECTED");
  const receipt=await response.json().catch(()=>null);
  if(!receipt)throw new WriteUncertain("The auto-moderation response did not confirm a save.");
  if(receipt.errors?.length)throw new ClientError("Patreon rejected the auto-moderation update.","WRITE_REJECTED");
  await b.page.reload({ waitUntil:"domcontentloaded" });
  await b.guard();
  const saved=await one(b.page.getByRole("switch",{ name:/^(Toggle comment auto-moderation|Przełącz automatyczną moderację komentarzy)$/i }),"saved auto-moderation toggle");
  if (await saved.isChecked()!==enabled) throw new WriteUncertain("Could not verify auto-moderation setting.");
  return { status:"saved",enabled };
}

export async function chats(b:Browser):Promise<unknown> {
  await b.goto("/messages?mode=campaign&tab=chats");
  const main=await one(b.page.getByRole("main"),"chats");
  await main.getByRole("heading").first().waitFor();
  return { url:b.page.url(),text:await main.innerText(),links:await main.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>({ title:n.textContent?.trim(),url:(n as HTMLAnchorElement).href }))) };
}
