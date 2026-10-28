import type { Browser } from "./browser.ts";
import { ClientError, UiChanged, WriteUncertain } from "./errors.ts";

/** Website JSON:API contracts inspected in Patreon's moderation and messaging bundles.
 * This uses the signed-in website session, not the public OAuth API. */
export async function request(b: Browser, path: string, method = "GET", body?: unknown): Promise<any> {
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

export interface ListOptions { cursor?: string; all?: boolean; }
type Resume = { url: string; offset: number };
function apiURL(value: string, path: string): URL {
  const url = new URL(value, 'https://www.patreon.com');
  if (url.origin !== 'https://www.patreon.com' || url.pathname !== path || url.username || url.password) throw new ClientError('Pagination cursor belongs to another endpoint.', 'INVALID_ARGUMENT');
  return url;
}
export function decodeCursor(cursor: string, path: string): Resume {
  try {
    if (cursor.length > 16000) throw Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!Number.isSafeInteger(value.offset) || value.offset < 0) throw Error();
    const url = apiURL(value.url, path);
    return { url: url.pathname + url.search, offset: value.offset };
  } catch { throw new ClientError('Invalid cursor for this list.', 'INVALID_ARGUMENT'); }
}
function nextURL(doc: any, current: string, path: string): string | null {
  const link = typeof doc.links?.next === 'object' ? doc.links.next?.href : doc.links?.next;
  if (link) { const u = apiURL(link, path); return u.pathname + u.search; }
  const cursor = doc.meta?.pagination?.cursors?.next;
  if (cursor == null || cursor === '') return null;
  const u = apiURL(current, path); u.searchParams.set('page[cursor]', String(cursor));
  return u.pathname + u.search;
}
/** Keep an offset within an oversized page, so a small --limit never drops rows. */
export async function paginate(firstURL: string, limit: number, options: ListOptions, get: (url: string) => Promise<any>, initial?: any) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ClientError('Limit must be 1–500.', 'INVALID_ARGUMENT');
  const path = new URL(firstURL, 'https://www.patreon.com').pathname;
  const first = apiURL(firstURL, path);
  let {url,offset} = options.cursor ? decodeCursor(options.cursor, path) : {url:first.pathname+first.search,offset:0};
  const items:any[] = [], included = new Map<string,any>(), seen = new Set<string>();
  let cursor:string|null = null;
  while (true) {
    if (seen.has(url)) throw new UiChanged('Patreon returned a pagination cycle.');
    seen.add(url);
    const doc = initial && !options.cursor && seen.size === 1 ? initial : await get(url);
    if (!Array.isArray(doc.data) || offset > doc.data.length) throw new UiChanged('List changed while resuming. Restart the list.');
    for (const item of doc.included ?? []) included.set(`${item.type}:${item.id}`,item);
    const available = doc.data.slice(offset), take = options.all ? available.length : Math.min(available.length,limit-items.length);
    items.push(...available.slice(0,take)); offset += take;
    const next = offset < doc.data.length ? {url,offset} : (() => {const n=nextURL(doc,url,path);return n?{url:n,offset:0}:null;})();
    if (!next) break;
    if (!options.all && items.length >= limit) { cursor=Buffer.from(JSON.stringify(next)).toString('base64url');break; }
    url=next.url;offset=next.offset;
  }
  return {items,included:[...included.values()],cursor,next:cursor,truncated:cursor!==null};
}
export async function listResources(b:Browser,path:string,limit=20,options:ListOptions={}) { return paginate(path,limit,options,url=>request(b,url)); }
