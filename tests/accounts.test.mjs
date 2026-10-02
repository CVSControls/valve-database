import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
let handler,role='admin',active=true,created=0,lastProfile=null,lastAudit=null;
globalThis.__accountsAdmin={
 auth:{getUser:async token=>({data:{user:token==='valid-jwt'?{id:'caller'}:null}}),
  admin:{createUser:async()=>{created++;return{data:{user:{id:'new-user'}}}},deleteUser:async()=>({}),updateUserById:async()=>({})}},
 from(){return{select(){return this},eq(){return this},single:async()=>({data:{role,is_active:active,email:'admin@example.test'}}),
  update(value){lastProfile=value;return{eq:async()=>({})}},insert:async value=>{lastAudit=value;return{}}}},
};
globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':'server-only-key'},serve:fn=>{handler=fn}};
const directory=await mkdtemp(path.join(process.cwd(),'.test-build-'));
await build({entryPoints:['supabase/functions/manage-users/index.ts'],outfile:path.join(directory,'accounts.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{
 name:'auth-mock',setup(api){api.onResolve({filter:/^npm:/},()=>({path:'mock',namespace:'mock'}));api.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.__accountsAdmin;',loader:'js'}))},
}]});
await import(pathToFileURL(path.join(directory,'accounts.mjs')));
after(async()=>{await rm(directory,{recursive:true,force:true});delete globalThis.Deno;delete globalThis.__accountsAdmin});
const call=(body,token='valid-jwt')=>handler(new Request('https://example.supabase.co/functions/v1/manage-users',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)}));
const create={path:'/admin/users',method:'POST',username:'new@example.test',password:'long-password',role:'uploader'};
test('account management rejects missing/invalid auth, viewers, and disabled admins',async()=>{
 assert.equal((await call(create,'')).status,401);assert.equal((await call(create,'invalid-jwt')).status,401);
 role='user';assert.equal((await call(create)).status,403);role='admin';active=false;
 assert.equal((await call(create)).status,403);active=true;assert.equal(created,0);
});
test('admin-created accounts are approved without exposing passwords',async()=>{
 assert.equal((await call({...create,role:'service_role'})).status,400);assert.equal((await call({...create,password:'short'})).status,400);
 assert.equal((await call(create)).status,200);assert.equal(created,1);assert.deepEqual(lastProfile,{role:'uploader',is_active:true});
 assert.equal(lastAudit.action,'user.create');assert.ok(!JSON.stringify(lastAudit).includes('password'));
});
test('active admins cannot be disabled/demoted from website controls',async()=>{
 const response=await call({path:'/admin/users/00000000-0000-0000-0000-000000000001',method:'PUT',role:'user',is_active:false});
 assert.equal(response.status,400);assert.match((await response.json()).error,/cannot be disabled or demoted/);
});
