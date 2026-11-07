import {createContext,useContext,type ReactNode} from 'react';
import type {User} from '../api/types';
export interface Session {user:User;name:string;companyId:string;isAdmin:boolean;isOwner:boolean;canAdmin:boolean;permissions:string;timezone:string;dateFormat:string;writableProjectIds?:string[];allowInvoices?:boolean;taskDetailsModal?:boolean;evaluation?:boolean;sourceUrl?:string}
const Context=createContext<Session|null>(null);
export function TeamSessionProvider({session,children}:{session:Session;children:ReactNode}){return <Context.Provider value={session}>{children}</Context.Provider>;}
export function useSession(){const value=useContext(Context);if(!value)throw Error('Project session unavailable.');return value;}
export function useProjectWritable(projectId?:string){const{writableProjectIds}=useSession();return writableProjectIds===undefined||Boolean(projectId&&writableProjectIds.includes(projectId));}
