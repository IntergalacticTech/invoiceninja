import {useSyncExternalStore} from 'react';
import type {Project} from './api/types';
export interface Route{segments:string[];query:URLSearchParams}
let basePath='/work';
export function configureTeamRouter(value:string){basePath=value;}
const snapshot=()=>window.location.pathname+window.location.search+window.location.hash;
function parse():Route{const query=new URLSearchParams(window.location.search);const id=query.get('project_id');return{segments:id?['project',id]:['projects'],query};}
const subscribe=(fn:()=>void)=>{
 const click=(event:MouseEvent)=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const anchor=(event.target as Element)?.closest?.('a');if(!anchor||anchor.target||anchor.hasAttribute('download'))return;
  const url=new URL(anchor.href,window.location.href);if(url.origin!==window.location.origin||url.pathname!==basePath)return;
  event.preventDefault();navigate(url.pathname+url.search);
 };
 window.addEventListener('popstate',fn);document.addEventListener('click',click);
 return()=>{window.removeEventListener('popstate',fn);document.removeEventListener('click',click);};
};
export function useRoute():Route{useSyncExternalStore(subscribe,snapshot,snapshot);return parse();}
export const projectSlug=(name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project';
export function href(path:string){
 const [pathname='',search='']=path.split('?');const input=new URLSearchParams(search);const query=new URLSearchParams();
 const project=/^\/(?:project|projects)\/([^/]+)$/.exec(pathname);
 if(project){const identifier=decodeURIComponent(project[1]||'');query.set('project_id',identifier.includes('--')?identifier.split('--').slice(-1)[0]||identifier:identifier);}
 if(input.get('inactive'))query.set('inactive',input.get('inactive')!);
 const task=input.get('task')||input.get('task_id');if(task)query.set('task_id',task);
 return basePath+(query.size?'?'+query.toString():'');
}
export function navigate(path:string){const target=path.startsWith(basePath)?path:href(path);window.history.pushState(null,'',target);window.dispatchEvent(new PopStateEvent('popstate'));}
export const projectHref=(p:Pick<Project,'name'|'id'>&{archived_at?:number})=>href(`/project/${projectSlug(p.name)}--${encodeURIComponent(p.id)}${p.archived_at?'?inactive=1':''}`);
export function taskHref(id:string){const q=new URLSearchParams(window.location.search);q.set('task_id',id);return basePath+'?'+q.toString();}
export function closeTask(){const q=new URLSearchParams(window.location.search);q.delete('task_id');q.delete('task');window.history.replaceState(null,'',basePath+(q.size?'?'+q.toString():''));window.dispatchEvent(new PopStateEvent('popstate'));}
