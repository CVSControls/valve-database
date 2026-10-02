import { localApi } from './local-backend';

export async function api<T=any>(url:string,options:RequestInit={}):Promise<T>{return localApi<T>(url,options)}
export async function session(){return api<{user:User|null;csrfToken:string}>('/auth/session')}
export function setCsrf(_value:string){}
export interface User{id:string;username:string;role:'admin'|'user'|'uploader'}
