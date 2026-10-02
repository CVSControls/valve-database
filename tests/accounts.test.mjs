import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
let handler,role='admin',active=true,created=0,lastProfile=null,lastAudit=null,targetRole='admin',targetActive=true,deleted=[],deleteError=null;
globalThis.__accountsAdmin={
 auth:{getUser:async token=>({data:{user:token==='valid-jwt'?{id:'caller'}:null}}),
  admin:{createUser:async()=>{created++;return{data:{user:{id:'new-user'}}}},deleteUser:async id=>{if(deleteError)return{error:{message:deleteError}};deleted.push(id);return{}},updateUserById:async()=>({})}},
 from(){let id;return{select(){return this},eq(_key,value){id=value;return this},single:async()=>({data:{role:id==='caller'?role:targetRole,is_active:id==='caller'?active:targetActive,email:'admin@example.test'}}),
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
test('deletion requires admin access, protects active admins, and audits success',async()=>{
 const id='00000000-0000-0000-0000-000000000002',request={path:'/admin/users/'+id,method:'DELETE'};
 role='user';assert.equal((await call(request)).status,403);role='admin';
 assert.equal((await call(request)).status,400);assert.equal(deleted.length,0);
 targetRole='user';assert.equal((await call(request)).status,200);
 assert.deepEqual(deleted,[id]);assert.equal(lastAudit.action,'user.delete');assert.equal(lastAudit.details.id,id);
 deleteError='Account deletion rejected';assert.equal((await call(request)).status,400);assert.equal(deleted.length,1);deleteError=null;
});
