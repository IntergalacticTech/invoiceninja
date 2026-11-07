import type { ListResponse } from './types';
export interface RequestOptions { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; query?: Record<string,string|number|boolean|undefined|null>; body?: unknown; auth?: boolean; token?: string; signal?: AbortSignal; responseType?: 'json'|'blob' }
export interface TeamTransport { request<T>(path:string,options?:RequestOptions):Promise<T>; sourceUrl?:string }
let host:TeamTransport | undefined;
export function configureTeamTransport(value:TeamTransport) { host=value; }
export function setTeamSourceUrl(sourceUrl:string) { if(host)host={...host,sourceUrl}; }
export function teamSourceOrigin() { return new URL(host?.sourceUrl || window.location.origin).origin; }
export class ApiError extends Error { constructor(readonly status:number,message:string){super(message);} }
let active=0;const waiting:(()=>void)[]=[];
export async function api<T>(path:string,options:RequestOptions={}):Promise<T>{
  if(!host)throw new Error('The project host is not connected.');
  const request=host.request;
  if(active>=6)await new Promise<void>(resolve=>waiting.push(resolve));
  active++;
  try{return await request<T>(path,options);}finally{active--;waiting.shift()?.();}
}
export async function fetchAll<T>(path:string,query:NonNullable<RequestOptions['query']>={},perPage=500,maxPages=20):Promise<T[]>{
  const out:T[]=[];
  for(let page=1;page<=maxPages;page++){
    const res=await api<ListResponse<T>>(path,{query:{...query,per_page:perPage,page}});
    out.push(...(res.data||[]));const pg=res.meta?.pagination;
    if(!pg||pg.current_page>=pg.total_pages||!res.data.length)return out;
  }
  throw new Error('This view is too large. Narrow the project or task filter.');
}
export const errorMessage=(error:unknown)=>error instanceof Error?error.message:'The project system could not complete the request.';
